/*
 * editor.js — Moteur CAO : vue (zoom/pan), grille, modèle de document,
 * outils (sélection, fil, placement), historique annuler/refaire, rendu.
 */

const GRID = 20; // pas de grille (unités monde)

class Editor {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    // Vue : transformation monde -> écran
    this.view = { x: 0, y: 0, scale: 1 };

    // Modèle de document
    this.components = []; // { id, type, x, y, rot, label, value }
    this.wires = [];      // { id, points: [{x,y}, ...] }
    this.selection = new Set();
    this.counters = {};   // pour les références auto (R1, R2, ...)

    // Outil courant : 'select' | 'wire' | 'pan' | 'place'
    this.tool = 'select';
    this.placeType = null;
    this.placeRot = 0;

    // États d'interaction
    this.dragging = null;   // déplacement de sélection
    this.panning = null;    // panoramique
    this.marquee = null;    // rectangle de sélection
    this.wireDraft = null;  // fil en cours
    this.wireVertFirst = false;
    this.mouse = { x: 0, y: 0, wx: 0, wy: 0 }; // écran + monde

    // Historique
    this.history = [];
    this.future = [];

    // Préférences
    this.snapEnabled = true;
    this.showGrid = true;

    // Métadonnées projet (cartouche) et simulation
    this.meta = { title: '', author: '' };
    this.simMode = false;
    this.simResult = null;

    this.onChange = null; // callback UI

    this._bindEvents();
    this.resize();
    // Amorce l'historique sans déclencher la sauvegarde auto (sinon on
    // écraserait la session précédente avant de pouvoir la restaurer).
    this.history.push(this.snapshot());
  }

  // --- Transformations ----------------------------------------------------
  worldToScreen(x, y) {
    return { x: x * this.view.scale + this.view.x, y: y * this.view.scale + this.view.y };
  }
  screenToWorld(x, y) {
    return { x: (x - this.view.x) / this.view.scale, y: (y - this.view.y) / this.view.scale };
  }
  snap(v) {
    return this.snapEnabled ? Math.round(v / GRID) * GRID : v;
  }
  snapPt(p) {
    return { x: this.snap(p.x), y: this.snap(p.y) };
  }

  // --- Utilitaires modèle -------------------------------------------------
  uid() {
    return 'e' + Math.random().toString(36).slice(2, 9);
  }
  nextRef(type) {
    const sym = SYMBOLS[type];
    if (!sym || !sym.prefix) return '';
    this.counters[sym.prefix] = (this.counters[sym.prefix] || 0) + 1;
    return sym.prefix + this.counters[sym.prefix];
  }
  getById(id) {
    return this.components.find((c) => c.id === id) || this.wires.find((w) => w.id === id);
  }

  // Terminaux d'un composant en coordonnées monde
  termsOf(c) {
    const sym = SYMBOLS[c.type];
    if (!sym) return [];
    const a = (c.rot * Math.PI) / 180;
    const cos = Math.cos(a), sin = Math.sin(a);
    return sym.terminals.map((t) => ({
      x: c.x + t.x * cos - t.y * sin,
      y: c.y + t.x * sin + t.y * cos,
    }));
  }

  // Tous les points d'accroche (terminaux + sommets de fils)
  snapTargets() {
    const pts = [];
    for (const c of this.components) for (const t of this.termsOf(c)) pts.push(t);
    for (const w of this.wires) for (const p of w.points) pts.push(p);
    return pts;
  }

  // Point accroché : terminal proche sinon grille
  snapForWire(wx, wy) {
    const thr = 12 / this.view.scale;
    let best = null, bd = thr;
    for (const p of this.snapTargets()) {
      const d = Math.hypot(p.x - wx, p.y - wy);
      if (d < bd) { bd = d; best = p; }
    }
    return best ? { x: best.x, y: best.y, onTerm: true } : { ...this.snapPt({ x: wx, y: wy }), onTerm: false };
  }

  // --- Historique ---------------------------------------------------------
  snapshot() {
    return JSON.stringify({
      components: this.components, wires: this.wires, counters: this.counters,
    });
  }
  pushHistory() {
    // Le circuit change : un éventuel résultat de simulation n'est plus valide
    if (this.simMode) { this.simMode = false; this.simResult = null; }
    this.history.push(this.snapshot());
    if (this.history.length > 100) this.history.shift();
    this.future = [];
    this.autosave();
    this._emit();
  }
  _restore(str) {
    const d = JSON.parse(str);
    this.components = d.components;
    this.wires = d.wires;
    this.counters = d.counters || {};
    this.selection.clear();
  }
  undo() {
    if (this.history.length <= 1) return;
    this.future.push(this.history.pop());
    this._restore(this.history[this.history.length - 1]);
    this.render(); this._emit();
  }
  redo() {
    if (!this.future.length) return;
    const s = this.future.pop();
    this.history.push(s);
    this._restore(s);
    this.render(); this._emit();
  }

  // --- Actions modèle -----------------------------------------------------
  addComponent(type, wx, wy) {
    const p = this.snapPt({ x: wx, y: wy });
    const c = { id: this.uid(), type, x: p.x, y: p.y, rot: this.placeRot, label: this.nextRef(type), value: '' };
    this.components.push(c);
    this.pushHistory();
    this.render();
    return c;
  }
  deleteSelection() {
    if (!this.selection.size) return;
    this.components = this.components.filter((c) => !this.selection.has(c.id));
    this.wires = this.wires.filter((w) => !this.selection.has(w.id));
    this.selection.clear();
    this.pushHistory();
    this.render();
  }
  rotateSelection() {
    let changed = false;
    for (const id of this.selection) {
      const c = this.components.find((x) => x.id === id);
      if (c) { c.rot = (c.rot + 90) % 360; changed = true; }
    }
    if (changed) { this.pushHistory(); this.render(); }
  }
  duplicateSelection() {
    if (!this.selection.size) return;
    const newSel = new Set();
    for (const id of [...this.selection]) {
      const c = this.components.find((x) => x.id === id);
      if (c) {
        const n = { ...c, id: this.uid(), x: c.x + GRID * 2, y: c.y + GRID * 2, label: this.nextRef(c.type) };
        this.components.push(n); newSel.add(n.id);
      }
      const w = this.wires.find((x) => x.id === id);
      if (w) {
        const n = { id: this.uid(), points: w.points.map((p) => ({ x: p.x + GRID * 2, y: p.y + GRID * 2 })) };
        this.wires.push(n); newSel.add(n.id);
      }
    }
    this.selection = newSel;
    this.pushHistory();
    this.render();
  }
  updateSelectedProps(label, value) {
    for (const id of this.selection) {
      const c = this.components.find((x) => x.id === id);
      if (c) { c.label = label; c.value = value; }
    }
    this.pushHistory();
    this.render();
  }

  clearAll() {
    this.components = []; this.wires = []; this.selection.clear(); this.counters = {};
    this.pushHistory(); this.render();
  }

  // --- Hit testing --------------------------------------------------------
  hitComponent(wx, wy) {
    for (let i = this.components.length - 1; i >= 0; i--) {
      const c = this.components[i];
      const sym = SYMBOLS[c.type];
      if (!sym) continue;
      const a = (-c.rot * Math.PI) / 180;
      const dx = wx - c.x, dy = wy - c.y;
      const lx = dx * Math.cos(a) - dy * Math.sin(a);
      const ly = dx * Math.sin(a) + dy * Math.cos(a);
      const b = sym.bbox, m = 4;
      if (lx >= b.x - m && lx <= b.x + b.w + m && ly >= b.y - m && ly <= b.y + b.h + m) return c;
    }
    return null;
  }
  hitWire(wx, wy) {
    const thr = 6 / this.view.scale;
    for (let i = this.wires.length - 1; i >= 0; i--) {
      const w = this.wires[i];
      for (let j = 0; j < w.points.length - 1; j++) {
        if (this._distSeg(wx, wy, w.points[j], w.points[j + 1]) < thr) return w;
      }
    }
    return null;
  }
  _distSeg(px, py, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((px - a.x) * dx + (py - a.y) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
  }

  // --- Routage orthogonal du fil -----------------------------------------
  wireRoute(a, b) {
    if (a.x === b.x || a.y === b.y) return [a, b];
    const elbow = this.wireVertFirst ? { x: a.x, y: b.y } : { x: b.x, y: a.y };
    return [a, elbow, b];
  }

  // --- Gestion souris -----------------------------------------------------
  _bindEvents() {
    const cv = this.canvas;
    cv.addEventListener('mousedown', (e) => this._down(e));
    window.addEventListener('mousemove', (e) => this._move(e));
    window.addEventListener('mouseup', (e) => this._up(e));
    cv.addEventListener('wheel', (e) => this._wheel(e), { passive: false });
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('dblclick', (e) => this._dblclick(e));
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('keydown', (e) => this._key(e));
  }

  _evtPos(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  _down(e) {
    const s = this._evtPos(e);
    const w = this.screenToWorld(s.x, s.y);

    // Panoramique : molette ou clic milieu, ou outil pan, ou espace
    if (e.button === 1 || this.tool === 'pan' || this._space) {
      this.panning = { sx: s.x, sy: s.y, vx: this.view.x, vy: this.view.y };
      return;
    }
    if (e.button === 2) { // clic droit : termine un fil
      if (this.wireDraft) this._finishWire();
      return;
    }

    if (this.tool === 'place' && this.placeType) {
      this.addComponent(this.placeType, w.x, w.y);
      return;
    }

    if (this.tool === 'wire') {
      const sp = this.snapForWire(w.x, w.y);
      if (!this.wireDraft) {
        this.wireDraft = { points: [{ x: sp.x, y: sp.y }] };
      } else {
        const last = this.wireDraft.points[this.wireDraft.points.length - 1];
        const route = this.wireRoute(last, { x: sp.x, y: sp.y });
        for (let i = 1; i < route.length; i++) this.wireDraft.points.push(route[i]);
        if (sp.onTerm) this._finishWire();
      }
      this.render();
      return;
    }

    // Outil sélection
    const hitC = this.hitComponent(w.x, w.y);
    const hit = hitC || this.hitWire(w.x, w.y);
    if (hit) {
      if (e.shiftKey) {
        if (this.selection.has(hit.id)) this.selection.delete(hit.id);
        else this.selection.add(hit.id);
      } else if (!this.selection.has(hit.id)) {
        this.selection = new Set([hit.id]);
      }
      // Préparer un déplacement
      this.dragging = { sx: w.x, sy: w.y, moved: false, snapshot: this._snapPositions() };
    } else {
      if (!e.shiftKey) this.selection.clear();
      this.marquee = { x0: w.x, y0: w.y, x1: w.x, y1: w.y };
    }
    this.render();
    this._emit();
  }

  _snapPositions() {
    const m = {};
    for (const c of this.components) m[c.id] = { x: c.x, y: c.y };
    for (const w of this.wires) m[w.id] = w.points.map((p) => ({ ...p }));
    return m;
  }

  _move(e) {
    const s = this._evtPos(e);
    const w = this.screenToWorld(s.x, s.y);
    this.mouse = { x: s.x, y: s.y, wx: w.x, wy: w.y };

    if (this.panning) {
      this.view.x = this.panning.vx + (s.x - this.panning.sx);
      this.view.y = this.panning.vy + (s.y - this.panning.sy);
      this.render(); this._emit();
      return;
    }

    if (this.dragging) {
      const dx = this.snap(w.x - this.dragging.sx);
      const dy = this.snap(w.y - this.dragging.sy);
      if (dx || dy) this.dragging.moved = true;
      const base = this.dragging.snapshot;
      for (const id of this.selection) {
        const c = this.components.find((x) => x.id === id);
        if (c) { c.x = base[id].x + dx; c.y = base[id].y + dy; }
        const wi = this.wires.find((x) => x.id === id);
        if (wi) wi.points = base[id].map((p) => ({ x: p.x + dx, y: p.y + dy }));
      }
      this.render();
      return;
    }

    if (this.marquee) {
      this.marquee.x1 = w.x; this.marquee.y1 = w.y;
      this.render();
      return;
    }

    if (this.tool === 'wire' || this.tool === 'place') this.render();
    this._emit();
  }

  _up(e) {
    if (this.panning) { this.panning = null; return; }
    if (this.dragging) {
      if (this.dragging.moved) this.pushHistory();
      this.dragging = null;
      this._emit();
      return;
    }
    if (this.marquee) {
      const m = this.marquee;
      const x0 = Math.min(m.x0, m.x1), x1 = Math.max(m.x0, m.x1);
      const y0 = Math.min(m.y0, m.y1), y1 = Math.max(m.y0, m.y1);
      if (Math.abs(x1 - x0) > 3 || Math.abs(y1 - y0) > 3) {
        if (!e.shiftKey) this.selection.clear();
        for (const c of this.components)
          if (c.x >= x0 && c.x <= x1 && c.y >= y0 && c.y <= y1) this.selection.add(c.id);
        for (const wi of this.wires)
          if (wi.points.every((p) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1)) this.selection.add(wi.id);
      }
      this.marquee = null;
      this.render(); this._emit();
    }
  }

  _wheel(e) {
    e.preventDefault();
    const s = this._evtPos(e);
    const before = this.screenToWorld(s.x, s.y);
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    this.view.scale = Math.max(0.15, Math.min(8, this.view.scale * factor));
    const after = this.screenToWorld(s.x, s.y);
    this.view.x += (after.x - before.x) * this.view.scale;
    this.view.y += (after.y - before.y) * this.view.scale;
    this.render(); this._emit();
  }

  _dblclick(e) {
    if (this.tool === 'wire') { this._finishWire(); return; }
    // Double-clic sur un interrupteur : bascule ouvert/fermé
    const s = this._evtPos(e);
    const w = this.screenToWorld(s.x, s.y);
    const c = this.hitComponent(w.x, w.y);
    if (c && (c.type === 'switch' || c.type === 'push_button')) {
      c.closed = !c.closed;
      this.pushHistory(); this.render(); this._emit();
    } else if (c && c.type === 'logic_in') {
      c.high = !c.high;
      this.pushHistory(); this.render(); this._emit();
    }
  }

  toggleSelectedSwitch() {
    let changed = false;
    for (const id of this.selection) {
      const c = this.components.find((x) => x.id === id);
      if (c && (c.type === 'switch' || c.type === 'push_button')) { c.closed = !c.closed; changed = true; }
    }
    if (changed) { this.pushHistory(); this.render(); this._emit(); }
  }

  _finishWire() {
    if (this.wireDraft && this.wireDraft.points.length >= 2) {
      this.wires.push({ id: this.uid(), points: this.wireDraft.points });
      this.wireDraft = null;
      this.pushHistory();
    } else {
      this.wireDraft = null;
    }
    this.render();
  }

  _key(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === ' ') { this._space = true; this.canvas.style.cursor = 'grab'; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); this.redo(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); this.duplicateSelection(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      this.selection = new Set([...this.components.map((c) => c.id), ...this.wires.map((w) => w.id)]);
      this.render(); this._emit();
    }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); this.deleteSelection(); }
    if (e.key.toLowerCase() === 'r') {
      if (this.tool === 'place') { this.placeRot = (this.placeRot + 90) % 360; this.render(); }
      else this.rotateSelection();
    }
    if (e.key === 'Escape') {
      this.wireDraft = null; this.marquee = null;
      this.setTool('select');
      this.selection.clear();
      this.render(); this._emit();
    }
    if (e.key === 'Shift' && this.tool === 'wire') { this.wireVertFirst = true; this.render(); }
  }

  setTool(tool, placeType = null) {
    this.tool = tool;
    this.placeType = placeType;
    this.wireDraft = null;
    if (tool !== 'select') this.selection.clear();
    const cursors = { select: 'default', wire: 'crosshair', pan: 'grab', place: 'copy' };
    this.canvas.style.cursor = cursors[tool] || 'default';
    this.render(); this._emit();
  }

  // --- Rendu --------------------------------------------------------------
  resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.canvas.style.width = rect.width + 'px';
    this.canvas.style.height = rect.height + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._cssW = rect.width; this._cssH = rect.height;
    this.render();
  }

  render() {
    const ctx = this.ctx;
    const W = this._cssW, H = this._cssH;
    ctx.save();
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#1b1f27';
    ctx.fillRect(0, 0, W, H);

    if (this.showGrid) this._drawGrid(W, H);

    // Repère monde
    ctx.translate(this.view.x, this.view.y);
    ctx.scale(this.view.scale, this.view.scale);
    const lw = 2 / this.view.scale;

    // Fils
    for (const w of this.wires) this._drawWire(w, this.selection.has(w.id), lw);

    // Composants
    for (const c of this.components) this._drawComponent(c, this.selection.has(c.id), lw);

    // Points de jonction
    this._drawJunctions(lw);

    // Superposition de simulation
    if (this.simMode && this.simResult && this.simResult.ok) this._drawSim(lw);

    // Fil en cours
    if (this.wireDraft) {
      const pts = [...this.wireDraft.points];
      const sp = this.snapForWire(this.mouse.wx, this.mouse.wy);
      const last = pts[pts.length - 1];
      const route = this.wireRoute(last, { x: sp.x, y: sp.y });
      const preview = [...pts, ...route.slice(1)];
      ctx.strokeStyle = '#7fd1ff'; ctx.lineWidth = lw; ctx.setLineDash([6 / this.view.scale, 4 / this.view.scale]);
      ctx.beginPath();
      ctx.moveTo(preview[0].x, preview[0].y);
      for (let i = 1; i < preview.length; i++) ctx.lineTo(preview[i].x, preview[i].y);
      ctx.stroke();
      ctx.setLineDash([]);
      // marqueur d'accroche
      ctx.fillStyle = sp.onTerm ? '#ff5d5d' : '#7fd1ff';
      circle(ctx, sp.x, sp.y, 4 / this.view.scale, true);
    }

    // Aperçu du composant à placer
    if (this.tool === 'place' && this.placeType) {
      const p = this.snapPt({ x: this.mouse.wx, y: this.mouse.wy });
      ctx.globalAlpha = 0.5;
      this._drawComponent({ type: this.placeType, x: p.x, y: p.y, rot: this.placeRot, label: '', value: '' }, false, lw);
      ctx.globalAlpha = 1;
    }

    ctx.restore();

    // Rectangle de sélection (en écran)
    if (this.marquee) {
      const a = this.worldToScreen(this.marquee.x0, this.marquee.y0);
      const b = this.worldToScreen(this.marquee.x1, this.marquee.y1);
      ctx.save();
      ctx.strokeStyle = '#4aa3ff'; ctx.fillStyle = 'rgba(74,163,255,0.12)';
      ctx.lineWidth = 1;
      ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
      ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
      ctx.restore();
    }
  }

  _drawGrid(W, H) {
    const ctx = this.ctx;
    const step = GRID * this.view.scale;
    if (step < 6) return;
    const ox = this.view.x % step, oy = this.view.y % step;
    ctx.strokeStyle = '#262b36'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = ox; x < W; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let y = oy; y < H; y += step) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();
    // gros points tous les 5 pas
    const big = step * 5;
    const bx = this.view.x % big, by = this.view.y % big;
    ctx.fillStyle = '#39414f';
    for (let x = bx; x < W; x += big)
      for (let y = by; y < H; y += big) { ctx.fillRect(x - 1, y - 1, 2, 2); }
  }

  _drawWire(w, selected, lw) {
    const ctx = this.ctx;
    ctx.strokeStyle = selected ? '#4aa3ff' : '#d7e0ee';
    ctx.lineWidth = selected ? lw * 1.4 : lw;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(w.points[0].x, w.points[0].y);
    for (let i = 1; i < w.points.length; i++) ctx.lineTo(w.points[i].x, w.points[i].y);
    ctx.stroke();
  }

  _drawJunctions(lw) {
    const ctx = this.ctx;
    const dots = computeJunctions(this.components, this.wires, SYMBOLS);
    ctx.fillStyle = '#d7e0ee';
    for (const j of dots) {
      ctx.beginPath();
      ctx.arc(j.x, j.y, lw * 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _drawSim(lw) {
    const ctx = this.ctx;
    const r = this.simResult;
    const fs = 12 / this.view.scale;
    ctx.font = `${fs}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    // Tensions des nets
    for (const [net, p] of Object.entries(r.netSample || {})) {
      const v = r.netV[net];
      if (v === undefined) continue;
      this._badge(fmtVolt(v), p.x, p.y - 14, '#0e2a1a', '#5ce08a');
    }
    // Courants des composants
    for (const c of this.components) {
      const i = r.compI[c.id];
      if (i === undefined) continue;
      this._badge(fmtAmp(i), c.x, c.y + SYMBOLS[c.type].bbox.h / 2 + 14, '#2a200e', '#ffb454');
    }
  }

  _badge(text, x, y, bg, fg) {
    const ctx = this.ctx;
    const pad = 3 / this.view.scale;
    const w = ctx.measureText(text).width + pad * 2;
    const h = (12 / this.view.scale) + pad;
    ctx.fillStyle = bg;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(x - w / 2, y - h / 2, w, h);
    ctx.globalAlpha = 1;
    ctx.fillStyle = fg;
    ctx.fillText(text, x, y);
  }

  _drawComponent(c, selected, lw) {
    const ctx = this.ctx;
    const sym = SYMBOLS[c.type];
    if (!sym) return;
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate((c.rot * Math.PI) / 180);

    ctx.strokeStyle = selected ? '#4aa3ff' : '#e8edf5';
    ctx.fillStyle = selected ? '#4aa3ff' : '#e8edf5';
    ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    sym.draw(ctx, c);

    // terminaux
    ctx.fillStyle = '#5a6678';
    for (const t of sym.terminals) circle(ctx, t.x, t.y, 2 / this.view.scale + 1, true);

    ctx.restore();

    // étiquette (redressée, hors rotation)
    if (c.label || c.value) {
      ctx.save();
      ctx.fillStyle = selected ? '#7fb8ff' : '#9fb0c8';
      ctx.font = `${11}px sans-serif`;
      ctx.textAlign = 'center';
      const txt = [c.label, c.value].filter(Boolean).join(' ');
      const sym2 = SYMBOLS[c.type];
      const off = (sym2.bbox.h / 2) + 12;
      ctx.fillText(txt, c.x, c.y - off);
      ctx.restore();
    }

    // poignée de sélection
    if (selected) {
      ctx.save();
      ctx.strokeStyle = 'rgba(74,163,255,0.6)';
      ctx.lineWidth = 1 / this.view.scale;
      ctx.setLineDash([4 / this.view.scale, 3 / this.view.scale]);
      const a = (c.rot * Math.PI) / 180;
      ctx.translate(c.x, c.y); ctx.rotate(a);
      const b = sym.bbox;
      ctx.strokeRect(b.x - 4, b.y - 4, b.w + 8, b.h + 8);
      ctx.restore();
    }
  }

  // Sélectionne un composant et le centre dans la vue (utilisé par l'ERC)
  focusComponent(id) {
    const c = this.components.find((x) => x.id === id);
    if (!c) return;
    this.selection = new Set([id]);
    this.view.x = this._cssW / 2 - c.x * this.view.scale;
    this.view.y = this._cssH / 2 - c.y * this.view.scale;
    this.render(); this._emit();
  }

  // --- Vue d'ensemble -----------------------------------------------------
  zoomBy(f) {
    const cx = this._cssW / 2, cy = this._cssH / 2;
    const before = this.screenToWorld(cx, cy);
    this.view.scale = Math.max(0.15, Math.min(8, this.view.scale * f));
    const after = this.screenToWorld(cx, cy);
    this.view.x += (after.x - before.x) * this.view.scale;
    this.view.y += (after.y - before.y) * this.view.scale;
    this.render(); this._emit();
  }
  zoomFit() {
    if (!this.components.length && !this.wires.length) {
      this.view = { x: this._cssW / 2, y: this._cssH / 2, scale: 1 };
      this.render(); this._emit(); return;
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const acc = (x, y) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };
    for (const c of this.components) {
      const b = SYMBOLS[c.type].bbox;
      acc(c.x + b.x, c.y + b.y); acc(c.x + b.x + b.w, c.y + b.y + b.h);
    }
    for (const w of this.wires) for (const p of w.points) acc(p.x, p.y);
    const pad = 60;
    const w = maxX - minX || 100, h = maxY - minY || 100;
    const scale = Math.min((this._cssW - pad) / w, (this._cssH - pad) / h, 4);
    this.view.scale = Math.max(0.15, scale);
    this.view.x = this._cssW / 2 - (minX + w / 2) * this.view.scale;
    this.view.y = this._cssH / 2 - (minY + h / 2) * this.view.scale;
    this.render(); this._emit();
  }

  // --- Sauvegarde / chargement -------------------------------------------
  serialize() {
    return { version: 1, meta: this.meta, components: this.components, wires: this.wires, counters: this.counters };
  }
  load(data) {
    this.components = data.components || [];
    this.wires = data.wires || [];
    this.counters = data.counters || {};
    this.meta = data.meta || { title: '', author: '' };
    this.clearSim();
    this.selection.clear();
    this.history = []; this.future = [];
    this.pushHistory();
    this.zoomFit();
  }

  // --- Simulation ---------------------------------------------------------
  runSim() {
    this.simResult = simulateDC(this.components, this.wires, SYMBOLS);
    this.simMode = true;
    this.render(); this._emit();
    return this.simResult;
  }
  clearSim() {
    this.simMode = false; this.simResult = null;
    this.render(); this._emit();
  }

  // --- Export SVG / impression -------------------------------------------
  exportSVG() {
    const date = new Date().toISOString().slice(0, 10);
    return buildSVG(this.components, this.wires, SYMBOLS, { ...this.meta, date });
  }
  print() {
    const svg = this.exportSVG();
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head><title>${this.meta.title || 'Schéma'}</title>` +
      `<style>body{margin:0;display:flex;justify-content:center;padding:20px}svg{max-width:100%;height:auto}</style></head>` +
      `<body onload="window.print()">${svg}</body></html>`);
    win.document.close();
  }

  // --- Sauvegarde automatique (localStorage) -----------------------------
  autosave() {
    try { localStorage.setItem('electricad-doc', JSON.stringify(this.serialize())); } catch (_) {}
  }
  restoreAuto() {
    try {
      const s = localStorage.getItem('electricad-doc');
      if (!s) return false;
      const d = JSON.parse(s);
      if (!d.components || (!d.components.length && !(d.wires || []).length)) return false;
      this.components = d.components; this.wires = d.wires || [];
      this.counters = d.counters || {}; this.meta = d.meta || { title: '', author: '' };
      this.history = []; this.future = []; this.pushHistory();
      return true;
    } catch (_) { return false; }
  }

  exportPNG() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const acc = (x, y) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };
    for (const c of this.components) { const b = SYMBOLS[c.type].bbox; acc(c.x + b.x - 20, c.y + b.y - 20); acc(c.x + b.x + b.w + 20, c.y + b.y + b.h + 20); }
    for (const w of this.wires) for (const p of w.points) acc(p.x, p.y);
    if (!isFinite(minX)) { minX = 0; minY = 0; maxX = 400; maxY = 300; }
    const pad = 30, scale = 2;
    const w = (maxX - minX + pad * 2), h = (maxY - minY + pad * 2);
    const cv = document.createElement('canvas');
    cv.width = w * scale; cv.height = h * scale;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.scale(scale, scale);
    ctx.translate(pad - minX, pad - minY);
    ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // fils
    ctx.strokeStyle = '#111';
    for (const wi of this.wires) {
      ctx.beginPath(); ctx.moveTo(wi.points[0].x, wi.points[0].y);
      for (let i = 1; i < wi.points.length; i++) ctx.lineTo(wi.points[i].x, wi.points[i].y);
      ctx.stroke();
    }
    // composants
    for (const c of this.components) {
      const sym = SYMBOLS[c.type];
      ctx.save(); ctx.translate(c.x, c.y); ctx.rotate((c.rot * Math.PI) / 180);
      ctx.strokeStyle = '#111'; ctx.fillStyle = '#111'; ctx.lineWidth = 2;
      sym.draw(ctx); ctx.restore();
      if (c.label || c.value) {
        ctx.fillStyle = '#333'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText([c.label, c.value].filter(Boolean).join(' '), c.x, c.y - sym.bbox.h / 2 - 12);
      }
    }
    return cv.toDataURL('image/png');
  }

  _emit() { if (this.onChange) this.onChange(); }
}
