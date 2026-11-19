// 纯手写 WebGL2 渲染器：网格、坡面、屋脊线、配重块、组件阵列、轨道相机
export interface Mesh {
  positions: Float32Array; // xyz 交错
  normals: Float32Array;
  indices: Uint32Array;
  color: [number, number, number, number];
  mode?: 'solid' | 'lines';
}

export interface RenderNode {
  mesh: Mesh;
  model: Float32Array; // 4x4 列主序
}

const VERT = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
uniform mat4 uView;
uniform mat4 uProj;
uniform mat4 uModel;
out vec3 vNormal;
out vec3 vWorld;
void main() {
  vec4 world = uModel * vec4(aPos, 1.0);
  vWorld = world.xyz;
  vNormal = mat3(uModel) * aNormal;
  gl_Position = uProj * uView * world;
}`;

const FRAG = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vWorld;
uniform vec4 uColor;
uniform vec3 uLightDir;
uniform float uAlpha;
out vec4 frag;
void main() {
  vec3 n = normalize(vNormal);
  float diff = max(dot(n, normalize(uLightDir)), 0.0);
  vec3 base = uColor.rgb * (0.45 + 0.55 * diff);
  // 简单高度雾增强层次
  float fog = clamp((vWorld.z + 40.0) / 120.0, 0.0, 1.0);
  base = mix(base * 0.7, base, fog);
  frag = vec4(base, uColor.a * uAlpha);
}`;

function mat4Identity(): Float32Array { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; }
function mat4Multiply(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return out;
}
function mat4Perspective(fovy: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  const m = new Float32Array(16);
  m[0] = f / aspect; m[5] = f; m[10] = (far + near) * nf; m[11] = -1; m[14] = 2 * far * near * nf;
  return m;
}
function mat4LookAt(eye: number[], center: number[], up: number[]): Float32Array {
  const z = norm3(sub3(eye, center));
  const x = norm3(cross3(up, z));
  const y = cross3(z, x);
  const m = mat4Identity();
  m[0] = x[0]; m[4] = x[1]; m[8] = x[2];
  m[1] = y[0]; m[5] = y[1]; m[9] = y[2];
  m[2] = z[0]; m[6] = z[1]; m[10] = z[2];
  m[12] = -dot3(x, eye); m[13] = -dot3(y, eye); m[14] = -dot3(z, eye);
  return m;
}
function sub3(a: number[], b: number[]) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function cross3(a: number[], b: number[]) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function dot3(a: number[], b: number[]) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function norm3(a: number[]) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

export class OrbitCamera {
  target = [0, 0, 0];
  distance = 60;
  azimuth = -Math.PI / 4;
  elevation = Math.PI / 5;
  eye(): number[] {
    const ce = Math.cos(this.elevation);
    return [
      this.target[0] + this.distance * ce * Math.cos(this.azimuth),
      this.target[1] + this.distance * ce * Math.sin(this.azimuth),
      this.target[2] + this.distance * Math.sin(this.elevation),
    ];
  }
  view() { return mat4LookAt(this.eye(), this.target, [0, 0, 1]); }
  rotate(dx: number, dy: number) {
    this.azimuth -= dx * 0.008;
    this.elevation = Math.max(0.05, Math.min(Math.PI / 2 - 0.02, this.elevation + dy * 0.008));
  }
  zoom(delta: number) { this.distance = Math.max(5, Math.min(300, this.distance * (1 + delta * 0.001))); }
}

export class Renderer {
  gl: WebGL2RenderingContext;
  program: WebGLProgram;
  camera = new OrbitCamera();
  nodes: RenderNode[] = [];
  private vao: WebGLVertexArrayObject;
  private buffers: WebGLBuffer[] = [];
  private uLoc: Record<string, WebGLUniformLocation | null> = {};

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
    if (!gl) throw new Error('当前浏览器不支持 WebGL2');
    this.gl = gl;
    this.program = this.link(VERT, FRAG);
    this.vao = gl.createVertexArray()!;
    gl.useProgram(this.program);
    for (const name of ['uView', 'uProj', 'uModel', 'uColor', 'uLightDir', 'uAlpha']) {
      this.uLoc[name] = gl.getUniformLocation(this.program, name);
    }
    gl.uniform3f(this.uLoc.uLightDir, 0.4, 0.6, 0.9);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0.10, 0.12, 0.16, 1);
  }

  private link(vs: string, fs: string): WebGLProgram {
    const gl = this.gl;
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader error');
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link error');
    return p;
  }

  setNodes(nodes: RenderNode[]) { this.nodes = nodes; }

  render() {
    const gl = this.gl;
    const canvas = gl.canvas as HTMLCanvasElement;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.floor(canvas.clientWidth * dpr), h = Math.floor(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    const proj = mat4Perspective(Math.PI / 4, canvas.width / canvas.height, 0.1, 1000);
    gl.uniformMatrix4fv(this.uLoc.uProj, false, proj);
    gl.uniformMatrix4fv(this.uLoc.uView, false, this.camera.view());

    for (const node of this.nodes) this.drawNode(node);
  }

  private drawNode(node: RenderNode) {
    const gl = this.gl, m = node.mesh;
    const pos = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, pos);
    gl.bufferData(gl.ARRAY_BUFFER, m.positions, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

    const nrm = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, nrm);
    gl.bufferData(gl.ARRAY_BUFFER, m.normals, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);

    const idx = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.indices, gl.DYNAMIC_DRAW);
    this.buffers.push(pos, nrm, idx);
    if (this.buffers.length > 24) { const old = this.buffers.shift()!; gl.deleteBuffer(old); }

    gl.uniformMatrix4fv(this.uLoc.uModel, false, node.model);
    gl.uniform4f(this.uLoc.uColor, ...m.color);
    gl.uniform1f(this.uLoc.uAlpha, m.mode === 'lines' ? 1 : m.color[3]);
    if (m.mode === 'lines') {
      gl.drawElements(gl.LINES, m.indices.length, gl.UNSIGNED_INT, 0);
    } else {
      gl.drawElements(gl.TRIANGLES, m.indices.length, gl.UNSIGNED_INT, 0);
    }
  }

  attachControls(canvas: HTMLCanvasElement) {
    const down = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      const move = (ev: PointerEvent) => this.camera.rotate(ev.movementX, ev.movementY);
      const up = () => { canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerup', up); };
      canvas.addEventListener('pointermove', move);
      canvas.addEventListener('pointerup', up);
    };
    const wheel = (e: WheelEvent) => { e.preventDefault(); this.camera.zoom(e.deltaY); };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('wheel', wheel, { passive: false });
    return () => { canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('wheel', wheel); };
  }
}

// ---------- 网格构造工具 ----------
export function boxMesh(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number,
  color: Mesh['color']): Mesh {
  const x0 = cx - sx / 2, x1 = cx + sx / 2, y0 = cy - sy / 2, y1 = cy + sy / 2, z0 = cz - sz / 2, z1 = cz + sz / 2;
  const positions = new Float32Array([
    x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0,
    x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1,
  ]);
  const normals = new Float32Array([
    0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1,
    0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
  ]);
  const indices = new Uint32Array([
    0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6,
    0, 4, 5, 0, 5, 1, 2, 6, 7, 2, 7, 3,
    0, 3, 7, 0, 7, 4, 1, 5, 6, 1, 6, 2,
  ]);
  return { positions, normals, indices, color };
}

export function polygonMesh(verts: number[][], color: Mesh['color'], normal = [0, 0, 1]): Mesh {
  const positions = new Float32Array(verts.length * 3);
  const normals = new Float32Array(verts.length * 3);
  verts.forEach((v, i) => { positions.set(v, i * 3); normals.set(normal, i * 3); });
  const indices: number[] = [];
  for (let i = 1; i < verts.length - 1; i++) indices.push(0, i, i + 1);
  return { positions, normals, indices: new Uint32Array(indices), color };
}

export function lineMesh(points: number[][], color: Mesh['color']): Mesh {
  const positions = new Float32Array(points.length * 3);
  const normals = new Float32Array(points.length * 3);
  points.forEach((p, i) => { positions.set(p, i * 3); normals.set([0, 0, 1], i * 3); });
  const indices: number[] = [];
  for (let i = 0; i < points.length - 1; i++) indices.push(i, i + 1);
  return { positions, normals, indices: new Uint32Array(indices), color, mode: 'lines' };
}

export function identityModel(): Float32Array { return mat4Identity(); }
export function translateModel(tx: number, ty: number, tz: number): Float32Array {
  const m = mat4Identity(); m[12] = tx; m[13] = ty; m[14] = tz; return m;
}
export function multiplyModel(a: Float32Array, b: Float32Array): Float32Array { return mat4Multiply(a, b); }
