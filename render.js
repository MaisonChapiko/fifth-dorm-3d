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
  const fittedSpan = Math.max(4.65, 4.55/aspect)/zoom;
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
  if (!gl) throw new Error('WebGLを利用できません。SafariまたはWebGL対応ブラウザで開いてください。');
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
  const buffer = gl.createBuffer();
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
    gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
    for (const [data,mode] of [[geometry.triangles,gl.TRIANGLES],[geometry.lines,gl.LINES]]) {
      gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(data),gl.DYNAMIC_DRAW);
      gl.vertexAttribPointer(position,3,gl.FLOAT,false,24,0);
      gl.vertexAttribPointer(color,3,gl.FLOAT,false,24,12);
      if (mode === gl.TRIANGLES) {
        gl.enable(gl.POLYGON_OFFSET_FILL);
        gl.polygonOffset(1,1);
      } else gl.disable(gl.POLYGON_OFFSET_FILL);
      gl.drawArrays(mode,0,data.length/6);
    }
  }
  return render;
}
