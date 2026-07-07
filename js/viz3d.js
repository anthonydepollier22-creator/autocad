/*
 * viz3d.js — Mini moteur 3D sans dépendance (canvas 2D, algorithme du peintre).
 *
 * Repère : Y vers le haut, la carte (PCB) est dans le plan XZ.
 * Les coordonnées du schéma se projettent directement : x -> X, y -> Z.
 *
 *  - Viz3D        : caméra orbitale (glisser = tourner, molette = zoom),
 *                   éclairage directionnel + ambiant, tri des faces.
 *  - BUILDERS3D   : représentation volumétrique de chaque composant.
 *  - buildBoard() : construit la carte complète (PCB, pistes, composants).
 */

class Viz3D {
  constructor(canvas, opts) {
    opts = opts || {};
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.faces = [];                       // { pts:[[x,y,z]..], color:[r,g,b] }
    this.yaw = opts.yaw !== undefined ? opts.yaw : -0.65;
    this.pitch = opts.pitch !== undefined ? opts.pitch : 0.82;
    this.dist = opts.dist || 700;
    this.target = opts.target || [0, 0, 0];
    this.fov = opts.fov || 42 * Math.PI / 180;
    this.autoRotate = opts.autoRotate !== false;
    this.light = this._norm([0.45, 1, 0.3]);       // lumière principale (chaude, en haut)
    this.light2 = this._norm([-0.6, 0.25, -0.75]); // lumière d'appoint (froide, latérale)
    this.bg = opts.bg || null;             // null = transparent
    this._raf = null;
    this._drag = null;
    if (opts.interactive !== false) this._bind();
  }

  // ---- Scène ----
  // Les calques évitent qu'une grande face (le PCB) recouvre les petites :
  // le calque 0 (carte) est toujours peint avant le calque 1 (composants).
  clear() { this.faces = []; this._layer = 1; }
  setLayer(n) { this._layer = n; }
  poly(pts, color) { this.faces.push({ pts, color: this._rgb(color), layer: this._layer === undefined ? 1 : this._layer }); }

  box(cx, cy, cz, sx, sy, sz, color, ry) {
    const x0 = -sx / 2, x1 = sx / 2, y0 = 0, y1 = sy, z0 = -sz / 2, z1 = sz / 2;
    let v = [
      [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1],
      [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1],
    ];
    if (ry) v = v.map((p) => rotY(p, ry));
    v = v.map((p) => [p[0] + cx, p[1] + cy, p[2] + cz]);
    const q = (a, b, c, d) => this.poly([v[a], v[b], v[c], v[d]], color);
    q(4, 5, 6, 7); q(3, 2, 1, 0); // dessus / dessous
    q(0, 1, 5, 4); q(2, 3, 7, 6); // faces Z
    q(1, 2, 6, 5); q(3, 0, 4, 7); // faces X
  }

  // Cylindre : axis 'y' (vertical) ou 'x' (couché), ry = rotation autour de Y
  cyl(cx, cy, cz, r, len, color, o) {
    o = o || {};
    const seg = o.seg || 14, axis = o.axis || 'y', ry = o.ry || 0;
    const r2 = o.r2 !== undefined ? o.r2 : r;
    const ring = (t, rr) => {
      const pts = [];
      for (let i = 0; i < seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        let p = axis === 'y'
          ? [Math.cos(a) * rr, t, Math.sin(a) * rr]
          : [t - len / 2, Math.cos(a) * rr + len / 2 * 0, Math.sin(a) * rr]; // axe X
        if (axis === 'x') p = [t - len / 2, Math.cos(a) * rr, Math.sin(a) * rr];
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
    const seg = o.seg || 12, rings = o.rings || 5;
    const pt = (i, k) => {
      const a = (i / seg) * Math.PI * 2, e = (k / rings) * Math.PI / 2;
      return [cx + Math.cos(a) * Math.cos(e) * r, cy + Math.sin(e) * r, cz + Math.sin(a) * Math.cos(e) * r];
    };
    for (let k = 0; k < rings; k++) {
      for (let i = 0; i < seg; i++) {
        const j = (i + 1) % seg;
        this.poly([pt(i, k), pt(j, k), pt(j, k + 1), pt(i, k + 1)], color);
      }
    }
  }

  // ---- Rendu ----
  fit(radius) {
    this.dist = Math.max(radius, 60) / Math.tan(this.fov / 2) * 1.25;
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, r.width * dpr);
    this.canvas.height = Math.max(1, r.height * dpr);
    this._dpr = dpr;
  }

  render() {
    const ctx = this.ctx;
    const dpr = this._dpr || 1;
    const W = this.canvas.width / dpr, H = this.canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (this.bg) { ctx.fillStyle = this.bg; ctx.fillRect(0, 0, W, H); }

    // Caméra
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const cyw = Math.cos(this.yaw), syw = Math.sin(this.yaw);
    const eye = [
      this.target[0] + this.dist * cp * syw,
      this.target[1] + this.dist * sp,
      this.target[2] + this.dist * cp * cyw,
    ];
    const fwd = this._norm([this.target[0] - eye[0], this.target[1] - eye[1], this.target[2] - eye[2]]);
    const right = this._norm(cross(fwd, [0, 1, 0]));
    const up = cross(right, fwd);
    const f = (H / 2) / Math.tan(this.fov / 2);
    const near = 10;

    const out = [];
    for (const face of this.faces) {
      let zsum = 0; const proj = [];
      let ok = true;
      for (const p of face.pts) {
        const dx = p[0] - eye[0], dy = p[1] - eye[1], dz = p[2] - eye[2];
        const x = dx * right[0] + dy * right[1] + dz * right[2];
        const y = dx * up[0] + dy * up[1] + dz * up[2];
        const z = dx * fwd[0] + dy * fwd[1] + dz * fwd[2];
        if (z < near) { ok = false; break; }
        zsum += z;
        proj.push([W / 2 + (x * f) / z, H / 2 - (y * f) / z]);
      }
      if (!ok) continue;
      // Normale (monde) pour l'éclairage
      const [a, b, c] = face.pts;
      const n = this._norm(cross(
        [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
        [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
      ));
      const d1 = Math.abs(n[0] * this.light[0] + n[1] * this.light[1] + n[2] * this.light[2]);
      const d2 = Math.abs(n[0] * this.light2[0] + n[1] * this.light2[1] + n[2] * this.light2[2]);
      const k = Math.min(1.04, 0.36 + 0.52 * d1 + 0.2 * d2);
      out.push({ z: zsum / face.pts.length, layer: face.layer, proj, col: `rgb(${Math.min(255, face.color[0] * k) | 0},${Math.min(255, face.color[1] * k) | 0},${Math.min(255, face.color[2] * k) | 0})` });
    }
    out.sort((p, q) => (p.layer !== q.layer ? p.layer - q.layer : q.z - p.z));
    for (const fce of out) {
      ctx.beginPath();
      ctx.moveTo(fce.proj[0][0], fce.proj[0][1]);
      for (let i = 1; i < fce.proj.length; i++) ctx.lineTo(fce.proj[i][0], fce.proj[i][1]);
      ctx.closePath();
      ctx.fillStyle = fce.col;
      ctx.strokeStyle = fce.col; ctx.lineWidth = 0.7;
      ctx.fill(); ctx.stroke();
    }
  }

  start() {
    this.resize();
    const loop = () => {
      if (this.autoRotate && !this._drag) this.yaw += 0.0045;
      this.render();
      this._raf = requestAnimationFrame(loop);
    };
    if (!this._raf) loop();
  }
  stop() { if (this._raf) cancelAnimationFrame(this._raf); this._raf = null; }

  // ---- Interaction ----
  _bind() {
    const cv = this.canvas;
    cv.style.touchAction = 'none';
    cv.addEventListener('pointerdown', (e) => {
      this._drag = { x: e.clientX, y: e.clientY };
      cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener('pointermove', (e) => {
      if (!this._drag) return;
      this.yaw -= (e.clientX - this._drag.x) * 0.008;
      this.pitch = Math.max(0.12, Math.min(1.45, this.pitch + (e.clientY - this._drag.y) * 0.006));
      this._drag = { x: e.clientX, y: e.clientY };
      this.autoRotate = false;
      if (!this._raf) this.render();
    });
    cv.addEventListener('pointerup', () => { this._drag = null; });
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.dist = Math.max(120, Math.min(6000, this.dist * (e.deltaY > 0 ? 1.1 : 0.9)));
      if (!this._raf) this.render();
    }, { passive: false });
  }

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
function rotY(p, deg) {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return [p[0] * c - p[2] * s, p[1], p[0] * s + p[2] * c];
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
};

// Fils de connexion du corps vers les bornes (à plat, hauteur y)
function _lead3d(v, x1, z1, x2, z2, y) {
  const dx = x2 - x1, dz = z2 - z1;
  const len = Math.hypot(dx, dz);
  if (len < 1) return;
  const ang = (Math.atan2(dz, dx) * 180) / Math.PI;
  v.box((x1 + x2) / 2, 0, (z1 + z2) / 2, len, y, 3, C3D.lead, -ang);
}

// Composant axial (résistance, diode, fusible…) : corps cylindrique + pattes
function _axial(v, c, bodyLen, r, color, bands) {
  const rot = -(c.rot || 0);
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
    const rot = -(c.rot || 0);
    const end = rotY([40, 0, 0], rot);
    _lead3d(v, c.x - end[0], c.y - end[2], c.x + end[0], c.y + end[2], 3);
    v.cyl(c.x, 0, c.y, 11, 30, C3D.cap, { capColor: C3D.capTop });
  },
  capacitor_pol: (v, c) => BUILDERS3D.capacitor(v, c),
  led: (v, c) => {
    const rot = -(c.rot || 0);
    const end = rotY([40, 0, 0], rot);
    _lead3d(v, c.x - end[0], c.y - end[2], c.x + end[0], c.y + end[2], 3);
    v.cyl(c.x, 0, c.y, 9, 12, C3D.led, { capTop: false });
    v.dome(c.x, 12, c.y, 9, C3D.led);
  },
  lamp: (v, c) => {
    const rot = -(c.rot || 0);
    const end = rotY([40, 0, 0], rot);
    _lead3d(v, c.x - end[0], c.y - end[2], c.x + end[0], c.y + end[2], 3);
    v.cyl(c.x, 0, c.y, 9, 8, C3D.metal);
    v.dome(c.x, 8, c.y, 13, '#ffd75e');
  },
  battery: (v, c) => { v.cyl(c.x, 0, c.y, 14, 46, '#2f9e57', { axis: 'x', ry: -(c.rot || 0), capColor: C3D.metal }); },
  battery2: (v, c) => BUILDERS3D.battery(v, c),
  dc_source: (v, c) => { v.box(c.x, 0, c.y, 56, 22, 34, C3D.dark, -(c.rot || 0)); },
  ac_source: (v, c) => BUILDERS3D.dc_source(v, c),
  current_source: (v, c) => BUILDERS3D.dc_source(v, c),
  motor: (v, c) => { v.cyl(c.x, 0, c.y, 16, 26, C3D.metal); v.cyl(c.x, 26, c.y, 3, 8, '#6d7681'); },
  buzzer: (v, c) => { v.cyl(c.x, 0, c.y, 14, 16, C3D.dark); v.cyl(c.x, 16, c.y, 3, 1.5, '#000'); },
  relay: (v, c) => { v.box(c.x, 0, c.y, 40, 24, 26, '#3f6fb5', -(c.rot || 0)); },
  voltmeter: (v, c) => { v.box(c.x, 0, c.y, 40, 18, 34, C3D.dark, -(c.rot || 0)); v.box(c.x, 18, c.y, 30, 2, 22, C3D.white, -(c.rot || 0)); },
  ammeter: (v, c) => BUILDERS3D.voltmeter(v, c),
  ohmmeter: (v, c) => BUILDERS3D.voltmeter(v, c),
  switch: (v, c) => {
    v.box(c.x, 0, c.y, 28, 10, 16, C3D.white, -(c.rot || 0));
    const tip = rotY([c.closed ? 6 : -6, 0, 0], -(c.rot || 0));
    v.box(c.x + tip[0], 10, c.y + tip[2], 12, 6, 8, C3D.lever, -(c.rot || 0));
  },
  push_button: (v, c) => { v.box(c.x, 0, c.y, 24, 8, 24, C3D.dark, -(c.rot || 0)); v.cyl(c.x, 8, c.y, 7, 6, c.closed ? '#2f9e57' : C3D.led); },
  transistor_npn: (v, c) => {
    v.cyl(c.x, 0, c.y, 12, 22, C3D.dark, { ry: -(c.rot || 0) });
    v.box(c.x, 0, c.y - 6, 24, 22, 12, C3D.dark, -(c.rot || 0));
  },
  transistor_pnp: (v, c) => BUILDERS3D.transistor_npn(v, c),
  transformer: (v, c) => {
    v.box(c.x, 0, c.y, 60, 34, 30, '#5d6670', -(c.rot || 0));
    v.cyl(c.x - 16, 4, c.y, 12, 26, C3D.copper, { ry: -(c.rot || 0) });
    v.cyl(c.x + 16, 4, c.y, 12, 26, C3D.copper, { ry: -(c.rot || 0) });
  },
  ground: (v, c) => { v.cyl(c.x, 0, c.y, 7, 2, C3D.pad); },
  vcc: (v, c) => { v.cyl(c.x, 0, c.y, 7, 2, C3D.gold); },
  junction: (v, c) => { v.cyl(c.x, 0, c.y, 5, 2, C3D.pad); },
  antenna: (v, c) => { v.cyl(c.x, 0, c.y, 2.5, 60, C3D.metal); },
  // Portes logiques et horloge : boîtier DIP
  _dip: (v, c, label) => {
    v.box(c.x, 3, c.y, 44, 12, 26, C3D.ic, -(c.rot || 0));
    for (let i = -1; i <= 1; i += 2) {
      for (let k = -1; k <= 1; k++) {
        const p = rotY([k * 14, 0, i * 16], -(c.rot || 0));
        v.box(c.x + p[0], 0, c.y + p[2], 4, 5, 6, C3D.pad, -(c.rot || 0));
      }
    }
  },
  clock: (v, c) => { v.box(c.x, 0, c.y, 40, 12, 28, C3D.metal, -(c.rot || 0)); },
  dff: (v, c) => BUILDERS3D._dip(v, c),
  seven_seg: (v, c) => {
    v.box(c.x, 0, c.y, 64, 16, 76, C3D.dark, -(c.rot || 0));
    v.box(c.x, 16, c.y, 50, 2, 62, '#3a1010', -(c.rot || 0));
  },
  // ----- Plan de maison ----------------------------------------------------
  door: (v, c) => {
    const rot = -(c.rot || 0);
    const off = rotY([-36, 0, -36], rot);
    v.box(c.x + off[0], 0, c.y + off[2], 7, 86, 70, '#b9895c', rot); // vantail ouvert
  },
  window_a: (v, c) => {
    const rot = -(c.rot || 0);
    v.box(c.x, 26, c.y, 84, 44, 6, '#a8cce6', rot);   // vitrage
    v.box(c.x, 24, c.y, 84, 3, 10, '#f4f1ea', rot);   // appui
    v.box(c.x, 68, c.y, 84, 3, 10, '#f4f1ea', rot);   // linteau
  },
  bed: (v, c) => {
    const rot = -(c.rot || 0);
    v.box(c.x, 0, c.y, 116, 16, 156, '#8a6f4d', rot);          // sommier
    v.box(c.x, 16, c.y, 108, 10, 148, '#ece8dd', rot);         // matelas
    const p1 = rotY([-26, 0, -54], rot), p2 = rotY([26, 0, -54], rot);
    v.box(c.x + p1[0], 26, c.y + p1[2], 42, 7, 26, '#f7f4ee', rot);
    v.box(c.x + p2[0], 26, c.y + p2[2], 42, 7, 26, '#f7f4ee', rot);
    const d = rotY([0, 0, 30], rot);
    v.box(c.x + d[0], 25, c.y + d[2], 110, 3, 88, '#5a7ba6', rot); // couette
  },
  sofa: (v, c) => {
    const rot = -(c.rot || 0);
    v.box(c.x, 0, c.y, 156, 24, 76, '#5a7ba6', rot);
    const bk = rotY([0, 0, -30], rot);
    v.box(c.x + bk[0], 24, c.y + bk[2], 156, 24, 16, '#4d6b94', rot); // dossier
    for (const s of [-1, 1]) {
      const ar = rotY([s * 70, 0, 6], rot);
      v.box(c.x + ar[0], 24, c.y + ar[2], 16, 12, 60, '#4d6b94', rot); // accoudoirs
    }
  },
  table: (v, c) => {
    const rot = -(c.rot || 0);
    v.box(c.x, 26, c.y, 116, 5, 76, '#a9825a', rot);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const lg = rotY([sx * 50, 0, sz * 30], rot);
      v.box(c.x + lg[0], 0, c.y + lg[2], 7, 26, 7, '#7d5f42', rot);
    }
  },
  counter: (v, c) => {
    const rot = -(c.rot || 0);
    v.box(c.x, 0, c.y, 176, 32, 56, '#e8eaee', rot);          // caisson
    v.box(c.x, 32, c.y, 180, 4, 60, '#8b939e', rot);          // plan de travail
    const sk = rotY([-50, 0, 0], rot);
    v.box(c.x + sk[0], 36, c.y + sk[2], 40, 2, 34, '#c3cad2', rot); // évier
    const tp = rotY([-50, 0, -14], rot);
    v.cyl(c.x + tp[0], 36, c.y + tp[2], 2.5, 12, '#aeb6bf');  // robinet
  },
  wardrobe: (v, c) => {
    const rot = -(c.rot || 0);
    v.box(c.x, 0, c.y, 116, 88, 46, '#a9825a', rot);
    v.box(c.x, 30, c.y, 118, 1.5, 47, '#7d5f42', rot);
  },
  panel_house: (v, c) => {
    const rot = -(c.rot || 0);
    v.box(c.x, 34, c.y, 66, 46, 12, C3D.module, rot);
    v.box(c.x, 44, c.y, 54, 10, 13, '#2f3844', rot); // rangée de disjoncteurs
  },
  gtl: (v, c) => {
    const rot = -(c.rot || 0);
    v.box(c.x, 0, c.y, 36, 90, 14, '#f0f2f5', rot);
    v.box(c.x, 20, c.y, 38, 2, 15, '#c3cad2', rot);
    v.box(c.x, 62, c.y, 38, 2, 15, '#c3cad2', rot);
  },
  socket_wall: (v, c) => { v.box(c.x, 10, c.y, 16, 15, 9, C3D.module, -(c.rot || 0)); },
  switch_sa: (v, c) => { v.box(c.x, 38, c.y, 16, 16, 9, C3D.module, -(c.rot || 0)); },
  switch_vv_wall: (v, c) => { v.box(c.x, 38, c.y, 16, 16, 9, C3D.module, -(c.rot || 0)); },
  dcl: (v, c) => {
    v.cyl(c.x, 84, c.y, 13, 4, '#f4f1ea');
    v.cyl(c.x, 74, c.y, 4.5, 10, '#ffd75e'); // suspension + ampoule
  },
  wall_light: (v, c) => { v.box(c.x, 52, c.y, 18, 12, 9, '#ffd75e', -(c.rot || 0)); },
  jbox: (v, c) => { v.box(c.x, 70, c.y, 14, 9, 9, '#d8dade', -(c.rot || 0)); },
  logic_in: (v, c) => { v.box(c.x, 0, c.y, 24, 10, 24, c.high ? '#2f9e57' : C3D.dark, -(c.rot || 0)); },
  logic_out: (v, c) => {
    v.cyl(c.x, 0, c.y, 8, 8, c.__on ? '#2f9e57' : C3D.dark);
    v.dome(c.x, 8, c.y, 8, c.__on ? '#5ce08a' : '#3a3f47');
  },
  // Norme française : modules DIN blancs
  breaker: (v, c) => {
    v.box(c.x, 0, c.y, 36, 34, 24, C3D.module, -(c.rot || 0));
    const tip = rotY([0, 0, 0], -(c.rot || 0));
    v.box(c.x + tip[0], 34, c.y + tip[2], 8, 6, 10, c.closed === false ? C3D.led : C3D.lever, -(c.rot || 0));
  },
  rcd: (v, c) => BUILDERS3D.breaker(v, c),
  socket: (v, c) => {
    v.box(c.x, 0, c.y, 36, 12, 36, C3D.module, -(c.rot || 0));
    v.cyl(c.x, 12, c.y, 13, 3, '#d5d9df');
  },
  sw_vv: (v, c) => BUILDERS3D.switch(v, c),
  bell: (v, c) => { v.dome(c.x, 4, c.y, 14, C3D.gold); v.cyl(c.x, 0, c.y, 14, 4, C3D.dark); },
};
for (const g of ['gate_and', 'gate_or', 'gate_not', 'gate_nand', 'gate_nor', 'gate_xor']) {
  BUILDERS3D[g] = (v, c) => BUILDERS3D._dip(v, c);
}

// Construit la carte complète ; renvoie le rayon englobant (pour cadrer la caméra)
function buildBoard(viz, components, wires, symbols) {
  viz.clear();
  const walls = wires.filter((w) => w.kind === 'wall');
  const conduits = wires.filter((w) => w.kind === 'conduit');
  const elec = wires.filter((w) => !w.kind || w.kind === 'wire');
  const houseMode = walls.length > 0; // plan de maison -> sol + murs extrudés

  // Bornes du circuit
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  const acc = (x, z) => { minX = Math.min(minX, x); minZ = Math.min(minZ, z); maxX = Math.max(maxX, x); maxZ = Math.max(maxZ, z); };
  for (const c of components) { const b = symbols[c.type].bbox; acc(c.x + b.x, c.y + b.y); acc(c.x + b.x + b.w, c.y + b.y + b.h); }
  for (const w of wires) for (const p of w.points) acc(p.x, p.y);
  if (!isFinite(minX)) { minX = -140; minZ = -100; maxX = 140; maxZ = 100; }
  const pad = houseMode ? 30 : 46;
  minX -= pad; minZ -= pad; maxX += pad; maxZ += pad;
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  const W = maxX - minX, D = maxZ - minZ;

  // Sol : PCB vert (schéma) ou dalle parquet (maison) — calque de fond
  viz.setLayer(0);
  viz.box(cx, -8, cz, W, 8, D, houseMode ? '#c8ad85' : C3D.pcb);
  if (houseMode) {
    // lames de parquet
    for (let x = minX + 40; x < maxX; x += 40) viz.box(x, 0.05, cz, 1, 0.4, D, '#b89a72');
  } else {
    for (const [ix, iz] of [[minX + 14, minZ + 14], [maxX - 14, minZ + 14], [minX + 14, maxZ - 14], [maxX - 14, maxZ - 14]]) {
      viz.cyl(ix, 0.1, iz, 5, 0.8, '#0e4227');
    }
  }
  viz.setLayer(1);

  // Murs extrudés
  for (const w of walls) {
    for (let i = 0; i < w.points.length - 1; i++) {
      const a = w.points[i], b = w.points[i + 1];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 1) continue;
      const ang = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
      viz.box((a.x + b.x) / 2, 0, (a.y + b.y) / 2, len + 10, 92, 10, '#ece7dc', -ang);
    }
  }
  // Goulottes / chemins de câbles : profilés blancs en plinthe
  for (const w of conduits) {
    for (let i = 0; i < w.points.length - 1; i++) {
      const a = w.points[i], b = w.points[i + 1];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 1) continue;
      const ang = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
      viz.box((a.x + b.x) / 2, 2, (a.y + b.y) / 2, len + 6, 9, 9, '#e4e8ee', -ang);
    }
  }
  // Pistes (fils du schéma électronique)
  for (const w of elec) {
    for (let i = 0; i < w.points.length - 1; i++) {
      _traceSeg(viz, w.points[i], w.points[i + 1]);
    }
    for (const p of w.points) viz.cyl(p.x, 0.2, p.y, 4, 1.6, C3D.copper, { seg: 8 });
  }
  // Pastilles de jonction
  if (typeof computeJunctions === 'function') {
    for (const j of computeJunctions(components, wires, symbols)) {
      viz.cyl(j.x, 0.3, j.y, 6, 2, C3D.pad, { seg: 10 });
    }
  }
  // Pastilles aux bornes + composants (pas de pastilles pour le plan maison)
  for (const c of components) {
    const sym = symbols[c.type];
    const a = ((c.rot || 0) * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
    if (!sym.plan) {
      for (const t of sym.terminals) {
        viz.cyl(c.x + t.x * cos - t.y * sin, 0.2, c.y + t.x * sin + t.y * cos, 5, 1.8, C3D.pad, { seg: 10 });
      }
    }
    (BUILDERS3D[c.type] || ((v, cc) => v.box(cc.x, 0, cc.y, 30, 14, 22, C3D.dark, -(cc.rot || 0))))(viz, c);
  }
  viz.target = [cx, 0, cz];
  return Math.max(W, D) / 2 + 30;
}

function _traceSeg(viz, a, b) {
  const dx = b.x - a.x, dz = b.y - a.y;
  const len = Math.hypot(dx, dz);
  if (len < 1) return;
  const ang = (Math.atan2(dz, dx) * 180) / Math.PI;
  viz.box((a.x + b.x) / 2, 0, (a.y + b.y) / 2, len + 4, 1.4, 5, C3D.copper, -ang);
}
