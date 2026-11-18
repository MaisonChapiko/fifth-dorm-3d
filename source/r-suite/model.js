// Plan geometry uses integer millimetres. The rendering transform uses metres.
const mm = value => Math.round(value * 1000);
const meters = value => value / 1000;
const inside = (x, y, [west, south, east, north]) =>
  x >= west && x < east && y >= south && y < north;
const unionContains = (rects, x, y) => rects.some(rect => inside(x, y, rect));
const sorted = values => [...new Set(values)].sort((a, b) => a - b);
const intervals = values => values.slice(1).map((value, i) => [values[i], value]);
const rectArea = ([a,b,c,d]) => (c - a) * (d - b);

function partition(rectangles, accept) {
  const xs = sorted(rectangles.flatMap(rect => [rect[0], rect[2]]));
  const ys = sorted(rectangles.flatMap(rect => [rect[1], rect[3]]));
  return intervals(ys).flatMap(([y0,y1]) => intervals(xs)
    .filter(([x0,x1]) => accept((x0+x1)/2, (y0+y1)/2))
    .map(([x0,x1]) => [x0,y0,x1,y1]));
}

function perimeter(room, parent, exterior, thickness) {
  const edges = [];
  for (const orient of ['h', 'v']) {
    const axis = orient === 'h' ? 0 : 1;
    const cross = 1 - axis;
    const lines = sorted(room.flatMap(r => [r[cross], r[cross + 2]]));
    const cuts = sorted([...room, ...parent, ...exterior]
      .flatMap(r => [r[axis],r[axis + 2]]));
    for (const line of lines) {
      for (const [start,end] of intervals(cuts)) {
        const point = offset => orient === 'h'
          ? [(start+end)/2, line+offset] : [line+offset, (start+end)/2];
        const positive = unionContains(room, ...point(0.25));
        if (positive === unionContains(room, ...point(-0.25))) continue;
        const inward = positive ? 1 : -1;
        const outer = exterior.some(r => r[cross] === line && start >= r[axis] && end <= r[axis+2]);
        const kind = outer ? 'exterior' :
          unionContains(parent, ...point(-inward*0.25)) ? 'internal_partition' : 'between_zones';
        const previous = edges.at(-1);
        if (previous && previous.orient === orient && previous.line === line &&
            previous.end === start && previous.inward === inward && previous.kind === kind) {
          previous.end = end;
          continue;
        }
        edges.push({orient, line, start, end, inward, kind, half: mm(thickness[kind + '_m'])/2});
      }
    }
  }
  return edges.map((edge,i) => ({...edge, id: 'wall-' + (i+1)}));
}
function strip(edge, start, end, low, high) {
  return edge.orient === 'h' ? [start,edge.line+low,end,edge.line+high]
    : [edge.line+low,start,edge.line+high,end];
}

const area = rects => rects.reduce((sum,rect) => sum+rectArea(rect),0)/1e6;
const toExterior = e => [...e.a,...e.b].map(mm);
const edgeAxis = orient => orient === 'h' ? 0 : 1;

function mergeWalls(rooms) {
  const byLine = new Map();
  for (const room of rooms) for (const edge of room.edges) {
    const key = edge.orient+':'+edge.line;
    if (!byLine.has(key)) byLine.set(key,[]);
    byLine.get(key).push({...edge, room});
  }
  const walls = [];
  for (const edges of byLine.values()) {
    for (const [start,end] of intervals(sorted(edges.flatMap(e=>[e.start,e.end])))) {
      const covering = edges.filter(e=>e.start<=start && e.end>=end);
      if (!covering.length) continue;
      const {orient,line,kind,half} = covering[0];
      if (covering.some(e=>e.kind!==kind || e.half!==half) ||
          covering.length > 2 || (covering.length===2 && covering[0].inward===covering[1].inward)) {
        throw new Error('壁の境界分類が一致しません '+orient+' '+line+' '+start);
      }
      const roomIds = covering.map(e=>e.room.id).sort();
      const wall = {id:'wall:'+orient+':'+line+':'+start,orient,line,kind,half,start,end,
        height:Math.max(...covering.map(e=>e.room.height)),roomIds,sides:covering};
      walls.push(wall);
    }
  }
  return walls;
}

function openings(data, rooms, walls) {
  const apertures = [
    ...data.doors.map(d=>({...d,type:'door',xy:d.at,width:d.clear_width_m,bottom:0,
      top:data.display.doorHeightsM[d.id],roomIds:d.between.filter(id=>rooms.some(r=>r.id===id))})),
    ...rooms.flatMap(room=>room.source.windows.map((w,i)=>({...w,windowType:w.type,type:'window',
      id:w.id||room.source.short_id+'.window.'+(i+1),xy:w.centre,width:w.width_m,
      bottom:w.sill_m,top:w.head_m??data.display.windowHeadM,roomIds:[room.id]})))
  ];
  for (const aperture of apertures) {
    const axis = edgeAxis(aperture.orient);
    const middle = mm(aperture.xy[axis]);
    aperture.start = middle-mm(aperture.width)/2;
    aperture.end = middle+mm(aperture.width)/2;
    const spans = walls.filter(w=>w.orient===aperture.orient && w.line===mm(aperture.xy[1-axis]) &&
      w.start<aperture.end && w.end>aperture.start);
    if (!spans.length || !Number.isFinite(aperture.top) || aperture.bottom>=aperture.top ||
        spans.some(w=>w.height<aperture.top || w.half!==spans[0].half ||
          w.roomIds.join()!==[...aperture.roomIds].sort().join()) ||
        spans.reduce((sum,w)=>sum+Math.min(w.end,aperture.end)-Math.max(w.start,aperture.start),0)!==
          aperture.end-aperture.start) throw new Error('開口境界を照合できません: '+aperture.id);
    aperture.rect = strip(spans[0],aperture.start,aperture.end,-spans[0].half,spans[0].half);
  }
  return apertures;
}

function wallSolids(walls, apertures, parent) {
  const volumes = walls.map(w=>({wall:w,rect:strip(w,w.start,w.end,-w.half,w.half)}));
  // Close convex corners of the outside perimeter. Shared partitions and T-junctions already intersect.
  for (const h of walls.filter(w=>w.orient==='h' && w.sides.length===1)) {
    for (const v of walls.filter(w=>w.orient==='v' && w.sides.length===1)) {
      if (![h.start,h.end].includes(v.line) || ![v.start,v.end].includes(h.line)) continue;
      const x=v.line,y=h.line;
      const quadrants=[-1,1].flatMap(dx=>[-1,1].map(dy=>unionContains(parent,x+dx,y+dy)));
      if (quadrants.filter(Boolean).length!==1) continue;
      const ax=x-v.sides[0].inward*v.half, ay=y-h.sides[0].inward*h.half;
      const wall=h.height<=v.height?h:v;
      volumes.push({wall,rect:[Math.min(x,ax),Math.min(y,ay),Math.max(x,ax),Math.max(y,ay)]});
    }
  }
  const heights=sorted([0,...walls.map(w=>w.height),...apertures.flatMap(o=>[o.bottom,o.top])]);
  const boxes=[];
  for (const [lo,hi] of intervals(heights)) {
    const solid=volumes.filter(v=>v.wall.height>=hi);
    const cuts=apertures.filter(o=>lo>=o.bottom && hi<=o.top).map(o=>o.rect);
    const rects=[...solid.map(v=>v.rect),...cuts];
    const xs=intervals(sorted(rects.flatMap(r=>[r[0],r[2]])));
    const ys=intervals(sorted(rects.flatMap(r=>[r[1],r[3]])));
    for (const [y0,y1] of ys) {
      let previous;
      for (const [x0,x1] of xs) {
        const x=(x0+x1)/2,y=(y0+y1)/2;
        const current=unionContains(cuts,x,y)?null:solid.find(v=>inside(x,y,v.rect));
        if (!current) {previous=null;continue;}
        if (previous?.id===current.wall.id) {
          previous.rect[2]=x1;
        } else {
          previous={id:current.wall.id,rect:[x0,y0,x1,y1],lo,hi};
          boxes.push(previous);
        }
      }
    }
  }
  return boxes;
}

export function buildSuite(data) {
  const parent=data.parentZoneRects.map(r=>r.map(mm));
  const rooms=data.rooms.map(source=>{
    const id=source.id;
    const rects=source.rects.map(r=>r.map(mm));
    const edges=perimeter(rects,parent,source.exterior_edges.map(toExterior),data.wallAssumption);
    const strips=edges.map(e=>strip(e,e.start,e.end,Math.min(0,e.inward*e.half),Math.max(0,e.inward*e.half)));
    const floor=partition([...rects,...strips],(x,y)=>unionContains(rects,x,y) && !unionContains(strips,x,y));
    return {source,id,rects,edges,floor,centerArea:area(rects),innerArea:area(floor),
      height:data.display.heights[source.short_id].m};
  });
  const walls=mergeWalls(rooms);
  const apertures=openings(data,rooms,walls);
  const boxes=wallSolids(walls,apertures,parent);
  const equipment=data.furniture.map(source=>({source,id:source.id,roomId:rooms.find(r=>r.source.short_id===source.room).id,
    rect:source.rect.map(mm),lo:0,hi:source.h,clear:source.clear.map(r=>r.map(mm))}));
  const origin=data.display.originXY.map(mm);
  const worldPoint=(x,y,height)=>[meters(x-origin[0]),height,meters(origin[1]-y)];
  const worldBox=({rect:[a,b,c,d],lo,hi})=>[worldPoint(a,d,lo),worldPoint(c,b,hi)];
  return {rooms,walls,apertures,boxes,equipment,parent,worldPoint,worldBox};
}

export function bounds(rects) {
  return [Math.min(...rects.map(r=>r[0])),Math.min(...rects.map(r=>r[1])),
    Math.max(...rects.map(r=>r[2])),Math.max(...rects.map(r=>r[3]))];
}

export function standingPoint(room,equipment) {
  const base=bounds(room.floor);
  const obstructions=equipment.filter(e=>e.roomId===room.id).map(e=>e.rect);
  let best=-Infinity,position;
  for (let y=base[1]+25;y<base[3];y+=50) for (let x=base[0]+25;x<base[2];x+=50) {
    if (!unionContains(room.floor,x,y) || unionContains(obstructions,x,y)) continue;
    const margin=Math.min(...room.edges.map(w=>{
      const a=w.orient==='h'?x:y,b=w.orient==='h'?y:x;
      return Math.hypot(Math.max(w.start-a,a-w.end,0),b-w.line)-w.half;
    }),...obstructions.map(([a,b,c,d])=>Math.hypot(Math.max(a-x,x-c,0),Math.max(b-y,y-d,0))));
    if (margin>best) {best=margin;position=[x,y];}
  }
  if (position) return position;
  const patch=room.floor.reduce((largest,r)=>rectArea(r)>rectArea(largest)?r:largest);
  return [(patch[0]+patch[2])/2,(patch[1]+patch[3])/2];
}
