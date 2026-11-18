import {buildSuite,bounds,standingPoint} from './model.js';
import {cameraFrame,createRenderer,hitBox,makeGeometry} from './render.js';

const get=id=>document.getElementById(id);
const viewport=get('viewport'), canvas=get('scene'), choice=get('object'), roomChoice=get('room'), status=get('loading');
const clamp=(x,min,max)=>Math.max(min,Math.min(max,x));
const fmt=(n,digits=3)=>Number(n.toFixed(digits)).toString();
const pair=p=>'('+p.map(n=>fmt(n)).join(', ')+')';
const rectMetres=r=>r.map(x=>x/1000);
const range=([a,b,c,d])=>pair([a,b])+' ～ '+pair([c,d]);
const size=([a,b,c,d])=>fmt(c-a)+' × '+fmt(d-b);
const wallKinds={exterior:'外壁',between_zones:'ゾーン境界',internal_partition:'間仕切り'};
const doorKinds={arch:'扉なし開口',door:'片開き',double:'両開き'};
const palette={
  floor:[.96,.97,.94],focusedFloor:[.85,.94,.90],wall:[.79,.86,.84],outer:[.70,.80,.79],
  edge:[.17,.31,.32],selected:[.25,.69,.59],door:[.92,.78,.50],window:[.47,.74,.86],
  clear:[.49,.80,.74],fixture:[.78,.72,.62],equipment:[.79,.86,.91],
};
const datasets={r:'./data/r.json'};

function showError(message) {
  status.hidden=false;
  status.textContent=message;
}

async function start() {
  const requested=new URLSearchParams(location.search).get('suite')?.toLowerCase() || 'r';
  const response=await fetch(datasets[requested] || datasets.r);
  if (!response.ok) throw new Error('設計データを読み込めませんでした ('+response.status+')');
  const data=await response.json();
  const model=buildSuite(data);
  const rooms=new Map(model.rooms.map(room=>[room.id,room]));
  const point=model.worldPoint;
  const name=id=>rooms.get(id)?.source.name ?? (id==='wing_e.3F.p_cor'?'専用廊下（対象外）':id);
  const objects=new Map();
  const positions=new Map(model.rooms.map(room=>[room.id,standingPoint(room,model.equipment)]));
  get('title').textContent=data.suite+'スイート';
  for (const room of model.rooms) roomChoice.add(new Option(room.source.name,room.id));
  let render;
  try { render=createRenderer(canvas);status.hidden=true; } catch (error) { showError(error.message); }

  const groups=new Map();
  function addObject(id,title,rows,group,{anchor,layer,roomIds=[]}={}) {
    let optionGroup=groups.get(group);
    if (!optionGroup) {
      optionGroup=document.createElement('optgroup');
      optionGroup.label=group;
      choice.append(optionGroup);
      groups.set(group,optionGroup);
    }
    optionGroup.append(new Option(layer==='equipment'?title+' ｜ '+name(roomIds[0]):title,id));
    const item={id,title,rows,anchor,layer,roomIds};
    objects.set(id,item);
    if (anchor) {
      const label=document.createElement('button');
      label.type='button';
      label.className='label';
      label.dataset.object=id;
      label.dataset.layer=layer;
      label.textContent=layer==='transom'?'欄間・寸法未定':title;
      label.hidden=true;
      label.addEventListener('click',event=>{if(event.detail===0) (layer==='room'?focusRoom:select)(id);});
      get('labels').append(label);
      item.label=label;
    }
  }
  const sum=key=>model.rooms.reduce((n,r)=>n+r[key],0);
  addObject('suite',data.suite+'スイート全体',[
    ['対象',model.rooms.length+'室 ／ 家具・設備 '+model.equipment.length+'点'],
    ['壁芯 / 内法',sum('centerArea').toFixed(2)+' / '+sum('innerArea').toFixed(2)+' m²'],
    ['開口',data.doors.length+'か所 ／ 外窓 '+model.apertures.filter(o=>o.type==='window').length+'か所'],
    ['座標系','X＝東・Y＝北。表示原点 '+pair(data.display.originXY)+'。'],
    ['床','3階 +'+fmt(data.display.floorLevelM)+'m（標高 '+fmt(data.display.floorElevationM)+'m）'],
  ],'全体');

  for (const room of model.rooms) {
    const src=room.source, height=data.display.heights[src.short_id], check=data.referenceChecks[src.short_id];
    const associated=model.apertures.filter(o=>o.type==='door' && o.roomIds.includes(room.id));
    addObject(room.id,src.name,[
      ['識別子',src.short_id],['壁芯 / 内法',room.centerArea.toFixed(2)+' / '+room.innerArea.toFixed(2)+' m²'],
      ...src.rects.map((rect,i)=>['壁芯矩形 '+(i+1),range(rect)+' ／ '+size(rect)+' m']),
      ['高さ',height.m.toFixed(2)+'m（'+height.basis+'）'],
      ['接続',associated.map(o=>name(o.between.find(id=>id!==room.id))).join(' ／ ') || '—'],
      ...(check.path.required_m>0?[['元資料の通路幅','必要 '+fmt(check.path.required_m)+'m ／ 最大連続 '+fmt(check.path.max_continuous_width_m)+'m（再計算対象外）']]:[]),
    ],'部屋',{anchor:point(...positions.get(room.id),.04),layer:'room',roomIds:[room.id]});
  }

  for (const wall of model.walls) {
    const {orient,line,start,end,roomIds,kind,half,height}=wall;
    const xy=orient==='h'?[start,line,end,line]:[line,start,line,end];
    addObject(wall.id,wallKinds[kind]+' '+pair(rectMetres(xy.slice(0,2))),[
      ['壁芯両端',range(rectMetres(xy))+' m'],['接する室',roomIds.map(name).join(' ／ ')],
      ['長さ / 厚み',fmt((end-start)/1000)+' / '+fmt(2*half/1000)+' m（壁厚は元資料の仮定）'],
      ['表示高さ',height.toFixed(2)+' m'],
    ],'壁',{roomIds});
  }

  const openingTitle=o=>o.type==='door'
    ? (doorKinds[o.kind] || o.kind)+'｜'+o.between.map(name).join(' ↔ ')
    : '外窓｜'+name(o.roomIds[0])+'・'+o.facing;
  for (const o of model.apertures) {
    const isDoor=o.type==='door';
    const ends=o.orient==='h'?[o.start/1000,o.xy[1],o.end/1000,o.xy[1]]
      :[o.xy[0],o.start/1000,o.xy[0],o.end/1000];
    addObject(o.id,openingTitle(o),[
      ['識別子',o.id],['中心 (X, Y)',pair(o.xy)+' m'],['壁芯両端',range(ends)+' m'],
      ['有効幅',o.width.toFixed(2)+' m'],
      isDoor?['表示開口高',o.top.toFixed(2)+'m（暫定）']
        :['下端 / 上端',o.bottom.toFixed(2)+' / '+o.top.toFixed(2)+' m（上端は暫定）'],
      ...(o.swing_into?[['開く側',name(o.swing_into)]]:[]),
      ...(o.auth && o.auth!=='なし'?[['認証',o.auth]]:[]),
      ...(o.finish?[['元資料の仕様',o.finish]]:[]),
      ...(!isDoor?[['元資料の仕様',o.windowType || '窓']]:[]),
    ],isDoor?'扉・通路開口':'外窓',{layer:'opening',roomIds:o.roomIds});
  }
  for (const item of data.display.transoms) {
    const door=model.apertures.find(o=>o.id===item.doorId);
    addObject(item.id,item.name,[
      ['関連開口',door.id],['設計資料',item.note],['表示方法','該当扉の位置に「欄間」の記号を表示。寸法は未確定。'],
    ],'欄間',{anchor:point(door.xy[0]*1000,door.xy[1]*1000,door.top+.22),layer:'transom',roomIds:door.roomIds});
  }

  for (const item of model.equipment) {
    const f=item.source, [a,b,c,d]=item.rect;
    addObject(item.id,f.name,[
      ['識別子 / 部屋',f.id+' ／ '+name(item.roomId)],['外形 (X, Y)',range(f.rect)+' m'],
      ['外形寸法',size(f.rect)+' × 高さ '+fmt(f.h)+' m（元資料の目安）'],
      ['指定クリアランス',f.clear.length?f.clear.map(r=>range(r)+' m（'+size(r)+' m）').join(' ／ '):'元資料に指定なし'],
      ...(f.note?[['注記',f.note]]:[]),
    ],'家具・設備',{anchor:point((a+c)/2,(b+d)/2,item.hi+.065),layer:'equipment',roomIds:[item.roomId]});
  }

  let mode='orbit', camera, frame, geometry, pickers=[], pending=false, focus='', selected='suite';
  let gestureMoved=false;
  const pointers=new Map();
  let lastDistance=0;
  const layers=()=>({walls:get('walls').value,equipment:get('equipment').checked,roomNames:get('names').checked,
    fixtureNames:get('fixture-names').checked,clearance:get('clearance').checked});
  const quad=([a,b,c,d],h)=>[point(a,b,h),point(c,b,h),point(c,d,h),point(a,d,h)];
  function border(positions,color) {
    for(let i=0;i<positions.length;i++) geometry.line(positions[i],positions[(i+1)%positions.length],color);
  }
  const lineAt=(x,y,a,b,h,color)=>geometry.line(point(x,y,h),point(a,b,h),color);
  function meshes() {
    const layer=layers();
    geometry=makeGeometry();pickers=[];
    const pick=(id,rect,lo,hi)=>pickers.push({id,world:model.worldBox({rect,lo,hi})});
    for(const room of model.rooms) for(const rect of room.floor) {
      geometry.quad(quad(rect,0),room.id===focus||room.id===selected?palette.focusedFloor:palette.floor);
      pick(room.id,rect,0,0);
    }
    const wallLimit=layer.walls==='none'?0:layer.walls==='cut'?data.display.sectionHeightM:Infinity;
    for(const wall of model.walls) {
      if(wallLimit===0) {
        const [a,b,c,d]=wall.orient==='h'?[wall.start,wall.line,wall.end,wall.line]:[wall.line,wall.start,wall.line,wall.end];
        lineAt(a,b,c,d,.006,[.51,.62,.60]);
      }
    }
    for(const w of model.boxes) {
      if(w.lo>=wallLimit) continue;
      const hi=Math.min(w.hi,wallLimit);
      const wall=model.walls.find(x=>x.id===w.id);
      geometry.box(model.worldBox({...w,hi}),selected===w.id?palette.selected:wall.kind==='exterior'?palette.outer:palette.wall);
      pick(w.id,w.rect,w.lo,hi);
    }
    for(const o of model.apertures) {
      const [a,b,c,d]=o.rect;
      const color=selected===o.id?palette.selected:o.type==='door'?palette.door:palette.window;
      if(o.type==='door') {
        const shape=quad(o.rect,.012);
        geometry.quad(shape,color);border(shape,palette.edge);pick(o.id,o.rect,0,.012);
      } else {
        const height=wallLimit===Infinity ? o.bottom+.018 : Math.min(wallLimit,o.bottom)+.018;
        const shape=quad(o.rect,height);
        geometry.quad(shape,color);border(shape,palette.edge);pick(o.id,o.rect,height,height);
        if(wallLimit===Infinity) {
          const [x0,y0,x1,y1]=o.orient==='h'?[a,(b+d)/2,c,(b+d)/2]:[(a+c)/2,b,(a+c)/2,d];
          border([point(x0,y0,o.bottom),point(x1,y1,o.bottom),point(x1,y1,o.top),point(x0,y0,o.top)],color);
          pick(o.id,o.rect,o.bottom,o.top);
        }
      }
    }
    for(const e of model.equipment) {
      if(layer.clearance) for(const rect of e.clear) {
        const shape=quad(rect,.019);
        geometry.quad(shape,palette.clear);border(shape,palette.edge);
      }
      if(!layer.equipment) continue;
      const color=selected===e.id?palette.selected:e.source.kind==='設備'?palette.equipment:palette.fixture;
      const wire=e.id.endsWith('.shower');
      if(wire) geometry.quad(quad(e.rect,.014),color);
      geometry.box(model.worldBox(e),color,palette.edge,wire);
      pick(e.id,e.rect,e.lo,e.hi);
    }
  }

  function refresh() {
    if(pending) return;
    pending=true;
    requestAnimationFrame(()=>{
      pending=false;
      if(!render) return;
      const width=canvas.clientWidth,height=canvas.clientHeight;
      if(!width||!height) return;
      frame=cameraFrame(camera,width,height);
      render(frame,geometry);
      const layer=layers(), placed=[];
      const visibleObjects=[...objects.values()].filter(o=>o.label)
        .sort((a,b)=>Number(b.id===selected)-Number(a.id===selected));
      for(const item of visibleObjects) {
        const label=item.label;
        const enabled=item.layer==='room'?layer.roomNames && mode!=='inside':
          item.layer==='equipment'?layer.fixtureNames && layer.equipment:
          layer.roomNames && (focus?item.roomIds.includes(focus):mode==='plan'||mode==='orbit');
        const [x,y,z]=frame.project(mode==='plan'&&item.layer==='transom'
          ? [item.anchor[0],0,item.anchor[2]]:item.anchor);
        label.hidden=!enabled||z<.06||x<12||x>width-12||y<18||y>height-20;
        if(label.hidden) continue;
        const w=label.offsetWidth,h=label.offsetHeight;
        const left=clamp(x,w/2+2,width-w/2-2);
        const offsets=item.layer==='transom'?[-24,24,0]:[0,-20,20,-32,32];
        const top=offsets.map(offset=>y+offset).find(v=>v>=h/2+1 && v<=height-h/2-1 &&
          !placed.some(p=>Math.abs(p.left-left)<(p.w+w)/2+3 && Math.abs(p.top-v)<(p.h+h)/2+2));
        label.hidden=top===undefined;
        if(label.hidden) continue;
        label.style.left=left+'px';label.style.top=top+'px';
        placed.push({left,top,w,h});
      }
      const [x1,y1]=frame.project(camera.target);
      const [x2,y2]=frame.project([camera.target[0],camera.target[1],camera.target[2]-1]);
      const angle=mode==='inside'?camera.yaw*180/Math.PI-180:Math.atan2(x2-x1,y1-y2)*180/Math.PI;
      get('north').style.transform='rotate('+angle+'deg)';
    });
  }
  function select(id) {
    selected=id;choice.value=id;
    const list=document.createElement('dl');
    for(const [key,value] of objects.get(id).rows) {
      const row=document.createElement('div');
      const term=document.createElement('dt');term.textContent=key;
      const def=document.createElement('dd');def.textContent=value;
      row.append(term,def);list.append(row);
    }
    get('details').replaceChildren(list);
    for(const object of objects.values()) object.label?.classList.toggle('active',object.id===id);
    meshes();refresh();
  }

  function view(next,{resetLayers=true}={}) {
    mode=next;
    if(mode==='inside'&&!focus) focus=model.rooms[0].id;
    roomChoice.value=focus;
    const room=rooms.get(focus);
    const [a,b,c,d]=bounds(room?.rects||model.parent);
    const spanX=(c-a)/2000, spanY=(d-b)/2000;
    const radius=Math.hypot(spanX,spanY);
    const isInside=mode==='inside', isPlan=mode==='plan';
    const look=isInside?positions.get(focus):[(a+c)/2,(b+d)/2];
    camera={mode,yaw:isInside?.30:focus?.48:.36,pitch:isInside?-.05:.91,zoom:1,
      spanX:isPlan?spanX*1.18:radius*1.04,
      spanY:isPlan?spanY*1.13:radius*.93,
      target:point(...look,isInside?1.56:isPlan?0:.40)};
    if(resetLayers) get('walls').value=isInside?'full':'cut';
    for(const button of document.querySelectorAll('[data-view]')) button.setAttribute('aria-pressed',String(button.dataset.view===mode));
    get('gesture').textContent=isPlan?'北を上に固定 · ピンチで拡大・縮小':
      isInside?'1本指で見回す · ピンチで視野を調整':'1本指で回転 · ピンチで拡大・縮小';
    select(focus||'suite');
  }
  function focusRoom(id) {
    focus=id;
    view(!id&&mode==='inside'?'orbit':mode,{resetLayers:false});
  }

  function rotate(dx,dy) {
    if(mode==='plan') return;
    camera.yaw+=(mode==='inside'?1:-1)*dx*.008;
    camera.pitch=clamp(camera.pitch+dy*.008, mode==='inside'?-1.43:.06,1.51);
    refresh();
  }
  function zoom(scale) {
    camera.zoom=clamp(camera.zoom*scale,mode==='inside'?.64:.50,5);
    refresh();
  }
  const distance=()=>{
    const [a,b]=pointers.values();
    return a&&b?Math.hypot(a.x-b.x,a.y-b.y):0;
  };
  viewport.addEventListener('pointerdown',event=>{
    if(event.target.closest('.zoom')||(event.pointerType==='mouse'&&event.button!==0)) return;
    if(!pointers.size) gestureMoved=false;
    pointers.set(event.pointerId,{x:event.clientX,y:event.clientY,startX:event.clientX,startY:event.clientY});
    (event.target.closest('.label')||viewport).setPointerCapture(event.pointerId);
    lastDistance=distance();
    if(pointers.size>1) gestureMoved=true;
  });
  viewport.addEventListener('pointermove',event=>{
    const previous=pointers.get(event.pointerId);
    if(!previous) return;
    const {clientX:x,clientY:y}=event;
    if(Math.hypot(x-previous.startX,y-previous.startY)>5) gestureMoved=true;
    pointers.set(event.pointerId,{...previous,x,y});
    if(pointers.size>1) {
      const next=distance();
      if(next>5&&lastDistance>5) zoom(next/lastDistance);
      lastDistance=next;
    } else if(gestureMoved) rotate(x-previous.x,y-previous.y);
  });
  function endPointer(event) {
    if(!pointers.delete(event.pointerId)) return;
    lastDistance=distance();
    if(event.type!=='pointerup'||gestureMoved||pointers.size||!frame) return;
    const label=event.target.closest('.label');
    if(label) {
      const item=objects.get(label.dataset.object);
      if(item.layer==='room') focusRoom(item.id);
      else select(item.id);
      return;
    }
    const rect=viewport.getBoundingClientRect();
    const ray=frame.ray(event.clientX-rect.left,event.clientY-rect.top);
    let best=Infinity,id;
    for(const picker of pickers) {
      const depth=hitBox(picker.world,ray);
      if(depth<best) {best=depth;id=picker.id;}
    }
    if(id) select(id);
  }
  for(const type of ['pointerup','pointercancel','lostpointercapture']) viewport.addEventListener(type,endPointer);
  for(const type of ['touchstart','touchmove','gesturestart','gesturechange']) {
    viewport.addEventListener(type,event=>{
      if(!event.target.closest('.zoom')&&event.cancelable) event.preventDefault();
    },{passive:false});
  }
  viewport.addEventListener('wheel',event=>{
    if(event.cancelable) event.preventDefault();
    zoom(Math.exp(-clamp(event.deltaY,-120,120)*.0025));
  },{passive:false});
  viewport.addEventListener('keydown',event=>{
    if(event.target!==viewport) return;
    const keys={ArrowLeft:[-14,0],ArrowRight:[14,0],ArrowUp:[0,-14],ArrowDown:[0,14]};
    if(keys[event.key]) {event.preventDefault();rotate(...keys[event.key]);}
    if(['+','=','-'].includes(event.key)) {event.preventDefault();zoom(event.key==='-'?1/1.2:1.2);}
  });
  roomChoice.addEventListener('change',()=>focusRoom(roomChoice.value));
  choice.addEventListener('change',()=>select(choice.value));
  document.querySelector('form.layers').addEventListener('change',()=>{meshes();refresh();});
  document.querySelector('form.layers').addEventListener('submit',event=>event.preventDefault());
  for(const button of document.querySelectorAll('[data-view]')) {
    button.addEventListener('click',()=>{
      if(button.dataset.view==='orbit' || button.dataset.view==='plan') focus='';
      view(button.dataset.view);
    });
  }
  get('reset').addEventListener('click',()=>{focus='';view('orbit');});
  get('plus').addEventListener('click',()=>zoom(1.2));
  get('minus').addEventListener('click',()=>zoom(1/1.2));
  canvas.addEventListener('webglcontextlost',event=>{
    event.preventDefault();render=null;
    showError('3D表示を中断しました。復帰を待つか、ページを再読み込みしてください。');
  });
  canvas.addEventListener('webglcontextrestored',()=>{
    try {render=createRenderer(canvas);status.hidden=true;refresh();} catch(error) {showError(error.message);}
  });
  new ResizeObserver(refresh).observe(viewport);
  view('orbit');
}
start().catch(error=>{showError(error.message);console.error(error);});
