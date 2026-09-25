/*
 * viz3d.js — Scène 3D : construction (carte électronique ou maison à
 * l'échelle), caméra orbitale et visite à la première personne, sélection
 * d'objets, et moteur de repli en canvas 2D (algorithme du peintre).
 *
 * Repère : Y vers le haut ; le plan est dans XZ (x → X, y → Z) ; 1 unité = 1 cm.
 *
 *  - Viz3D        : géométrie (faces colorées, émissives, transparentes,
 *                   rattachées à un objet), caméra, interaction, rendu 2D.
 *                   GL3D (gl3d.js) en hérite et rend la même scène en WebGL2.
 *  - BUILDERS3D   : volume de chaque composant.
 *  - buildBoard() : construit la scène complète et décrit l'éclairage, les
 *                   obstacles de la visite et les câbles (rayons X).
 */

const HOUSE3D = { H: 250, CUT: 115, LOW: 14, T_EXT: 20, T_INT: 10, EYE: 162, RADIUS: 22 };
const WALL_COL = '#e7e2d9';

class Viz3D {
  constructor(canvas, opts) {
    opts = opts || {};
    this.canvas = canvas;
    this.ctx = opts.noCtx ? null : canvas.getContext('2d');
    this.faces = [];                       // { pts, color, layer, obj, em, alpha }
    this.yaw = opts.yaw !== undefined ? opts.yaw : -0.65;
    this.pitch = opts.pitch !== undefined ? opts.pitch : 0.82;
    this.dist = opts.dist || 700;
    this.target = opts.target || [0, 0, 0];
    this.fov = opts.fov || 42 * Math.PI / 180;
    this.autoRotate = opts.autoRotate !== false;
    this.light = this._norm([0.45, 1, 0.3]);
    this.light2 = this._norm([-0.6, 0.25, -0.75]);
    this.bg = opts.bg || null;
    this.mode = 'orbit';
    this.walk = null;
    this.trans = null;
    this.keys = {};
    this.lights = [];
    this.flows = [];
    this.scene = null;
    this.cutX = null; // vue en coupe : plan vertical x = cutX (ou z si cutAxis = 'z') ; la partie au-delà disparaît
    this.cutAxis = 'x';
    this.obj = null; this.em = 0; this.alpha = 1;
    this.onPick = null; this.onHover = null;
    this._raf = null;
    this._drag = null;
    if (opts.interactive !== false) this._bind();
  }

  // ---- Scène ----
  // Les calques évitent qu'une grande face (le PCB) recouvre les petites dans
  // le rendu 2D : le calque 0 est toujours peint avant le calque 1.
  clear() { this.faces = []; this._layer = 1; this.lights = []; this.flows = []; this.dirty = true; }
  setLayer(n) { this._layer = n; }
  poly(pts, color) {
    this.dirty = true;
    // étage : décalage de la géométrie (le plan de l'étage est dessiné à côté du rez-de-chaussée)
    const o = this.off;
    if (o) pts = pts.map((p) => [p[0] + o.dx, p[1] + o.dy, p[2]]);
    this.faces.push({
      pts, color: this._rgb(color), layer: this._layer === undefined ? 1 : this._layer,
      obj: this.obj, em: this.em, alpha: this.alpha, dx: o ? o.dx : 0, cap: !!this.capping,
    });
  }
  addLight(l) {
    const o = this.off;
    l.px = l.x; l.pz = l.z; // position dans le plan (pièce de la lampe)
    if (o) { l.x += o.dx; l.y += o.dy; }
    this.lights.push(l);
  }

  box(cx, cy, cz, sx, sy, sz, color, ry, top) {
    const x0 = -sx / 2, x1 = sx / 2, y0 = 0, y1 = sy, z0 = -sz / 2, z1 = sz / 2;
    let v = [
      [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1],
      [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1],
    ];
    if (ry) v = v.map((p) => rotY(p, ry));
    v = v.map((p) => [p[0] + cx, p[1] + cy, p[2] + cz]);
    const q = (a, b, c, d, col) => this.poly([v[a], v[b], v[c], v[d]], col || color);
    q(4, 5, 6, 7, top); q(3, 2, 1, 0); // dessus / dessous
    q(0, 1, 5, 4); q(2, 3, 7, 6);      // faces Z
    q(1, 2, 6, 5); q(3, 0, 4, 7);      // faces X
  }

  // Cylindre (ou tronc de cône avec r2) : axis 'y' (vertical, base en cy) ou
  // 'x' (couché, centré en cy) ; ry = rotation autour de Y (degrés)
  cyl(cx, cy, cz, r, len, color, o) {
    o = o || {};
    const seg = o.seg || 14, axis = o.axis || 'y', ry = o.ry || 0;
    const r2 = o.r2 !== undefined ? o.r2 : r;
    const ring = (t, rr) => {
      const pts = [];
      for (let i = 0; i < seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        let p = axis === 'y' ? [Math.cos(a) * rr, t, Math.sin(a) * rr] : [t - len / 2, Math.cos(a) * rr, Math.sin(a) * rr];
        if (ry) p = rotY(p, ry);
        pts.push([p[0] + cx, p[1] + cy, p[2] + cz]);
      }
      return pts;
    };
    const a = ring(0, r), b = ring(len, r2);
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg;
      this.poly([a[i], a[j], b[j], b[i]], color);
    }
    if (o.capBot !== false) this.poly(a.slice().reverse(), o.capColor || color);
    if (o.capTop !== false) this.poly(b, o.capColor || color);
  }

  dome(cx, cy, cz, r, color, o) {
    o = o || {};
    const seg = o.seg || 12, rings = o.rings || 5, sy = o.sy || 1;
    const pt = (i, k) => {
      const a = (i / seg) * Math.PI * 2, e = (k / rings) * Math.PI / 2;
      return [cx + Math.cos(a) * Math.cos(e) * r, cy + Math.sin(e) * r * sy, cz + Math.sin(a) * Math.cos(e) * r];
    };
    for (let k = 0; k < rings; k++) {
      for (let i = 0; i < seg; i++) {
        const j = (i + 1) % seg;
        this.poly([pt(i, k), pt(j, k), pt(j, k + 1), pt(i, k + 1)], color);
      }
    }
  }

  // ---- Caméra ----
  fit(radius) {
    // Écran en portrait (téléphone) : c'est l'angle horizontal qui limite
    const r = this.canvas.getBoundingClientRect();
    const aspect = r.width && r.height ? Math.min(1, r.width / r.height) : 1;
    this.dist = Math.max(radius, 60) / (Math.tan(this.fov / 2) * aspect) * 1.25;
    this.baseDist = this.dist;
  }
  _orbitCam() {
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const t = this.target;
    return {
      eye: [t[0] + this.dist * cp * Math.sin(this.yaw), t[1] + this.dist * sp, t[2] + this.dist * cp * Math.cos(this.yaw)],
      look: t.slice(), fov: this.fov,
    };
  }
  // Décalage 3D du niveau où se trouve le visiteur (maison à étage)
  _walkOff() {
    const st = this.scene && this.scene.stairs, w = this.walk;
    return (st && st.off[w.level || 0]) || { dx: 0, dy: 0 };
  }
  _walkCam() {
    const w = this.walk, o = this._walkOff();
    const eye = [w.x + o.dx, HOUSE3D.EYE + w.bob + (w.ey !== undefined ? w.ey : o.dy + (w.lift || 0)), w.z];
    const cp = Math.cos(w.pitch);
    return { eye, look: [eye[0] - Math.sin(w.yaw) * cp * 100, eye[1] + Math.sin(w.pitch) * 100, eye[2] - Math.cos(w.yaw) * cp * 100], fov: 62 * Math.PI / 180 };
  }
  camera() {
    const cur = this.mode === 'walk' && this.walk ? this._walkCam() : this._orbitCam();
    if (!this.trans) return cur;
    const k0 = Math.min(1, (performance.now() - this.trans.t0) / this.trans.dur);
    const k = k0 < 0.5 ? 2 * k0 * k0 : 1 - Math.pow(-2 * k0 + 2, 2) / 2;
    const f = this.trans.from;
    const lerp = (a, b) => a.map((v, i) => v + (b[i] - v) * k);
    if (k0 >= 1) this.trans = null;
    return { eye: lerp(f.eye, cur.eye), look: lerp(f.look, cur.look), fov: f.fov + (cur.fov - f.fov) * k };
  }
  // Transition douce vers un nouvel état de caméra (appliqué par fn)
  animateTo(fn, dur) {
    const from = this.camera();
    fn();
    this.trans = { from, t0: performance.now(), dur: dur || 700 };
    this.autoRotate = false;
  }
  setView(name) {
    this.animateTo(() => {
      if (this.mode === 'walk') this.exitWalk(true);
      if (name === 'top') { this.pitch = 1.53; this.yaw = 0; this.dist = (this.baseDist || this.dist) * 0.95; }
      else { this.pitch = 0.78; this.yaw = -0.55; this.dist = this.baseDist || this.dist; }
    }, 800);
  }

  // Gerbe d'étincelles (défaut) au point 3D (x, y, z) — rendue par le moteur WebGL
  spark(x, y, z, opts) {
    opts = opts || {};
    const n = opts.n || 60, rays = [];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * 1.2 - 0.2, v = (opts.speed || 260) * (0.4 + Math.random() * 0.8);
      rays.push({ dx: Math.cos(a) * Math.cos(e), dy: Math.sin(e), dz: Math.sin(a) * Math.cos(e), v });
    }
    (this.sparks = this.sparks || []).push({
      x, y, z, rays, t0: performance.now() / 1000, dur: opts.dur || 1.1, g: opts.g === undefined ? 380 : opts.g,
      color: opts.color || [1, 0.72, 0.28], size: opts.size || 15, flash: opts.flash === undefined ? [1, 0.6, 0.25] : opts.flash, room: opts.room,
    });
    this.dirty = true;
  }

  // ---- Vue en coupe ----
  setCut(x, axis) {
    this.cutX = x === null || x === undefined ? null : x;
    if (axis) this.cutAxis = axis;
    _buildCaps(this, this.cutX);
    this.dirty = true;
  }

  // ---- Visite à la première personne ----
  enterWalk(start) {
    const s = start || (this.scene && this.scene.start) || { x: this.target[0], z: this.target[2], yaw: 0 };
    this.animateTo(() => {
      this.mode = 'walk';
      this.walk = { x: s.x, z: s.z, yaw: s.yaw, pitch: -0.08, vx: 0, vz: 0, bob: 0, phase: 0, level: 0, lift: 0, stair: false };
    }, 1100);
  }
  exitWalk(silent) {
    const go = () => { this.mode = 'orbit'; };
    if (silent) go(); else this.animateTo(go, 900);
  }
  // Déplacement : accélération douce, collisions avec les murs et les meubles
  update(dt) {
    if (this.mode === 'walk' && this.walk) {
      const w = this.walk, k = this.keys;
      let f = (k.z || k.w || k.arrowup ? 1 : 0) - (k.s || k.arrowdown ? 1 : 0);
      let r = (k.d ? 1 : 0) - (k.q || k.a ? 1 : 0);
      const turn = (k.arrowright ? 1 : 0) - (k.arrowleft ? 1 : 0);
      w.yaw -= turn * dt * 1.8;
      let speed = k.shift ? 320 : 170;
      // joystick tactile : direction et intensité analogiques
      if (this.stick) { f = -this.stick.y; r = this.stick.x; speed = 60 + 220 * Math.min(1, Math.hypot(f, r)); }
      const fx = -Math.sin(w.yaw), fz = -Math.cos(w.yaw), rx = Math.cos(w.yaw), rz = -Math.sin(w.yaw);
      let tx = fx * f + rx * r, tz = fz * f + rz * r;
      const l = Math.hypot(tx, tz);
      if (l > 0.05) { tx = (tx / l) * speed; tz = (tz / l) * speed; } else { tx = 0; tz = 0; }
      const a = Math.min(1, dt * 9);
      w.vx += (tx - w.vx) * a; w.vz += (tz - w.vz) * a;
      if (!this.guided) { // visite guidée : la trajectoire passe par les portes, pas de collisions
        const nx = w.x + w.vx * dt, nz = w.z + w.vz * dt;
        const st = this.scene && this.scene.stairs;
        if (st) this._walkStairs(w, st, nx, nz);
        else { const p = collideCircle(this.scene, nx, nz, HOUSE3D.RADIUS); w.x = p.x; w.z = p.z; }
      }
      // pièce où l'on entre (nom affiché par l'interface)
      if (this.onRoom && !this.guided && this.scene && this.scene.rooms && typeof roomAt === 'function') {
        const r = w.stair ? -2 : roomAt(this.scene.rooms, w.x, w.z);
        if (r !== w.room) { const first = w.room === undefined; w.room = r; if (r >= 0 && !first) this.onRoom(r); }
      }
      // hauteur des yeux lissée (marches, changement de niveau)
      const yT = this._walkOff().dy + (w.lift || 0);
      w.ey = w.ey === undefined || this.guided ? yT : w.ey + (yT - w.ey) * Math.min(1, dt * 14);
      const v = Math.hypot(w.vx, w.vz);
      w.phase += v * dt * 0.045;
      w.bob = v > 10 ? Math.sin(w.phase) * 1.6 : w.bob * 0.9;
    } else if (this.autoRotate && !this._drag) {
      this.yaw += dt * 0.27;
    }
  }

  // Escalier : on entre par le bas de la volée (ou par la trémie, à l'étage),
  // la hauteur suit la position sur la volée ; en haut on sort devant ou sur
  // le côté (volée qui finit contre un mur : on tourne sur le palier).
  // La volée va du bas (y local +157) au haut (y local −157) du symbole.
  _walkStairs(w, st, nx, nz) {
    const R = HOUSE3D.RADIUS, HALF = 157, W2 = 38, TOP = HALF - 90, rise = st.off[1].dy - st.off[0].dy;
    const toLocal = (c, x, z) => {
      const a = (-(c.rot || 0) * Math.PI) / 180, co = Math.cos(a), si = Math.sin(a), dx = x - c.x, dz = z - c.y;
      return [dx * co - dz * si, dx * si + dz * co];
    };
    const liftAt = (ly) => Math.max(0, Math.min(1, (HALF - ly) / (2 * HALF - 60))) * rise;
    const [vx, vy] = toLocal({ x: 0, y: 0, rot: st.lo.rot }, w.vx, w.vz); // vy < 0 : on monte
    if (!w.stair) {
      if (!w.level) {
        const [lx, ly] = toLocal(st.lo, nx, nz);
        if (Math.abs(lx) < W2 + 8 && ly > HALF - 24 && ly < HALF + R + 6 && vy < -1) { w.stair = true; w.from = 0; }
      } else if (w.level === 1) {
        const [lx, ly] = toLocal(st.hi, nx, nz);
        // on s'avance dans la trémie par le haut de la volée (devant ou sur le côté)
        const into = (ly < -HALF + 4 && vy > 1) || (Math.abs(lx) > 40 && lx * vx < -1);
        // (le visiteur bute contre le bord de la trémie : on le laisse s'y engager)
        if (Math.abs(lx) < 52 + R + 6 && ly > -HALF - R - 6 && ly < -TOP && into) {
          const [X, Z] = _lp(st.lo, Math.max(-W2, Math.min(W2, lx)), Math.max(ly, -HALF + 30));
          nx = X; nz = Z; w.x = X; w.z = Z;
          w.stair = true; w.from = 1; w.level = 0;
        }
      }
    }
    if (!w.stair) {
      const p = collideCircle(this.scene, nx, nz, R);
      w.x = p.x; w.z = p.z;
      return;
    }
    const p = collideCircle(this.scene, nx, nz, R, st.polys[0]);
    const [lx0, ly] = toLocal(st.lo, p.x, p.z);
    const side = Math.abs(lx0) > W2 + 4;
    // arrivée à l'étage : en haut de la volée, devant ou sur le côté, là où le plancher est libre
    if (ly < -TOP && (side || ly < -HALF - 2)) {
      // repoussé hors de la trémie sur le palier : position stable et proche = plancher libre
      const qx = p.x + st.hi.x - st.lo.x, qz = p.z + st.hi.y - st.lo.y, q = collideCircle(this.scene, qx, qz, R);
      const q2 = collideCircle(this.scene, q.x, q.z, R);
      if (Math.hypot(q.x - qx, q.z - qz) < R + 16 && Math.hypot(q2.x - q.x, q2.z - q.z) < 1) {
        w.x = q.x; w.z = q.z; w.stair = false; w.lift = 0; w.level = 1;
        if (w.from === 0 && this.onLevel) this.onLevel(1);
        return;
      }
    }
    // retour au sol du rez-de-chaussée : en bas, devant ou sur le côté des premières marches
    if (ly > HALF + 2 || (side && liftAt(ly) < 40)) {
      w.x = p.x; w.z = p.z; w.stair = false; w.lift = 0;
      if (w.from === 1 && this.onLevel) this.onLevel(0);
      return;
    }
    const lx = Math.max(-W2, Math.min(W2, lx0));
    [w.x, w.z] = _lp(st.lo, lx, ly);
    w.lift = liftAt(ly);
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    this._dpr = dpr;
  }

  // ---- Rendu 2D (algorithme du peintre) ----
  render() {
    const ctx = this.ctx;
    const dpr = this._dpr || 1;
    const W = this.canvas.width / dpr, H = this.canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (this.bg) { ctx.fillStyle = this.bg; ctx.fillRect(0, 0, W, H); }
    const cam = this.camera();
    const eye = cam.eye;
    const fwd = this._norm([cam.look[0] - eye[0], cam.look[1] - eye[1], cam.look[2] - eye[2]]);
    const right = this._norm(cross(fwd, [0, 1, 0]));
    const up = cross(right, fwd);
    const f = (H / 2) / Math.tan(cam.fov / 2);
    const near = 8;
    const out = [];
    const cut = this.cutX, ca = this.cutAxis === 'z' ? 2 : 0;
    for (const face of this.faces) {
      if (cut !== null && !face.cap) { // vue en coupe (le terrain reste)
        let cx = 0, cy = 0;
        for (const p of face.pts) { cx += p[ca]; cy += p[1]; }
        if (cy / face.pts.length > -10.5 && cx / face.pts.length > cut) continue;
      }
      let zsum = 0; const proj = [];
      let ok = true;
      for (const p of face.pts) {
        const dx = p[0] - eye[0], dy = p[1] - eye[1], dz = p[2] - eye[2];
        const z = dx * fwd[0] + dy * fwd[1] + dz * fwd[2];
        if (z < near) { ok = false; break; }
        zsum += z;
        proj.push([W / 2 + ((dx * right[0] + dy * right[1] + dz * right[2]) * f) / z, H / 2 - ((dx * up[0] + dy * up[1] + dz * up[2]) * f) / z]);
      }
      if (!ok) continue;
      const [a, b, c] = face.pts;
      const n = this._norm(cross([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - a[0], c[1] - a[1], c[2] - a[2]]));
      const d1 = Math.abs(n[0] * this.light[0] + n[1] * this.light[1] + n[2] * this.light[2]);
      const d2 = Math.abs(n[0] * this.light2[0] + n[1] * this.light2[1] + n[2] * this.light2[2]);
      const k = Math.min(1.04, 0.36 + 0.52 * d1 + 0.2 * d2) + (face.em || 0) * 0.7;
      out.push({
        z: zsum / face.pts.length, layer: face.layer, proj, obj: face.obj, alpha: face.alpha,
        col: `rgb(${Math.min(255, face.color[0] * k) | 0},${Math.min(255, face.color[1] * k) | 0},${Math.min(255, face.color[2] * k) | 0})`,
      });
    }
    out.sort((p, q) => (p.layer !== q.layer ? p.layer - q.layer : q.z - p.z));
    for (const fce of out) {
      ctx.beginPath();
      ctx.moveTo(fce.proj[0][0], fce.proj[0][1]);
      for (let i = 1; i < fce.proj.length; i++) ctx.lineTo(fce.proj[i][0], fce.proj[i][1]);
      ctx.closePath();
      ctx.globalAlpha = fce.alpha === undefined ? 1 : fce.alpha;
      ctx.fillStyle = fce.col;
      ctx.strokeStyle = fce.col; ctx.lineWidth = 0.7;
      ctx.fill(); if (ctx.globalAlpha === 1) ctx.stroke();
    }
    ctx.globalAlpha = 1;
    this._drawn = out;
  }

  // Objet sous le pointeur (coordonnées CSS dans le canvas)
  pick(x, y) {
    const list = this._drawn || [];
    for (let i = list.length - 1; i >= 0; i--) {
      const f = list[i];
      if (!f.obj || (f.alpha !== undefined && f.alpha < 0.5)) continue;
      if (pointInPoly2(f.proj, x, y)) return f.obj;
    }
    return null;
  }

  start() {
    this.resize();
    let last = performance.now();
    const loop = (now) => {
      const dt = Math.min(0.05, ((now || performance.now()) - last) / 1000);
      last = now || performance.now();
      this.update(dt);
      this.render();
      if (this.onFrame) this.onFrame();
      this._raf = requestAnimationFrame(loop);
    };
    if (!this._raf) loop(performance.now());
  }
  stop() { if (this._raf) cancelAnimationFrame(this._raf); this._raf = null; }

  // ---- Interaction ----
  _bind() {
    const cv = this.canvas;
    cv.style.touchAction = 'none';
    const pts = new Map();
    const pos = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    cv.addEventListener('pointerdown', (e) => {
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this._drag = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, pan: e.button === 2 || e.shiftKey, moved: false };
      cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener('pointermove', (e) => {
      if (pts.has(e.pointerId) && pts.size === 2) {
        const [a, b] = [...pts.values()];
        const d0 = Math.hypot(a.x - b.x, a.y - b.y);
        pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const [c, d] = [...pts.values()];
        const d1 = Math.hypot(c.x - d.x, c.y - d.y);
        if (d0 > 0 && this.mode === 'orbit') this.dist = Math.max(80, Math.min(9000, this.dist * d0 / d1));
        if (this._drag) this._drag.moved = true;
        return;
      }
      if (!this._drag) {
        if (this.onHover && performance.now() - (this._hoverT || 0) > 70) {
          this._hoverT = performance.now();
          const p = pos(e);
          this.onHover(this.pick(p.x, p.y), p);
        }
        return;
      }
      const dx = e.clientX - this._drag.x, dy = e.clientY - this._drag.y;
      if (Math.hypot(e.clientX - this._drag.x0, e.clientY - this._drag.y0) > 4) this._drag.moved = true;
      this._drag.x = e.clientX; this._drag.y = e.clientY;
      if (this.mode === 'walk' && this.walk) {
        this.walk.yaw += dx * 0.0045;
        this.walk.pitch = Math.max(-1.2, Math.min(1.2, this.walk.pitch + dy * 0.0035));
      } else if (this._drag.pan) {
        const k = this.dist / 900;
        const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw), fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
        this.target = [this.target[0] - rx * dx * k + fx * dy * k, this.target[1], this.target[2] - rz * dx * k + fz * dy * k];
      } else {
        this.yaw -= dx * 0.008;
        this.pitch = Math.max(0.08, Math.min(1.55, this.pitch + dy * 0.006));
      }
      this.autoRotate = false;
      if (!this._raf) this.render();
    });
    const end = (e) => {
      pts.delete(e.pointerId);
      if (this._drag && !this._drag.moved && e.type === 'pointerup' && this.onPick) {
        const p = pos(e);
        this.onPick(this.pick(p.x, p.y), p, e);
      }
      this._drag = null;
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (this.mode === 'walk') return;
      this.dist = Math.max(80, Math.min(9000, this.dist * (e.deltaY > 0 ? 1.1 : 0.9)));
      this.autoRotate = false;
      if (!this._raf) this.render();
    }, { passive: false });
  }
  // Clavier de la visite (à brancher par la page : la vue 3D n'a pas le focus)
  keyDown(e) {
    const k = e.key.toLowerCase();
    if (this.mode !== 'walk') return false;
    if (['z', 'q', 's', 'd', 'w', 'a', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'].includes(k)) {
      this.keys[k] = true;
      return true;
    }
    return false;
  }
  keyUp(e) { this.keys[e.key.toLowerCase()] = false; }

  _rgb(c) {
    if (Array.isArray(c)) return c;
    const n = parseInt(c.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  _norm(v) {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  }
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
// Rotation autour de Y dans le même sens que la rotation du plan (x → X, y → Z)
function rotY(p, deg) {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return [p[0] * c - p[2] * s, p[1], p[0] * s + p[2] * c];
}
function pointInPoly2(P, x, y) {
  let inside = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [xi, yi] = P[i], [xj, yj] = P[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Collision d'un cercle (le visiteur) avec les murs (segments épais) et les
// meubles (rectangles orientés) : on repousse le cercle hors des obstacles.
function collideCircle(scene, x, z, R, skip) {
  if (!scene || !scene.colliders) return { x, z };
  const { segs, polys } = scene.colliders;
  for (let it = 0; it < 4; it++) {
    for (const s of segs) {
      const dx = s.b.x - s.a.x, dz = s.b.y - s.a.y, l2 = dx * dx + dz * dz;
      let t = l2 ? ((x - s.a.x) * dx + (z - s.a.y) * dz) / l2 : 0;
      t = Math.max(0, Math.min(1, t));
      const qx = s.a.x + t * dx, qz = s.a.y + t * dz;
      const d = Math.hypot(x - qx, z - qz), min = R + s.r;
      if (d < min && d > 1e-6) { x = qx + ((x - qx) / d) * min; z = qz + ((z - qz) / d) * min; }
    }
    for (const P of polys) {
      if (P === skip) continue; // la volée sur laquelle on marche
      let best = null;
      for (let i = 0; i < P.length; i++) {
        const a = P[i], b = P[(i + 1) % P.length];
        const dx = b.x - a.x, dz = b.y - a.y, l2 = dx * dx + dz * dz;
        let t = l2 ? ((x - a.x) * dx + (z - a.y) * dz) / l2 : 0;
        t = Math.max(0, Math.min(1, t));
        const qx = a.x + t * dx, qz = a.y + t * dz, d = Math.hypot(x - qx, z - qz);
        if (!best || d < best.d) best = { qx, qz, d };
      }
      const inside = pointInPoly2(P.map((p) => [p.x, p.y]), x, z);
      if (inside || best.d < R) {
        let nx = x - best.qx, nz = z - best.qz, l = Math.hypot(nx, nz) || 1;
        if (inside) { nx = -nx; nz = -nz; }
        x = best.qx + (nx / l) * R; z = best.qz + (nz / l) * R;
      }
    }
  }
  return { x, z };
}

// ---------------------------------------------------------------------------
// Représentations 3D des composants
// ---------------------------------------------------------------------------
const C3D = {
  lead: '#b9c2cc', copper: '#c98f45', pcb: '#17663b', pad: '#cfd6dd',
  resistor: '#d9b98a', bands: ['#8a5a2b', '#111111', '#c0392b', '#d4af37'],
  cap: '#2c5f8a', capTop: '#b9c2cc', dark: '#20242b', white: '#e8eaee',
  led: '#d43a3a', metal: '#9aa4af', gold: '#d4af37', ic: '#23262d',
  module: '#e8eaee', lever: '#3a70c4',
  // maison
  woodL: '#c9a173', woodD: '#7a5a3e', fabric: '#4f6d99', fabricD: '#3f5a82', linen: '#f1ede4',
  appl: '#eef0f2', steel: '#b8bec6', glassBlk: '#1d2127', plate: '#f6f6f3', chrome: '#c9ced4',
};

// Fils de connexion du corps vers les bornes (à plat, hauteur y)
function _lead3d(v, x1, z1, x2, z2, y) {
  const dx = x2 - x1, dz = z2 - z1;
  const len = Math.hypot(dx, dz);
  if (len < 1) return;
  v.box((x1 + x2) / 2, 0, (z1 + z2) / 2, len, y, 3, C3D.lead, (Math.atan2(dz, dx) * 180) / Math.PI);
}

// Composant axial (résistance, diode, fusible…) : corps cylindrique + pattes
function _axial(v, c, bodyLen, r, color, bands) {
  const rot = c.rot || 0;
  const end = rotY([40, 0, 0], rot);
  _lead3d(v, c.x - end[0], c.y - end[2], c.x + end[0], c.y + end[2], 3);
  v.cyl(c.x, r + 2, c.y, r, bodyLen, color, { axis: 'x', ry: rot });
  if (bands) {
    bands.forEach((b, i) => {
      const t = -bodyLen / 2 + bodyLen * (0.2 + i * 0.18);
      const p = rotY([t, 0, 0], rot);
      v.cyl(c.x + p[0], r + 2 - 0.6, c.y + p[2], r + 0.8, 3.5, b, { axis: 'x', ry: rot, capTop: false, capBot: false });
    });
  }
}

// ---- Outils de la maison ----
// Point local (lx, ly) du symbole → monde (x, z)
function _lp(c, lx, ly) {
  const a = ((c.rot || 0) * Math.PI) / 180, co = Math.cos(a), si = Math.sin(a);
  return [c.x + lx * co - ly * si, c.y + lx * si + ly * co];
}
// Boîte dans le repère du symbole : centre (lx, ly), sx le long de x local,
// sz le long de y local, de y0 à y0 + h
function _lb(v, c, lx, ly, sx, sz, y0, h, color, top) {
  const [x, z] = _lp(c, lx, ly);
  v.box(x, y0, z, sx, h, sz, color, c.rot || 0, top);
}
function _wallH(v) { return v.scene ? v.scene.wallH : HOUSE3D.H; }
// Fixation murale : point du nu du mur le plus proche, direction du mur et
// normale vers l'appareil. Sans mur proche : position et rotation du symbole.
function _mount(v, c, maxD) {
  const walls = v.scene && v.scene.walls;
  let best = null;
  if (walls) {
    for (const w of walls) {
      const dx = w.b.x - w.a.x, dy = w.b.y - w.a.y, l2 = dx * dx + dy * dy;
      let t = l2 ? ((c.x - w.a.x) * dx + (c.y - w.a.y) * dy) / l2 : 0;
      t = Math.max(0, Math.min(1, t));
      const px = w.a.x + t * dx, py = w.a.y + t * dy, d = Math.hypot(c.x - px, c.y - py);
      if (d < (maxD || 45) && (!best || d < best.d)) best = { d, px, py, w };
    }
  }
  if (!best) {
    const n = rotY([0, 0, 1], c.rot || 0);
    return { x: c.x - n[0] * 10, z: c.y - n[2] * 10, ux: Math.cos(((c.rot || 0) * Math.PI) / 180), uz: Math.sin(((c.rot || 0) * Math.PI) / 180), nx: n[0], nz: n[2], ang: c.rot || 0, half: 5 };
  }
  const w = best.w, len = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y) || 1;
  const ux = (w.b.x - w.a.x) / len, uz = (w.b.y - w.a.y) / len;
  let nx = -uz, nz = ux;
  if ((c.x - best.px) * nx + (c.y - best.py) * nz < 0) { nx = -nx; nz = -nz; }
  // le long du mur, on garde la position exacte de l'appareil
  const along = (c.x - best.px) * ux + (c.y - best.py) * uz;
  return {
    x: best.px + ux * along + nx * (w.t / 2), z: best.py + uz * along + nz * (w.t / 2),
    ux, uz, nx, nz, ang: (Math.atan2(uz, ux) * 180) / Math.PI, half: w.t / 2,
  };
}
// Boîte posée sur un mur : décalage « along » le long du mur, « out » depuis le
// nu du mur (vers la pièce), de y0 à y0 + h ; w le long du mur, d en profondeur
function _mb(v, m, along, out, y0, h, w, d, color, top) {
  v.box(m.x + m.ux * along + m.nx * (out + d / 2), y0, m.z + m.uz * along + m.nz * (out + d / 2), w, h, d, color, m.ang, top);
}
// Pose d'une lumière (point lumineux)
function _light(v, c, x, y, z, power, color) {
  if (!c.__lit) return;
  v.addLight({ x, y, z, power, color: color || [1, 0.84, 0.62], id: c.id });
}
// Prise sur plan de travail ? (sinon en plinthe)
function _onWorktop(v, c) {
  return !!(v.scene && v.scene.worktops && v.scene.worktops.some((P) => pointInPoly2(P, c.x, c.y)));
}

const BUILDERS3D = {
  resistor: (v, c) => _axial(v, c, 42, 8, C3D.resistor, C3D.bands),
  resistor_iec: (v, c) => _axial(v, c, 42, 8, C3D.resistor, C3D.bands),
  potentiometer: (v, c) => {
    _axial(v, c, 42, 8, '#3f6fb5');
    v.cyl(c.x, 18, c.y, 5, 8, C3D.white);
  },
  fuse: (v, c) => _axial(v, c, 40, 7, '#d8dade'),
  diode: (v, c) => _axial(v, c, 30, 6, C3D.dark, ['#e8eaee']),
  zener: (v, c) => _axial(v, c, 30, 6, C3D.dark, ['#e8eaee']),
  inductor: (v, c) => _axial(v, c, 42, 10, C3D.copper),
  capacitor: (v, c) => {
    const end = rotY([40, 0, 0], c.rot || 0);
    _lead3d(v, c.x - end[0], c.y - end[2], c.x + end[0], c.y + end[2], 3);
    v.cyl(c.x, 0, c.y, 11, 30, C3D.cap, { capColor: C3D.capTop });
  },
  capacitor_pol: (v, c) => BUILDERS3D.capacitor(v, c),
  led: (v, c) => {
    const end = rotY([40, 0, 0], c.rot || 0);
    _lead3d(v, c.x - end[0], c.y - end[2], c.x + end[0], c.y + end[2], 3);
    v.cyl(c.x, 0, c.y, 9, 12, C3D.led, { capTop: false });
    v.dome(c.x, 12, c.y, 9, C3D.led);
  },
  lamp: (v, c) => {
    const end = rotY([40, 0, 0], c.rot || 0);
    _lead3d(v, c.x - end[0], c.y - end[2], c.x + end[0], c.y + end[2], 3);
    v.cyl(c.x, 0, c.y, 9, 8, C3D.metal);
    v.dome(c.x, 8, c.y, 13, '#ffd75e');
  },
  battery: (v, c) => { v.cyl(c.x, 14, c.y, 14, 46, '#2f9e57', { axis: 'x', ry: c.rot || 0, capColor: C3D.metal }); },
  battery2: (v, c) => BUILDERS3D.battery(v, c),
  dc_source: (v, c) => { v.box(c.x, 0, c.y, 56, 22, 34, C3D.dark, c.rot || 0); },
  ac_source: (v, c) => BUILDERS3D.dc_source(v, c),
  current_source: (v, c) => BUILDERS3D.dc_source(v, c),
  motor: (v, c) => { v.cyl(c.x, 0, c.y, 16, 26, C3D.metal); v.cyl(c.x, 26, c.y, 3, 8, '#6d7681'); },
  buzzer: (v, c) => { v.cyl(c.x, 0, c.y, 14, 16, C3D.dark); v.cyl(c.x, 16, c.y, 3, 1.5, '#000'); },
  relay: (v, c) => { v.box(c.x, 0, c.y, 40, 24, 26, '#3f6fb5', c.rot || 0); },
  voltmeter: (v, c) => { v.box(c.x, 0, c.y, 40, 18, 34, C3D.dark, c.rot || 0); v.box(c.x, 18, c.y, 30, 2, 22, C3D.white, c.rot || 0); },
  ammeter: (v, c) => BUILDERS3D.voltmeter(v, c),
  ohmmeter: (v, c) => BUILDERS3D.voltmeter(v, c),
  switch: (v, c) => {
    v.box(c.x, 0, c.y, 28, 10, 16, C3D.white, c.rot || 0);
    const tip = rotY([c.closed ? 6 : -6, 0, 0], c.rot || 0);
    v.box(c.x + tip[0], 10, c.y + tip[2], 12, 6, 8, C3D.lever, c.rot || 0);
  },
  push_button: (v, c) => { v.box(c.x, 0, c.y, 24, 8, 24, C3D.dark, c.rot || 0); v.cyl(c.x, 8, c.y, 7, 6, c.closed ? '#2f9e57' : C3D.led); },
  transistor_npn: (v, c) => {
    v.cyl(c.x, 0, c.y, 12, 22, C3D.dark, { ry: c.rot || 0 });
    const f = rotY([0, 0, -6], c.rot || 0);
    v.box(c.x + f[0], 0, c.y + f[2], 24, 22, 12, C3D.dark, c.rot || 0);
  },
  transistor_pnp: (v, c) => BUILDERS3D.transistor_npn(v, c),
  transformer: (v, c) => {
    v.box(c.x, 0, c.y, 60, 34, 30, '#5d6670', c.rot || 0);
    for (const s of [-16, 16]) { const p = rotY([s, 0, 0], c.rot || 0); v.cyl(c.x + p[0], 4, c.y + p[2], 12, 26, C3D.copper); }
  },
  ground: (v, c) => { v.cyl(c.x, 0, c.y, 7, 2, C3D.pad); },
  vcc: (v, c) => { v.cyl(c.x, 0, c.y, 7, 2, C3D.gold); },
  junction: (v, c) => { v.cyl(c.x, 0, c.y, 5, 2, C3D.pad); },
  antenna: (v, c) => { v.cyl(c.x, 0, c.y, 2.5, 60, C3D.metal); },
  // Portes logiques et horloge : boîtier DIP
  _dip: (v, c) => {
    v.box(c.x, 3, c.y, 44, 12, 26, C3D.ic, c.rot || 0);
    for (let i = -1; i <= 1; i += 2) {
      for (let k = -1; k <= 1; k++) {
        const p = rotY([k * 14, 0, i * 16], c.rot || 0);
        v.box(c.x + p[0], 0, c.y + p[2], 4, 5, 6, C3D.pad, c.rot || 0);
      }
    }
  },
  clock: (v, c) => { v.box(c.x, 0, c.y, 40, 12, 28, C3D.metal, c.rot || 0); },
  dff: (v, c) => BUILDERS3D._dip(v, c),
  seven_seg: (v, c) => {
    v.box(c.x, 0, c.y, 64, 16, 76, C3D.dark, c.rot || 0);
    v.box(c.x, 16, c.y, 50, 2, 62, '#3a1010', c.rot || 0);
  },
  logic_in: (v, c) => { v.box(c.x, 0, c.y, 24, 10, 24, c.high ? '#2f9e57' : C3D.dark, c.rot || 0); },
  logic_out: (v, c) => {
    v.cyl(c.x, 0, c.y, 8, 8, c.__on ? '#2f9e57' : C3D.dark);
    v.dome(c.x, 8, c.y, 8, c.__on ? '#5ce08a' : '#3a3f47');
  },
  // Norme française : modules DIN blancs
  breaker: (v, c) => {
    v.box(c.x, 0, c.y, 36, 34, 24, C3D.module, c.rot || 0);
    v.box(c.x, 34, c.y, 8, 6, 10, c.closed === false ? C3D.led : C3D.lever, c.rot || 0);
  },
  rcd: (v, c) => BUILDERS3D.breaker(v, c),
  socket: (v, c) => {
    v.box(c.x, 0, c.y, 36, 12, 36, C3D.module, c.rot || 0);
    v.cyl(c.x, 12, c.y, 13, 3, '#d5d9df');
  },
  sw_vv: (v, c) => BUILDERS3D.switch(v, c),
  bell: (v, c) => { v.dome(c.x, 4, c.y, 14, C3D.gold); v.cyl(c.x, 0, c.y, 14, 4, C3D.dark); },

  // ----- Plan de maison : architecture ------------------------------------
  // Porte : huisserie, linteau au-dessus du passage, vantail ouvert à 90°
  door: (v, c) => {
    const H = _wallH(v), hh = Math.min(204, H - 1);
    const m = _mount(v, c, 60);
    const t = m ? m.half * 2 : 10;
    _lb(v, c, -42, 0, 4, t + 3, 0, hh, '#f3f1ec');
    _lb(v, c, 42, 0, 4, t + 3, 0, hh, '#f3f1ec');
    if (H > 208) {
      _lb(v, c, 0, 0, 88, t + 3, 204, 4, '#f3f1ec');
      _lb(v, c, 0, 0, 84, t, 208, H - 208, WALL_COL, v.scene && v.scene.cutTop);
    }
    _lb(v, c, -38, -38, 4, 76, 0, hh - 2, C3D.woodL);
    _lb(v, c, -35, -70, 3, 3, 100, 2.5, C3D.chrome);
  },
  garage_door: (v, c) => {
    const H = _wallH(v), hh = Math.min(210, H - 1);
    _lb(v, c, 0, 0, 240, 4, 0, hh, '#dfe3e8');
    for (let y = 30; y < hh; y += 45) _lb(v, c, 0, 0, 240, 5.5, y, 2, '#c6ccd4');
    if (H > 212) _lb(v, c, 0, 0, 244, HOUSE3D.T_EXT, 210, H - 210, WALL_COL, v.scene && v.scene.cutTop);
  },
  // Fenêtre : le mur laisse l'ouverture (allège 95 cm, linteau 215 cm)
  window_a: (v, c) => {
    const H = _wallH(v), top = Math.min(215, H), bot = 95;
    const m = _mount(v, c, 30);
    const t = m ? m.half * 2 : 10;
    _lb(v, c, 0, 0, 92, t + 8, bot - 3, 3, '#e8e4dc');           // appuis
    if (top <= bot + 4) return;
    for (const s of [-38, 38]) _lb(v, c, s, 0, 5, 7, bot, top - bot, '#f7f7f5');
    _lb(v, c, 0, 0, 3, 6, bot, top - bot, '#f7f7f5');            // meneau
    _lb(v, c, 0, 0, 80, 7, bot, 4, '#f7f7f5');
    if (top === 215) _lb(v, c, 0, 0, 80, 7, top - 4, 4, '#f7f7f5');
    const a0 = v.alpha; v.alpha = 0.28;
    _lb(v, c, 0, 0, 74, 1.5, bot + 4, top - bot - 8, '#bcd9ee');
    v.alpha = a0;
  },
  room: () => {}, // l'étiquette n'a pas de volume : la pièce se voit à son sol

  // ----- Mobilier -----------------------------------------------------------
  bed: (v, c) => {
    _lb(v, c, 0, 2, 120, 156, 0, 30, C3D.woodD);
    _lb(v, c, 0, 4, 114, 150, 30, 20, C3D.linen);
    _lb(v, c, 0, 26, 118, 112, 50, 5, '#5a7ba6');                 // couette
    for (const s of [-28, 28]) _lb(v, c, s, -60, 46, 26, 50, 10, '#fbfaf6');
    _lb(v, c, 0, -78, 124, 5, 0, 95, C3D.woodD);                  // tête de lit
  },
  sofa: (v, c) => {
    _lb(v, c, 0, 4, 156, 72, 0, 40, C3D.fabric);
    for (const s of [-38, 38]) _lb(v, c, s, 8, 74, 60, 40, 7, C3D.fabricD);
    _lb(v, c, 0, -32, 156, 16, 0, 82, C3D.fabricD);
    for (const s of [-72, 72]) _lb(v, c, s, 4, 14, 72, 0, 60, C3D.fabricD);
  },
  table: (v, c) => {
    _lb(v, c, 0, 0, 120, 80, 72, 4, C3D.woodL);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) _lb(v, c, sx * 52, sz * 32, 5, 5, 0, 72, C3D.woodD);
    for (const sx of [-30, 30]) {
      for (const sz of [-1, 1]) {
        _lb(v, c, sx, sz * 58, 42, 40, 44, 4, C3D.woodL);
        _lb(v, c, sx, sz * 77, 42, 4, 44, 46, C3D.woodL);
        for (const lx of [-18, 18]) _lb(v, c, sx + lx, sz * 58, 3, 3, 0, 44, C3D.woodD);
      }
    }
  },
  counter: (v, c) => {
    _lb(v, c, 0, 2, 178, 56, 0, 10, '#3a3f47');                   // socle
    _lb(v, c, 0, 0, 178, 58, 10, 76, C3D.appl);
    for (const s of [-44, 0, 44]) _lb(v, c, s, 29.5, 1, 1, 14, 70, '#c9ced4');
    _lb(v, c, 0, 0, 182, 62, 86, 4, '#b89d7a');                   // plan de travail
    _lb(v, c, -50, 2, 40, 34, 89.6, 0.8, '#8c949e');              // évier
    const [fx, fz] = _lp(c, -50, -22);
    v.cyl(fx, 90, fz, 1.6, 26, C3D.chrome);
    _lb(v, c, 0, -12, 178, 34, 145, 70, C3D.appl);                // meubles hauts
  },
  wardrobe: (v, c) => {
    _lb(v, c, 0, 0, 118, 48, 0, 210, C3D.woodL);
    _lb(v, c, 0, 24.5, 1, 1, 4, 202, C3D.woodD);
    for (const s of [-6, 6]) _lb(v, c, s, 25, 2, 2, 100, 26, C3D.chrome);
  },
  desk: (v, c) => {
    _lb(v, c, 0, 0, 120, 60, 72, 3, C3D.woodL);
    for (const s of [-56, 56]) _lb(v, c, s, 0, 4, 56, 0, 72, C3D.woodD);
    _lb(v, c, 0, -18, 6, 6, 75, 12, '#2a2e35');
    const scr = c.__on ? '#8fb6ea' : '#16191e';
    const e0 = v.em; v.em = c.__on ? 0.9 : 0;
    _lb(v, c, 0, -20, 54, 2.5, 86, 32, scr);
    v.em = e0;
    const [cx, cz] = _lp(c, 0, 50);
    v.cyl(cx, 0, cz, 3, 42, '#2a2e35');
    v.cyl(cx, 42, cz, 22, 6, '#2f3542');
    _lb(v, c, 0, 66, 40, 5, 48, 40, '#2f3542');
  },
  tv_unit: (v, c) => {
    _lb(v, c, 0, 0, 158, 42, 0, 42, C3D.woodD);
    _lb(v, c, 0, -8, 30, 16, 42, 12, '#23262d');
    const e0 = v.em; v.em = c.__on ? 0.85 : 0;
    _lb(v, c, 0, -10, 112, 3, 54, 64, c.__on ? '#7fa6d8' : '#121417');
    v.em = e0;
  },
  // Escalier droit : 14 marches de 22 cm de giron jusqu'au plancher de l'étage (2,80 m),
  // limon et main courante ; « haut » : garde-corps autour de la trémie
  stairs: (v, c) => {
    const rail = '#e8e4dc';
    if (c.value === 'haut') {
      // garde-corps sur les côtés, ouverts sur les 90 derniers cm (arrivée sur le palier)
      _lb(v, c, -52, 45, 4, 224, 0, 100, rail);
      _lb(v, c, 52, 45, 4, 224, 0, 100, rail);
      _lb(v, c, 0, 157, 104, 4, 0, 100, rail); // au-dessus du bas de la volée ; on arrive côté -y
      return;
    }
    const rise = 280 / 15, go = 310 / 14;
    for (let i = 0; i < 14; i++) {
      const yc = 155 - (i + 0.5) * go;
      _lb(v, c, 0, yc, 100, go, 0, (i + 1) * rise, '#e3ddd2', '#b98b5e');
    }
    // main courante inclinée (côté +x), sur poteaux
    const top = (i) => (i + 1) * rise + 90;
    for (const i of [0, 6, 13]) _lb(v, c, 48, 155 - (i + 0.5) * go, 4, 4, (i + 1) * rise, 90, '#7a5a3e');
    const [ax, az] = _lp(c, 48, 155 - 0.5 * go), [bx, bz] = _lp(c, 48, 155 - 13.5 * go);
    v.poly([[ax, top(0) - 3, az], [bx, top(13) - 3, bz], [bx, top(13) + 3, bz], [ax, top(0) + 3, az]], '#7a5a3e');
  },
  level_title: () => {}, // simple légende du plan
  plant: (v, c) => {
    v.cyl(c.x, 0, c.y, 15, 30, '#b5653d', { r2: 17 });
    for (const [dx, dz, y, r] of [[0, 0, 44, 20], [-10, 6, 60, 15], [9, -6, 70, 14], [3, 8, 84, 10]]) v.dome(c.x + dx, y - r * 0.6, c.y + dz, r, '#4f8a4b', { sy: 1.2 });
  },
  car: (v, c) => {
    _lb(v, c, 0, 0, 176, 410, 26, 50, '#b8322e');
    _lb(v, c, 0, 30, 150, 210, 76, 50, '#b8322e');
    const a0 = v.alpha; v.alpha = 0.55;
    _lb(v, c, 0, 30, 152, 200, 82, 38, '#2a3440');
    v.alpha = a0;
    for (const sx of [-1, 1]) {
      for (const sz of [-130, 140]) {
        const [x, z] = _lp(c, sx * 80, sz);
        v.cyl(x, 32, z, 32, 22, '#1d2026', { axis: 'x', ry: (c.rot || 0), seg: 16 });
      }
    }
    const e0 = v.em; v.em = 0.5;
    for (const sx of [-60, 60]) _lb(v, c, sx, -205, 26, 3, 55, 8, '#fff4c9');
    v.em = e0;
  },
  // ----- Sanitaire ----------------------------------------------------------
  shower: (v, c) => {
    _lb(v, c, 0, 0, 90, 90, 0, 6, '#fbfbfb');
    const a0 = v.alpha; v.alpha = 0.22;
    _lb(v, c, 0, 44, 90, 1.2, 6, 194, '#cfe6f2');
    _lb(v, c, 44, 0, 1.2, 90, 6, 194, '#cfe6f2');
    v.alpha = a0;
    const [x, z] = _lp(c, -38, -38);
    v.cyl(x, 6, z, 1.5, 180, C3D.chrome);
    v.cyl(x + 0, 186, z, 9, 2, C3D.chrome);
  },
  bathtub: (v, c) => {
    _lb(v, c, 0, 0, 170, 76, 0, 55, '#fbfbfb');
    _lb(v, c, 0, 0, 150, 58, 54.6, 0.8, '#d7e6ef');
    const [x, z] = _lp(c, 70, -30);
    v.cyl(x, 55, z, 2, 18, C3D.chrome);
  },
  washbasin: (v, c) => {
    _lb(v, c, 0, 0, 60, 44, 0, 80, C3D.woodL);
    _lb(v, c, 0, 0, 62, 46, 80, 5, '#fbfbfb');
    _lb(v, c, 0, 4, 40, 26, 84.8, 0.8, '#d7e6ef');
    const [x, z] = _lp(c, 0, -17);
    v.cyl(x, 85, z, 1.6, 20, C3D.chrome);
    _lb(v, c, 0, -21, 58, 2, 110, 70, '#c7d4df');                 // miroir
  },
  toilet: (v, c) => {
    _lb(v, c, 0, -24, 38, 16, 38, 42, '#fbfbfb');
    const [x, z] = _lp(c, 0, 6);
    v.cyl(x, 0, z, 15, 38, '#fbfbfb', { r2: 19 });
    v.cyl(x, 38, z, 19, 3, '#f0f0ee');
  },
  // ----- Électroménager -----------------------------------------------------
  fridge: (v, c) => {
    _lb(v, c, 0, 0, 60, 64, 0, 185, '#e3e7ec');
    _lb(v, c, 0, 32.4, 58, 0.8, 120, 1, '#b8bec6');
    _lb(v, c, 22, 33, 3, 3, 80, 30, C3D.chrome);
    _lb(v, c, 22, 33, 3, 3, 130, 30, C3D.chrome);
  },
  oven: (v, c) => {
    _lb(v, c, 0, 0, 60, 60, 0, 210, C3D.appl);
    const e0 = v.em; v.em = c.__on ? 0.8 : 0;
    _lb(v, c, 0, 30.2, 50, 0.8, 84, 46, c.__on ? '#ff9a3c' : C3D.glassBlk);
    v.em = e0;
    _lb(v, c, 0, 30.4, 50, 1, 134, 8, '#2a2e35');
  },
  cooktop: (v, c) => {
    _lb(v, c, 0, 2, 58, 56, 0, 10, '#3a3f47');
    _lb(v, c, 0, 0, 58, 58, 10, 76, C3D.appl);
    _lb(v, c, 0, 0, 62, 62, 86, 4, '#b89d7a');
    _lb(v, c, 0, 0, 56, 50, 90, 0.8, '#15171b');
    const e0 = v.em;
    v.em = c.__on ? 1 : 0;
    for (const [sx, sz, r] of [[-13, -12, 9], [13, -12, 7], [-13, 13, 7], [13, 13, 9]]) {
      const [x, z] = _lp(c, sx, sz);
      v.cyl(x, 90.8, z, r, 0.4, c.__on ? '#ff4a1c' : '#2c3036', { seg: 16 });
    }
    v.em = e0;
    _lb(v, c, 0, -8, 60, 46, 165, 14, C3D.steel);                 // hotte
    _lb(v, c, 0, -20, 26, 20, 179, 71, C3D.steel);
  },
  washer: (v, c) => {
    _lb(v, c, 0, 0, 59, 59, 0, 85, C3D.appl);
    const [x, z] = _lp(c, 0, 30);
    v.cyl(x, 44, z, 17, 2, '#aab3bd', { axis: 'x', ry: (c.rot || 0) + 90, seg: 18 });
    v.cyl(x, 44, z, 12, 2.4, c.__on ? '#5c86b8' : '#3a4a5c', { axis: 'x', ry: (c.rot || 0) + 90, seg: 18 });
    _lb(v, c, 0, 29.8, 50, 1, 72, 8, '#dfe3e8');
  },
  dryer: (v, c) => {
    BUILDERS3D.washer(v, c);
    _lb(v, c, 0, 29.9, 50, 1, 72, 8, '#c9d6e3');
  },
  dishwasher: (v, c) => {
    _lb(v, c, 0, 0, 59, 59, 0, 86, C3D.appl);
    _lb(v, c, 0, 0, 62, 62, 86, 4, '#b89d7a');
    _lb(v, c, 0, 29.8, 54, 1, 76, 7, c.__on ? '#3d7bd9' : '#2a2e35');
  },
  water_heater: (v, c) => {
    const m = _mount(v, c, 70);
    const cx = m ? m.x + m.nx * 28 : c.x, cz = m ? m.z + m.nz * 28 : c.y;
    v.cyl(cx, 40, cz, 27, 150, '#f4f5f7', { seg: 18 });
    v.cyl(cx, 30, cz, 20, 10, '#e2e5e9', { seg: 18 });
    v.cyl(cx - 8, 0, cz, 1.6, 30, '#c0392b');
    v.cyl(cx + 8, 0, cz, 1.6, 30, '#2b6cb0');
  },
  radiator: (v, c) => {
    const m = _mount(v, c, 45);
    _mb(v, m, 0, 2, 15, 58, 78, 6, '#f7f7f5');
    for (let s = -32; s <= 32; s += 8) _mb(v, m, s, 7.5, 17, 54, 2, 1.5, '#e4e6e9');
    if (c.__on) {
      const e0 = v.em; v.em = 0.8;
      _mb(v, m, 30, 8, 66, 3, 3, 1, '#ff6a3c');
      v.em = e0;
    }
  },
  ev_charger: (v, c) => {
    const m = _mount(v, c, 45);
    _mb(v, m, 0, 0, 95, 42, 26, 12, '#2a2f38');
    const e0 = v.em; v.em = 1;
    _mb(v, m, 0, 12, 118, 3, 12, 1, c.__on ? '#35d07f' : '#3f8cff');
    v.em = e0;
    _mb(v, m, 9, 12, 100, 8, 6, 5, '#15181d');
  },
  vmc: (v, c) => {
    const H = _wallH(v);
    v.cyl(c.x, H - 1.5, c.y, 10, 1.5, '#f4f5f7', { seg: 16 });
    v.cyl(c.x, H - 2.2, c.y, 6, 0.8, '#b8bec6', { seg: 16 });
  },
  // ----- Implantation électrique -------------------------------------------
  // GTL : colonne toute hauteur ; tableau : coffret avec rangées de modules
  // (manettes bleues fermées, rouges déclenchées, grises ouvertes)
  gtl: (v, c) => {
    const m = _mount(v, c, 70), H = _wallH(v);
    _mb(v, m, 0, 0, 0, H - 2, 60, 20, '#f2f3f5');
    _mb(v, m, 0, 20, 4, H - 10, 1, 0.6, '#c9ced4');
  },
  panel_house: (v, c) => {
    const m = _mount(v, c, 80);
    const out = v.scene && v.scene.gtlNear && v.scene.gtlNear(c) ? 20 : 0;
    _mb(v, m, 0, out, 95, 82, 60, 14, '#fafbfc');
    _mb(v, m, 0, out + 14, 100, 72, 52, 0.6, '#dfe3e8');
    const states = (v.scene && v.scene.breakers) || [];
    for (let row = 0; row < 3; row++) {
      const y = 152 - row * 24;
      _mb(v, m, 0, out + 14, y - 2, 16, 50, 1.2, '#f7f7f5');
      for (let k = 0; k < 8; k++) {
        const st = states[row * 8 + k];
        if (!st) continue;
        const col = st === 'on' ? '#2f6fd1' : st === 'tripped' ? '#e03a2f' : '#8b95a3';
        _mb(v, m, -21 + k * 6, out + 15, y + (st === 'on' ? 6 : 1), 5, 4, 2.5, col);
      }
    }
  },
  socket_wall: (v, c) => {
    const m = _mount(v, c, 45);
    const y = _onWorktop(v, c) ? 106 : 24;
    _mb(v, m, 0, 0, y, 9, 9, 1.6, C3D.plate);
    for (const s of [-1.9, 1.9]) _mb(v, m, s, 1.6, y + 4, 1.1, 1.1, 0.3, '#2a2e35');
  },
  rj45: (v, c) => {
    const m = _mount(v, c, 45);
    _mb(v, m, 0, 0, 24, 9, 9, 1.6, C3D.plate);
    _mb(v, m, 0, 1.6, 27, 3, 2.5, 0.3, '#2a2e35');
  },
  switch_sa: (v, c) => {
    const m = _mount(v, c, 45);
    _mb(v, m, 0, 0, 106, 9, 9, 1.4, C3D.plate);
    _mb(v, m, 0, 1.4, 107.5, 6, 6, c.closed ? 1.4 : 0.8, '#e9eaec');
  },
  switch_vv_wall: (v, c) => BUILDERS3D.switch_sa(v, c),
  dcl: (v, c) => {
    const H = _wallH(v), full = !(v.scene && v.scene.cut);
    const top = full ? H : HOUSE3D.H;
    v.cyl(c.x, top - 2, c.y, 6, 2, '#f4f1ea');
    v.cyl(c.x, top - 42, c.y, 0.5, 40, '#2a2e35', { seg: 6 });
    v.cyl(c.x, top - 60, c.y, 18, 16, '#efe6d2', { r2: 6, seg: 16, capBot: false });
    const e0 = v.em; v.em = c.__lit ? 1 : 0;
    v.dome(c.x, top - 66, c.y, 6, c.__lit ? '#fff1c4' : '#e8e4d8', { sy: 1.1 });
    v.em = e0;
    _light(v, c, c.x, top - 70, c.y, 1);
  },
  wall_light: (v, c) => {
    const m = _mount(v, c, 45);
    _mb(v, m, 0, 0, 176, 8, 22, 3, '#d9d4c7');
    const e0 = v.em; v.em = c.__lit ? 1 : 0;
    _mb(v, m, 0, 3, 178, 18, 16, 6, c.__lit ? '#fff1c4' : '#ece7da');
    v.em = e0;
    _light(v, c, m.x + m.nx * 16, 186, m.z + m.nz * 16, 0.6);
  },
  jbox: (v, c) => {
    const m = _mount(v, c, 45);
    _mb(v, m, 0, 0, 226, 12, 12, 5, '#d8dade');
  },
  smoke_detector: (v, c) => {
    const H = _wallH(v);
    v.cyl(c.x, H - 4, c.y, 6, 4, '#f7f7f5', { seg: 16 });
    const e0 = v.em; v.em = 1;
    v.cyl(c.x + 3, H - 4.3, c.y, 0.8, 0.4, '#ff3b30', { seg: 6 });
    v.em = e0;
  },
};
for (const g of ['gate_and', 'gate_or', 'gate_not', 'gate_nand', 'gate_nor', 'gate_xor']) {
  BUILDERS3D[g] = (v, c) => BUILDERS3D._dip(v, c);
}

// Hauteurs des objets fixés au plafond (non coupés avec les murs)
const CEILING_OBJ = new Set(['dcl', 'vmc', 'smoke_detector']);
// Meubles qui arrêtent le visiteur
const SOLID_FURNITURE = new Set(['stairs', 
  'bed', 'sofa', 'table', 'counter', 'wardrobe', 'desk', 'tv_unit', 'fridge', 'oven', 'cooktop', 'washer', 'dryer',
  'dishwasher', 'water_heater', 'shower', 'bathtub', 'washbasin', 'toilet', 'car', 'gtl', 'plant',
]);

// ---------------------------------------------------------------------------
// Construction de la scène
// opts : { walls: 'full'|'cut'|'low', ceiling, ground, xray, sim: { snap, design, sim } }
// Renvoie le rayon englobant (pour cadrer la caméra).
// ---------------------------------------------------------------------------
function buildBoard(viz, components, wires, symbols, opts) {
  opts = opts || {};
  viz.clear();
  const walls = wires.filter((w) => w.kind === 'wall');
  const conduits = wires.filter((w) => w.kind === 'conduit');
  const elec = wires.filter((w) => !w.kind || w.kind === 'wire');
  const houseMode = walls.length > 0;

  // Maison à étage : plans des niveaux côte à côte, empilés en 3D
  const levels = houseMode && opts.levels && opts.levels.length > 1 ? opts.levels : null;
  const levelOf = (x) => {
    if (!levels) return 0;
    const i = levels.findIndex((l) => x >= l.x0 && x < l.x1);
    return i < 0 ? 0 : i;
  };
  // Bornes (celles du rez-de-chaussée : les étages s'empilent au-dessus)
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  const acc = (x, z) => { if (levelOf(x) !== 0) return; minX = Math.min(minX, x); minZ = Math.min(minZ, z); maxX = Math.max(maxX, x); maxZ = Math.max(maxZ, z); };
  for (const c of components) { const b = symbols[c.type].bbox; if (levelOf(c.x) === 0) { acc(c.x + b.x, c.y + b.y); acc(c.x + b.x + b.w, c.y + b.y + b.h); } }
  for (const w of wires) for (const p of w.points) acc(p.x, p.y);
  if (!isFinite(minX)) { minX = -140; minZ = -100; maxX = 140; maxZ = 100; }
  const pad = houseMode ? 30 : 46;
  minX -= pad; minZ -= pad; maxX += pad; maxZ += pad;
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  const W = maxX - minX, D = maxZ - minZ;
  if (!opts.keepCamera) viz.target = [cx, levels ? 130 : 0, cz]; // maison à étage : on vise mi-hauteur
  viz.bounds = { minX, minZ, maxX, maxZ };
  viz.outerBounds = null;

  if (!houseMode) {
    viz.scene = null;
    _buildPCB(viz, components, elec, symbols, { minX, minZ, maxX, maxZ, cx, cz, W, D });
    return Math.max(W, D) / 2 + 30;
  }
  _buildHouse(viz, components, walls, conduits, symbols, opts, { minX, minZ, maxX, maxZ, cx, cz, W, D, levels, levelOf });
  viz.off = null;
  if (viz.cutX !== null && viz.cutX !== undefined) _buildCaps(viz, viz.cutX); // vue en coupe active
  return Math.max(W, D) / 2 + 40 + (levels ? 90 : 0);
}

function _buildPCB(viz, components, elec, symbols, b) {
  viz.setLayer(0);
  viz.box(b.cx, -8, b.cz, b.W, 8, b.D, C3D.pcb);
  for (const [ix, iz] of [[b.minX + 14, b.minZ + 14], [b.maxX - 14, b.minZ + 14], [b.minX + 14, b.maxZ - 14], [b.maxX - 14, b.maxZ - 14]]) {
    viz.cyl(ix, 0.1, iz, 5, 0.8, '#0e4227');
  }
  viz.setLayer(1);
  for (const w of elec) {
    for (let i = 0; i < w.points.length - 1; i++) _traceSeg(viz, w.points[i], w.points[i + 1]);
    for (const p of w.points) viz.cyl(p.x, 0.2, p.y, 4, 1.6, C3D.copper, { seg: 8 });
  }
  if (typeof computeJunctions === 'function') {
    for (const j of computeJunctions(components, [...elec], symbols)) viz.cyl(j.x, 0.3, j.y, 6, 2, C3D.pad, { seg: 10 });
  }
  for (const c of components) {
    const sym = symbols[c.type];
    const a = ((c.rot || 0) * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
    viz.obj = c.id;
    for (const t of sym.terminals) viz.cyl(c.x + t.x * cos - t.y * sin, 0.2, c.y + t.x * sin + t.y * cos, 5, 1.8, C3D.pad, { seg: 10 });
    (BUILDERS3D[c.type] || ((v, cc) => v.box(cc.x, 0, cc.y, 30, 14, 22, C3D.dark, cc.rot || 0)))(viz, c);
    viz.obj = null;
  }
}

function _traceSeg(viz, a, b) {
  const dx = b.x - a.x, dz = b.y - a.y;
  const len = Math.hypot(dx, dz);
  if (len < 1) return;
  viz.box((a.x + b.x) / 2, 0, (a.y + b.y) / 2, len + 4, 1.4, 5, C3D.copper, (Math.atan2(dz, dx) * 180) / Math.PI);
}

function _buildHouse(viz, components, walls, conduits, symbols, opts, b) {
  const levelOf = b.levelOf || (() => 0), lv = b.levels;
  const offOf = (x) => { const L = lv && lv[levelOf(x)]; return L && (L.dx || L.dy) ? { dx: L.dx || 0, dy: L.dy || 0 } : null; };
  const at = (x) => { viz.off = offOf(x); }; // place la géométrie qui suit sur le bon niveau
  const shown = (x) => opts.level === undefined || opts.level === null || opts.level === 'all' || levelOf(x) === opts.level;
  const mode = opts.walls || 'full';
  const full = mode === 'full' || mode === 'roof'; // « roof » : extérieur, toiture posée
  const H = full ? HOUSE3D.H : mode === 'cut' ? HOUSE3D.CUT : HOUSE3D.LOW;
  const info = typeof computeRooms === 'function' ? computeRooms(components, walls) : null;
  const snap = opts.sim && opts.sim.snap, design = opts.sim && opts.sim.design, sim = opts.sim && opts.sim.sim;
  const scene = viz.scene = {
    wallH: H, cut: !full, cutTop: full ? null : '#4b5361', rooms: info,
    walls: [], colliders: { segs: [], polys: [] }, worktops: [], start: null, breakers: [],
    upDy: lv ? Math.max(...lv.map((L) => L.dy || 0)) : 0, // les lampes de l'étage éclairent jusqu'à son plafond
    stairs: null,
  };
  // Segments de mur (épaisseur extérieure / intérieure)
  for (const w of walls) {
    for (let i = 0; i < w.points.length - 1; i++) {
      const a = w.points[i], c = w.points[i + 1];
      if (Math.hypot(c.x - a.x, c.y - a.y) < 1) continue;
      const t = w.ext ? HOUSE3D.T_EXT : HOUSE3D.T_INT;
      scene.walls.push({ a, b: c, t, ext: !!w.ext });
      scene.colliders.segs.push({ a, b: c, r: t / 2 });
    }
  }
  scene.worktops = components.filter((c) => c.type === 'counter' || c.type === 'cooktop').map((c) => _footprint3(c, 2).map((p) => [p.x, p.y]));
  const gtls = components.filter((c) => c.type === 'gtl');
  scene.gtlNear = (c) => gtls.some((g) => Math.hypot(g.x - c.x, g.y - c.y) < 30);
  // État des disjoncteurs pour le tableau 3D
  if (design && design.ok && sim) {
    scene.breakers = design.circuits.map((ct) => {
      const bk = sim.breakers[ct.id];
      return !bk ? 'on' : bk.tripped ? 'tripped' : bk.closed ? 'on' : 'off';
    });
  }
  // États des appareils (lampes allumées, appareils en marche)
  for (const c of components) {
    const d = snap && snap.devices[c.id];
    c.__lit = !!(snap && snap.lit && snap.lit.has(c.id));
    c.__on = !!(d && d.on);
    if (!d && c.on && snap) {
      // appareils branchés sur une prise : en marche si la prise est alimentée
      const sock = design && design.plugs[c.id];
      c.__on = !!(sock && snap.devices[sock] && snap.devices[sock].U > 0);
    }
  }

  // Terrain, dalle, sols des pièces
  const floored = info ? info.rooms.map((r) => !r.leaked && r.sharedWith === null) : [];
  // Trémies : l'escalier « haut » de l'étage ouvre le plancher au-dessus de la volée
  const holes = lv ? components.filter((c) => c.type === 'stairs' && c.value === 'haut' && levelOf(c.x) > 0).map((c) => {
    const f = _footprint3(c, 0), xs = f.map((p) => p.x), zs = f.map((p) => p.y);
    return { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
  }) : [];
  const inHole = holes.length ? (x, z) => holes.some((h) => x > h.x0 && x < h.x1 && z > h.z0 && z < h.z1) : null;
  // … et le plafond du niveau du dessous (même trémie, dans le repère de ce niveau)
  const ceilHoles = holes.map((h) => {
    const k = levelOf(h.x0 + 1), s = (lv[k].dx || 0) - (lv[k - 1].dx || 0);
    return { x0: h.x0 + s, x1: h.x1 + s, z0: h.z0, z1: h.z1 };
  });
  viz.setLayer(0);
  if (opts.ground) {
    const g = 2600; // jusqu'à l'horizon (le brouillard fond le bord)
    viz.poly([[b.minX - g, -11, b.minZ - g], [b.maxX + g, -11, b.minZ - g], [b.maxX + g, -11, b.maxZ + g], [b.minX - g, -11, b.maxZ + g]], '#8ea56d');
  }
  viz.box(b.cx, -10, b.cz, b.W, 10, b.D, '#b3a792');
  scene.slabs = [{ x0: b.cx - b.W / 2, x1: b.cx + b.W / 2, z0: b.cz - b.D / 2, z1: b.cz + b.D / 2, y0: -10, y1: 0, lvl: 0 }];
  scene.cutOff = lv ? lv.map((L) => (L.dx || L.dy ? { dx: L.dx || 0, dy: L.dy || 0 } : null)) : [null];
  if (info) {
    viz.setLayer(0.5);
    const labX = (room) => { const l = components.find((c) => c.id === room.id); return l ? l.x : 0; };
    info.rooms.forEach((room, i) => {
      if (!floored[i] || !shown(labX(room))) return;
      at(labX(room));
      const col = opts.energy ? opts.energy.color(i) : _floorColor(room);
      for (const r of _cutRects(roomRuns(info, i), holes)) {
        viz.poly([[r.x, 0.3, r.y], [r.x + r.w, 0.3, r.y], [r.x + r.w, 0.3, r.y + r.h], [r.x, 0.3, r.y + r.h]], col);
      }
    });
    viz.setLayer(0.6);
    info.rooms.forEach((room, i) => {
      if (!floored[i] || opts.energy || !shown(labX(room))) return;
      at(labX(room));
      const k = room.type && room.type.floor;
      if (k === 'concrete') return;
      const tile = k === 'tile';
      _floorSeams(viz, info, i, tile ? 30 : 40, tile, _shade(_floorColor(room), tile ? 0.9 : 0.86), inHole);
    });
    viz.off = null;
  }
  // Planchers des étages (dalle vue de dessous et en rive)
  if (lv) {
    lv.forEach((L, k) => {
      if (!k || !shown(L.x0)) return;
      const ws = scene.walls.filter((w) => levelOf((w.a.x + w.b.x) / 2) === k);
      if (!ws.length) return;
      const xs = ws.flatMap((w) => [w.a.x, w.b.x]), zs = ws.flatMap((w) => [w.a.y, w.b.y]);
      const x0 = Math.min(...xs) - 10, x1 = Math.max(...xs) + 10, z0 = Math.min(...zs) - 10, z1 = Math.max(...zs) + 10;
      at(L.x0);
      viz.setLayer(0.4);
      // la dalle comble la hauteur entre le haut des murs du dessous et le plancher (≥ 24 cm)
      const e = Math.max(24, (L.dy || 0) - ((lv[k - 1] && lv[k - 1].dy) || 0) - HOUSE3D.H);
      for (const r of _cutRects([{ x: x0, y: z0, w: x1 - x0, h: z1 - z0 }], holes)) {
        viz.box(r.x + r.w / 2, -e, r.y + r.h / 2, r.w, e, r.h, '#d8d2c6');
        scene.slabs.push({ x0: r.x, x1: r.x + r.w, z0: r.y, z1: r.y + r.h, y0: -e, y1: 0, lvl: k });
      }
      viz.off = null;
    });
  }
  viz.setLayer(1);

  // Murs : ouvertures des fenêtres (allège + linteau), transparents en rayons X
  const windows = components.filter((c) => c.type === 'window_a');
  viz.alpha = opts.xray ? 0.16 : 1;
  viz.obj = 'wall';
  for (const w of scene.walls) {
    const mx = (w.a.x + w.b.x) / 2;
    w.lvl = levelOf(mx); w.hidden = !shown(mx);
    if (w.hidden) continue;
    at(mx);
    const dx = w.b.x - w.a.x, dz = w.b.y - w.a.y, len = Math.hypot(dx, dz);
    const ux = dx / len, uz = dz / len, ang = (Math.atan2(dz, dx) * 180) / Math.PI;
    const ops = [];
    for (const win of windows) {
      const t = (win.x - w.a.x) * ux + (win.y - w.a.y) * uz;
      const off = Math.abs((win.x - w.a.x) * -uz + (win.y - w.a.y) * ux);
      if (off < w.t / 2 + 4 && t > -30 && t < len + 30) ops.push([Math.max(0, t - 40), Math.min(len, t + 40)]);
    }
    ops.sort((p, q) => p[0] - q[0]);
    w.ops = ops; // ouvertures (vue en coupe)
    const piece = (s0, s1, y0, h) => {
      if (s1 - s0 < 0.5 || h <= 0) return;
      const e0 = s0 <= 0 ? w.t / 2 : 0, e1 = s1 >= len ? w.t / 2 : 0;
      const m = (s0 - e0 + s1 + e1) / 2;
      viz.box(w.a.x + ux * m, y0, w.a.y + uz * m, s1 - s0 + e0 + e1, h, w.t, WALL_COL, ang, scene.cutTop);
    };
    let s = 0;
    for (const [o0, o1] of ops) {
      piece(s, o0, 0, H);
      piece(o0, o1, 0, Math.min(95, H));
      if (H > 215) piece(o0, o1, 215, H - 215);
      s = o1;
    }
    piece(s, len, 0, H);
  }
  viz.alpha = 1; viz.obj = null; viz.off = null;

  // Plafond (visite)
  if (opts.ceiling && info && full) {
    viz.obj = 'ceiling';
    info.rooms.forEach((room, i) => {
      if (!floored[i]) return;
      const lab = components.find((c) => c.id === room.id);
      if (lab && !shown(lab.x)) return;
      at(lab ? lab.x : 0);
      for (const r of _cutRects(roomRuns(info, i), ceilHoles)) viz.poly([[r.x, H, r.y + r.h], [r.x + r.w, H, r.y + r.h], [r.x + r.w, H, r.y], [r.x, H, r.y]], '#f6f4ef');
    });
    viz.obj = null; viz.off = null;
  }

  // Goulottes : en plinthe le long des murs, en moulure au plafond ailleurs
  const nearWall = (p) => scene.walls.some((w) => _dSeg(p.x, p.y, w.a, w.b) < 32);
  const ceilY = HOUSE3D.H - 9;
  viz.obj = 'conduit';
  if (opts.xray) viz.alpha = 0.35;
  for (const w of conduits) {
    if (w.riser) continue; // colonne montante : dans la cage d'escalier
    for (let i = 0; i < w.points.length - 1; i++) {
      const a = w.points[i], c = w.points[i + 1];
      if (!shown((a.x + c.x) / 2)) continue;
      at((a.x + c.x) / 2);
      const len = Math.hypot(c.x - a.x, c.y - a.y);
      if (len < 1) continue;
      const ang = (Math.atan2(c.y - a.y, c.x - a.x) * 180) / Math.PI;
      const high = !nearWall({ x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 });
      if (high && !full && !opts.xray) continue;
      const y = high ? ceilY : 1;
      const a0 = viz.alpha;
      if (high && !full) viz.alpha = Math.min(viz.alpha, 0.45);
      viz.box((a.x + c.x) / 2, y, (a.y + c.y) / 2, len + 5, 7, 5, '#e9ecf0', ang);
      if (high) for (const p of [a, c]) if (nearWall(p)) viz.box(p.x, 1, p.y, 5, ceilY - 1, 5, '#e9ecf0', ang);
      viz.alpha = a0;
    }
  }
  viz.alpha = 1; viz.obj = null; viz.off = null;

  // Composants (menuiseries translucides en rayons X)
  const JOINERY = new Set(['door', 'window_a', 'garage_door']);
  const stairPoly = new Map();
  for (const c of components) {
    const sym = symbols[c.type];
    if (!sym || !shown(c.x)) continue;
    at(c.x);
    viz.obj = c.id;
    viz.alpha = opts.xray && JOINERY.has(c.type) ? 0.16 : 1;
    if (!(mode === 'low' && CEILING_OBJ.has(c.type))) {
      (BUILDERS3D[c.type] || ((v, cc) => v.box(cc.x, 0, cc.y, 30, 14, 22, C3D.dark, cc.rot || 0)))(viz, c);
    }
    viz.obj = null; viz.alpha = 1;
    if (SOLID_FURNITURE.has(c.type)) {
      const P = _footprint3(c, c.type === 'plant' ? -6 : 0);
      scene.colliders.polys.push(P);
      if (c.type === 'stairs') stairPoly.set(c.id, P);
    }
  }
  viz.off = null;
  // Escalier praticable en visite : de la volée du rez-de-chaussée à la trémie de l'étage
  if (lv && lv.length > 1) {
    const lo = components.find((c) => c.type === 'stairs' && c.value !== 'haut' && levelOf(c.x) === 0);
    const hi = components.find((c) => c.type === 'stairs' && c.value === 'haut' && levelOf(c.x) === 1);
    if (lo && hi && stairPoly.has(lo.id) && stairPoly.has(hi.id) && (lo.rot || 0) === (hi.rot || 0)) {
      scene.stairs = { lo, hi, polys: [stairPoly.get(lo.id), stairPoly.get(hi.id)], off: lv.map((L) => ({ dx: L.dx || 0, dy: L.dy || 0 })) };
    }
  }

  // Rayons X : câbles de chaque circuit, échauffement et courant animé
  if (opts.xray && design && design.ok) _buildCables(viz, components, design, snap, sim, nearWall, { place: (x) => { at(x); return shown(x); }, offOf, shown, only: opts.circuit || null });
  viz.off = null;

  // Abords (terrasse, allées, haie, arbres) et toiture
  const extOf = (k) => {
    const ws = scene.walls.filter((w) => w.ext && levelOf((w.a.x + w.b.x) / 2) === k);
    if (!ws.length) return null;
    const ex = { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity };
    for (const w of ws) for (const p of [w.a, w.b]) {
      ex.minX = Math.min(ex.minX, p.x); ex.maxX = Math.max(ex.maxX, p.x);
      ex.minZ = Math.min(ex.minZ, p.y); ex.maxZ = Math.max(ex.maxZ, p.y);
    }
    return ex;
  };
  const ex0 = extOf(0);
  if (ex0) {
    if (opts.ground) _buildGarden(viz, components.filter((c) => levelOf(c.x) === 0), info, ex0);
    const top = lv ? lv.length - 1 : 0, exT = extOf(top);
    if (mode === 'roof' && exT && (shown(lv ? lv[top].x0 : 0) || !lv)) {
      at(lv ? lv[top].x0 : 0);
      _buildRoof(viz, exT, opts.pv || 0);
      viz.off = null;
    }
  }

  // Lumières : pièce de chaque lampe (le moteur WebGL ne l'éclaire que là)
  for (const l of viz.lights) l.room = info ? roomAt(info, l.px !== undefined ? l.px : l.x, l.pz !== undefined ? l.pz : l.z) : -1;

  // Point de départ de la visite : derrière la porte d'entrée
  scene.start = _walkStart(components, info, b);
}

// ---------------------------------------------------------------------------
// Toiture : deux pans de tuiles (pente 33°), faîtage le long du grand côté,
// débords, rives, pignons, cheminée
// ---------------------------------------------------------------------------
function _buildRoof(viz, ex, pvKwc) {
  const o = 38, t = Math.tan((33 * Math.PI) / 180), yWall = HOUSE3D.H + 6;
  const alongX = ex.maxX - ex.minX >= ex.maxZ - ex.minZ;
  // repère local : u le long du faîtage, v en travers
  const P = (u, v, y) => (alongX ? [u, y, v] : [v, y, u]);
  const eu0 = alongX ? ex.minX : ex.minZ, eu1 = alongX ? ex.maxX : ex.maxZ;
  const ev0 = alongX ? ex.minZ : ex.minX, ev1 = alongX ? ex.maxZ : ex.maxX;
  const half = (ev1 - ev0) / 2, vc = (ev0 + ev1) / 2;
  const u0 = eu0 - o, u1 = eu1 + o, vA = ev0 - o, vB = ev1 + o;
  const ridgeY = yWall + half * t, eaveY = yWall - o * t;
  const yAt = (v) => ridgeY - Math.abs(v - vc) * t;
  const TILE = '#a8573c', TILE_D = '#8e4731', RIDGE = '#7c3b2a', FASCIA = '#efe9df';
  viz.setLayer(1);
  viz.obj = 'roof';
  // Pans
  viz.poly([P(u0, vA, eaveY), P(u1, vA, eaveY), P(u1, vc, ridgeY), P(u0, vc, ridgeY)], TILE);
  viz.poly([P(u0, vB, eaveY), P(u0, vc, ridgeY), P(u1, vc, ridgeY), P(u1, vB, eaveY)], TILE);
  // Rangs de tuiles (tous les 34 cm), légèrement en relief
  const run = half + o, rows = Math.floor(run / 34);
  for (let k = 1; k < rows; k++) {
    for (const edge of [vA, vB]) {
      const dir = Math.sign(vc - edge), f0 = k / rows, f1 = f0 + 4 / run;
      const va = edge + dir * f0 * run, vb = edge + dir * f1 * run;
      viz.poly([P(u0, va, yAt(va) + 0.9), P(u1, va, yAt(va) + 0.9), P(u1, vb, yAt(vb) + 0.9), P(u0, vb, yAt(vb) + 0.9)], TILE_D);
    }
  }
  // Faîtage
  const uc = (u0 + u1) / 2;
  const rc = P(uc, vc, ridgeY - 5);
  viz.box(rc[0], rc[1], rc[2], alongX ? u1 - u0 + 6 : 18, 11, alongX ? 18 : u1 - u0 + 6, RIDGE);
  // Rives et bandeaux d'égout
  for (const v of [vA, vB]) {
    const a = P(u0, v, eaveY - 14), b = P(u1, v, eaveY - 14), c = P(u1, v, eaveY), d = P(u0, v, eaveY);
    viz.poly([a, b, c, d], FASCIA);
  }
  for (const u of [u0, u1]) {
    viz.poly([P(u, vA, eaveY - 12), P(u, vA, eaveY), P(u, vc, ridgeY), P(u, vc, ridgeY - 12)], FASCIA);
    viz.poly([P(u, vB, eaveY - 12), P(u, vB, eaveY), P(u, vc, ridgeY), P(u, vc, ridgeY - 12)], FASCIA);
  }
  // Sous-faces des débords
  viz.poly([P(u0, vA, eaveY - 1), P(u1, vA, eaveY - 1), P(u1, ev0, yWall - 1), P(u0, ev0, yWall - 1)], '#d9d2c6');
  viz.poly([P(u0, vB, eaveY - 1), P(u1, vB, eaveY - 1), P(u1, ev1, yWall - 1), P(u0, ev1, yWall - 1)], '#d9d2c6');
  // Pignons, au nu extérieur des murs d'about
  for (const u of [eu0 - HOUSE3D.T_EXT / 2, eu1 + HOUSE3D.T_EXT / 2]) {
    viz.poly([P(u, ev0, HOUSE3D.H - 1), P(u, ev1, HOUSE3D.H - 1), P(u, ev1, yWall), P(u, vc, ridgeY - 1), P(u, ev0, yWall)], WALL_COL);
  }
  // Panneaux photovoltaïques (400 Wc, portrait 1,13 × 1,72 m) sur le pan exposé au sud
  if (pvKwc > 0) {
    const cosA = Math.cos((33 * Math.PI) / 180);
    const pw = 113, ph = 172 * cosA, gap = 3; // largeur le long du faîtage, emprise horizontale en pente
    const hd0 = o + 30, hdMax = half + o - 45; // du débord au faîtage (distances horizontales depuis l'égout)
    const nu = Math.max(0, Math.floor((u1 - u0 - 100 + gap) / (pw + gap)));
    const nr = Math.max(0, Math.floor((hdMax - hd0 + gap) / (ph + gap)));
    const want = Math.ceil((pvKwc * 1000) / 400);
    const n = Math.min(want, nu * nr);
    viz.scene.pv = { want, placed: n, capacity: nu * nr };
    const vAt = (hd) => vB - hd, yOn = (hd) => eaveY + hd * t; // pan sud : de vB vers le faîtage
    viz.obj = 'pv';
    const perRow = n ? Math.ceil(n / Math.ceil(n / nu)) : 0; // rangées équilibrées
    for (let k = 0; k < n; k++) {
      const row = Math.floor(k / perRow), inRow = Math.min(perRow, n - row * perRow), col = k % perRow;
      const rowW = inRow * (pw + gap) - gap, ua = (u0 + u1) / 2 - rowW / 2 + col * (pw + gap), ub = ua + pw;
      const h0 = hd0 + row * (ph + gap), h1 = h0 + ph;
      const q = (a, b, c0, c1, lift, col) => viz.poly([P(a, vAt(c0), yOn(c0) + lift), P(b, vAt(c0), yOn(c0) + lift), P(b, vAt(c1), yOn(c1) + lift), P(a, vAt(c1), yOn(c1) + lift)], col);
      q(ua, ub, h0, h1, 4, '#c3c9d1');                     // cadre aluminium
      q(ua + 3, ub - 3, h0 + 2.5, h1 - 2.5, 5, '#1b2a47'); // cellules
      q((ua + ub) / 2 - 0.8, (ua + ub) / 2 + 0.8, h0 + 2.5, h1 - 2.5, 5.4, '#33466b');
    }
    viz.obj = 'roof';
  }
  // Cheminée (sur le pan nord quand il y a des panneaux)
  const cu = eu0 + (eu1 - eu0) * 0.72, cv = vc + ((pvKwc > 0 ? vA : vB) - vc) * 0.32, base = yAt(cv) - 18;
  const cp = P(cu, cv, base);
  viz.box(cp[0], base, cp[2], 52, ridgeY + 52 - base, 52, '#b8a998', 0, '#6d6258');
  viz.obj = null;
}

// ---------------------------------------------------------------------------
// Abords : terrasse bois devant le séjour, allée d'entrée, entrée de garage,
// haie autour du terrain, arbres
// ---------------------------------------------------------------------------
function _buildGarden(viz, components, info, ex) {
  const M = 520; // marge du terrain autour de la maison
  const lot = { minX: ex.minX - M, minZ: ex.minZ - M, maxX: ex.maxX + M, maxZ: ex.maxZ + M };
  viz.outerBounds = lot;
  const GY = -9.8;
  // Côté de la maison le plus proche d'un point : 'N' (z min), 'S', 'W' (x min), 'E'
  const sideOf = (x, z) => {
    const d = { N: Math.abs(z - ex.minZ), S: Math.abs(z - ex.maxZ), W: Math.abs(x - ex.minX), E: Math.abs(x - ex.maxX) };
    return Object.keys(d).reduce((a, k) => (d[k] < d[a] ? k : a), 'N');
  };
  const out = { N: [0, -1], S: [0, 1], W: [-1, 0], E: [1, 0] };
  const openings = []; // passages dans la haie { side, c, w }
  viz.obj = 'garden';
  viz.setLayer(0.2);

  // Bande (allée) du mur jusqu'à la haie
  const strip = (x, z, side, w, col, joints) => {
    const [dx, dz] = out[side];
    const x0 = dx ? (dx > 0 ? ex.maxX + 10 : lot.minX) : x - w / 2, x1 = dx ? (dx > 0 ? lot.maxX : ex.minX - 10) : x + w / 2;
    const z0 = dz ? (dz > 0 ? ex.maxZ + 10 : lot.minZ) : z - w / 2, z1 = dz ? (dz > 0 ? lot.maxZ : ex.minZ - 10) : z + w / 2;
    viz.poly([[x0, GY, z0], [x1, GY, z0], [x1, GY, z1], [x0, GY, z1]], col);
    if (joints) {
      viz.setLayer(0.25);
      const len = dx ? x1 - x0 : z1 - z0;
      for (let k = 60; k < len; k += 60) {
        const p = dx ? x0 + k : z0 + k;
        if (dx) viz.poly([[p, GY + 0.2, z0], [p + 2, GY + 0.2, z0], [p + 2, GY + 0.2, z1], [p, GY + 0.2, z1]], joints);
        else viz.poly([[x0, GY + 0.2, p], [x1, GY + 0.2, p], [x1, GY + 0.2, p + 2], [x0, GY + 0.2, p + 2]], joints);
      }
      viz.setLayer(0.2);
    }
    openings.push({ side, c: dx ? z : x, w: w + 20 });
  };
  // Entrée de garage (enrobé) et allée piétonne (dalles) jusqu'à la porte d'entrée
  const gd = components.find((c) => c.type === 'garage_door');
  if (gd) strip(gd.x, gd.y, sideOf(gd.x, gd.y), 300, '#77787a', '#6a6b6d');
  const onEdge = (c) => Math.min(Math.abs(c.x - ex.minX), Math.abs(c.x - ex.maxX), Math.abs(c.y - ex.minZ), Math.abs(c.y - ex.maxZ)) < 15;
  const entry = components.find((c) => c.type === 'door' && onEdge(c));
  if (entry) {
    const side = sideOf(entry.x, entry.y);
    strip(entry.x, entry.y, side, 120, '#cfc6b6', '#b9ae9b');
    // Éclairage extérieur (crépusculaire) : applique près de la porte, bornes le long de l'allée
    const [dx, dz] = out[side];
    const wallX = dx ? (dx > 0 ? ex.maxX : ex.minX) : entry.x, wallZ = dz ? (dz > 0 ? ex.maxZ : ex.minZ) : entry.y;
    const along = [dz ? 1 : 0, dx ? 1 : 0];
    viz.setLayer(1);
    const lx = wallX + dx * 16 + along[0] * 75, lz = wallZ + dz * 16 + along[1] * 75;
    viz.box(lx - dx * 4, 190, lz - dz * 4, dx ? 6 : 18, 26, dx ? 18 : 6, '#2d3137');
    const e0 = viz.em; viz.em = 0.5;
    viz.box(lx + dx * 2, 196, lz + dz * 2, dx ? 8 : 12, 14, dx ? 12 : 8, '#fff1d6');
    viz.em = e0;
    viz.addLight({ x: lx + dx * 20, y: 190, z: lz + dz * 20, power: 0.55, radius: 380, color: [1, 0.82, 0.58], dusk: true });
    const len = M - 10;
    for (const [f, sgn] of [[0.3, 1], [0.62, -1], [0.92, 1]]) {
      const bx = wallX + dx * (10 + f * len) + along[0] * sgn * 85, bz = wallZ + dz * (10 + f * len) + along[1] * sgn * 85;
      viz.cyl(bx, -10, bz, 6, 72, '#2d3137', { seg: 8 });
      const e1 = viz.em; viz.em = 0.55;
      viz.cyl(bx, 62, bz, 8, 9, '#fff1d6', { seg: 8 });
      viz.em = e1;
      viz.cyl(bx, 71, bz, 10, 3, '#2d3137', { seg: 8 });
      viz.addLight({ x: bx, y: 66, z: bz, power: 0.32, radius: 230, color: [1, 0.8, 0.55], dusk: true });
    }
    viz.setLayer(0.2);
  }

  // Terrasse en bois devant le séjour (côté extérieur le plus proche)
  const sej = info ? info.rooms.findIndex((r) => r.type && r.type.key === 'sejour' && !r.leaked && r.sharedWith === null) : -1;
  if (sej >= 0) {
    let rx0 = Infinity, rz0 = Infinity, rx1 = -Infinity, rz1 = -Infinity;
    for (const r of roomRuns(info, sej)) { rx0 = Math.min(rx0, r.x); rz0 = Math.min(rz0, r.y); rx1 = Math.max(rx1, r.x + r.w); rz1 = Math.max(rz1, r.y + r.h); }
    const d = { N: rz0 - ex.minZ, S: ex.maxZ - rz1, W: rx0 - ex.minX, E: ex.maxX - rx1 };
    const side = Object.keys(d).reduce((a, k) => (d[k] < d[a] ? k : a), 'N');
    if (d[side] < 40) {
      const D = 260, inset = 30;
      const [dx, dz] = out[side];
      const x0 = dx ? (dx > 0 ? ex.maxX + 10 : ex.minX - 10 - D) : rx0 + inset, x1 = dx ? (dx > 0 ? ex.maxX + 10 + D : ex.minX - 10) : rx1 - inset;
      const z0 = dz ? (dz > 0 ? ex.maxZ + 10 : ex.minZ - 10 - D) : rz0 + inset, z1 = dz ? (dz > 0 ? ex.maxZ + 10 + D : ex.minZ - 10) : rz1 - inset;
      viz.setLayer(1);
      viz.box((x0 + x1) / 2, -11, (z0 + z1) / 2, x1 - x0, 13, z1 - z0, '#b3875a', 0, '#bf9264');
      // lames
      viz.setLayer(1.1);
      const alongX = !dx; // lames parallèles au mur
      const n = Math.floor((alongX ? z1 - z0 : x1 - x0) / 15);
      for (let k = 1; k < n; k++) {
        if (alongX) { const z = z0 + k * 15; viz.poly([[x0, 2.2, z], [x1, 2.2, z], [x1, 2.2, z + 1.5], [x0, 2.2, z + 1.5]], '#94704a'); }
        else { const x = x0 + k * 15; viz.poly([[x, 2.2, z0], [x + 1.5, 2.2, z0], [x + 1.5, 2.2, z1], [x, 2.2, z1]], '#94704a'); }
      }
      // salon de jardin : table et deux chaises
      const tx = (x0 + x1) / 2 + (alongX ? (x1 - x0) * 0.22 : 0), tz = (z0 + z1) / 2 + (alongX ? 0 : (z1 - z0) * 0.22);
      viz.setLayer(1);
      viz.cyl(tx, 2, tz, 4, 70, '#3b3f45', { seg: 8 });
      viz.cyl(tx, 72, tz, 48, 3, '#e9e5dc', { seg: 18 });
      for (const s of [-1, 1]) {
        const cx = tx + (alongX ? s * 78 : 0), cz = tz + (alongX ? 0 : s * 78);
        viz.box(cx, 2, cz, 44, 44, 44, '#3b3f45', 0, '#565b63');
        viz.box(cx + (alongX ? s * 20 : 0), 46, cz + (alongX ? 0 : s * 20), alongX ? 5 : 44, 42, alongX ? 44 : 5, '#565b63');
      }
    }
  }

  // Haie tout autour du terrain, interrompue par les allées
  viz.setLayer(1);
  const HEDGE = ['#4d7a3c', '#557f41', '#48733a'];
  const hedgeSide = (side) => {
    const horiz = side === 'N' || side === 'S';
    const a0 = horiz ? lot.minX : lot.minZ, a1 = horiz ? lot.maxX : lot.maxZ;
    const fixed = side === 'N' ? lot.minZ : side === 'S' ? lot.maxZ : side === 'W' ? lot.minX : lot.maxX;
    const gaps = openings.filter((g) => g.side === side);
    let k = 0;
    for (let a = a0; a < a1 - 1; a += 180) {
      const b = Math.min(a1, a + 180), m = (a + b) / 2;
      if (gaps.some((g) => Math.abs(m - g.c) < g.w / 2 + 90)) continue;
      const hh = 105 + ((k++ * 37) % 3) * 9;
      if (horiz) viz.box(m, -11, fixed, b - a + 8, hh, 60, HEDGE[k % 3], 0, _shade(HEDGE[k % 3], 1.12));
      else viz.box(fixed, -11, m, 60, hh, b - a + 8, HEDGE[k % 3], 0, _shade(HEDGE[k % 3], 1.12));
    }
  };
  for (const side of ['N', 'S', 'W', 'E']) hedgeSide(side);

  // Arbres (positions fixes, loin des allées)
  const spots = [
    [lot.minX + 170, lot.minZ + 170], [lot.maxX - 170, lot.minZ + 170], [lot.minX + 170, lot.maxZ - 170], [lot.maxX - 170, lot.maxZ - 170],
    [(ex.minX + ex.maxX) / 2 - (ex.maxX - ex.minX) * 0.3, lot.maxZ - 200], [(ex.minX + ex.maxX) / 2 + (ex.maxX - ex.minX) * 0.3, lot.minZ + 200],
  ];
  const clear = (x, z) => !openings.some((g) => {
    const along = g.side === 'N' || g.side === 'S' ? x : z;
    const across = g.side === 'N' ? z < ex.minZ : g.side === 'S' ? z > ex.maxZ : g.side === 'W' ? x < ex.minX : x > ex.maxX;
    return across && Math.abs(along - g.c) < g.w / 2 + 150;
  });
  spots.forEach(([x, z], i) => {
    if (!clear(x, z)) return;
    const s = 0.85 + ((i * 53) % 5) * 0.08;
    viz.cyl(x, -11, z, 11 * s, 150 * s, '#6b4f36', { seg: 8, r2: 7 * s });
    const green = ['#4c7d3e', '#5b8a45', '#467338'];
    for (const [dx, dy, dz, r] of [[0, 150, 0, 85], [-40, 185, 25, 62], [38, 195, -20, 58], [8, 235, 6, 52]]) {
      viz.dome(x + dx * s, (dy - r * 0.55) * s - 11, z + dz * s, r * s, green[(i + dy) % 3], { seg: 10, rings: 4, sy: 1.15 });
      viz.dome(x + dx * s, (dy - r * 0.55) * s - 11, z + dz * s, r * s * 0.98, _shade(green[(i + dy) % 3], 0.8), { seg: 10, rings: 2, sy: -0.55 });
    }
  });
  viz.obj = null;
  viz.setLayer(1);
}

// ---------------------------------------------------------------------------
// Visite guidée : parcours en profondeur des pièces à partir de l'entrée, en
// passant par les portes (jamais à travers un mur). Points { x, z, room, stop }.
// ---------------------------------------------------------------------------
function tourPath(components, wires, levels) {
  const info = computeRooms(components, wires);
  if (!info || !info.owner) return [];
  const ok = (i) => i >= 0 && info.rooms[i] && !info.rooms[i].leaked && info.rooms[i].sharedWith === null;
  const center = (i) => {
    const lab = components.find((c) => c.id === info.rooms[i].id);
    return lab ? { x: lab.x, z: lab.y } : null;
  };
  // Portes intérieures : pièces de part et d'autre
  const adj = {};
  for (const d of components) {
    if (d.type !== 'door') continue;
    const n = rotY([0, 0, 1], d.rot || 0);
    const a = roomAt(info, d.x + n[0] * 45, d.y + n[2] * 45), b = roomAt(info, d.x - n[0] * 45, d.y - n[2] * 45);
    if (!ok(a) || !ok(b) || a === b) continue;
    (adj[a] = adj[a] || []).push({ to: b, d, n: [n[0], n[2]], s: 1 });
    (adj[b] = adj[b] || []).push({ to: a, d, n: [n[0], n[2]], s: -1 });
  }
  // Maison à étage : l'escalier relie la pièce du bas de la volée au palier
  // (visité en dernier : la visite finit à l'étage)
  const lo = levels && levels.length > 1 && components.find((c) => c.type === 'stairs' && c.value !== 'haut');
  const hi = lo && components.find((c) => c.type === 'stairs' && c.value === 'haut');
  if (lo && hi) {
    const rise = (levels[1].dy || 0) - (levels[0].dy || 0);
    const [ax, az] = _lp(lo, 0, 157 + 55), a = roomAt(info, ax, az);
    // sortie en haut : devant la volée, sinon sur le côté où le palier est libre
    const exits = [[0, -157 - 50], [-52 - 42, -120], [52 + 42, -120]].map(([lx, ly]) => _lp(hi, lx, ly));
    const ex = exits.find(([x, z]) => ok(roomAt(info, x, z)));
    if (ok(a) && ex) {
      const b = roomAt(info, ex[0], ex[1]);
      const path = [
        { x: ax, z: az, room: a, stop: false },
        { x: _lp(lo, 0, 150)[0], z: _lp(lo, 0, 150)[1], room: a, stop: false, lift: 0 },
        { x: _lp(lo, 0, -97)[0], z: _lp(lo, 0, -97)[1], room: a, stop: false, lift: rise },
        { x: ex[0], z: ex[1], room: b, stop: false, lift: 0 },
      ];
      (adj[a] = adj[a] || []).push({ to: b, stairs: path });
      (adj[b] = adj[b] || []).push({ to: a, stairs: path.slice().reverse().map((p) => ({ ...p, room: p === path[0] ? a : b })) });
    }
  }
  const start = _walkStart(components, info, { minX: 0, minZ: 0, maxX: 0, maxZ: 0 });
  const r0 = roomAt(info, start.x, start.z);
  if (!ok(r0)) return [];
  const pts = [{ x: start.x, z: start.z, room: r0, stop: false }];
  const c0 = center(r0);
  if (c0) pts.push({ ...c0, room: r0, stop: true });
  const seen = new Set([r0]);
  const via = (e, from, to) => {
    if (e.stairs) { for (const p of e.stairs) pts.push({ ...p }); return; }
    // côté « from » de la porte, seuil, côté « to »
    const k = e.s; // n pointe vers la pièce a (s = 1 : from = a)
    pts.push({ x: e.d.x + e.n[0] * 60 * k, z: e.d.y + e.n[1] * 60 * k, room: from, stop: false });
    pts.push({ x: e.d.x, z: e.d.y, room: from, stop: false });
    pts.push({ x: e.d.x - e.n[0] * 60 * k, z: e.d.y - e.n[1] * 60 * k, room: to, stop: false });
  };
  const visit = (r) => {
    const edges = (adj[r] || []).slice().sort((p, q) => (!!p.stairs - !!q.stairs) || (info.rooms[q.to].area || 0) - (info.rooms[p.to].area || 0));
    for (const e of edges) {
      if (seen.has(e.to)) continue;
      seen.add(e.to);
      via(e, r, e.to);
      const c = center(e.to);
      if (c) pts.push({ ...c, room: e.to, stop: true });
      visit(e.to);
      // retour par la même porte (ou le même escalier)
      via(e.stairs ? (adj[e.to] || []).find((x) => x.stairs && x.to === r) : { ...e, s: -e.s }, e.to, r);
    }
  };
  visit(r0);
  // on s'arrête après la dernière pièce visitée (pas de retour inutile)
  while (pts.length && !pts[pts.length - 1].stop) pts.pop();
  return pts;
}

function _walkStart(components, info, b) {
  if (info && info.owner) {
    for (const d of components) {
      if (d.type !== 'door') continue;
      const n = rotY([0, 0, 1], d.rot || 0);
      for (const s of [1, -1]) {
        const out = roomAt(info, d.x - n[0] * s * 45, d.y - n[2] * s * 45) < 0 &&
          (() => { const gx = Math.round((d.x - n[0] * s * 45 - info.x0) / info.step), gy = Math.round((d.y - n[2] * s * 45 - info.y0) / info.step); return gx < 0 || gy < 0 || gx >= info.nx || gy >= info.ny || info.owner[gy * info.nx + gx] < 0; })();
        const inRoom = info.owner && (() => { const x = d.x + n[0] * s * 70, y = d.y + n[2] * s * 70; const gx = Math.round((x - info.x0) / info.step), gy = Math.round((y - info.y0) / info.step); return gx >= 0 && gy >= 0 && gx < info.nx && gy < info.ny && info.owner[gy * info.nx + gx] >= 0; })();
        if (out && inRoom) {
          const dx = n[0] * s, dz = n[2] * s;
          return { x: d.x + dx * 70, z: d.y + dz * 70, yaw: Math.atan2(-dx, -dz) };
        }
      }
    }
    const r = info.rooms.findIndex((x) => !x.leaked);
    if (r >= 0) {
      const lab = components.find((c) => c.id === info.rooms[r].id);
      if (lab) return { x: lab.x, z: lab.y, yaw: 0 };
    }
  }
  return { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2, yaw: 0 };
}

const CABLE_COLORS = ['#ffb020', '#4f9dff', '#35d07f', '#ff5d7a', '#b18aec', '#6ad7d0', '#ff8a3d', '#e6e05a', '#5ce0c6', '#f58ad8'];
function _buildCables(viz, components, design, snap, sim, nearWall, lvl) {
  const place = (lvl && lvl.place) || (() => true), offOf = (lvl && lvl.offOf) || (() => null);
  const shown = (lvl && lvl.shown) || (() => true);
  const only = lvl && lvl.only; // un circuit isolé : les autres s'estompent
  const net = design.net, byId = {};
  for (const c of components) byId[c.id] = c;
  const H = HOUSE3D.H;
  const tb = byId[design.panel];
  design.circuits.forEach((ct, k) => {
    const st = snap && snap.circuits.find((x) => x.id === ct.id);
    const live = st ? st.live : true;
    const heat = st ? Math.min(1, Math.max(0, (st.heat - 0.2) / 1.1)) : 0;
    const base = CABLE_COLORS[k % CABLE_COLORS.length];
    const dim = !!only && ct.id !== only, pick = !!only && ct.id === only;
    const col = dim ? '#8b939e' : !live ? '#5d6570' : heat > 0.05 ? _mix(base, '#ff2a14', heat) : base;
    viz.em = dim ? 0 : live ? 0.55 + heat * 0.9 : 0;
    viz.alpha = dim ? 0.14 : 1;
    const th = pick ? 3.6 : 2.2; // circuit isolé : câble plus épais
    viz.obj = 'cable:' + ct.id;
    const lift = (k % 5) * 1.3;
    const level = (e) => {
      const p = net.pos[e.a], q = net.pos[e.b];
      return nearWall({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }) ? 3 + lift : H - 14 - lift;
    };
    const seg = (p, q, y) => {
      const len = Math.hypot(q.x - p.x, q.y - p.y);
      if (len < 0.5) return;
      viz.box((p.x + q.x) / 2, y, (p.y + q.y) / 2, len + th, th, th, col, (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI);
    };
    const riser = (p, y0, y1) => { if (Math.abs(y1 - y0) > 1) viz.box(p.x, Math.min(y0, y1), p.y, th, Math.abs(y1 - y0), th, col); };
    for (const ei of ct.edges) {
      const e = net.edges[ei], y = level(e);
      if (e.riser) {
        // montée vers l'étage : colonne verticale dans la trémie de l'escalier
        const dyOf = (v) => (offOf(net.pos[v].x) || { dy: 0 }).dy;
        const [lo, hi] = dyOf(e.a) <= dyOf(e.b) ? [e.a, e.b] : [e.b, e.a];
        const up = shown(net.pos[hi].x);
        if (!place(net.pos[lo].x) && !up) continue;
        const y0 = shown(net.pos[lo].x) ? 3 + lift : dyOf(hi) - dyOf(lo) - 24; // étage seul : depuis le dessous de la dalle
        riser(net.pos[lo], y0, up ? dyOf(hi) - dyOf(lo) + 3 + lift : H - 4);
        continue;
      }
      if (!place((net.pos[e.a].x + net.pos[e.b].x) / 2)) continue;
      seg(net.pos[e.a], net.pos[e.b], y);
      if (y > 50) for (const v of [e.a, e.b]) if (nearWall(net.pos[v])) riser(net.pos[v], 3 + lift, y);
    }
    // descentes vers chaque appareil
    for (const id of ct.devices) {
      const c = byId[id], r = design.route[id];
      if (!c || !r || r.off || r.node === undefined) continue;
      if (!place(c.x)) continue;
      const p = net.pos[r.node];
      const top = CEILING_OBJ.has(c.type) ? H - 14 - lift : 3 + lift;
      seg(p, { x: c.x, y: c.y }, top);
      const h = (typeof MOUNT_H !== 'undefined' && MOUNT_H[c.type] ? MOUNT_H[c.type] * 100 : 30);
      riser({ x: c.x, y: c.y }, top, Math.min(h, H - 4));
      if (pick) { // repère lumineux au-dessus de chaque point du circuit isolé
        const y0 = CEILING_OBJ.has(c.type) ? H - 60 : Math.min(h, H - 4) + 18;
        viz.em = 1.3;
        viz.box(c.x, y0, c.y, 1.6, 30, 1.6, base);
        viz.box(c.x, y0 + 30, c.y, 9, 9, 9, base, 45);
        viz.em = live ? 0.55 + heat * 0.9 : 0;
      }
    }
    viz.em = 0; viz.obj = null; viz.off = null; viz.alpha = 1;
    if (dim) return; // pas de courant animé sur les circuits estompés
    // Courant animé : du tableau vers chaque appareil qui consomme
    if (!snap || !live || !tb) return;
    for (const id of ct.devices) {
      const dv = snap.devices[id], r = design.route[id], c = byId[id];
      if (!dv || !dv.P || !r || r.off || !c || !shown(c.x) || !shown(tb.x)) continue;
      const pts = _flowPath(net, r, design, tb, c, nearWall, lift, offOf);
      if (pts.length < 2) continue;
      const I = dv.P / Math.max(1, dv.U);
      viz.flows.push({ pts, speed: 50 + 280 * Math.min(1, I / 12), color: [1, 0.8, 0.4], size: 6 + Math.min(5, I / 3) });
    }
  });
}
// Polyligne 3D du tableau jusqu'à l'appareil en suivant les câbles
function _flowPath(net, r, design, tb, c, nearWall, lift, offOf) {
  const H = HOUSE3D.H;
  // point du plan → point 3D du bon niveau (l'étage est décalé en x et surélevé)
  const O = (x, y, z) => { const o = offOf && offOf(x); return o ? [x + o.dx, y + o.dy, z] : [x, y, z]; };
  const nodes = [];
  let v = r.node;
  nodes.push(v);
  for (const ei of r.edges) { const e = net.edges[ei]; v = e.a === v ? e.b : e.a; nodes.push(v); }
  nodes.reverse(); // tableau → appareil
  const pts = [O(tb.x, 140, tb.y)];
  const dyOf = (x) => { const o = offOf && offOf(x); return o ? o.dy : 0; };
  const yOf = (i) => {
    if (i === 0) return 3 + lift;
    const p = net.pos[nodes[i - 1]], q = net.pos[nodes[i]];
    if (dyOf(p.x) !== dyOf(q.x)) return 3 + lift; // montée d'étage
    return nearWall({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }) ? 3 + lift : H - 14 - lift;
  };
  let prevY = O(tb.x, 3 + lift, tb.y)[1];
  const to = (q) => {
    const L = pts[pts.length - 1];
    if (Math.abs(q[1] - prevY) > 1) pts.push([L[0], q[1], L[2]]);
    pts.push(q);
    prevY = q[1];
  };
  nodes.forEach((n, i) => { const p = net.pos[n]; to(O(p.x, yOf(i), p.y)); });
  const top = CEILING_OBJ.has(c.type) ? H - 14 - lift : 3 + lift;
  to(O(c.x, top, c.y));
  const h = typeof MOUNT_H !== 'undefined' && MOUNT_H[c.type] ? MOUNT_H[c.type] * 100 : 30;
  pts.push(O(c.x, Math.min(h, H - 4), c.y));
  return pts;
}

function _footprint3(c, grow) {
  const b = SYMBOLS[c.type].bbox, g = grow || 0;
  return [[b.x - g, b.y - g], [b.x + b.w + g, b.y - g], [b.x + b.w + g, b.y + b.h + g], [b.x - g, b.y + b.h + g]]
    .map(([x, y]) => { const [px, pz] = _lp(c, x, y); return { x: px, y: pz }; });
}
function _dSeg(px, py, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - a.x) * dx + (py - a.y) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}
// Vue en coupe : remplit les murs et les dalles tranchés par le plan x = cx
// (sinon on verrait l'intérieur creux des boîtes). Reconstruit à chaque
// déplacement du plan ; les faces « cap » ne sont jamais coupées.
const CAP_COLOR = '#30353d';
function _buildCaps(viz, cx) {
  viz.faces = viz.faces.filter((f) => !f.cap);
  const sc = viz.scene;
  if (cx === null || !sc || !sc.slabs) return;
  const H = sc.wallH, offs = sc.cutOff || [null], alongZ = viz.cutAxis === 'z';
  // repère du plan de coupe : u = axe coupé (x ou z), v = axe horizontal dans le plan
  const U = (p) => (alongZ ? p.y : p.x), V = (p) => (alongZ ? p.x : p.y);
  const P = (u, y, v) => (alongZ ? [v, y, u] : [u, y, v]);
  const o0 = viz.obj, a0 = viz.alpha, e0 = viz.em, l0 = viz._layer;
  viz.capping = true; viz.obj = 'wall'; viz.alpha = 1; viz.em = 0; viz.setLayer(1);
  for (const w of sc.walls) {
    if (w.hidden) continue;
    const o = offs[w.lvl || 0] || null, pu = cx - (o && !alongZ ? o.dx : 0); // l'étage n'est décalé qu'en x
    const du = U(w.b) - U(w.a), dv = V(w.b) - V(w.a), len = Math.hypot(du, dv);
    if (len < 1) continue;
    const uu = du / len, uv = dv / len;
    if (Math.abs(uu) < 0.2) continue; // mur presque parallèle au plan
    const t = (pu - U(w.a)) / uu; // abscisse le long du mur
    if (t < -w.t / 2 || t > len + w.t / 2) continue;
    const v = V(w.a) + uv * t, half = w.t / 2 / Math.abs(uu);
    const open = (w.ops || []).some(([a, b]) => t > a && t < b);
    const spans = open ? [[0, Math.min(95, H)]].concat(H > 215 ? [[215, H]] : []) : [[0, H]];
    viz.off = o;
    for (const [y0, y1] of spans) viz.poly([P(pu, y0, v - half), P(pu, y0, v + half), P(pu, y1, v + half), P(pu, y1, v - half)], CAP_COLOR);
  }
  for (const sl of sc.slabs) {
    const o = offs[sl.lvl || 0] || null, pu = cx - (o && !alongZ ? o.dx : 0);
    const u0 = alongZ ? sl.z0 : sl.x0, u1 = alongZ ? sl.z1 : sl.x1, v0 = alongZ ? sl.x0 : sl.z0, v1 = alongZ ? sl.x1 : sl.z1;
    if (pu <= u0 || pu >= u1) continue;
    viz.off = o;
    viz.poly([P(pu, sl.y0, v0), P(pu, sl.y0, v1), P(pu, sl.y1, v1), P(pu, sl.y1, v0)], CAP_COLOR);
  }
  viz.off = null; viz.capping = false; viz.obj = o0; viz.alpha = a0; viz.em = e0; viz.setLayer(l0 === undefined ? 1 : l0);
}

// Rectangles {x, y, w, h} privés des trous {x0, x1, z0, z1} (trémies)
function _cutRects(rects, holes) {
  let out = rects;
  for (const h of holes) {
    const next = [];
    for (const r of out) {
      const rx1 = r.x + r.w, ry1 = r.y + r.h;
      if (h.x1 <= r.x || h.x0 >= rx1 || h.z1 <= r.y || h.z0 >= ry1) { next.push(r); continue; }
      const zA = Math.max(r.y, h.z0), zB = Math.min(ry1, h.z1);
      if (zA > r.y) next.push({ x: r.x, y: r.y, w: r.w, h: zA - r.y });
      if (zB < ry1) next.push({ x: r.x, y: zB, w: r.w, h: ry1 - zB });
      if (h.x0 > r.x) next.push({ x: r.x, y: zA, w: h.x0 - r.x, h: zB - zA });
      if (h.x1 < rx1) next.push({ x: h.x1, y: zA, w: rx1 - h.x1, h: zB - zA });
    }
    out = next;
  }
  return out;
}
function _mix(a, b, t) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (s) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
  return '#' + ((1 << 24) + (ch(16) << 16) + (ch(8) << 8) + ch(0)).toString(16).slice(1);
}
function _shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (s) => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) * k)));
  return '#' + ((1 << 24) + (ch(16) << 16) + (ch(8) << 8) + ch(0)).toString(16).slice(1);
}

// ---- Sols du plan de maison -----------------------------------------------
const _FLOORS = {
  chambre: '#cfae7e', sejour: '#d8b98a', circ: '#c9aa7c', bureau: '#caa878',
  cuisine: '#e3e6ea', sdb: '#dbe7ee', wc: '#e3e6ea', annexe: '#d9d6cf', garage: '#b9bcbf', dressing: '#cfae7e',
};
function _floorColor(room) {
  return (room.type && _FLOORS[room.type.key]) || '#d2b384';
}

// Joints du revêtement de la pièce i : lames (dans un sens) ou carreaux
// (dans les deux sens), découpés aux contours exacts de la pièce.
function _floorSeams(viz, info, i, pitch, both, color, hole) {
  const S = info.step, k = Math.round(pitch / S), y = 0.5, t = 0.7;
  const own = (gx, gy) => info.owner[gy * info.nx + gx] === i && !(hole && hole(info.x0 + gx * S, info.y0 + gy * S));
  for (let gx = 0; gx < info.nx; gx++) {
    if ((Math.round((info.x0 + gx * S) / S)) % k !== 0) continue;
    const x = info.x0 + gx * S;
    let start = -1;
    for (let gy = 0; gy <= info.ny; gy++) {
      const inside = gy < info.ny && own(gx, gy);
      if (inside && start < 0) start = gy;
      if (!inside && start >= 0) {
        const z1 = info.y0 + start * S - S / 2, z2 = info.y0 + gy * S - S / 2;
        viz.poly([[x - t, y, z1], [x + t, y, z1], [x + t, y, z2], [x - t, y, z2]], color);
        start = -1;
      }
    }
  }
  if (!both) return;
  for (let gy = 0; gy < info.ny; gy++) {
    if ((Math.round((info.y0 + gy * S) / S)) % k !== 0) continue;
    const z = info.y0 + gy * S;
    let start = -1;
    for (let gx = 0; gx <= info.nx; gx++) {
      const inside = gx < info.nx && own(gx, gy);
      if (inside && start < 0) start = gx;
      if (!inside && start >= 0) {
        const x1 = info.x0 + start * S - S / 2, x2 = info.x0 + gx * S - S / 2;
        viz.poly([[x1, y, z - t], [x2, y, z - t], [x2, y, z + t], [x1, y, z + t]], color);
        start = -1;
      }
    }
  }
}

// Moteur le plus riche disponible : WebGL2 (gl3d.js) sinon canvas 2D
function createViz3D(canvas, opts) {
  if (typeof GL3D !== 'undefined' && GL3D.supported()) {
    try { return new GL3D(canvas, opts); } catch (e) { /* repli en canvas 2D */ }
  }
  return new Viz3D(canvas, opts);
}
