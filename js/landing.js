/*
 * landing.js — Site vitrine : démonstration vivante (maison générée, 3D,
 * plan, tableau), plan annoté, contrôle NF C 15-100, banc d'essai d'un
 * disjoncteur, catalogue de schémas, applications à télécharger.
 */

const $ = (id) => document.getElementById(id);
const nf = (v, d = 0) => Number(v).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// ---------------------------------------------------------------------------
// Maisons types : générées dans un worker (le solveur de mobilier est lent),
// puis analysées (pièces, tableau, contrôle NF C 15-100). Résultats en cache.
// ---------------------------------------------------------------------------
const HouseStore = (() => {
  const cache = new Map();
  const pending = new Map();
  let worker = null, seq = 0;
  const direct = (key) => new Promise((resolve) => setTimeout(() => resolve(buildHouse(key)), 20));
  function viaWorker(key) {
    if (!worker) {
      worker = new Worker('js/house-worker.js');
      worker.onmessage = (e) => {
        const p = pending.get(e.data.id);
        if (!p) return;
        pending.delete(e.data.id);
        if (e.data.error) p.reject(new Error(e.data.error)); else p.resolve(e.data.doc);
      };
      worker.onerror = (e) => {
        e.preventDefault();
        worker = false; // fichier local, CSP… : on génère sur le fil principal
        for (const p of pending.values()) p.reject(new Error('worker'));
        pending.clear();
      };
    }
    return new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, key });
    });
  }
  function analyse(doc) {
    const info = computeRooms(doc.components, doc.wires);
    const design = designInstallation(doc.components, doc.wires);
    const rep = checkNFC15100(doc.components, doc.wires);
    const area = rep.rooms.reduce((s, r) => s + (r.area || 0), 0);
    return { doc, info, design, rep, area };
  }
  function get(key) {
    if (!cache.has(key)) {
      let p;
      if (worker === false || typeof Worker === 'undefined') p = direct(key);
      else {
        try { p = viaWorker(key).catch(() => direct(key)); } catch (e) { worker = false; p = direct(key); }
      }
      cache.set(key, p.then(analyse));
    }
    return cache.get(key);
  }
  return { get };
})();

// Scénario d'éclairage selon l'heure : le soir, séjour, cuisine, circulations,
// une chambre et le bureau sont allumés ; plaque et télévision en marche.
function applyScene(h, doc, info) {
  const evening = h < 7.5 || h >= 17.5;
  const litKeys = new Set(['sejour', 'cuisine', 'circ', 'bureau']);
  const seen = new Set();
  let bedroom = false;
  for (const c of doc.components) {
    if (c.type !== 'switch_sa' && c.type !== 'switch_vv_wall') continue;
    const i = c.ctrl ? info.rooms.findIndex((r) => r.id === c.ctrl) : roomAt(info, c.x, c.y);
    const room = info.rooms[i];
    const key = room && room.type ? room.type.key : '';
    let want = evening && litKeys.has(key);
    if (evening && key === 'chambre' && (!bedroom || seen.has(i))) { want = true; bedroom = true; }
    c.closed = want && !seen.has(i);
    seen.add(i);
  }
  for (const c of doc.components) {
    if (c.type === 'cooktop') c.on = h >= 18.5 && h < 20.5;
    if (c.type === 'tv_unit') c.on = h >= 17.5 && h < 23.5;
  }
  return evening ? (h >= 18.5 && h < 20.5 ? 'soir-cuisine' : 'soir') : 'jour';
}

function simSnapshot(H) {
  if (!H.design.ok) return null;
  const sim = new InstallSim();
  sim.setDesign(H.design);
  return { snap: sim.step(0.1, H.doc.components, H.doc.wires), design: H.design, sim };
}

// ---------------------------------------------------------------------------
// Plan 2D (mêmes symboles que l'éditeur), avec la transformation plan → écran
// ---------------------------------------------------------------------------
function planBounds(data) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const acc = (x, y) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };
  for (const c of data.components) { const b = SYMBOLS[c.type].bbox; acc(c.x + b.x, c.y + b.y); acc(c.x + b.x + b.w, c.y + b.y + b.h); }
  for (const w of data.wires) for (const p of w.points) acc(p.x, p.y);
  return { minX, minY, maxX, maxY };
}

function drawPlan(cv, data, opt) {
  opt = Object.assign({ padX: 16, padY: 16, ink: '#17202c', bg: null, conduit: '#1d5dbd', fill: 0.14, lit: null }, opt);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = cv.clientWidth || 600, H = cv.clientHeight || 400;
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (opt.bg) { ctx.fillStyle = opt.bg; ctx.fillRect(0, 0, W, H); }
  const b = planBounds(data);
  const s = Math.min((W - 2 * opt.padX) / (b.maxX - b.minX), (H - 2 * opt.padY) / (b.maxY - b.minY));
  const ox = W / 2 - ((b.minX + b.maxX) / 2) * s, oy = H / 2 - ((b.minY + b.maxY) / 2) * s;
  ctx.translate(ox, oy);
  ctx.scale(s, s);
  if (data.wires.some((w) => w.kind === 'wall')) {
    const info = computeRooms(data.components, data.wires);
    info.rooms.forEach((room, i) => {
      if (room.leaked || room.sharedWith !== null) return;
      ctx.beginPath();
      for (const r of roomRuns(info, i)) ctx.rect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = room.color; ctx.globalAlpha = opt.fill; ctx.fill(); ctx.globalAlpha = 1;
      const lab = data.components.find((c) => c.id === room.id);
      if (lab) lab.__area = room.area;
    });
  }
  // halos des lampes allumées
  if (opt.lit) {
    for (const c of data.components) {
      if (!opt.lit.has(c.id)) continue;
      const g = ctx.createRadialGradient(c.x, c.y, 4, c.x, c.y, 110);
      g.addColorStop(0, 'rgba(255, 207, 80, 0.5)'); g.addColorStop(1, 'rgba(255, 207, 80, 0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c.x, c.y, 110, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const w of data.wires) {
    const wall = w.kind === 'wall', cond = w.kind === 'conduit';
    ctx.strokeStyle = cond ? opt.conduit : opt.ink;
    ctx.lineWidth = wall ? 8 : cond ? 3 : 1.4 / s;
    ctx.globalAlpha = cond ? 0.55 : 1;
    ctx.setLineDash(cond ? [10, 6] : []);
    ctx.beginPath();
    w.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();
  }
  ctx.globalAlpha = 1; ctx.setLineDash([]);
  ctx.strokeStyle = opt.ink; ctx.fillStyle = opt.ink; ctx.lineWidth = Math.max(1.1 / s, 1.6);
  for (const c of data.components) {
    ctx.save(); ctx.translate(c.x, c.y); ctx.rotate((c.rot * Math.PI) / 180);
    SYMBOLS[c.type].draw(ctx, c); ctx.restore();
  }
  return { s, ox, oy, W, H, b };
}

// Vignette d'un schéma d'électronique (tracés clairs sur fond sombre)
function drawSchematic(cv, data) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = cv.clientWidth || 400, H = cv.clientHeight || 300;
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const b = planBounds(data);
  const s = Math.min((W - 48) / (b.maxX - b.minX), (H - 40) / (b.maxY - b.minY), 1.1);
  ctx.translate(W / 2 - ((b.minX + b.maxX) / 2) * s, H / 2 - ((b.minY + b.maxY) / 2) * s);
  ctx.scale(s, s);
  ctx.strokeStyle = '#c9d3e3'; ctx.fillStyle = '#c9d3e3';
  ctx.lineWidth = 1.8 / s; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const w of data.wires) {
    ctx.beginPath();
    w.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();
  }
  for (const j of computeJunctions(data.components, data.wires, SYMBOLS)) {
    ctx.beginPath(); ctx.arc(j.x, j.y, 3.2 / s, 0, Math.PI * 2); ctx.fill();
  }
  for (const c of data.components) {
    ctx.save(); ctx.translate(c.x, c.y); ctx.rotate((c.rot * Math.PI) / 180);
    SYMBOLS[c.type].draw(ctx, c); ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// Tableau électrique (modules sur rail DIN)
// ---------------------------------------------------------------------------
const KIND_LABEL = { light: 'Éclairage', socket: 'Prises', heating: 'Chauffage', dedicated: 'Circuit spécialisé' };
function esc(s) { return String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])); }

function boardHTML(design) {
  if (!design.ok) return '<p>Aucun tableau.</p>';
  const mod = (cls, id, lever, rating, kind, title) =>
    `<div class="mod ${cls}" ${kind ? `data-k="${kind}"` : ''} title="${esc(title)}"><span class="m-id">${esc(id)}</span><span class="m-lever"></span><span class="m-in">${esc(rating)}</span><span class="m-k"></span></div>`;
  let h = `<div class="board-agcp">${mod('w2 agcp', 'AGCP', true, design.agcp.setting + ' A', '', 'Disjoncteur de branchement')}
    <p><b>Disjoncteur de branchement</b><br>${design.agcp.setting} A · 500 mA · abonnement ${design.agcp.kva} kVA</p></div>`;
  for (const r of design.rcds) {
    const cs = design.circuits.filter((c) => c.rcd === r.id);
    if (!cs.length) continue;
    h += '<div class="rail">' + mod('w2', r.id, true, `${r.In} A ${r.type}`, '', `Interrupteur différentiel ${r.In} A 30 mA type ${r.type}`);
    for (const c of cs) h += mod('', c.id, true, c.In + ' A', c.kind, `${c.id} ${c.name} — ${c.In} A, ${nf(c.S, c.S % 1 ? 1 : 0)} mm², ${nf(c.length, 1)} m`);
    h += '</div>';
  }
  h += '<p class="board-legend">' + Object.entries(KIND_LABEL).map(([k, l]) => `<span style="--k:${{ light: '#e0b515', socket: '#1d5dbd', heating: '#d4622a', dedicated: '#2e8a3b' }[k]}"><i></i>${l}</span>`).join('') + '</p>';
  return h;
}

// ---------------------------------------------------------------------------
// Démonstration du héros
// ---------------------------------------------------------------------------
const HOUSE_CHIPS = [
  ['studio', 'Studio'], ['t2', 'T2'], ['t3', 'T3'], ['t4', 'T4'], ['t5', 'T5 + garage'],
];
const demo = { key: 't5', tab: '3d', hour: 17.75, scene: null, H: null, viz: null, token: 0, visible: true };

function fmtHour(h) {
  const hh = Math.floor(h), mm = Math.round((h - hh) * 60);
  return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
}

function setStatus(text, busy) {
  const el = $('demo-status');
  el.textContent = text;
  el.classList.toggle('busy', !!busy);
}

function build3D(first) {
  const H = demo.H, viz = demo.viz;
  if (!H || !viz) return;
  demo.scene = applyScene(demo.hour, H.doc, H.info);
  const r = buildBoard(viz, H.doc.components, H.doc.wires, SYMBOLS, { walls: 'full', ground: true, sim: simSnapshot(H), keepCamera: !first });
  if (first) viz.fit(r * 0.8);
  viz.dirty = true;
  if (!viz._raf) viz.render();
}

function drawDemoPlan() {
  const H = demo.H;
  if (!H || demo.tab !== 'plan') return;
  applyScene(demo.hour, H.doc, H.info);
  const snap = simSnapshot(H);
  drawPlan($('demo-plan'), H.doc, { ink: '#d7dfeb', conduit: '#6aa8ff', fill: 0.2, bg: '#10151c', padX: 22, padY: 22, lit: snap && snap.snap ? snap.snap.lit : null });
}

function renderDemoPanel() {
  const H = demo.H;
  if (!H) return;
  const d = H.design;
  const rows = d.ok ? d.circuits.map((c) => `<tr><td>${c.id}</td><td>${esc(c.name)}</td><td class="num">${c.In} A</td><td class="num">${nf(c.S, c.S % 1 ? 1 : 0)} mm²</td><td class="num">${nf(c.length, 1)} m</td><td class="num ${c.ok ? 'ok' : 'ko'}">${nf(c.dUpct, 1)} %</td></tr>`).join('') : '';
  $('demo-panel').innerHTML = `<div class="board dark">${boardHTML(d)}</div>
    <table class="circ-table"><thead><tr><th>Circuit</th><th></th><th class="num">Calibre</th><th class="num">Section</th><th class="num">Câble</th><th class="num">ΔU</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function showTab(tab) {
  demo.tab = tab;
  for (const b of document.querySelectorAll('.demo-tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  $('demo-view').setAttribute('aria-labelledby', 'tab-' + tab);
  $('demo3d').hidden = tab !== '3d';
  $('demo-plan').hidden = tab !== 'plan';
  $('demo-panel').hidden = tab !== 'panel';
  $('demo-time').hidden = tab === 'panel' || (tab === '3d' && demo.viz && !demo.viz.webgl);
  $('demo-poster').hidden = tab !== '3d';
  if (demo.viz) { if (tab === '3d' && demo.visible) { demo.viz.resize(); demo.viz.start(); } else demo.viz.stop(); }
  if (tab === 'plan') drawDemoPlan();
  if (tab === 'panel') renderDemoPanel();
}

function updateReadout(H) {
  const d = H.design;
  $('ro-area').textContent = fmtArea(H.area);
  $('ro-rooms').textContent = H.rep.rooms.length;
  $('ro-circ').textContent = d.ok ? d.circuits.length : '—';
  $('ro-kva').textContent = d.ok ? d.agcp.kva + ' kVA' : '—';
  const n = $('ro-norm');
  n.textContent = H.rep.ok ? '✓ Conforme' : `${H.rep.errors + H.rep.warnings} point(s)`;
  n.className = H.rep.ok ? 'ok' : 'ko';
}

async function loadHouse(key) {
  const token = ++demo.token;
  demo.key = key;
  for (const b of $('demo-houses').children) b.setAttribute('aria-checked', String(b.dataset.key === key));
  const T = HOUSE_TYPES.find((t) => t.key === key);
  setStatus(`Génération : ${T.name}…`, true);
  const t0 = performance.now();
  let H;
  try { H = await HouseStore.get(key); } catch (e) { setStatus('Génération impossible', false); return; }
  if (token !== demo.token) return;
  demo.H = H;
  updateReadout(H);
  if (demo.viz) {
    build3D(true);
    $('demo-poster').classList.add('gone');
  }
  if (demo.tab === 'plan') drawDemoPlan();
  if (demo.tab === 'panel') renderDemoPanel();
  const ms = Math.max(1, Math.round(performance.now() - t0));
  setStatus(`${T.name} · ${H.doc.components.length} éléments · ${ms < 60 ? 'instantané' : nf(ms / 1000, 1) + ' s'}`, false);
  renderSections(H, T);
}

function initDemo() {
  const chips = $('demo-houses');
  for (const [key, label] of HOUSE_CHIPS) {
    const T = HOUSE_TYPES.find((t) => t.key === key);
    const b = document.createElement('button');
    b.type = 'button'; b.setAttribute('role', 'radio'); b.dataset.key = key;
    b.setAttribute('aria-checked', String(key === demo.key));
    b.title = T.desc;
    b.innerHTML = `${esc(label)}`;
    b.addEventListener('click', () => { if (demo.key !== key) loadHouse(key); });
    chips.appendChild(b);
  }
  chips.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const list = [...chips.children], i = list.findIndex((b) => b.dataset.key === demo.key);
    const nb = list[(i + (e.key === 'ArrowRight' ? 1 : list.length - 1)) % list.length];
    nb.focus(); nb.click(); e.preventDefault();
  });
  for (const b of document.querySelectorAll('.demo-tabs button')) b.addEventListener('click', () => showTab(b.dataset.tab));
  document.querySelector('.demo-tabs').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const tabs = ['3d', 'plan', 'panel'], i = tabs.indexOf(demo.tab);
    const t = tabs[(i + (e.key === 'ArrowRight' ? 1 : 2)) % 3];
    showTab(t); $('tab-' + t).focus(); e.preventDefault();
  });

  // Heure : soleil, ciel et lampes
  const hour = $('demo-hour');
  const onHour = () => {
    demo.hour = +hour.value;
    $('demo-hour-lbl').textContent = fmtHour(demo.hour);
    $('demo-hour-ico').textContent = demo.hour >= 7 && demo.hour < 18 ? '☀' : '☾';
    if (demo.viz && demo.viz.setTime) { demo.viz.setTime(demo.hour); demo.viz.dirty = true; if (!demo.viz._raf) demo.viz.render(); }
    if (demo.H) {
      const before = demo.scene;
      const now = applyScene(demo.hour, demo.H.doc, demo.H.info);
      if (now !== before) { if (demo.tab === '3d') build3D(false); else demo.scene = now; }
      if (demo.tab === 'plan') drawDemoPlan();
    }
  };
  hour.addEventListener('input', onHour);
  $('demo-hour-lbl').textContent = fmtHour(demo.hour);

  // Vue 3D
  const cv = $('demo3d');
  demo.viz = createViz3D(cv, { sky: true, time: demo.hour, pitch: 0.8, yaw: -0.55, autoRotate: !REDUCED });
  if (!demo.viz.webgl) $('demo-time').hidden = true;
  const visible = (on) => {
    demo.visible = on;
    if (on && demo.tab === '3d') { demo.viz.resize(); demo.viz.start(); } else demo.viz.stop();
  };
  if ('IntersectionObserver' in window) new IntersectionObserver((es) => es.forEach((e) => visible(e.isIntersecting)), { rootMargin: '80px' }).observe(cv);
  else visible(true);
  window.addEventListener('resize', () => {
    if (demo.tab === '3d') demo.viz.resize(); else if (demo.tab === 'plan') drawDemoPlan();
  });
  onHour();
  loadHouse(demo.key);
}

// ---------------------------------------------------------------------------
// Sections C1 à C3 : même maison que la démonstration
// ---------------------------------------------------------------------------
const CALLOUTS = [
  ['panel_house', 'Tableau + GTL'],
  ['cooktop', 'Plaque : circuit 32 A'],
  ['smoke_detector', 'Détecteur de fumée'],
  ['switch_vv_wall', 'Va-et-vient'],
  ['ev_charger', 'Borne de recharge'],
  ['rj45', 'Prise RJ45'],
  ['radiator', 'Radiateur'],
  ['dcl', 'Point lumineux DCL'],
];

function renderPlanFigure(H, T) {
  const cv = $('plan-canvas'), svg = $('callouts');
  const W = cv.clientWidth || 600, Hc = cv.clientHeight || 400;
  const wide = W > 560;
  // Étiquettes au-dessus et au-dessous d'un plan allongé, sur les côtés sinon
  const pb = planBounds(H.doc);
  const tb = (pb.maxX - pb.minX) / (pb.maxY - pb.minY) > (W / Hc) * 0.85;
  const pad = !wide ? { padX: 12, padY: 14 } : tb ? { padX: 16, padY: 60 } : { padX: 168, padY: 18 };
  const t = drawPlan(cv, H.doc, Object.assign({ ink: css('--ink'), conduit: css('--blue'), fill: 0.16 }, pad));
  $('plan-cap').innerHTML = `<span>${esc(T.name)} · ${fmtArea(H.area)} · ${H.rep.rooms.length} pièces</span><span>${H.doc.components.length} éléments · ${nf(H.design.ok ? H.design.cableTotal : 0, 0)} m de câble</span>`;
  svg.setAttribute('viewBox', `0 0 ${t.W} ${t.H}`);
  if (!wide) { svg.innerHTML = ''; return; }
  const X = (x) => t.ox + x * t.s, Y = (y) => t.oy + y * t.s;
  const cx = (t.b.minX + t.b.maxX) / 2, cy = (t.b.minY + t.b.maxY) / 2;
  // Un exemplaire de chaque type, le plus près du bord concerné
  const picks = [];
  for (const [type, label] of CALLOUTS) {
    const cands = H.doc.components.filter((c) => c.type === type);
    if (!cands.length) continue;
    const edge = tb ? (c) => Math.min(c.y - t.b.minY, t.b.maxY - c.y) : (c) => Math.min(c.x - t.b.minX, t.b.maxX - c.x);
    const c = cands.sort((a, b) => edge(a) - edge(b))[0];
    const side = tb ? (c.y < cy ? 'T' : 'B') : (c.x < cx ? 'L' : 'R');
    if (picks.filter((p) => p.side === side).length >= 3) continue;
    picks.push({ c, label, side, x: X(c.x), y: Y(c.y), tw: label.length * 7 + 14 });
    if (picks.length >= 6) break;
  }
  let out = '';
  const label = (bx, by, p) => `<rect class="lab-bg" x="${bx}" y="${by}" width="${p.tw}" height="22" rx="3"/><text x="${bx + 7}" y="${by + 15}">${esc(p.label)}</text>`;
  if (tb) {
    for (const side of ['T', 'B']) {
      const list = picks.filter((p) => p.side === side).sort((a, b) => a.x - b.x);
      let right = 8;
      for (const p of list) { p.bx = Math.max(p.x - p.tw / 2, right); right = p.bx + p.tw + 12; }
      let limit = t.W - 8;
      for (let i = list.length - 1; i >= 0; i--) { const p = list[i]; p.bx = Math.min(p.bx, limit - p.tw); limit = p.bx - 12; }
      const by = side === 'T' ? 10 : t.H - 32;
      const edgeY = side === 'T' ? Y(t.b.minY) - 10 : Y(t.b.maxY) + 10;
      for (const p of list) {
        const lx = p.bx + p.tw / 2, ly = side === 'T' ? by + 22 : by;
        out += `<polyline class="lead-line" points="${p.x},${p.y} ${p.x},${edgeY} ${lx},${ly}"/><circle class="lead-dot" cx="${p.x}" cy="${p.y}" r="4"/>` + label(p.bx, by, p);
      }
    }
  } else {
    for (const side of ['L', 'R']) {
      const list = picks.filter((p) => p.side === side).sort((a, b) => a.y - b.y);
      let last = -Infinity;
      for (const p of list) { p.ly = Math.max(p.y, last + 34); last = p.ly; }
      const overflow = last - (t.H - 16);
      if (overflow > 0) list.forEach((p) => { p.ly -= overflow; });
      for (const p of list) {
        const planEdge = side === 'L' ? X(t.b.minX) - 14 : X(t.b.maxX) + 14;
        const bx = side === 'L' ? 8 : t.W - 8 - p.tw;
        out += `<polyline class="lead-line" points="${p.x},${p.y} ${planEdge},${p.ly} ${side === 'L' ? bx + p.tw : bx},${p.ly}"/><circle class="lead-dot" cx="${p.x}" cy="${p.y}" r="4"/>` + label(bx, p.ly - 11, p);
      }
    }
  }
  svg.innerHTML = out;
}

function renderNorm(H) {
  const rows = H.rep.rooms.map((r) => {
    const st = r.status === 'ok' ? ['st-ok', 'Conforme'] : r.status === 'warn' ? ['st-warn', 'À vérifier'] : ['st-err', 'Non conforme'];
    const req = r.socketsReq !== null && r.socketsReq !== undefined ? `<span class="req"> / ${r.socketsReq}</span>` : '';
    return `<tr><td><span class="room-name"><span class="room-sw" style="background:${esc(r.color)}"></span>${esc(r.name)}</span></td>
      <td class="num">${fmtArea(r.area || 0)}</td><td class="num">${r.sockets}${req}</td><td class="num">${r.lights}</td>
      <td><span class="st ${st[0]}" title="${esc(r.msgs.join(' ; '))}">${st[1]}</span></td></tr>`;
  }).join('');
  $('norm-table').tBodies[0].innerHTML = rows;
  const icon = { ok: '✓', warn: '!', err: '✕' };
  $('norm-global').innerHTML = H.rep.global.slice(0, 5).map((g) => `<li><span class="ci ci-${g.level}">${icon[g.level] || '•'}</span><span>${esc(g.msg)}</span></li>`).join('');
}

function renderBoardSection(H) {
  const d = H.design;
  $('board').innerHTML = boardHTML(d);
  if (!d.ok) { $('board-sum').innerHTML = ''; return; }
  const items = [
    ['Circuits', `${d.circuits.length} + ${d.reserve} réserve`],
    ['Différentiels', `${d.rcds.length} × 30 mA`],
    ['Abonnement', `${d.agcp.kva} kVA`],
    ['Puissance installée', `${nf(d.installed / 1000, 1)} kW`],
    ['Puissance probable', `${nf(d.probable / 1000, 1)} kW`],
    ['Câble', `${nf(d.cableTotal, 0)} m`],
  ];
  $('board-sum').innerHTML = items.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
}

function renderSections(H, T) {
  renderPlanFigure(H, T);
  renderNorm(H);
  renderBoardSection(H);
}

// ---------------------------------------------------------------------------
// Banc d'essai : une ligne, des appareils, un disjoncteur (mêmes lois que la
// simulation de l'éditeur : θ → (I/In)², déclenchement à 1,13², τ = 120 s,
// magnétique dès 10 In, Icc = U / (Z amont + 2ρL/S))
// ---------------------------------------------------------------------------
function initBench() {
  const SPEED = 20;
  const st = { In: 20, S: 2.5, L: 20, heat: 0, tripped: null, t: 0, last: 0, raf: 0, visible: false };
  const loads = [...document.querySelectorAll('#bench-loads button')];
  const power = () => loads.filter((b) => b.getAttribute('aria-pressed') === 'true').reduce((s, b) => s + +b.dataset.w, 0);
  const fmtT = (s) => (s < 60 ? `${nf(s, s < 10 ? 1 : 0)} s` : `${Math.floor(s / 60)} min ${String(Math.round(s % 60)).padStart(2, '0')} s`);
  const values = () => {
    const I = st.tripped ? 0 : power() / U_NOM;
    const r = I / st.In;
    const limit = st.In === 16 ? 3 : 5;
    const dU = (2 * RHO_CU * st.L * (power() / U_NOM)) / st.S / U_NOM * 100;
    const Icc = U_NOM / (Z_UP + (2 * RHO_CU * st.L) / st.S);
    return { I, r, limit, dU, Icc };
  };
  function paint() {
    const v = values();
    const mI = $('m-i'), mL = $('m-load'), mU = $('m-du');
    mI.textContent = `${nf(v.I, 1)} A`;
    mL.textContent = `${nf(v.r * 100, 0)} %`;
    mL.className = v.r > 1.13 ? 'bad' : v.r > 1 ? 'warn' : 'good';
    mU.textContent = `${nf(v.dU, 1)} %`;
    mU.className = v.dU > v.limit ? 'bad' : v.dU > v.limit * 0.8 ? 'warn' : 'good';
    $('heat-fill').style.width = Math.min(100, (st.heat / THERMAL_TRIP) * 100) + '%';
    $('bench-breaker').classList.toggle('tripped', !!st.tripped);
    $('bench-in').textContent = st.In + ' A';
    const vd = $('verdict');
    if (st.tripped) {
      vd.className = 'verdict bad';
      vd.textContent = st.tripped;
    } else if (v.r > Math.sqrt(THERMAL_TRIP)) {
      const r2 = v.r * v.r;
      const left = -TAU_BREAKER * Math.log((r2 - THERMAL_TRIP) / Math.max(1e-6, r2 - st.heat));
      vd.className = 'verdict warn';
      vd.textContent = `Surcharge : ${nf(v.I, 1)} A pour ${st.In} A — le disjoncteur chauffe, il coupe dans ≈ ${fmtT(Math.max(0, left))}.`;
    } else if (v.r > 1) {
      vd.className = 'verdict warn';
      vd.textContent = `Légère surcharge (< 1,13 In) : pas de déclenchement, mais le câble chauffe.`;
    } else if (v.dU > v.limit) {
      vd.className = 'verdict warn';
      vd.textContent = `Tient, mais chute de tension ${nf(v.dU, 1)} % > ${v.limit} % : ligne trop longue pour cette section.`;
    } else {
      vd.className = 'verdict ok';
      vd.textContent = v.I > 0 ? `Tout va bien : ${nf(v.I, 1)} A pour un calibre de ${st.In} A.` : 'Aucun appareil en marche.';
    }
  }
  function tick(now) {
    st.raf = 0;
    const dt = Math.min(0.1, (now - (st.last || now)) / 1000) * SPEED;
    st.last = now;
    const v = values();
    const target = v.r * v.r;
    st.heat = target + (st.heat - target) * Math.exp(-dt / TAU_BREAKER);
    if (!st.tripped && v.r > 0) st.t += dt;
    if (!st.tripped && st.heat >= THERMAL_TRIP) {
      st.tripped = `Déclenché (thermique) après ${fmtT(st.t)} de surcharge. Débranchez un appareil puis réarmez.`;
    }
    paint();
    const settling = Math.abs(st.heat - target) > 0.002;
    if (st.visible && settling) st.raf = requestAnimationFrame(tick);
    else st.last = 0;
  }
  const kick = () => { if (!st.raf && st.visible) { st.last = 0; st.raf = requestAnimationFrame(tick); } paint(); };
  for (const b of loads) b.addEventListener('click', () => {
    b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true'));
    if (!st.tripped) st.t = values().r > Math.sqrt(THERMAL_TRIP) ? st.t : 0;
    kick();
  });
  for (const b of document.querySelectorAll('#bench-circuit button')) b.addEventListener('click', () => {
    for (const o of document.querySelectorAll('#bench-circuit button')) o.setAttribute('aria-checked', String(o === b));
    st.In = +b.dataset.in; st.S = +b.dataset.s; st.heat = 0; st.tripped = null; st.t = 0;
    kick();
  });
  const len = $('bench-len');
  len.addEventListener('input', () => { st.L = +len.value; $('bench-len-out').textContent = `${st.L} m`; kick(); });
  $('bench-short').addEventListener('click', () => {
    const v = values();
    if (st.tripped) return;
    if (v.Icc >= 10 * st.In) {
      st.tripped = `Court-circuit : Icc ≈ ${nf(v.Icc, 0)} A ≥ 10 × In = ${10 * st.In} A → déclenchement magnétique instantané.`;
    } else {
      const r2 = (v.Icc / st.In) ** 2;
      const t = -TAU_BREAKER * Math.log(1 - THERMAL_TRIP / r2);
      st.tripped = `Court-circuit : Icc ≈ ${nf(v.Icc, 0)} A < 10 In — trop faible pour le magnétique ; le thermique coupe en ${fmtT(t)}. Ligne trop longue !`;
    }
    st.heat = 0;
    paint();
  });
  $('bench-reset').addEventListener('click', () => { st.tripped = null; st.heat = 0; st.t = 0; kick(); });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((es) => es.forEach((e) => { st.visible = e.isIntersecting; if (st.visible) kick(); }), { rootMargin: '60px' }).observe($('bench'));
  } else { st.visible = true; }
  paint();
}

// ---------------------------------------------------------------------------
// Catalogue d'électronique
// ---------------------------------------------------------------------------
function initLab() {
  const tbody = $('lab-table').tBodies[0];
  const list = EXAMPLES.filter((e) => e.sim !== 'plan' && !/^maison/.test(e.id));
  const cv = $('lab-canvas');
  let current = null;
  const show = (ex, row) => {
    if (current === ex) return;
    current = ex;
    for (const r of tbody.rows) r.classList.toggle('on', r === row);
    drawSchematic(cv, ex.data);
    $('lab-cap').innerHTML = `<b>${esc(ex.name)}</b> — ${esc(ex.desc)}`;
  };
  for (const ex of list) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><a class="ln" href="app.html?ex=${encodeURIComponent(ex.id)}">${esc(ex.name)}</a></td>
      <td class="lvl">${esc(ex.level)}</td><td class="sim"><b>${esc(ex.simLabel)}</b></td>
      <td class="go"><a href="app.html?ex=${encodeURIComponent(ex.id)}" aria-label="Ouvrir ${esc(ex.name)} dans l’éditeur">→</a></td>`;
    tr.addEventListener('mouseenter', () => show(ex, tr));
    tr.addEventListener('focusin', () => show(ex, tr));
    tr.addEventListener('click', (e) => { if (!e.target.closest('a')) location.href = 'app.html?ex=' + encodeURIComponent(ex.id); });
    tbody.appendChild(tr);
  }
  if (list.length) show(list.find((e) => e.id === 'lowpass') || list[0], null);
  let rs = 0;
  window.addEventListener('resize', () => { clearTimeout(rs); rs = setTimeout(() => { const ex = current; current = null; if (ex) show(ex, [...tbody.rows].find((r) => r.classList.contains('on')) || null); }, 150); });
}

// ---------------------------------------------------------------------------
// Navigation : ombre, progression de lecture, menu mobile
// ---------------------------------------------------------------------------
function initNav() {
  const nav = document.querySelector('.nav'), bar = $('nav-progress');
  const onScroll = () => {
    nav.classList.toggle('scrolled', window.scrollY > 8);
    const max = document.documentElement.scrollHeight - window.innerHeight;
    bar.style.setProperty('--p', max > 0 ? Math.min(1, window.scrollY / max).toFixed(4) : 0);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  const btn = $('nav-menu'), links = $('nav-links');
  const close = () => { links.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); };
  btn.addEventListener('click', () => {
    const open = !links.classList.contains('open');
    links.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', String(open));
  });
  links.addEventListener('click', (e) => { if (e.target.closest('a')) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
}

function initReveal() {
  const els = document.querySelectorAll('.sec-head, .plan-grid, .norm-wrap, .bench-grid, .shots, .lab-grid, .dl-grid, .faq-list, .final, .cartouche');
  if (REDUCED || !('IntersectionObserver' in window)) return;
  els.forEach((el) => el.classList.add('reveal'));
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });
  els.forEach((el) => io.observe(el));
}

document.addEventListener('DOMContentLoaded', () => {
  // Cartouche : chiffres tirés du code
  $('ct-sym').textContent = Object.keys(SYMBOLS).length;
  $('ct-houses').textContent = HOUSE_TYPES.length;
  $('ct-ex').textContent = EXAMPLES.length;
  initDownloads();
  initNav();
  initReveal();
  initBench();
  initLab();
  initDemo();
  // Redessin du plan annoté à la bonne taille
  let rs = 0;
  window.addEventListener('resize', () => {
    clearTimeout(rs);
    rs = setTimeout(() => { if (demo.H) renderPlanFigure(demo.H, HOUSE_TYPES.find((t) => t.key === demo.key)); }, 150);
  });
  // Changement de thème clair / sombre : les tracés du plan suivent
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    if (demo.H) renderPlanFigure(demo.H, HOUSE_TYPES.find((t) => t.key === demo.key));
  });
});

// ---------------------------------------------------------------------------
// Applications à télécharger : système détecté, tailles et version de la
// dernière release GitHub, installation de l'application web (PWA).
// ---------------------------------------------------------------------------
const RELEASES_API = 'https://api.github.com/repos/anthonydepollier22-creator/autocad/releases/latest';

function detectOS() {
  const ua = navigator.userAgent;
  const plat = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
  if (/Android/i.test(ua)) return 'android';
  // iPadOS se présente comme un Mac, mais tactile
  if (/iPhone|iPad|iPod/.test(ua) || (/Mac/.test(plat) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/CrOS/.test(ua) || /Chrome OS/i.test(plat)) return 'web';
  if (/Win/i.test(plat) || /Windows/.test(ua)) return 'windows';
  if (/Mac/i.test(plat) || /Mac OS X/.test(ua)) return 'mac';
  if (/Linux|X11/i.test(plat + ' ' + ua)) return 'linux';
  return 'web';
}

// Mac à puce Apple ou Intel : Chrome et Edge le disent, sinon on regarde le GPU
async function detectMacArch() {
  try {
    if (navigator.userAgentData && navigator.userAgentData.getHighEntropyValues) {
      const { architecture } = await navigator.userAgentData.getHighEntropyValues(['architecture']);
      if (architecture) return architecture === 'arm' ? 'arm64' : 'x64';
    }
  } catch (e) { /* information refusée */ }
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const gpu = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
      const lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
      if (/Intel|AMD|Radeon|NVIDIA/i.test(gpu)) return 'x64';
    }
  } catch (e) { /* ignoré */ }
  return 'arm64'; // Safari masque le GPU : la plupart des Mac récents ont une puce Apple
}

function fmtSize(bytes) {
  const mo = bytes / 1048576;
  return mo.toLocaleString('fr-FR', { maximumFractionDigits: mo < 10 ? 1 : 0 }) + ' Mo';
}

function initDownloads() {
  const sec = document.getElementById('telecharger');
  if (window.Capacitor) document.documentElement.classList.add('in-app');
  if (!sec || document.documentElement.classList.contains('in-app')) return;
  const os = detectOS();
  const cardOf = (key) => sec.querySelector(`.dl-card[data-os="${key}"]`);

  // Carte « Votre appareil » et bouton du héros
  const mine = cardOf(os);
  if (mine) {
    mine.classList.add('is-you');
    const tag = document.createElement('span');
    tag.className = 'dl-you';
    tag.textContent = 'Votre appareil';
    mine.prepend(tag);
  }
  const heroLabel = document.querySelector('#hero-dl span');
  if (heroLabel) {
    heroLabel.textContent = {
      windows: 'Télécharger pour Windows', mac: 'Télécharger pour Mac', linux: 'Télécharger pour Linux',
      android: 'Télécharger pour Android', ios: /iPhone|iPod/.test(navigator.userAgent) ? 'Installer sur l’iPhone' : 'Installer sur l’iPad',
      web: 'Installer l’application',
    }[os];
  }
  // Les liens vers la section font ressortir la carte concernée
  document.querySelectorAll('a[href="#telecharger"]').forEach((a) => {
    a.addEventListener('click', () => {
      const card = a.dataset.osLink ? cardOf(a.dataset.osLink) : mine;
      if (!card) return;
      card.classList.remove('flash');
      setTimeout(() => card.classList.add('flash'), 450);
    });
  });
  sec.addEventListener('animationend', (e) => e.target.classList.remove('flash'));

  // Mac : le bon processeur en premier
  if (os === 'mac') {
    detectMacArch().then((arch) => {
      const btns = [...cardOf('mac').querySelectorAll('.dl-btn')];
      btns.forEach((b) => b.classList.toggle('alt', b.dataset.arch !== arch));
      const rec = btns.find((b) => b.dataset.arch === arch);
      if (rec) rec.parentElement.prepend(rec);
    });
  }

  // Version et tailles depuis la dernière release (les liens directs marchent sans)
  const version = document.getElementById('dl-version');
  const files = sec.querySelectorAll('.dl-btn[data-file]');
  const setPending = (b) => {
    b.classList.add('pending');
    b.setAttribute('aria-disabled', 'true');
    b.querySelector('[data-meta]').textContent = 'bientôt';
  };
  if ('fetch' in window) {
    fetch(RELEASES_API, { headers: { Accept: 'application/vnd.github+json' } })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((rel) => {
        const assets = new Map((rel.assets || []).map((a) => [a.name, a]));
        files.forEach((b) => {
          const a = assets.get(b.dataset.file);
          const meta = b.querySelector('[data-meta]');
          if (a) meta.textContent = `${meta.textContent} · ${fmtSize(a.size)}`;
          else setPending(b);
        });
        const v = String(rel.tag_name || '').replace(/^v/, '');
        const rev = document.getElementById('foot-rev');
        if (rev && v) rev.textContent = 'v' + v;
        const date = rel.published_at ? new Date(rel.published_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
        version.textContent = `Version ${v}` + (date ? ` · publiée le ${date}` : '');
      })
      .catch((status) => {
        if (status !== 404) return; // hors ligne ou quota atteint : on garde les liens
        files.forEach(setPending);
        version.innerHTML = '<span class="dl-wait">Première version en cours de publication</span> — l’application web fonctionne déjà';
      });
  }

  // Application web installable (Chrome, Edge, Android)
  const pwaBtn = document.getElementById('dl-pwa');
  const pwaNote = document.getElementById('dl-pwa-note');
  const installed = () => {
    pwaBtn.hidden = true;
    pwaNote.textContent = 'Installée ✓ — ÉlectriCAD est dans vos applications.';
  };
  let installEvt = null;
  if (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone) installed();
  else if (os === 'ios') pwaNote.textContent = 'Sur iPhone et iPad : Safari → Partager → Sur l’écran d’accueil.';
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installEvt = e;
    pwaBtn.hidden = false;
    pwaNote.textContent = 'Une fenêtre à part, avec son icône, utilisable hors ligne.';
  });
  pwaBtn.addEventListener('click', async () => {
    if (!installEvt) return;
    installEvt.prompt();
    const { outcome } = await installEvt.userChoice;
    installEvt = null;
    if (outcome === 'accepted') installed();
  });
  window.addEventListener('appinstalled', installed);
}
