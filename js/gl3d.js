/*
 * gl3d.js — Rendu WebGL2 de la scène construite par viz3d.js.
 *
 *  • ombres portées du soleil (carte d'ombre 2048², filtrage PCF matériel) ;
 *  • ciel et lumière qui suivent l'heure (jour, crépuscule, nuit) ;
 *  • lampes allumées qui éclairent leur pièce — et seulement elle : une
 *    texture des pièces (issue de la détection du plan) masque la lumière
 *    derrière les murs ;
 *  • vitrages et rayons X transparents (tri arrière → avant), matériaux
 *    émissifs (ampoules, écrans, plaques chaudes), tone mapping ACES ;
 *  • courant animé (particules le long des câbles) ;
 *  • sélection et survol des objets par rendu d'identifiants.
 */

const _M4 = {
  mul(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
    return o;
  },
  persp(fov, asp, n, f) {
    const t = 1 / Math.tan(fov / 2), o = new Float32Array(16);
    o[0] = t / asp; o[5] = t; o[10] = (f + n) / (n - f); o[11] = -1; o[14] = (2 * f * n) / (n - f);
    return o;
  },
  ortho(l, r, b, t, n, f) {
    const o = new Float32Array(16);
    o[0] = 2 / (r - l); o[5] = 2 / (t - b); o[10] = -2 / (f - n);
    o[12] = -(r + l) / (r - l); o[13] = -(t + b) / (t - b); o[14] = -(f + n) / (f - n); o[15] = 1;
    return o;
  },
  look(eye, at, up) {
    const nz = _v3.norm([eye[0] - at[0], eye[1] - at[1], eye[2] - at[2]]);
    const nx = _v3.norm(cross(up, nz)), ny = cross(nz, nx);
    return new Float32Array([
      nx[0], ny[0], nz[0], 0, nx[1], ny[1], nz[1], 0, nx[2], ny[2], nz[2], 0,
      -_v3.dot(nx, eye), -_v3.dot(ny, eye), -_v3.dot(nz, eye), 1,
    ]);
  },
};
const _v3 = {
  norm(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; },
  dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; },
  lerp(a, b, t) { return a.map((v, i) => v + (b[i] - v) * t); },
};
const _smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

const _GLSL_MAIN_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNor;
layout(location=2) in vec4 aCol;
layout(location=3) in vec3 aExt;
uniform mat4 uVP, uSunVP;
out vec3 vPos; out vec3 vNor; out vec4 vCol; out float vEm; out float vObj; out vec4 vSun; out float vDx;
void main() {
  vPos = aPos; vNor = aNor; vCol = aCol; vEm = aExt.x; vObj = aExt.y; vDx = aExt.z;
  vSun = uSunVP * vec4(aPos + aNor * 1.2, 1.0);
  gl_Position = uVP * vec4(aPos, 1.0);
}`;
const _GLSL_MAIN_FS = `#version 300 es
precision highp float;
precision highp sampler2DShadow;
in vec3 vPos; in vec3 vNor; in vec4 vCol; in float vEm; in float vObj; in vec4 vSun; in float vDx;
uniform vec3 uEye, uSunDir, uSunCol, uSky, uGround;
uniform float uShadowOn, uHover, uExposure;
uniform sampler2DShadow uShadow;
uniform int uNL;
uniform float uUpY; // hauteur de l'étage (géométrie décalée en x : vDx ≠ 0)
uniform vec4 uLP[16];
uniform vec4 uLC[16];
uniform sampler2D uRoom;
uniform vec4 uRoomBox;
uniform vec3 uFogCol;
uniform vec4 uFog;
uniform vec3 uClip;
out vec4 frag;
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
void main() {
  if (uClip.y > 0.5 && vPos.y > -10.5 && (uClip.z > 0.5 ? vPos.z : vPos.x) > uClip.x + 0.05) discard;
  vec3 N = normalize(vNor);
  vec3 V = normalize(uEye - vPos);
  if (dot(N, V) < 0.0) N = -N;
  vec3 base = pow(vCol.rgb, vec3(2.2));
  vec3 light = mix(uGround, uSky, N.y * 0.5 + 0.5);
  float ndl = max(dot(N, uSunDir), 0.0);
  if (ndl > 0.0) {
    float sh = 1.0;
    if (uShadowOn > 0.5) {
      vec3 p = vSun.xyz / vSun.w * 0.5 + 0.5;
      if (p.x > 0.0 && p.x < 1.0 && p.y > 0.0 && p.y < 1.0) {
        // au-delà du plan lointain (ombres très longues au coucher) : on compare au plus loin
        float pz = min(p.z, 0.9995);
        // biais proportionnel à la pente : soleil rasant sans « acné » sur la pelouse
        float nc = max(ndl, 0.02);
        float bias = clamp(0.0008 + 0.00035 * sqrt(1.0 - nc * nc) / nc, 0.0008, 0.012);
        vec2 ts = 1.0 / vec2(textureSize(uShadow, 0));
        sh = 0.0;
        for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++)
          sh += texture(uShadow, vec3(p.xy + vec2(float(i), float(j)) * ts * 1.5, pz - bias));
        sh /= 9.0;
      }
    }
    light += uSunCol * ndl * sh;
  }
  float room = 0.0;
  // position dans le plan (les étages sont dessinés côte à côte, décalés en x)
  vec2 q = (vPos.xz - vec2(vDx, 0.0) + N.xz * 14.0 - uRoomBox.xy) * uRoomBox.zw;
  if (q.x >= 0.0 && q.x <= 1.0 && q.y >= 0.0 && q.y <= 1.0) room = floor(texture(uRoom, q).r * 255.0 + 0.5);
  // Les lampes n'éclairent que l'intérieur : rien au-dessus du plafond (toiture)
  int nl = vPos.y < 254.0 + (abs(vDx) > 0.5 ? uUpY : 0.0) ? uNL : 0;
  for (int i = 0; i < 16; i++) {
    if (i >= nl) break;
    vec3 L = uLP[i].xyz - vPos;
    float d = length(L), R = uLP[i].w;
    if (d > R) continue;
    float lr = uLC[i].w;
    if (lr > 0.5 && (abs(lr - room) > 0.5 || vPos.y < -5.0)) continue; // lampe d'une pièce : jamais le terrain
    L /= d;
    float win = clamp(1.0 - pow(d / R, 4.0), 0.0, 1.0);
    float att = win * win / (1.0 + d * d / 22000.0);
    light += uLC[i].rgb * att * (max(dot(N, L), 0.0) * 0.8 + 0.2);
  }
  vec3 col = base * light + base * vEm * 2.6;
  if (uHover > 0.5 && abs(vObj - uHover) < 0.5) col = col * 1.25 + vec3(0.06, 0.12, 0.24);
  col = aces(col * uExposure);
  col = pow(col, vec3(1.0 / 2.2));
  float fog = uFog.w > 0.0 ? smoothstep(uFog.z, uFog.w, distance(vPos.xz, uFog.xy)) : 0.0;
  col = mix(col, uFogCol, fog);
  frag = vec4(col * vCol.a, vCol.a);
}`;
// Vue en coupe : tout ce qui est au-delà du plan x (ou z si uClip.z = 1) = uClip.x disparaît (sauf le terrain)
const _GLSL_CLIP = 'if (uClip.y > 0.5 && vW.y > -10.5 && (uClip.z > 0.5 ? vW.z : vW.x) > uClip.x + 0.05) discard;';
const _GLSL_DEPTH_VS = `#version 300 es
layout(location=0) in vec3 aPos;
uniform mat4 uVP;
out vec3 vW;
void main() { vW = aPos; gl_Position = uVP * vec4(aPos, 1.0); }`;
const _GLSL_DEPTH_FS = `#version 300 es
precision highp float;
in vec3 vW;
uniform vec3 uClip;
out vec4 frag;
void main() { ${_GLSL_CLIP} frag = vec4(1.0); }`;
const _GLSL_PICK_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=3) in vec2 aExt;
uniform mat4 uVP;
flat out float vObj;
out vec3 vW;
void main() { vObj = aExt.y; vW = aPos; gl_Position = uVP * vec4(aPos, 1.0); }`;
const _GLSL_PICK_FS = `#version 300 es
precision highp float;
flat in float vObj;
in vec3 vW;
uniform vec3 uClip;
out vec4 frag;
void main() { ${_GLSL_CLIP} frag = vec4(mod(vObj, 256.0) / 255.0, floor(vObj / 256.0) / 255.0, 0.0, 1.0); }`;
const _GLSL_SKY_VS = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p; gl_Position = vec4(p * 2.0 - 1.0, 0.999, 1.0);
}`;
const _GLSL_SKY_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform vec3 uTop, uHorizon;
uniform float uStars;
out vec4 frag;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  float t = pow(clamp(vUv.y, 0.0, 1.0), 0.7);
  vec3 c = mix(uHorizon, uTop, t);
  vec2 g = floor(gl_FragCoord.xy / 3.0);
  float s = step(0.997, hash(g)) * uStars * smoothstep(0.35, 0.9, vUv.y);
  frag = vec4(c + s * 0.8, 1.0);
}`;
const _GLSL_PT_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec4 aCol;
uniform mat4 uVP;
uniform float uScale;
out vec4 vCol;
void main() {
  vec4 p = uVP * vec4(aPos, 1.0);
  gl_Position = p;
  gl_PointSize = clamp(aCol.a * uScale / p.w, 3.0, 22.0);
  vCol = aCol;
}`;
const _GLSL_PT_FS = `#version 300 es
precision mediump float;
in vec4 vCol;
out vec4 frag;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.1, length(d));
  frag = vec4(vCol.rgb * a, a);
}`;

// Course du soleil par saison (journée type) : déclinaison et midi solaire
// en heure légale (France, heure d'hiver / d'été)
const GL3D_SEASONS = { hiver: { decl: -23.4, noon: 12.75 }, ete: { decl: 23.4, noon: 14.0 } };

class GL3D extends Viz3D {
  static supported() {
    if (GL3D._ok === undefined) {
      try { GL3D._ok = !!document.createElement('canvas').getContext('webgl2'); } catch (e) { GL3D._ok = false; }
    }
    return GL3D._ok;
  }

  constructor(canvas, opts) {
    opts = opts || {};
    super(canvas, Object.assign({}, opts, { noCtx: true }));
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL2 indisponible');
    this.gl = gl;
    this.webgl = true;
    this.sky = !!opts.sky;
    this.shadows = opts.shadows !== false;
    this.hoverObj = null;
    this._init();
    this.setTime(opts.time !== undefined ? opts.time : 15.5);
  }

  _prog(vs, fs) {
    const gl = this.gl;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i), name = info.name.replace(/\[0\]$/, '');
      u[name] = gl.getUniformLocation(p, info.name);
    }
    return { p, u };
  }

  _init() {
    const gl = this.gl;
    this.P = {
      main: this._prog(_GLSL_MAIN_VS, _GLSL_MAIN_FS),
      depth: this._prog(_GLSL_DEPTH_VS, _GLSL_DEPTH_FS),
      pick: this._prog(_GLSL_PICK_VS, _GLSL_PICK_FS),
      sky: this._prog(_GLSL_SKY_VS, _GLSL_SKY_FS),
      pt: this._prog(_GLSL_PT_VS, _GLSL_PT_FS),
    };
    // Carte d'ombre
    this.SHADOW = 2048;
    this.shadowTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, this.SHADOW, this.SHADOW);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    this.shadowFB = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFB);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.shadowTex, 0);
    gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    // Texture des pièces (masque d'éclairage)
    this.roomTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.roomTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([0]));
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    this.roomBox = [0, 0, 0, 0];
    this.vaoO = gl.createVertexArray(); this.vboO = gl.createBuffer();
    this.vaoT = gl.createVertexArray(); this.vboT = gl.createBuffer(); this.iboT = gl.createBuffer();
    this.vaoP = gl.createVertexArray(); this.vboP = gl.createBuffer();
    this.vaoSky = gl.createVertexArray();
    for (const [vao, vbo] of [[this.vaoO, this.vboO], [this.vaoT, this.vboT]]) {
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      const S = 13 * 4; // position, normale, couleur, (émission, objet, décalage d'étage)
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, S, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, S, 12);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, S, 24);
      gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 3, gl.FLOAT, false, S, 40);
    }
    gl.bindVertexArray(this.vaoT); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.iboT);
    gl.bindVertexArray(this.vaoP);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vboP);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 28, 12);
    gl.bindVertexArray(null);
    this.nO = 0; this.nT = 0;
  }

  // ---- Heure du jour : soleil, ciel, ambiance ----
  _clipU() { return this.cutX !== null && this.cutX !== undefined ? [this.cutX, 1, this.cutAxis === 'z' ? 1 : 0] : [0, 0, 0]; }
  // Saison (journée type) : vraie course du soleil à 46° N, heure légale
  setSeason(k) {
    this.season = GL3D_SEASONS[k] || null;
    this.setTime(this.time);
  }
  setTime(h) {
    this.time = h;
    let s;
    if (this.season) {
      // soleil dans le repère est / nord / zénith, puis en 3D : +x = est, +z = sud
      const lat = (46 * Math.PI) / 180, d = (this.season.decl * Math.PI) / 180, H = ((h - this.season.noon) * 15 * Math.PI) / 180;
      const up = Math.sin(lat) * Math.sin(d) + Math.cos(lat) * Math.cos(d) * Math.cos(H);
      const east = -Math.cos(d) * Math.sin(H), north = Math.cos(lat) * Math.sin(d) - Math.sin(lat) * Math.cos(d) * Math.cos(H);
      s = Math.asin(Math.max(-1, Math.min(1, up))); // hauteur (rad) : mêmes seuils que ci-dessous
      this.sunDir = _v3.norm([east, Math.max(up, -0.2), -north]);
    } else {
      const t = (h - 6) / 12;
      s = Math.sin(Math.PI * t);
      const alt = s * 1.0;
      const az = Math.PI * (0.1 + t * 0.8);
      this.sunDir = _v3.norm([Math.cos(az) * Math.cos(alt), Math.sin(alt), 0.35 + Math.sin(az) * Math.cos(alt) * 0.6]);
    }
    const day = _smooth(-0.1, 0.3, s), warm = 1 - _smooth(0.05, 0.55, s);
    this.day = day;
    this.sunCol = _v3.lerp([1.0, 0.92, 0.82], [1.0, 0.52, 0.28], warm).map((v) => v * 1.75 * _smooth(-0.02, 0.12, s));
    this.skyAmb = _v3.lerp([0.075, 0.08, 0.11], [0.4, 0.46, 0.56], day);
    this.groundAmb = _v3.lerp([0.035, 0.032, 0.035], [0.24, 0.22, 0.19], day);
    const dusk = _smooth(0.0, 0.3, s) * (1 - _smooth(0.2, 0.45, s)); // lumière dorée : la dernière heure
    this.skyTop = _v3.lerp(_v3.lerp([0.02, 0.03, 0.08], [0.33, 0.54, 0.8], day), [0.2, 0.24, 0.45], dusk * 0.8);
    this.skyHor = _v3.lerp(_v3.lerp([0.06, 0.08, 0.16], [0.8, 0.87, 0.94], day), [1.0, 0.62, 0.42], dusk * 0.9);
    this.exposure = 0.92 + (1 - day) * 0.45;
    this._shadowDirty = true;
  }

  // ---- Géométrie ----
  _upload() {
    const gl = this.gl;
    this.objIndex = new Map(); this.objList = [null];
    const idx = (o) => {
      if (!o) return 0;
      if (!this.objIndex.has(o)) { this.objIndex.set(o, this.objList.length); this.objList.push(o); }
      return this.objIndex.get(o);
    };
    let nOpaque = 0, nTrans = 0;
    for (const f of this.faces) { const n = (f.pts.length - 2) * 3; if (f.alpha < 0.99) nTrans += n; else nOpaque += n; }
    const O = new Float32Array(nOpaque * 13), T = new Float32Array(nTrans * 13);
    let o = 0, t = 0;
    this.tFaces = [];
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const f of this.faces) {
      const [a, b, c] = f.pts;
      const n = _v3.norm(cross([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - a[0], c[1] - a[1], c[2] - a[2]]));
      const col = f.color, al = f.alpha === undefined ? 1 : f.alpha, em = f.em || 0, ob = idx(f.obj), dx = f.dx || 0;
      const trans = al < 0.99;
      const arr = trans ? T : O;
      let k = trans ? t : o;
      const start = k;
      const put = (p) => {
        arr[k++] = p[0]; arr[k++] = p[1]; arr[k++] = p[2];
        arr[k++] = n[0]; arr[k++] = n[1]; arr[k++] = n[2];
        arr[k++] = col[0] / 255; arr[k++] = col[1] / 255; arr[k++] = col[2] / 255; arr[k++] = al;
        arr[k++] = em; arr[k++] = ob; arr[k++] = dx;
        if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
        if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
        if (p[2] < minZ) minZ = p[2]; if (p[2] > maxZ) maxZ = p[2];
      };
      for (let i = 1; i < f.pts.length - 1; i++) { put(f.pts[0]); put(f.pts[i]); put(f.pts[i + 1]); }
      if (trans) {
        const cx = f.pts.reduce((s, p) => s + p[0], 0) / f.pts.length, cy = f.pts.reduce((s, p) => s + p[1], 0) / f.pts.length, cz = f.pts.reduce((s, p) => s + p[2], 0) / f.pts.length;
        this.tFaces.push({ c: [cx, cy, cz], v0: start / 13, n: (k - start) / 13 });
        t = k;
      } else o = k;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vboO); gl.bufferData(gl.ARRAY_BUFFER, O, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vboT); gl.bufferData(gl.ARRAY_BUFFER, T, gl.STATIC_DRAW);
    this.nO = nOpaque; this.nT = nTrans;
    this.sceneBox = isFinite(minX) ? { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] } : { min: [-100, 0, -100], max: [100, 50, 100] };
    // Masque des pièces
    const info = this.scene && this.scene.rooms;
    gl.bindTexture(gl.TEXTURE_2D, this.roomTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    if (info && info.owner) {
      const data = new Uint8Array(info.nx * info.ny);
      for (let i = 0; i < data.length; i++) data[i] = Math.min(255, info.owner[i] + 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, info.nx, info.ny, 0, gl.RED, gl.UNSIGNED_BYTE, data);
      const S = info.step;
      this.roomBox = [info.x0 - S / 2, info.y0 - S / 2, 1 / (info.nx * S), 1 / (info.ny * S)];
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([0]));
      this.roomBox = [0, 0, 0, 0];
    }
    this.dirty = false;
    this._shadowDirty = true;
  }

  // Emprise utile (la maison, pas le terrain) : cadre la carte d'ombre et la brume
  _focusBox() {
    const b = this.outerBounds || this.bounds, s = this.sceneBox; // terrain compris (ombres de la haie, des arbres)
    if (!b || !s) return s;
    return { min: [b.minX - 60, s.min[1], b.minZ - 60], max: [b.maxX + 60, s.max[1], b.maxZ + 60] };
  }
  _sunMatrix() {
    const b = this._focusBox();
    const c = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
    const R = Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) / 2 + 20;
    const d = this.sunDir;
    const eye = [c[0] + d[0] * R * 2, c[1] + d[1] * R * 2, c[2] + d[2] * R * 2];
    const up = Math.abs(d[1]) > 0.98 ? [0, 0, 1] : [0, 1, 0];
    return _M4.mul(_M4.ortho(-R, R, -R, R, R * 0.5, R * 3.5), _M4.look(eye, c, up));
  }

  _viewProj(cam, W, H) {
    const b = this.sceneBox || { min: [0, 0, 0], max: [1000, 1000, 1000] };
    const span = Math.hypot(b.max[0] - b.min[0], b.max[2] - b.min[2]) + 4000;
    const near = this.mode === 'walk' ? 4 : Math.max(4, this.dist * 0.02);
    return _M4.mul(_M4.persp(cam.fov, W / H, near, near + span + this.dist * 2), _M4.look(cam.eye, cam.look, [0, 1, 0]));
  }

  // Position à l'écran (px CSS) d'un point de la scène ; null s'il est derrière la caméra
  project(p) {
    const m = this._VP;
    if (!m) return null;
    const x = p[0], y = p[1], z = p[2];
    const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
    const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
    const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (cw <= 1e-6) return null;
    return { x: (cx / cw * 0.5 + 0.5) * this.canvas.clientWidth, y: (0.5 - (cy / cw) * 0.5) * this.canvas.clientHeight };
  }

  render() {
    const gl = this.gl;
    if (this.dirty || !this.sceneBox) this._upload();
    const W = this.canvas.width, H = this.canvas.height;
    const cam = this.camera();
    this._cam = cam;
    const VP = this._viewProj(cam, W, H);
    this._VP = VP;
    const sunUp = this.sunDir[1] > 0.02 && this.shadows && this.nO > 0;
    const SVP = this._sunMatrix();
    // 1. Ombres
    if (sunUp && this._shadowDirty) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFB);
      gl.viewport(0, 0, this.SHADOW, this.SHADOW);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
      gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1.5, 3);
      gl.useProgram(this.P.depth.p);
      gl.uniformMatrix4fv(this.P.depth.u.uVP, false, SVP);
      gl.uniform3fv(this.P.depth.u.uClip, this._clipU());
      gl.bindVertexArray(this.vaoO);
      gl.drawArrays(gl.TRIANGLES, 0, this.nO);
      gl.disable(gl.POLYGON_OFFSET_FILL);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this._shadowDirty = false;
    }
    // 2. Ciel
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (this.sky) {
      gl.disable(gl.DEPTH_TEST);
      gl.useProgram(this.P.sky.p);
      gl.uniform3fv(this.P.sky.u.uTop, this.skyTop);
      gl.uniform3fv(this.P.sky.u.uHorizon, this.skyHor);
      gl.uniform1f(this.P.sky.u.uStars, 1 - this.day);
      gl.bindVertexArray(this.vaoSky);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    // 3. Scène
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
    const P = this.P.main;
    gl.useProgram(P.p);
    gl.uniformMatrix4fv(P.u.uVP, false, VP);
    gl.uniformMatrix4fv(P.u.uSunVP, false, SVP);
    gl.uniform3fv(P.u.uEye, cam.eye);
    gl.uniform3fv(P.u.uSunDir, this.sunDir);
    gl.uniform3fv(P.u.uSunCol, this.sunCol);
    gl.uniform3fv(P.u.uSky, this.skyAmb);
    gl.uniform3fv(P.u.uGround, this.groundAmb);
    gl.uniform1f(P.u.uShadowOn, sunUp ? 1 : 0);
    gl.uniform1f(P.u.uExposure, this.exposure);
    gl.uniform1f(P.u.uHover, this.hoverObj && this.objIndex ? this.objIndex.get(this.hoverObj) || 0 : 0);
    gl.uniform4fv(P.u.uRoomBox, this.roomBox);
    // brume : le terrain se fond dans l'horizon autour de la maison
    const sb = this._focusBox(), rad = sb ? Math.hypot(sb.max[0] - sb.min[0], sb.max[2] - sb.min[2]) / 2 : 1000;
    gl.uniform3fv(P.u.uFogCol, this.sky ? this.skyHor : [0, 0, 0]);
    gl.uniform4fv(P.u.uFog, this.sky && sb ? [(sb.min[0] + sb.max[0]) / 2, (sb.min[2] + sb.max[2]) / 2, rad * 1.15, rad * 2.1] : [0, 0, 0, 0]);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.shadowTex); gl.uniform1i(P.u.uShadow, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.roomTex); gl.uniform1i(P.u.uRoom, 1);
    // lampes : les 16 plus proches du regard
    // vue en coupe : les éclairages extérieurs de la partie retirée disparaissent avec elle
    const cutX = this.cutX, cz = this.cutAxis === 'z';
    const lit = cutX === null || cutX === undefined ? this.lights : this.lights.filter((l) => l.room >= 0 || (cz ? l.z : l.x) <= cutX);
    const ls = lit.slice().sort((a, b) => Math.hypot(a.x - cam.look[0], a.z - cam.look[2]) - Math.hypot(b.x - cam.look[0], b.z - cam.look[2])).slice(0, 16);
    const LP = new Float32Array(64), LC = new Float32Array(64);
    ls.forEach((l, i) => {
      LP.set([l.x, l.y, l.z, l.radius || 620], i * 4);
      // éclairage extérieur à interrupteur crépusculaire : il s'allume avec la nuit
      const k = 2.1 * (l.power || 1) * (l.dusk ? Math.max(0, 1 - this.day * 1.4) : 1);
      LC.set([l.color[0] * k, l.color[1] * k, l.color[2] * k, (l.room >= 0 ? l.room + 1 : 0)], i * 4);
    });
    gl.uniform1i(P.u.uNL, ls.length);
    gl.uniform1f(P.u.uUpY, (this.scene && this.scene.upDy) || 0);
    gl.uniform3fv(P.u.uClip, this._clipU());
    gl.uniform4fv(P.u.uLP, LP);
    gl.uniform4fv(P.u.uLC, LC);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(this.vaoO);
    gl.drawArrays(gl.TRIANGLES, 0, this.nO);
    // 4. Transparents, triés de l'arrière vers l'avant
    if (this.nT) {
      const e = cam.eye;
      this.tFaces.sort((a, b) => ((b.c[0] - e[0]) ** 2 + (b.c[1] - e[1]) ** 2 + (b.c[2] - e[2]) ** 2) - ((a.c[0] - e[0]) ** 2 + (a.c[1] - e[1]) ** 2 + (a.c[2] - e[2]) ** 2));
      const ib = new Uint32Array(this.nT);
      let k = 0;
      for (const f of this.tFaces) for (let i = 0; i < f.n; i++) ib[k++] = f.v0 + i;
      gl.bindVertexArray(this.vaoT);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.iboT);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, ib, gl.DYNAMIC_DRAW);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.drawElements(gl.TRIANGLES, this.nT, gl.UNSIGNED_INT, 0);
      gl.depthMask(true);
    }
    // 5. Courant animé
    if (this.flows.length) this._drawFlows(VP, H, cam);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }

  _drawFlows(VP, H, cam) {
    const gl = this.gl, now = performance.now() / 1000;
    const out = [];
    for (const f of this.flows) {
      if (!f.len) {
        f.cum = [0];
        for (let i = 1; i < f.pts.length; i++) {
          const a = f.pts[i - 1], b = f.pts[i];
          f.cum.push(f.cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
        }
        f.len = f.cum[f.cum.length - 1];
      }
      const gap = 28;
      let s = (now * f.speed) % gap, i = 1;
      for (; s < f.len; s += gap) {
        while (i < f.cum.length - 1 && f.cum[i] < s) i++;
        const a = f.pts[i - 1], b = f.pts[i], seg = f.cum[i] - f.cum[i - 1] || 1, u = (s - f.cum[i - 1]) / seg;
        out.push(a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u, f.color[0], f.color[1], f.color[2], f.size);
      }
      if (out.length > 7 * 6000) break;
    }
    if (!out.length) return;
    gl.useProgram(this.P.pt.p);
    gl.uniformMatrix4fv(this.P.pt.u.uVP, false, VP);
    gl.uniform1f(this.P.pt.u.uScale, H / (2 * Math.tan(cam.fov / 2)));
    gl.bindVertexArray(this.vaoP);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vboP);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(out), gl.STREAM_DRAW);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    gl.depthMask(false);
    gl.drawArrays(gl.POINTS, 0, out.length / 7);
    gl.depthMask(true);
  }

  // Objet sous le pointeur : rendu des identifiants dans un tampon hors écran
  pick(x, y) {
    const gl = this.gl;
    if (!this._VP || !this.objList) return null;
    const W = this.canvas.width, H = this.canvas.height;
    if (!this._pickFB || this._pickW !== W || this._pickH !== H) {
      if (this._pickFB) { gl.deleteFramebuffer(this._pickFB); gl.deleteTexture(this._pickTex); gl.deleteRenderbuffer(this._pickDepth); }
      this._pickFB = gl.createFramebuffer();
      this._pickTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this._pickTex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, W, H);
      this._pickDepth = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, this._pickDepth);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, W, H);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this._pickFB);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this._pickTex, 0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this._pickDepth);
      this._pickW = W; this._pickH = H;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._pickFB);
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    gl.useProgram(this.P.pick.p);
    gl.uniformMatrix4fv(this.P.pick.u.uVP, false, this._VP);
    gl.uniform3fv(this.P.pick.u.uClip, this._clipU());
    gl.bindVertexArray(this.vaoO);
    gl.drawArrays(gl.TRIANGLES, 0, this.nO);
    const dpr = this._dpr || 1;
    const px = new Uint8Array(4);
    gl.readPixels(Math.round(x * dpr), Math.round(H - y * dpr), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(null);
    const id = px[0] + px[1] * 256;
    return this.objList[id] || null;
  }
}
