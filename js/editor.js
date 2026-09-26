/*
 * editor.js — Moteur CAO : vue (zoom/pan), grille, modèle de document,
 * outils (sélection, fil, placement), historique annuler/refaire, rendu.
 */

const GRID = 20; // pas de grille (unités monde)

// Composants basculables au double-clic (ouvert / fermé)
const SWITCHABLE = new Set(['switch', 'push_button', 'breaker', 'rcd', 'agcp', 'contactor', 'teleruptor', 'sw_vv', 'switch_sa', 'switch_vv_wall']);
// Appareils du plan de maison qu'on met en marche au double-clic
const APPLIANCES = new Set(['oven', 'cooktop', 'washer', 'dishwasher', 'dryer', 'water_heater', 'radiator', 'ev_charger', 'tv_unit', 'desk']);

// Palettes de rendu du plan (synchronisées avec le thème de l'interface)
const CANVAS_THEMES = {
  dark: {
    bg: '#141821', grid: '#202632', gridDot: '#39414f',
    wire: '#d7e0ee', comp: '#e8edf5', term: '#5a6678',
    sel: '#4f9dff', selSoft: 'rgba(79,157,255,0.6)', selFill: 'rgba(79,157,255,0.12)',
    hover: '#9dc4f0', label: '#94a3ba', labelSel: '#7fb8ff',
    draft: '#7fd1ff', snap: '#ff5d5d', junction: '#d7e0ee',
    badgeVbg: '#0e2a1a', badgeV: '#5ce08a', badgeIbg: '#2a200e', badgeI: '#ffb454',
  },
  light: {
    bg: '#fafbfc', grid: '#e7eaf0', gridDot: '#c4cbd8',
    wire: '#2a323f', comp: '#1f2733', term: '#94a0b0',
    sel: '#1668c4', selSoft: 'rgba(22,104,196,0.55)', selFill: 'rgba(22,104,196,0.10)',
    hover: '#4d84c4', label: '#5b6b82', labelSel: '#1668c4',
    draft: '#1668c4', snap: '#d43a3a', junction: '#2a323f',
    badgeVbg: '#dff3e7', badgeV: '#0f7a3d', badgeIbg: '#f9ecd4', badgeI: '#8f5607',
  },
};

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
    this.colors = CANVAS_THEMES.dark;
    this.hoverId = null;

    // Métadonnées projet (cartouche) et simulation
    this.meta = { title: '', author: '' };
    this.simMode = false;
    this.simResult = null;

    this.onChange = null; // callback UI
    this.planState = null;  // { lit: Set, on: Set } fourni par la simulation de l'installation
    this.highlight = null;  // Set d'ids mis en évidence (circuit survolé)

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
    const thr = (this._coarse ? 24 : 12) / this.view.scale;
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
      board: (this.meta && this.meta.board) || null, // tableau personnalisé : annulable lui aussi
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
    if (this.meta) { if (d.board) this.meta.board = d.board; else delete this.meta.board; }
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
    if (type === 'breaker' || type === 'rcd' || type === 'agcp') c.closed = true; // conduisent par défaut
    if (type === 'room') c.value = 'Pièce'; // à renommer : Chambre, Séjour, Cuisine…
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
        const n = { id: this.uid(), kind: w.kind, points: w.points.map((p) => ({ x: p.x + GRID * 2, y: p.y + GRID * 2 })) };
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
    for (let i = this.wires.length - 1; i >= 0; i--) {
      const w = this.wires[i];
      const thr = (w.kind ? 8 : 6) * (this._coarse ? 2 : 1) / this.view.scale + (w.kind ? 4 : 0);
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
  // Événements « pointer » : souris, doigt et stylet. Au doigt : pincer pour
  // zoomer, glisser à deux doigts pour déplacer la vue, double-tap = double-clic.
  _bindEvents() {
    const cv = this.canvas;
    cv.style.touchAction = 'none';
    this._touches = new Map();
    cv.addEventListener('pointerdown', (e) => {
      this._coarse = e.pointerType !== 'mouse';
      this._touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this._touches.size === 2) { this._startPinch(); return; }
      if (this._touches.size > 2 || this._pinch) return;
      try { cv.setPointerCapture(e.pointerId); } catch (_) {}
      this._down(e);
    });
    window.addEventListener('pointermove', (e) => {
      if (this._touches.has(e.pointerId)) this._touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this._pinch) { if (this._touches.size >= 2) this._movePinch(); return; }
      this._move(e);
    });
    const end = (e) => {
      const mine = this._touches.delete(e.pointerId);
      if (this._pinch) { if (!this._touches.size) this._pinch = null; return; }
      this._up(e);
      if (mine && e.type === 'pointerup' && e.pointerType !== 'mouse') this._tap(e);
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    cv.addEventListener('wheel', (e) => this._wheel(e), { passive: false });
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('dblclick', (e) => {
      if (performance.now() - (this._tapDblAt || 0) < 700) return; // déjà traité par le double-tap
      this._dblclick(e);
    });
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('keydown', (e) => this._key(e));
  }

  // Deux doigts : le geste en cours (déplacement, rectangle) est abandonné
  _startPinch() {
    if (this.dragging) {
      const base = this.dragging.snapshot;
      for (const c of this.components) if (base[c.id]) { c.x = base[c.id].x; c.y = base[c.id].y; }
      for (const w of this.wires) if (base[w.id]) w.points = base[w.id].map((p) => ({ ...p }));
      this.dragging = null;
    }
    this.marquee = null; this.panning = null;
    const [a, b] = [...this._touches.values()];
    const r = this.canvas.getBoundingClientRect();
    const mid = { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top };
    this._pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, scale0: this.view.scale, world: this.screenToWorld(mid.x, mid.y) };
    this.render();
  }
  _movePinch() {
    const [a, b] = [...this._touches.values()];
    const r = this.canvas.getBoundingClientRect();
    const mid = { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top };
    const p = this._pinch;
    this.view.scale = Math.max(0.15, Math.min(8, p.scale0 * Math.hypot(a.x - b.x, a.y - b.y) / p.d0));
    this.view.x = mid.x - p.world.x * this.view.scale;
    this.view.y = mid.y - p.world.y * this.view.scale;
    this.render(); this._emit();
  }
  // Double-tap au doigt (le navigateur n'émet pas toujours dblclick en tactile)
  _tap(e) {
    const now = performance.now(), last = this._lastTap;
    this._lastTap = { t: now, x: e.clientX, y: e.clientY };
    if (last && now - last.t < 320 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 30) {
      this._lastTap = null;
      this._tapDblAt = now;
      this._dblclick(e);
    }
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

    if (this.tool === 'measure') { // règle : glisser d'un point à l'autre (grille ou bornes)
      const a = this.snapForWire(w.x, w.y);
      this.measure = { a: { x: a.x, y: a.y }, b: { x: a.x, y: a.y }, live: true };
      this.render();
      return;
    }
    if (this.tool === 'ul-move' && this.underlay) {
      this.ulDrag = { sx: w.x, sy: w.y, x0: this.underlay.x, y0: this.underlay.y };
      return;
    }
    if (this.tool === 'ul-calib' && this.underlay) {
      this.ulCalib = (this.ulCalib || []).concat([{ x: w.x, y: w.y }]);
      if (this.ulCalib.length === 2) {
        const [a, b] = this.ulCalib;
        this.ulCalib = null;
        if (this.onCalibrate && Math.hypot(b.x - a.x, b.y - a.y) > 2) this.onCalibrate(a, b);
      }
      this.render();
      return;
    }

    if (this.tool === 'place' && this.placeType) {
      this.addComponent(this.placeType, w.x, w.y);
      return;
    }

    if (this.tool === 'wire' || this.tool === 'wall' || this.tool === 'conduit') {
      const sp = this.snapForWire(w.x, w.y);
      if (!this.wireDraft) {
        this.wireDraft = { points: [{ x: sp.x, y: sp.y }] };
      } else {
        const last = this.wireDraft.points[this.wireDraft.points.length - 1];
        const route = this.wireRoute(last, { x: sp.x, y: sp.y });
        for (let i = 1; i < route.length; i++) this.wireDraft.points.push(route[i]);
        if (sp.onTerm && this.tool === 'wire') this._finishWire();
        // mur : revenir au point de départ ferme le contour
        const p0 = this.wireDraft && this.wireDraft.points[0];
        if (this.tool === 'wall' && p0 && this.wireDraft.points.length >= 4 && Math.hypot(sp.x - p0.x, sp.y - p0.y) < 1) this._finishWire();
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
    if (this.ulDrag && this.underlay) {
      this.underlay.x = this.ulDrag.x0 + (w.x - this.ulDrag.sx);
      this.underlay.y = this.ulDrag.y0 + (w.y - this.ulDrag.sy);
      this.render();
      return;
    }
    if (this.tool === 'ul-calib') this.render();
    if (this.measure && this.measure.live) {
      const b = e.shiftKey ? { x: w.x, y: w.y } : this.snapForWire(w.x, w.y); // Maj : sans aimantation
      this.measure.b = { x: b.x, y: b.y };
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

    // Surbrillance au survol (outil sélection)
    if (this.tool === 'select') {
      const h = this.hitComponent(w.x, w.y) || this.hitWire(w.x, w.y);
      const id = h ? h.id : null;
      if (id !== this.hoverId) {
        this.hoverId = id;
        this.canvas.style.cursor = id ? 'pointer' : 'default';
        this.render();
      }
    } else if (this.hoverId) {
      this.hoverId = null;
    }

    if (this.tool === 'wire' || this.tool === 'wall' || this.tool === 'conduit' || this.tool === 'place') this.render();
    this._emit();
  }

  _up(e) {
    if (this.panning) { this.panning = null; return; }
    if (this.ulDrag) { this.ulDrag = null; this.saveUnderlay(); return; }
    if (this.measure && this.measure.live) { this.measure.live = false; this.render(); this._emit(); return; }
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
    // double-clic (ou double-tap) : termine le fil, le mur ou la goulotte en cours
    if (this.tool === 'wire' || this.tool === 'wall' || this.tool === 'conduit') { this._finishWire(); return; }
    // Double-clic sur un interrupteur : bascule ouvert/fermé
    const s = this._evtPos(e);
    const w = this.screenToWorld(s.x, s.y);
    const c = this.hitComponent(w.x, w.y);
    if (c && SWITCHABLE.has(c.type)) {
      c.closed = !c.closed;
      this.pushHistory(); this.render(); this._emit();
    } else if (c && c.type === 'logic_in') {
      c.high = !c.high;
      this.pushHistory(); this.render(); this._emit();
    } else if (c && APPLIANCES.has(c.type)) {
      c.on = !c.on; // état de fonctionnement : pas une modification du plan
      this.autosave(); this.render(); this._emit();
    }
  }

  toggleSelectedSwitch() {
    let changed = false;
    for (const id of this.selection) {
      const c = this.components.find((x) => x.id === id);
      if (c && SWITCHABLE.has(c.type)) { c.closed = !c.closed; changed = true; }
    }
    if (changed) { this.pushHistory(); this.render(); this._emit(); }
  }

  _finishWire() {
    // points confondus (le double-clic en ajoute) retirés
    if (this.wireDraft) this.wireDraft.points = this.wireDraft.points.filter((p, i, a) => !i || Math.hypot(p.x - a[i - 1].x, p.y - a[i - 1].y) > 0.5);
    if (this.wireDraft && this.wireDraft.points.length >= 2) {
      const w = { id: this.uid(), points: this.wireDraft.points };
      if (this.tool === 'wall') w.kind = 'wall';
      else if (this.tool === 'conduit') w.kind = 'conduit';
      this.wires.push(w);
      this.wireDraft = null;
      this.pushHistory();
    } else {
      this.wireDraft = null;
    }
    this.render();
  }

  _key(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (document.body.classList.contains('modal-open')) return;
    if (e.key === ' ') { this._space = true; this.canvas.style.cursor = 'grab'; }
    if (e.key === 'Enter' && this.wireDraft) { e.preventDefault(); this._finishWire(); return; }
    if (!e.ctrlKey && !e.metaKey && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 'v') this.setTool('select');
      if (k === 'w') this.setTool('wire');
      if (k === 'h') this.setTool('pan');
      if (k === 'm') this.setTool('wall');
      if (k === 'g') this.setTool('conduit');
      if (k === 'l') this.setTool('measure');
      if (e.key === '+' || e.key === '=') this.zoomBy(1.2);
      if (e.key === '-') this.zoomBy(1 / 1.2);
      if (e.key === '0') this.zoomFit();
    }
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
    if (e.key === 'Shift' && (this.tool === 'wire' || this.tool === 'wall' || this.tool === 'conduit')) { this.wireVertFirst = true; this.render(); }
  }

  setTheme(name) {
    this.colors = CANVAS_THEMES[name] || CANVAS_THEMES.dark;
    this.render();
  }

  setTool(tool, placeType = null) {
    this.tool = tool;
    this.placeType = placeType;
    this.wireDraft = null;
    if (tool !== 'select') this.selection.clear();
    const cursors = { select: 'default', wire: 'crosshair', wall: 'crosshair', conduit: 'crosshair', pan: 'grab', place: 'copy', 'ul-move': 'move', 'ul-calib': 'crosshair', measure: 'crosshair' };
    if (tool !== 'measure') this.measure = null;
    this.ulCalib = null;
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
    ctx.fillStyle = this.colors.bg;
    ctx.fillRect(0, 0, W, H);

    if (this.showGrid) this._drawGrid(W, H);

    // Repère monde
    ctx.translate(this.view.x, this.view.y);
    ctx.scale(this.view.scale, this.view.scale);
    const lw = 2 / this.view.scale;

    // Calque : plan importé à décalquer, sous tout le reste
    const ul = this.underlay;
    if (ul && ul.img && ul.img.complete && ul.img.naturalWidth) {
      ctx.globalAlpha = ul.opacity;
      ctx.drawImage(ul.img, ul.x, ul.y, ul.img.naturalWidth * ul.scale, ul.img.naturalHeight * ul.scale);
      ctx.globalAlpha = 1;
    }

    // Plan de maison : sol de chaque pièce teinté selon son type
    const plan = this._planInfo();
    if (plan) this._drawRoomFills(plan);
    if (plan) this._drawWetZones();

    // Fils
    for (const w of this.wires) this._drawWire(w, this.selection.has(w.id), lw);

    // Composants
    for (const c of this.components) this._drawComponent(c, this.selection.has(c.id), lw);

    // Cotations des murs (masquées quand on dézoome trop pour les lire)
    if (plan && this.view.scale > 0.35) this._drawDims();

    // Points de jonction
    this._drawJunctions(lw);

    // Règle : segment mesuré, longueur et écarts en x / y
    if (this.measure) this._drawMeasure(this.measure);

    // Mise à l'échelle du calque : points cliqués et segment en cours
    if (this.tool === 'ul-calib' && this.ulCalib) {
      const pts = this.ulCalib.slice();
      if (pts.length === 1 && this.mouse) pts.push({ x: this.mouse.wx, y: this.mouse.wy });
      ctx.strokeStyle = '#ff6b3d'; ctx.fillStyle = '#ff6b3d'; ctx.lineWidth = 2 / this.view.scale;
      if (pts.length === 2) { ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); ctx.lineTo(pts[1].x, pts[1].y); ctx.stroke(); }
      for (const q of this.ulCalib) circle(ctx, q.x, q.y, 5 / this.view.scale, true);
    }

    // Mode fil : matérialise toutes les bornes connectables
    if (this.tool === 'wire' || this.tool === 'conduit') {
      ctx.strokeStyle = this.colors.draft;
      ctx.lineWidth = 1 / this.view.scale;
      ctx.globalAlpha = 0.55;
      for (const c of this.components)
        for (const t of this.termsOf(c)) circle(ctx, t.x, t.y, 4.5 / this.view.scale);
      ctx.globalAlpha = 1;
    }

    // Superposition de simulation
    if (this.simMode && this.simFlows) this._drawFlows(lw);
    if (this.simMode && this.simResult && this.simResult.ok) this._drawSim(lw);

    // Fil en cours
    if (this.wireDraft) {
      const pts = [...this.wireDraft.points];
      const sp = this.snapForWire(this.mouse.wx, this.mouse.wy);
      const last = pts[pts.length - 1];
      const route = this.wireRoute(last, { x: sp.x, y: sp.y });
      const preview = [...pts, ...route.slice(1)];
      ctx.strokeStyle = this.colors.draft; ctx.lineWidth = lw; ctx.setLineDash([6 / this.view.scale, 4 / this.view.scale]);
      ctx.beginPath();
      ctx.moveTo(preview[0].x, preview[0].y);
      for (let i = 1; i < preview.length; i++) ctx.lineTo(preview[i].x, preview[i].y);
      ctx.stroke();
      ctx.setLineDash([]);
      // marqueur d'accroche
      ctx.fillStyle = sp.onTerm ? this.colors.snap : this.colors.draft;
      circle(ctx, sp.x, sp.y, 4 / this.view.scale, true);
      // longueur du mur en cours de tracé
      if (this.tool === 'wall' && typeof fmtMeters === 'function') {
        let len = 0;
        for (let i = 1; i < route.length; i++) len += Math.hypot(route[i].x - route[i - 1].x, route[i].y - route[i - 1].y);
        if (len > 0) {
          const fs = 12 / this.view.scale;
          ctx.font = `600 ${fs}px sans-serif`;
          ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
          ctx.lineWidth = 3 / this.view.scale; ctx.strokeStyle = this.colors.bg;
          const tx = sp.x + 10 / this.view.scale, ty = sp.y - 8 / this.view.scale;
          ctx.strokeText(fmtMeters(len), tx, ty);
          ctx.fillStyle = this.colors.draft;
          ctx.fillText(fmtMeters(len), tx, ty);
        }
      }
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
      ctx.strokeStyle = this.colors.sel; ctx.fillStyle = this.colors.selFill;
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
    ctx.strokeStyle = this.colors.grid; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = ox; x < W; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let y = oy; y < H; y += step) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();
    // gros points tous les 5 pas
    const big = step * 5;
    const bx = this.view.x % big, by = this.view.y % big;
    ctx.fillStyle = this.colors.gridDot;
    for (let x = bx; x < W; x += big)
      for (let y = by; y < H; y += big) { ctx.fillRect(x - 1, y - 1, 2, 2); }
  }

  _drawWire(w, selected, lw) {
    const ctx = this.ctx;
    const hovered = this.hoverId === w.id && !selected;
    const col = selected ? this.colors.sel : hovered ? this.colors.hover : this.colors.wire;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const path = () => {
      ctx.beginPath();
      ctx.moveTo(w.points[0].x, w.points[0].y);
      for (let i = 1; i < w.points.length; i++) ctx.lineTo(w.points[i].x, w.points[i].y);
      ctx.stroke();
    };
    if (w.kind === 'wall') {
      // Mur : trait épais plein, repères du matériau (montants de placo, hachures de maçonnerie)
      ctx.strokeStyle = selected || hovered ? col : this.colors.comp;
      ctx.lineWidth = 9;
      path();
      if (this.view.scale > 0.45 && typeof wallMarks === 'function') {
        ctx.save(); ctx.strokeStyle = this.colors.bg; ctx.lineWidth = 1.1; ctx.lineCap = 'butt'; ctx.globalAlpha = 0.8;
        ctx.beginPath();
        for (const [x1, y1, x2, y2] of wallMarks(w)) { ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); }
        ctx.stroke(); ctx.restore();
      }
    } else if (w.kind === 'conduit' && w.riser) {
      // Montée d'étage : relie les deux plans (tirets) ; sa longueur réelle est la hauteur d'étage
      ctx.strokeStyle = selected || hovered ? col : this.colors.label;
      ctx.lineWidth = 2;
      ctx.setLineDash([12, 9]);
      path();
      ctx.setLineDash([]);
      const m = riserLabelAt(w, this.wires);
      ctx.font = '600 20px sans-serif';
      ctx.fillStyle = selected || hovered ? col : this.colors.label;
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText(`montée ${fmtMeters(w.len || 300)}`, m.x, m.y - 8);
    } else if (w.kind === 'conduit') {
      // Goulotte / chemin de câbles : double ligne (tube creux)
      ctx.strokeStyle = selected || hovered ? col : this.colors.label;
      ctx.lineWidth = 8;
      path();
      ctx.strokeStyle = this.colors.bg;
      ctx.lineWidth = 4.5;
      path();
    } else {
      ctx.strokeStyle = col;
      ctx.lineWidth = selected || hovered ? lw * 1.4 : lw;
      path();
    }
  }

  // Longueur d'une mesure en mètres (et ses composantes)
  measureLength(m) {
    const dx = (m.b.x - m.a.x) / PLAN_UNITS_PER_M, dy = (m.b.y - m.a.y) / PLAN_UNITS_PER_M;
    return { d: Math.hypot(dx, dy), dx: Math.abs(dx), dy: Math.abs(dy) };
  }
  _drawMeasure(m) {
    const ctx = this.ctx, k = 1 / this.view.scale, L = this.measureLength(m);
    const col = '#ffb020';
    ctx.save();
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 2 * k;
    ctx.setLineDash([8 * k, 5 * k]);
    ctx.beginPath(); ctx.moveTo(m.a.x, m.a.y); ctx.lineTo(m.b.x, m.b.y); ctx.stroke();
    ctx.setLineDash([]);
    for (const p of [m.a, m.b]) circle(ctx, p.x, p.y, 4 * k, true);
    if (L.d > 0) {
      const f = (v) => v.toFixed(2).replace('.', ',') + ' m';
      const txt = f(L.d) + (L.dx > 0.005 && L.dy > 0.005 ? `  (${f(L.dx)} × ${f(L.dy)})` : '');
      ctx.font = `600 ${13 * k}px sans-serif`;
      const mt = ctx.measureText && ctx.measureText(txt), tw = mt && mt.width ? mt.width : txt.length * 7 * k;
      const mx = (m.a.x + m.b.x) / 2, my = (m.a.y + m.b.y) / 2 - 14 * k;
      ctx.fillStyle = 'rgba(20, 24, 31, 0.85)';
      ctx.fillRect(mx - tw / 2 - 6 * k, my - 11 * k, tw + 12 * k, 20 * k);
      ctx.fillStyle = col; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(txt, mx, my);
    }
    ctx.restore();
  }

  _drawJunctions(lw) {
    const ctx = this.ctx;
    const dots = computeJunctions(this.components, this.wires, SYMBOLS);
    ctx.fillStyle = this.colors.junction;
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
      this._badge(fmtVolt(v), p.x, p.y - 14, this.colors.badgeVbg, this.colors.badgeV);
    }
    // Courants des composants
    for (const c of this.components) {
      const i = r.compI[c.id];
      if (i === undefined) continue;
      this._badge(fmtAmp(i), c.x, c.y + SYMBOLS[c.type].bbox.h / 2 + 14, this.colors.badgeIbg, this.colors.badgeI);
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

  // Pièces détectées (null s'il n'y a pas de murs) ; reporte la surface
  // calculée sur les étiquettes pour qu'elles l'affichent.
  _planInfo() {
    const hasWalls = typeof computeRooms === 'function' && this.wires.some((w) => w.kind === 'wall');
    const info = hasWalls ? computeRooms(this.components, this.wires) : null;
    for (const c of this.components) {
      if (c.type !== 'room') continue;
      const r = info && info.rooms.find((x) => x.id === c.id);
      c.__area = r ? r.area : null;
      c.__leak = r ? r.leaked : false;
    }
    return info;
  }

  _drawRoomFills(info) {
    const ctx = this.ctx;
    const alpha = this.colors === CANVAS_THEMES.light ? 0.13 : 0.1;
    info.rooms.forEach((room, i) => {
      if (room.leaked || room.sharedWith !== null) return;
      ctx.beginPath();
      for (const r of roomRuns(info, i)) ctx.rect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = room.color;
      ctx.globalAlpha = alpha;
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  // Volumes 1 et 2 des douches et baignoires : aucune prise ni commande en volume 2
  _drawWetZones() {
    const zones = typeof wetZones === 'function' ? wetZones(this.components, this.wires) : [];
    if (!zones.length) return;
    const ctx = this.ctx, k = 1 / this.view.scale;
    ctx.save();
    for (const z of zones) {
      ctx.fillStyle = '#3b8fd9'; ctx.globalAlpha = 0.16;
      ctx.beginPath();
      for (const r of z.v2) ctx.rect(r.x, r.y, r.w, r.h);
      ctx.fill();
      ctx.globalAlpha = 0.22; ctx.fillStyle = '#1f6fd1';
      ctx.beginPath(); z.v1.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); ctx.fill();
      if (this.view.scale > 0.45 && z.v2.length) {
        ctx.globalAlpha = 0.9; ctx.fillStyle = '#6fb1ff';
        ctx.font = `600 ${11 * k}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        // « V2 » au milieu de la plus longue bande, « V1 » dans un coin de l'emprise
        const big = z.v2.reduce((a, r) => (r.w > a.w ? r : a), z.v2[0]);
        ctx.fillText('V2', big.x + big.w / 2, big.y + big.h / 2);
        const cx = z.v1.reduce((t, p) => t + p.x, 0) / 4, cy = z.v1.reduce((t, p) => t + p.y, 0) / 4;
        ctx.fillText('V1', (z.v1[0].x * 3 + cx) / 4, (z.v1[0].y * 3 + cy) / 4);
      }
    }
    ctx.restore();
  }

  _drawDims() {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 3; ctx.lineJoin = 'round';
    ctx.strokeStyle = this.colors.bg; ctx.fillStyle = this.colors.label;
    for (const d of wallDimensions(this.wires)) {
      ctx.save();
      ctx.translate(d.x, d.y); ctx.rotate(d.angle);
      ctx.strokeText(d.text, 0, 0);
      ctx.fillText(d.text, 0, 0);
      ctx.restore();
    }
    ctx.restore();
  }

  _drawComponent(c, selected, lw) {
    const ctx = this.ctx;
    const sym = SYMBOLS[c.type];
    if (!sym) return;
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate((c.rot * Math.PI) / 180);

    const hovered = this.hoverId === c.id && !selected;
    const col = selected ? this.colors.sel : hovered ? this.colors.hover : this.colors.comp;
    // Installation simulée : halo des lampes allumées, circuit survolé
    const st = this.planState;
    if (st && st.lit.has(c.id)) {
      const g = ctx.createRadialGradient(0, 0, 4, 0, 0, 90);
      g.addColorStop(0, 'rgba(255, 214, 110, 0.55)');
      g.addColorStop(1, 'rgba(255, 214, 110, 0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, 90, 0, Math.PI * 2); ctx.fill();
    }
    if (this.highlight && this.highlight.has(c.id)) {
      ctx.fillStyle = this.colors.selFill;
      ctx.strokeStyle = this.colors.sel;
      ctx.lineWidth = 2 / this.view.scale;
      ctx.beginPath(); ctx.arc(0, 0, 22, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    ctx.strokeStyle = col;
    ctx.fillStyle = col;
    ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    sym.draw(ctx, c);
    if (st && st.on.has(c.id) && !st.lit.has(c.id)) {
      const b = sym.bbox;
      ctx.fillStyle = '#34c471';
      ctx.beginPath(); ctx.arc(b.x + b.w - 3, b.y + 3, 4.5, 0, Math.PI * 2); ctx.fill();
    }

    // terminaux
    ctx.fillStyle = this.colors.term;
    for (const t of sym.terminals) circle(ctx, t.x, t.y, 2 / this.view.scale + 1, true);

    ctx.restore();

    // étiquette (redressée, hors rotation) — sauf symboles qui dessinent la leur.
    // Sur un plan de maison, l'appareillage est dense : ses repères n'apparaissent
    // qu'en zoomant, au survol ou à la sélection.
    const quiet = sym.plan && !selected && this.hoverId !== c.id && this.view.scale < 1.6;
    if ((c.label || c.value || c.h) && !sym.ownLabel && !quiet) {
      ctx.save();
      ctx.fillStyle = selected ? this.colors.labelSel : this.colors.label;
      ctx.font = `${11}px sans-serif`;
      const txt = labelText(c);
      const la = labelAnchor(c, SYMBOLS[c.type]);
      ctx.textAlign = la.align;
      ctx.fillText(txt, la.x, la.y);
      ctx.restore();
    }
    // repère du circuit (plan d'implantation), lisible à tous les zooms
    const tag = this.showTags && this.circuitTags && this.circuitTags[c.id];
    if (tag && typeof drawCircuitTag === 'function') drawCircuitTag(ctx, c, tag, Math.max(1, 0.9 / this.view.scale));

    // poignée de sélection
    if (selected) {
      ctx.save();
      ctx.strokeStyle = this.colors.selSoft;
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
    const ul = this.underlay && this.underlay.img && this.underlay.img.naturalWidth ? this.underlay : null;
    if (!this.components.length && !this.wires.length && !ul) {
      this.view = { x: this._cssW / 2, y: this._cssH / 2, scale: 1 };
      this.render(); this._emit(); return;
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const acc = (x, y) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };
    if (ul) { acc(ul.x, ul.y); acc(ul.x + ul.img.naturalWidth * ul.scale, ul.y + ul.img.naturalHeight * ul.scale); } // le calque compte
    for (const c of this.components) {
      const b = SYMBOLS[c.type].bbox;
      acc(c.x + b.x, c.y + b.y); acc(c.x + b.x + b.w, c.y + b.y + b.h);
    }
    for (const w of this.wires) for (const p of w.points) acc(p.x, p.y);
    const pad = 90;
    const w = maxX - minX || 100, h = maxY - minY || 100;
    const scale = Math.min((this._cssW - pad) / w, (this._cssH - pad) / h, 1.6);
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
    // Répartition du courant dans les fils -> animation de flux
    this.simFlows = this.simResult.ok
      ? computeWireFlows(this.components, this.wires, SYMBOLS, this.simResult)
      : null;
    this._startFlowLoop();
    this.render(); this._emit();
    return this.simResult;
  }
  clearSim() {
    this.simMode = false; this.simResult = null; this.simFlows = null;
    this.render(); this._emit();
  }

  _startFlowLoop() {
    if (typeof requestAnimationFrame === 'undefined') return;
    if (this._flowRaf) return;
    const loop = () => {
      if (!this.simMode || !this.simFlows) { this._flowRaf = null; return; }
      this.render();
      this._flowRaf = requestAnimationFrame(loop);
    };
    this._flowRaf = requestAnimationFrame(loop);
  }

  // Points lumineux qui circulent le long des fils (sens et vitesse ∝ courant)
  _drawFlows(lw) {
    const ctx = this.ctx;
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
    ctx.fillStyle = '#ffcf6a';
    for (const e of this.simFlows) {
      const I = e.I;
      if (Math.abs(I) < 1e-6) continue; // masque le bruit numérique (gmin)
      const ax = I > 0 ? e.a.x : e.b.x, ay = I > 0 ? e.a.y : e.b.y;
      const bx = I > 0 ? e.b.x : e.a.x, by = I > 0 ? e.b.y : e.a.y;
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 4) continue;
      const speed = 26 + 90 * Math.min(1, Math.abs(I) / 0.05);
      const spacing = 30;
      const off = (now * speed) % spacing;
      for (let d = off; d <= len; d += spacing) {
        const t = d / len;
        ctx.beginPath();
        ctx.arc(ax + (bx - ax) * t, ay + (by - ay) * t, lw * 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // --- Export SVG / impression -------------------------------------------
  exportSVG() {
    const date = new Date().toISOString().slice(0, 10);
    return buildSVG(this.components, this.wires, SYMBOLS, { ...this.meta, date });
  }
  print(svgIn) {
    const svg = svgIn || this.exportSVG();
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head><title>${this.meta.title || 'Schéma'}</title>` +
      `<style>body{margin:0;display:flex;justify-content:center;padding:20px}svg{max-width:100%;height:auto}</style></head>` +
      `<body onload="window.print()">${svg}</body></html>`);
    win.document.close();
  }

  // --- Sauvegarde automatique (localStorage) -----------------------------
  // --- Calque : plan importé à décalquer ------------------------------------
  // Hors historique et hors fichier : il est gardé à part dans le navigateur.
  setUnderlay(src, place) {
    const img = new Image();
    return new Promise((resolve) => {
      img.onload = () => {
        let { x, y, scale } = place || {};
        if (scale === undefined) { // pleine vue, centré
          const r = this.canvas.getBoundingClientRect();
          const a = this.screenToWorld(0, 0), b = this.screenToWorld(r.width, r.height);
          scale = Math.min((b.x - a.x) * 0.85 / img.naturalWidth, (b.y - a.y) * 0.85 / img.naturalHeight);
          x = (a.x + b.x) / 2 - (img.naturalWidth * scale) / 2;
          y = (a.y + b.y) / 2 - (img.naturalHeight * scale) / 2;
        }
        this.underlay = { src, img, x, y, scale, opacity: (place && place.opacity) || 0.5 };
        this.render(); this._emit();
        resolve(this.saveUnderlay());
      };
      img.onerror = () => resolve(false);
      img.src = src;
    });
  }
  clearUnderlay() {
    this.underlay = null;
    try { localStorage.removeItem('electricad-underlay'); } catch (_) {}
    if (this.tool === 'ul-move' || this.tool === 'ul-calib') this.setTool('select');
    this.render(); this._emit();
  }
  // Deux points du calque et leur distance réelle (m) : le point a reste fixe
  calibrateUnderlay(a, b, meters) {
    const ul = this.underlay, d = Math.hypot(b.x - a.x, b.y - a.y);
    if (!ul || !(meters > 0) || d < 1) return false;
    const k = (meters * PLAN_UNITS_PER_M) / d;
    ul.scale *= k;
    ul.x = a.x - (a.x - ul.x) * k;
    ul.y = a.y - (a.y - ul.y) * k;
    this.render(); this.saveUnderlay();
    return k;
  }
  saveUnderlay() {
    const ul = this.underlay;
    if (!ul) return false;
    try {
      localStorage.setItem('electricad-underlay', JSON.stringify({ src: ul.src, x: ul.x, y: ul.y, scale: ul.scale, opacity: ul.opacity }));
      return true;
    } catch (_) { return false; } // image trop lourde pour le stockage : elle reste pour la session
  }
  restoreUnderlay() {
    try {
      const s = localStorage.getItem('electricad-underlay');
      if (s) { const u = JSON.parse(s); if (u && u.src) return this.setUnderlay(u.src, u); }
    } catch (_) {}
    return Promise.resolve(false);
  }

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
    const info = this._planInfo();
    const pad = info ? 50 : 30, scale = 2; // marge plus large pour les cotations
    const w = (maxX - minX + pad * 2), h = (maxY - minY + pad * 2);
    const cv = document.createElement('canvas');
    cv.width = w * scale; cv.height = h * scale;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.scale(scale, scale);
    ctx.translate(pad - minX, pad - minY);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // sols des pièces
    if (info) {
      info.rooms.forEach((room, i) => {
        if (room.leaked || room.sharedWith !== null) return;
        ctx.beginPath();
        for (const r of roomRuns(info, i)) ctx.rect(r.x, r.y, r.w, r.h);
        ctx.fillStyle = room.color; ctx.globalAlpha = 0.14; ctx.fill(); ctx.globalAlpha = 1;
      });
    }
    // fils, murs, goulottes
    for (const wi of this.wires) {
      const path = () => {
        ctx.beginPath(); ctx.moveTo(wi.points[0].x, wi.points[0].y);
        for (let i = 1; i < wi.points.length; i++) ctx.lineTo(wi.points[i].x, wi.points[i].y);
        ctx.stroke();
      };
      if (wi.kind === 'wall') { ctx.strokeStyle = '#1f2733'; ctx.lineWidth = 9; path(); }
      else if (wi.kind === 'conduit' && wi.riser) { ctx.strokeStyle = '#6b7788'; ctx.lineWidth = 2; ctx.setLineDash([12, 9]); path(); ctx.setLineDash([]); }
      else if (wi.kind === 'conduit') {
        ctx.strokeStyle = '#6b7788'; ctx.lineWidth = 8; path();
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 4.5; path();
      } else { ctx.strokeStyle = '#111'; ctx.lineWidth = 2; path(); }
    }
    // composants
    for (const c of this.components) {
      const sym = SYMBOLS[c.type];
      ctx.save(); ctx.translate(c.x, c.y); ctx.rotate((c.rot * Math.PI) / 180);
      ctx.strokeStyle = '#111'; ctx.fillStyle = '#111'; ctx.lineWidth = 2;
      sym.draw(ctx, c); ctx.restore();
      if ((c.label || c.value || c.h) && !sym.ownLabel) {
        const la = labelAnchor(c, sym);
        ctx.fillStyle = '#333'; ctx.font = '11px sans-serif'; ctx.textAlign = la.align; ctx.textBaseline = 'alphabetic';
        ctx.fillText(labelText(c), la.x, la.y);
      }
    }
    // cotations
    if (info) {
      ctx.font = '11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#444';
      for (const d of wallDimensions(this.wires)) {
        ctx.save(); ctx.translate(d.x, d.y); ctx.rotate(d.angle); ctx.fillText(d.text, 0, 0); ctx.restore();
      }
    }
    return cv.toDataURL('image/png');
  }

  _emit() { if (this.onChange) this.onChange(); }
}
