const sub = (a,b) => a.map((n,i) => n-b[i]);
const add = (a,b) => a.map((n,i) => n+b[i]);
const times = (a,n) => a.map(x => x*n);
const dot = (a,b) => a.reduce((sum,n,i) => sum+n*b[i],0);
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit = a => times(a,1/Math.hypot(...a));
const UP = [0,1,0];

export function cameraFrame(camera, width, height) {
  const {mode,yaw,pitch,zoom,target} = camera;
  const direction = [Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch)];
  let eye, forward, right, up;
  if (mode === 'inside') {
    eye = target;
    forward = direction;
    right = unit(cross(forward,UP));
    up = cross(right,forward);
  } else if (mode === 'plan') {
    eye = add(target,[0,14,0]);
    forward = [0,-1,0];
    right = [1,0,0];
    up = [0,0,-1];
  } else {
    eye = add(target,times(direction,13));
    forward = times(direction,-1);
    right = unit(cross(forward, UP));
    up = cross(right,forward);
  }
  const aspect = width/height;
  const perspective = mode === 'inside';
  const fittedSpan = Math.max(camera.spanY, camera.spanX/aspect)/zoom;
  const tangent = Math.tan((0.52/zoom));
  const sx = perspective ? 1/(aspect*tangent) : 1/(aspect*fittedSpan);
  const sy = perspective ? 1/tangent : 1/fittedSpan;
  return {
    eye,forward,right,up,sx,sy,perspective,
    project(point) {
      const delta = sub(point,eye);
      const depth = dot(forward,delta);
      const divide = perspective ? depth : 1;
      return [(dot(right,delta)*sx/divide+1)*width/2,
        (1-dot(up,delta)*sy/divide)*height/2,depth];
    },
    ray(x,y) {
      const delta = add(times(right,(2*x/width-1)/sx),times(up,(1-2*y/height)/sy));
      return perspective ? [eye, unit(add(delta,forward))] : [add(eye,delta),forward];
    }
  };
}

export function hitBox([start,end],[origin,dir]) {
  let tmin = 0, tmax = Infinity;
  for (let i=0;i<3;i++) {
    if (Math.abs(dir[i]) < 1e-9) {
      if (origin[i] < start[i] || origin[i] > end[i]) return Infinity;
      continue;
    }
    const a = (start[i]-origin[i])/dir[i], b = (end[i]-origin[i])/dir[i];
    tmin = Math.max(tmin,Math.min(a,b));
    tmax = Math.min(tmax,Math.max(a,b));
    if (tmax < tmin) return Infinity;
  }
  return tmin;
}

const faces = [
  [[0,3,2,1],.81], [[4,5,6,7],1], [[0,1,5,4],.78],
  [[1,2,6,5],.63], [[2,3,7,6],.88], [[3,0,4,7],.72],
];
const boxEdges = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];

export function makeGeometry() {
  const triangles = [], lines = [];
  const vertex = (out,p,color) => out.push(...p,...color);
  function line(a,b,c) {
    vertex(lines,a,c);
    vertex(lines,b,c);
  }
  function quad(points,color) {
    for (const id of [0,1,2,0,2,3]) vertex(triangles,points[id],color);
  }
  function box([[a,b,c],[d,e,f]], color, edges, wire=false) {
    const p = [[a,b,c],[d,b,c],[d,b,f],[a,b,f],[a,e,c],[d,e,c],[d,e,f],[a,e,f]];
    if (!wire) for (const [indices,shade] of faces) quad(indices.map(i=>p[i]),times(color,shade));
    if (edges) for (const [i,k] of boxEdges) line(p[i],p[k],edges);
  }
  return {triangles,lines,line,quad,box};
}

export function createRenderer(canvas) {
  const gl = canvas.getContext('webgl',{antialias:true,alpha:false});
  if (!gl) return createCanvasRenderer(canvas);
  canvas.dataset.renderer = 'webgl';
  const shader = (type,source) => {
    const compiled = gl.createShader(type);
    gl.shaderSource(compiled,source);
    gl.compileShader(compiled);
    if (!gl.getShaderParameter(compiled,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(compiled));
    return compiled;
  };
  const program = gl.createProgram();
  gl.attachShader(program,shader(gl.VERTEX_SHADER,`
    attribute vec3 position, color;
    uniform vec3 eye, right, up, forward;
    uniform vec2 scale;
    uniform float perspective;
    varying vec3 rgb;
    void main() {
      vec3 d = position-eye;
      float z = dot(d,forward);
      float depth = mix(z/25.0-1.0, (50.05/49.95)*z-5.0/49.95, perspective);
      gl_Position = vec4(dot(d,right)*scale.x,dot(d,up)*scale.y,depth,mix(1.0,z,perspective));
      rgb = color;
    }`));
  gl.attachShader(program,shader(gl.FRAGMENT_SHADER,`
    precision mediump float;
    varying vec3 rgb;
    void main() { gl_FragColor = vec4(rgb,1.0); }`));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.clearColor(.90,.93,.93,1);
  const uniforms = Object.fromEntries(['eye','right','up','forward','scale','perspective']
    .map(key=>[key,gl.getUniformLocation(program,key)]));
  const position = gl.getAttribLocation(program,'position');
  const color = gl.getAttribLocation(program,'color');
  gl.enableVertexAttribArray(position);
  gl.enableVertexAttribArray(color);
  const buffers = [gl.createBuffer(),gl.createBuffer()];
  let uploadedGeometry;
  function render(frame,geometry) {
    const ratio = Math.min(window.devicePixelRatio || 1,2);
    const width = Math.max(1, Math.round(canvas.clientWidth*ratio));
    const height = Math.max(1, Math.round(canvas.clientHeight*ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0,0,width,height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    for (const key of ['eye','right','up','forward']) gl.uniform3fv(uniforms[key],frame[key]);
    gl.uniform2f(uniforms.scale,frame.sx,frame.sy);
    gl.uniform1f(uniforms.perspective,Number(frame.perspective));
    const layers = [[geometry.triangles,gl.TRIANGLES],[geometry.lines,gl.LINES]];
    for (const [index,[data,mode]] of layers.entries()) {
      gl.bindBuffer(gl.ARRAY_BUFFER,buffers[index]);
      if (uploadedGeometry !== geometry) gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(data),gl.STATIC_DRAW);
      gl.vertexAttribPointer(position,3,gl.FLOAT,false,24,0);
      gl.vertexAttribPointer(color,3,gl.FLOAT,false,24,12);
      if (mode === gl.TRIANGLES) {
        gl.enable(gl.POLYGON_OFFSET_FILL);
        gl.polygonOffset(1,1);
      } else gl.disable(gl.POLYGON_OFFSET_FILL);
      gl.drawArrays(mode,0,data.length/6);
    }
    uploadedGeometry = geometry;
  }
  return render;
}

// Real depth-tested software 3D for browsers where WebGL is unavailable.
function createCanvasRenderer(canvas) {
  const ctx=canvas.getContext('2d',{alpha:false});
  if(!ctx) throw new Error('3D表示に必要なCanvasを利用できません。');
  canvas.dataset.renderer='canvas';
  let image, pixels, depth;
  const pack=(r,g,b)=>0xff000000|(Math.round(b*255)<<16)|(Math.round(g*255)<<8)|Math.round(r*255);
  const background=pack(.90,.93,.93);

  return function render(frame,geometry) {
    const scale=Math.min(window.devicePixelRatio||1,1.40,1150/canvas.clientWidth,780/canvas.clientHeight);
    const width=Math.max(1,Math.round(canvas.clientWidth*scale));
    const height=Math.max(1,Math.round(canvas.clientHeight*scale));
    if(!image||canvas.width!==width||canvas.height!==height) {
      canvas.width=width;canvas.height=height;
      image=ctx.createImageData(width,height);
      pixels=new Uint32Array(image.data.buffer);
      depth=new Float32Array(width*height);
    }
    pixels.fill(background);
    depth.fill(-Infinity);
    const near=frame.perspective?.05:0;
    function unpack(data,i) {
      const delta=[data[i]-frame.eye[0],data[i+1]-frame.eye[1],data[i+2]-frame.eye[2]];
      return [dot(frame.right,delta),dot(frame.up,delta),dot(frame.forward,delta)];
    }
    function project([x,y,z]) {
      const inv=frame.perspective?1/z:1;
      return [(x*frame.sx*inv+1)*width*.5,(1-y*frame.sy*inv)*height*.5,frame.perspective?inv:-z];
    }
    const cut=(a,b)=>{
      const t=(near-a[2])/(b[2]-a[2]);
      return [a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1]),near];
    };
    function triangle(a,b,c,color) {
      const dx=b[0]-a[0],dy=b[1]-a[1],ex=c[0]-a[0],ey=c[1]-a[1];
      const det=dx*ey-dy*ex;
      if(Math.abs(det)<1e-8)return;
      const xmin=Math.max(0,Math.floor(Math.min(a[0],b[0],c[0])));
      const xmax=Math.min(width-1,Math.ceil(Math.max(a[0],b[0],c[0])));
      const ymin=Math.max(0,Math.floor(Math.min(a[1],b[1],c[1])));
      const ymax=Math.min(height-1,Math.ceil(Math.max(a[1],b[1],c[1])));
      const vStep=ey/det,wStep=-dy/det;
      for(let y=ymin;y<=ymax;y++) {
        const yy=y+.5-a[1],xx=xmin+.5-a[0];
        let v=(xx*ey-yy*ex)/det,w=(dx*yy-dy*xx)/det;
        let idx=y*width+xmin;
        for(let x=xmin;x<=xmax;x++,idx++,v+=vStep,w+=wStep) {
          if(v<-.000001||w<-.000001||v+w>1.000001)continue;
          const z=a[2]+v*(b[2]-a[2])+w*(c[2]-a[2]);
          if(z>=depth[idx]) { depth[idx]=z;pixels[idx]=color; }
        }
      }
    }
    const tris=geometry.triangles;
    for(let i=0;i<tris.length;i+=18) {
      const vertices=[unpack(tris,i),unpack(tris,i+6),unpack(tris,i+12)];
      const clipped=[];
      for(let j=0;j<3;j++) {
        const a=vertices[(j+2)%3],b=vertices[j];
        if((a[2]>=near)!==(b[2]>=near))clipped.push(cut(a,b));
        if(b[2]>=near)clipped.push(b);
      }
      if(clipped.length<3)continue;
      const poly=clipped.map(project),color=pack(tris[i+3],tris[i+4],tris[i+5]);
      for(let j=1;j+1<poly.length;j++)triangle(poly[0],poly[j],poly[j+1],color);
    }
    // Clip each projected segment to the framebuffer before walking its pixels.
    const lines=geometry.lines;
    for(let i=0;i<lines.length;i+=12) {
      let a=unpack(lines,i),b=unpack(lines,i+6);
      if(a[2]<near&&b[2]<near)continue;
      if(a[2]<near)a=cut(a,b);
      if(b[2]<near)b=cut(b,a);
      a=project(a);b=project(b);
      const dx=b[0]-a[0],dy=b[1]-a[1],dz=b[2]-a[2];
      let from=0,to=1,visible=true;
      for(const [p,d,min,max] of [[a[0],dx,0,width-1],[a[1],dy,0,height-1]]) {
        if(!d) {if(p<min||p>max)visible=false;continue;}
        const l=(min-p)/d,r=(max-p)/d;
        from=Math.max(from,Math.min(l,r));
        to=Math.min(to,Math.max(l,r));
      }
      if(!visible||to<from)continue;
      const count=Math.max(1,Math.ceil(Math.max(Math.abs(dx),Math.abs(dy))*(to-from)));
      const color=pack(lines[i+3],lines[i+4],lines[i+5]);
      for(let j=0;j<=count;j++) {
        const t=from+(to-from)*j/count;
        const idx=Math.round(a[1]+dy*t)*width+Math.round(a[0]+dx*t);
        const z=a[2]+dz*t;
        const tolerance=frame.perspective?.0012*Math.max(1,z*z):.026;
        if(z+tolerance>=depth[idx]) { depth[idx]=Math.max(z,depth[idx]);pixels[idx]=color; }
      }
    }
    ctx.putImageData(image,0,0);
  };
}
