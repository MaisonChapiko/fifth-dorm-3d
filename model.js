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

export function buildModel(data) {
  const room = data.room.rects.map(r => r.map(mm));
  const exterior = data.room.exterior_edges.map(e => [...e.a,...e.b].map(mm));
  const walls = perimeter(room,data.parentZoneRects.map(r => r.map(mm)),exterior,data.wallAssumption);
  const strips = walls.map(w => strip(w,w.start,w.end,Math.min(0,w.inward*w.half),Math.max(0,w.inward*w.half)));
  const floor = partition([...room,...strips], (x,y) =>
    unionContains(room,x,y) && !unionContains(strips,x,y));
  const apertures = [
    ...data.doors.map(d => ({...d, xy:d.at, width:d.clear_width_m, bottom:0,
      top:data.display.doorHeightsM[d.id], type:'door'})),
    ...data.room.windows.map((w,i) => ({...w,id:w.id || 'window-'+(i+1),xy:w.centre,
      width:w.width_m,bottom:w.sill_m,top:w.head_m ?? data.display.windowHeadsM?.[w.id || 'window-'+(i+1)],
      type:'window'})),
  ];
  for (const opening of apertures) {
    const axis = opening.orient === 'h' ? 0 : 1;
    const center = mm(opening.xy[axis]);
    opening.start = center - mm(opening.width)/2;
    opening.end = center + mm(opening.width)/2;
    const edge = walls.find(w => w.orient === opening.orient && w.line === mm(opening.xy[1-axis]) &&
      opening.start >= w.start && opening.end <= w.end);
    if (!edge || !Number.isFinite(opening.top) || opening.bottom >= opening.top ||
        opening.top > data.display.wallHeightM) throw new Error('開口の位置または高さを確認してください ('+opening.id+')');
    opening.wall = edge.id;
    opening.rect = strip(edge,opening.start,opening.end,-edge.half,edge.half);
  }
  const wallVolumes = walls.map(w => ({wall:w,rect:strip(w,w.start,w.end,-w.half,w.half)}));
  // Complete the outward quadrant at convex wall joints. The floor deduction
  // remains based on the source's finite inward edge strips.
  for (const h of walls.filter(w => w.orient === 'h')) {
    for (const v of walls.filter(w => w.orient === 'v')) {
      if (![h.start,h.end].includes(v.line) || ![v.start,v.end].includes(h.line)) continue;
      const x = v.line, y = h.line;
      const occupied = [-1,1].flatMap(dx => [-1,1].map(dy => unionContains(room,x+dx,y+dy)))
        .filter(Boolean).length;
      if (occupied !== 1) continue;
      const outerX = x-v.inward*v.half, outerY = y-h.inward*h.half;
      wallVolumes.push({wall:h,rect:[Math.min(x,outerX),Math.min(y,outerY),
        Math.max(x,outerX),Math.max(y,outerY)]});
    }
  }
  const wallRects = wallVolumes.map(volume => volume.rect);
  const boxes = [];
  const heights = sorted([0,data.display.wallHeightM,...apertures.flatMap(o => [o.bottom,o.top])]);
  // Disjoint wall solids, including a single owner for each corner intersection.
  for (const [lo,hi] of intervals(heights)) {
    const cuts = apertures.filter(o => lo >= o.bottom && hi <= o.top).map(o => o.rect);
    const rectangles = [...wallRects,...cuts];
    const partitioned = partition(rectangles,(x,y) =>
      unionContains(wallRects,x,y) && !unionContains(cuts,x,y));
    for (const rect of partitioned) {
      const x = (rect[0]+rect[2])/2, y = (rect[1]+rect[3])/2;
      const {wall} = wallVolumes.find(volume => inside(x,y,volume.rect));
      boxes.push({id:wall.id,rect,lo,hi});
    }
  }
  const equipment = data.furniture.map(f => ({
    id:f.id,rect:f.rect.map(mm),lo:0,hi:f.h,clear:f.clear.map(r => r.map(mm))
  }));
  const origin = data.display.originXY.map(mm);
  const worldPoint = (x,y,height) => [meters(x-origin[0]),height,meters(origin[1]-y)];
  const worldBox = ({rect:[x0,y0,x1,y1],lo,hi}) =>
    [worldPoint(x0,y1,lo),worldPoint(x1,y0,hi)];
  return {room,walls,floor,apertures,boxes,equipment,worldPoint,worldBox,
    areaCenter:room.reduce((sum,r) => sum+rectArea(r),0)/1e6,
    areaInner:floor.reduce((sum,r) => sum+rectArea(r),0)/1e6};
}
