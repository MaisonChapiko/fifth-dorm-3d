import {buildModel} from './model.js';
import {cameraFrame,createRenderer,hitBox,makeGeometry} from './render.js';

const get = id => document.getElementById(id);
const viewport = get('viewport');
const canvas = get('scene');
const choice = get('object');
const status = get('loading');
const clamp = (value,min,max) => Math.max(min, Math.min(max,value));
const fmt = (value,digits=3) => Number(value.toFixed(digits)).toString();
const pair = p => '('+p.map(x=>fmt(x)).join(', ')+')';
const range = ([x0,y0,x1,y1]) => pair([x0,y0])+' ～ '+pair([x1,y1]);
const rectDims = ([x0,y0,x1,y1]) => fmt(x1-x0)+' × '+fmt(y1-y0);
const equipmentName = item => item.name.replace(/\(.+\)$/,'');
const wallKind = {internal_partition:'間仕切り',between_zones:'ゾーン境界',exterior:'外壁'};
const roomName = '主寝室専用浴室';
const edgeColor = [.17,.31,.32];
const wallColor = [.80,.87,.86];
const openColor = [.65,.38,.07];
const clearColor = [.47,.80,.74];
const selectedColor = [.22,.68,.61];
const fixtureColors = {
  'R.b.tub':[.81,.88,.98], 'R.b.shower':[.37,.65,.71],
  'R.b.vanity':[.81,.71,.54], 'R.b.toilet':[.91,.92,.90],
};

function showError(message) {
  status.hidden = false;
  status.textContent = message;
}

async function start() {
  const response = await fetch('./data/r-bath.json');
  if (!response.ok) throw new Error('設計データを読み込めませんでした ('+response.status+')');
  const data = await response.json();
  const model = buildModel(data);
  let render;
  try {
    render = createRenderer(canvas);
    status.hidden = true;
  } catch (error) { showError(error.message); }
  const objects = new Map();
  const point = (x,y,h) => model.worldPoint(x,y,h);
  const center = ([a,b,c,d],h) => point((a+c)/2,(b+d)/2,h);
  function addObject(id,name,info,anchor,layer) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = name;
    choice.append(opt);
    const item = {id,name,info,anchor,layer};
    objects.set(id,item);
    if (!anchor) return;
    const label = document.createElement('button');
    label.type = 'button';
    label.className = 'label';
    label.dataset.object = id;
    label.textContent = name;
    label.addEventListener('click', event => {
      if (event.detail === 0) select(id);
    });
    get('labels').append(label);
    item.label = label;
  }
  addObject(data.room.id,roomName,[
    ['識別子', data.room.id],
    ['壁芯 / 内法', model.areaCenter.toFixed(2)+' / '+model.areaInner.toFixed(2)+' m²'],
    ['壁芯矩形 1',range(data.room.rects[0])+' ／ '+rectDims(data.room.rects[0])+' m'],
    ['壁芯矩形 2',range(data.room.rects[1])+' ／ '+rectDims(data.room.rects[1])+' m'],
    ['床・天井', '3階 +9.50 m（標高75.50 m）／天井高2.70 m（元資料の仮定）'],
    ['座標系','X＝東、Y＝北。表示原点 (651, 530) と床面。窓0か所。'],
  ],point(652500,534100,.035),'floor');
  for (const wall of model.walls) {
    const {id,orient,line,start,end,kind,half} = wall;
    const coords = orient === 'h' ? [start,line,end,line] : [line,start,line,end];
    addObject(id,'壁 '+id.slice(5)+'｜'+wallKind[kind],[
      ['識別子',id+'（ビューア内）'],['壁芯 (X, Y)',range(coords.map(n=>n/1000))],
      ['壁芯長',fmt((end-start)/1000)+' m'],['壁厚',fmt(2*half/1000)+' m（元資料の仮定）'],
      ['全高',data.display.wallHeightM.toFixed(2)+' m（元資料の水回り天井高）'],
    ],null,'wall');
  }
  for (const o of model.apertures) {
    const door = o.type === 'door';
    const endpoints = o.orient === 'h' ? [o.start/1000,o.xy[1],o.end/1000,o.xy[1]]
      : [o.xy[0],o.start/1000,o.xy[0],o.end/1000];
    const name = ({R_ba_br:'寝室側開口',R_ba_wr:'衣装室側開口'})[o.id] || o.id;
    addObject(o.id,name,[
      ['識別子',o.id],['中心 (X, Y)',pair(o.xy)+' m'],['壁芯両端',range(endpoints)+' m'],
      ['有効幅',o.width.toFixed(2)+' m'],['表示高さ',(o.top-o.bottom).toFixed(2)+' m（暫定表示値）'],
      ['仕様',door?'片開き・浴室側へ開く（元資料）':'窓'],
    ],point(o.xy[0]*1000,o.xy[1]*1000,.04),'opening');
  }
  for (const item of data.furniture) {
    const mesh = model.equipment.find(e=>e.id===item.id);
    addObject(item.id,equipmentName(item),[
      ['識別子',item.id],['外形 (X, Y)',range(item.rect)+' m'],
      ['外形寸法',rectDims(item.rect)+' × 高さ '+fmt(item.h)+' m（元資料の目安）'],
      ['指定クリアランス',item.clear.map(r=>range(r)+' m（'+rectDims(r)+' m）').join(' ／ ')],
    ],center(mesh.rect,item.h+.07),'equipment');
  }
  let mode = 'orbit', camera, frame, geometry, pickers = [], pending = false;
  let gestureMoved = false;
  const pointers = new Map();
  let lastDistance = 0;
  let selected = data.room.id;
  const layers = () => ({
    walls:get('walls').value,
    equipment:get('equipment').checked,
    names:get('names').checked,
    clearance:get('clearance').checked,
  });
  const quad = (rect,h) => {
    const [a,b,c,d] = rect;
    return [point(a,b,h),point(c,b,h),point(c,d,h),point(a,d,h)];
  };
  const border = (shape,color) => {
    for (let i=0;i<4;i++) geometry.line(shape[i],shape[(i+1)%4],color);
  };
  function meshes() {
    const layer = layers();
    geometry = makeGeometry();
    pickers = [];
    for (const rect of model.floor) {
      geometry.quad(quad(rect,0),[.97,.98,.97]);
      pickers.push({id:data.room.id,world:model.worldBox({rect,lo:0,hi:0})});
    }
    for (const wall of model.walls) {
      const {orient,line,start,end} = wall;
      const p = (n,h) => orient === 'h' ? point(n,line,h) : point(line,n,h);
      geometry.line(p(start,.006),p(end,.006),[.49,.59,.57]);
    }
    for (const opening of model.apertures) {
      const poly = quad(opening.rect,.009);
      geometry.quad(poly,selected===opening.id?[.99,.77,.33]:[.97,.89,.71]);
      border(poly,openColor);
      pickers.push({id:opening.id,world:model.worldBox({rect:opening.rect,lo:0,hi:.009})});
    }
    if (layer.walls !== 'none') {
      const limit = layer.walls === 'cut' ? .85 : data.display.wallHeightM;
      for (const box of model.boxes) {
        if (box.lo >= limit) continue;
        const world = model.worldBox({...box,hi:Math.min(box.hi,limit)});
        geometry.box(world,selected===box.id?selectedColor:wallColor);
        pickers.push({id:box.id,world});
      }
    }
    for (const e of model.equipment) {
      if (layer.clearance) for (const rect of e.clear) {
        const poly = quad(rect,.012);
        geometry.quad(poly,clearColor);
        border(poly,edgeColor);
      }
      if (!layer.equipment) continue;
      const world = model.worldBox(e);
      const color = selected===e.id?selectedColor:(fixtureColors[e.id] || [.77,.83,.85]);
      if (e.id === 'R.b.shower') geometry.quad(quad(e.rect,.012),color);
      geometry.box(world,color,selected===e.id?[.05,.38,.34]:edgeColor,e.id==='R.b.shower');
      pickers.push({id:e.id,world});
    }
  }
  function refresh() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      if (!render) return;
      const width = canvas.clientWidth, height = canvas.clientHeight;
      if (!width || !height) return;
      frame = cameraFrame(camera,width,height);
      render(frame,geometry);
      const layer = layers();
      for (const obj of objects.values()) {
        if (!obj.label) continue;
        const [x,y,z] = frame.project(obj.anchor);
        obj.label.hidden = !layer.names || (obj.layer === 'equipment' && !layer.equipment) ||
          z < .06 || x < 15 || x > width-15 || y < 13 || y > height-13;
        if (obj.label.hidden) continue;
        const half = obj.label.offsetWidth/2;
        obj.label.style.left = clamp(x,half+2,width-half-2)+'px';
        obj.label.style.top = y+'px';
      }
      const [x1,y1] = frame.project(camera.target);
      const [x2,y2] = frame.project([camera.target[0],camera.target[1],camera.target[2]-1]);
      const angle = mode==='inside'?camera.yaw*180/Math.PI-180:Math.atan2(x2-x1,y1-y2)*180/Math.PI;
      get('north').style.transform = 'rotate('+angle+'deg)';
    });
  }
  function select(id) {
    selected = id;
    choice.value = id;
    const list = document.createElement('dl');
    for (const [key,value] of objects.get(id).info) {
      const row = document.createElement('div');
      const term = document.createElement('dt'); term.textContent = key;
      const def = document.createElement('dd'); def.textContent = value;
      row.append(term,def);
      list.append(row);
    }
    get('details').replaceChildren(list);
    for (const obj of objects.values()) obj.label?.classList.toggle('active',obj.id===id);
    meshes();
    refresh();
  }
  function view(next) {
    mode = next;
    const isInside = mode === 'inside';
    camera = {mode,yaw:isInside?-.32:.62,pitch:isInside?-.085:.77,zoom:1,
      target:isInside?[3.62,1.56,-1.33]:[2.5,.46,-3]};
    get('walls').value = isInside ? 'full' : 'cut';
    for (const button of document.querySelectorAll('[data-view]')) {
      button.setAttribute('aria-pressed',String(button.dataset.view===mode));
    }
    get('gesture').textContent = next === 'plan' ? '北を上に固定 · ピンチで拡大・縮小'
      : isInside ? '1本指で見回す · ピンチで視野を調整' : '1本指で回転 · ピンチで拡大・縮小';
    meshes();
    refresh();
  }
  function rotate(dx,dy) {
    if (mode === 'plan') return;
    const sign = mode === 'inside' ? 1 : -1;
    camera.yaw += sign*dx*.008;
    camera.pitch = clamp(camera.pitch+dy*.008,mode==='inside'?-1.43:.07,1.51);
    refresh();
  }
  function zoom(scale) {
    camera.zoom = clamp(camera.zoom*scale,mode==='inside'?.64:.50,4);
    refresh();
  }
  const distance = () => {
    const [a,b] = pointers.values();
    return a && b ? Math.hypot(a.x-b.x,a.y-b.y) : 0;
  };
  viewport.addEventListener('pointerdown',event => {
    if (event.target.closest('.zoom') || (event.pointerType==='mouse' && event.button!==0)) return;
    if (!pointers.size) gestureMoved = false;
    const label = event.target.closest('.label');
    pointers.set(event.pointerId,{x:event.clientX,y:event.clientY,startX:event.clientX,startY:event.clientY});
    (label || viewport).setPointerCapture(event.pointerId);
    lastDistance = distance();
    if (pointers.size>1) gestureMoved = true;
  });
  viewport.addEventListener('pointermove',event => {
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    const {clientX:x,clientY:y} = event;
    if (Math.hypot(x-previous.startX,y-previous.startY)>5) gestureMoved = true;
    pointers.set(event.pointerId,{...previous,x,y});
    if (pointers.size>1) {
      const next = distance();
      if (next>5 && lastDistance>5) zoom(next/lastDistance);
      lastDistance = next;
    } else if (gestureMoved) rotate(x-previous.x,y-previous.y);
  });
  function endPointer(event) {
    if (!pointers.delete(event.pointerId)) return;
    lastDistance = distance();
    if (event.type !== 'pointerup' || gestureMoved || pointers.size || !frame ||
        event.target.closest('.label')) return;
    const rect = viewport.getBoundingClientRect();
    const ray = frame.ray(event.clientX-rect.left,event.clientY-rect.top);
    let best = Infinity, id;
    for (const picker of pickers) {
      const depth = hitBox(picker.world,ray);
      if (depth < best) { best = depth; id = picker.id; }
    }
    if (id) select(id);
  }
  for (const type of ['pointerup','pointercancel','lostpointercapture']) {
    viewport.addEventListener(type,endPointer);
  }
  for (const type of ['touchstart','touchmove','gesturestart','gesturechange']) {
    viewport.addEventListener(type,event => {
      if (!event.target.closest('.zoom') && event.cancelable) event.preventDefault();
    },{passive:false});
  }
  viewport.addEventListener('pointerup', event => {
    const label = event.target.closest('.label');
    if (label && !gestureMoved && !pointers.size) select(label.dataset.object);
  });
  viewport.addEventListener('wheel',event => {
    if (event.cancelable) event.preventDefault();
    zoom(Math.exp(-clamp(event.deltaY,-120,120)*.0025));
  },{passive:false});
  viewport.addEventListener('keydown',event => {
    if (event.target!==viewport) return;
    const moves = {ArrowLeft:[-14,0],ArrowRight:[14,0],ArrowUp:[0,-14],ArrowDown:[0,14]};
    if (moves[event.key]) { event.preventDefault(); rotate(...moves[event.key]); }
    if (['+','=','-'].includes(event.key)) { event.preventDefault(); zoom(event.key==='-'?1/1.2:1.2); }
  });
  choice.addEventListener('change',()=>select(choice.value));
  document.querySelector('form.layers').addEventListener('change',()=>{meshes();refresh();});
  document.querySelector('form.layers').addEventListener('submit',event=>event.preventDefault());
  for (const button of document.querySelectorAll('[data-view]')) {
    button.addEventListener('click',()=>view(button.dataset.view));
  }
  get('reset').addEventListener('click',()=>view('orbit'));
  get('plus').addEventListener('click',()=>zoom(1.2));
  get('minus').addEventListener('click',()=>zoom(1/1.2));
  canvas.addEventListener('webglcontextlost',event=>{
    event.preventDefault();
    render = null;
    showError('3D表示を中断しました。復帰を待つか、ページを再読み込みしてください。');
  });
  canvas.addEventListener('webglcontextrestored',()=>{
    try { render=createRenderer(canvas);status.hidden=true;refresh(); }
    catch (error) { showError(error.message); }
  });
  new ResizeObserver(refresh).observe(viewport);
  view('orbit');
  select(data.room.id);
}

start().catch(error=>{
  showError(error.message);
  console.error(error);
});
