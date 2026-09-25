/*
 * landing.js — Animation du site vitrine : héros 3D, galerie d'exemples,
 * vitrine de composants 3D interactifs, applications à télécharger.
 */

// Carte de démonstration du héros : une carte dense et décorative
// (composants réels + pistes), plus riche qu'un simple exemple.
const DEMO_BOARD = {
  components: [
    { id: 'ic', type: 'gate_and', x: 0, y: 0, rot: 0 },
    { id: 'r1', type: 'resistor', x: -130, y: -60, rot: 0 },
    { id: 'r2', type: 'resistor', x: -130, y: -20, rot: 0 },
    { id: 'd1', type: 'led', x: 120, y: -60, rot: 0 },
    { id: 'c1', type: 'capacitor', x: 140, y: 20, rot: 0 },
    { id: 'q1', type: 'transistor_npn', x: -120, y: 60, rot: 0 },
    { id: 'd2', type: 'diode', x: 60, y: 80, rot: 0 },
    { id: 'l1', type: 'inductor', x: 0, y: 120, rot: 0 },
  ],
  wires: [
    { id: 'w1', points: [{ x: -180, y: -60 }, { x: -80, y: -60 }] },
    { id: 'w2', points: [{ x: -180, y: -20 }, { x: -80, y: -20 }] },
    { id: 'w3', points: [{ x: -80, y: -60 }, { x: -40, y: -60 }, { x: -40, y: -20 }] },
    { id: 'w4', points: [{ x: -80, y: -20 }, { x: -64, y: -20 }, { x: -64, y: 20 }, { x: -40, y: 20 }] },
    { id: 'w5', points: [{ x: 40, y: 0 }, { x: 64, y: 0 }, { x: 64, y: -60 }, { x: 80, y: -60 }] },
    { id: 'w6', points: [{ x: 64, y: 0 }, { x: 64, y: 20 }, { x: 100, y: 20 }] },
    { id: 'w7', points: [{ x: 20, y: 80 }, { x: -20, y: 80 }, { x: -20, y: 40 }] },
    { id: 'w8', points: [{ x: 180, y: 20 }, { x: 200, y: 20 }, { x: 200, y: 80 }, { x: 100, y: 80 }] },
    { id: 'w9', points: [{ x: -180, y: 60 }, { x: -160, y: 60 }] },
    { id: 'w10', points: [{ x: -120, y: 20 }, { x: -120, y: -20 }] },
    { id: 'w11', points: [{ x: -120, y: 100 }, { x: -120, y: 120 }, { x: -40, y: 120 }] },
    { id: 'w12', points: [{ x: 40, y: 120 }, { x: 100, y: 120 }, { x: 100, y: 80 }] },
    { id: 'w13', points: [{ x: 160, y: -60 }, { x: 200, y: -60 }, { x: 200, y: 20 }] },
  ],
};

document.addEventListener('DOMContentLoaded', () => {
  initDownloads();

  // --- Héros : carte de démonstration 3D, rotation automatique -------------
  const heroCanvas = document.getElementById('hero3d');
  if (heroCanvas) {
    const viz = createViz3D(heroCanvas, { pitch: 0.68, yaw: -0.45, time: 14 });
    const radius = buildBoard(viz, DEMO_BOARD.components, DEMO_BOARD.wires, SYMBOLS);
    viz.fit(radius * 0.8);
    runWhenVisible(viz, heroCanvas);
  }

  // --- Maison T5 au crépuscule, lumières allumées, installation calculée ----
  const houseCanvas = document.getElementById('house3d');
  if (houseCanvas && typeof getExampleData === 'function') {
    const data = getExampleData('maison-t5') || getExampleData('maison');
    const design = typeof designInstallation === 'function' ? designInstallation(data.components, data.wires) : null;
    let simState = null;
    if (design && design.ok) {
      // une soirée : séjour, cuisine, couloir et deux chambres éclairés, plaque et TV en marche
      const info = computeRooms(data.components, data.wires);
      const litRooms = new Set(['Séjour', 'Cuisine', 'Couloir', 'Chambre 1', 'Bureau', 'Entrée']);
      const seen = new Set();
      for (const c of data.components) {
        if (c.type !== 'switch_sa' && c.type !== 'switch_vv_wall') continue;
        const i = c.ctrl ? info.rooms.findIndex((r) => r.id === c.ctrl) : roomAt(info, c.x, c.y);
        const name = i >= 0 ? info.rooms[i].name : '';
        c.closed = litRooms.has(name) && !seen.has(name);
        seen.add(name);
      }
      for (const c of data.components) if (c.type === 'cooktop' || c.type === 'tv_unit' || c.type === 'desk') c.on = true;
      const sim = new InstallSim();
      sim.setDesign(design);
      simState = { snap: sim.step(0.1, data.components, data.wires), design, sim };
    }
    const viz = createViz3D(houseCanvas, { pitch: 0.86, yaw: -0.5, time: 19.4 });
    viz.fit(buildBoard(viz, data.components, data.wires, SYMBOLS, { walls: 'full', sim: simState }) * 0.72);
    runWhenVisible(viz, houseCanvas);
    const rep = checkNFC15100(data.components, data.wires);
    const area = rep.rooms.reduce((s, r) => s + (r.area || 0), 0);
    const badge = document.getElementById('house-badge');
    badge.innerHTML = (rep.ok ? '<span class="hb-ok">✓</span> Conforme NF C 15-100' : '<span class="hb-ko">!</span> À vérifier') +
      ` · ${rep.rooms.length} pièces · ${fmtArea(area)}` + (design && design.ok ? ` · ${design.circuits.length} circuits` : '');
    badge.hidden = false;
  }

  // --- Navigation collante ---------------------------------------------------
  const nav = document.querySelector('.nav');
  const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 12);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // --- Apparition au défilement ----------------------------------------------
  const toReveal = document.querySelectorAll(
    '.feature, .g-card, .show-card, .step, .section h2, .section-sub, .eyebrow, .cta-final h2'
  );
  toReveal.forEach((el) => el.classList.add('reveal'));
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          const el = e.target;
          const sibs = [...el.parentElement.children].filter((s) => s.classList.contains('reveal'));
          el.style.transitionDelay = Math.min(sibs.indexOf(el) * 70, 350) + 'ms';
          el.classList.add('in');
          io.unobserve(el);
        }
      });
    }, { threshold: 0.12 });
    toReveal.forEach((el) => io.observe(el));
  } else {
    toReveal.forEach((el) => el.classList.add('in'));
  }

  // --- Galerie d'exemples ----------------------------------------------------
  const gallery = document.getElementById('gallery');
  if (gallery && typeof EXAMPLES !== 'undefined') {
    for (const ex of EXAMPLES) {
      const a = document.createElement('a');
      a.className = 'g-card';
      a.href = 'app.html?ex=' + ex.id;
      const cv = document.createElement('canvas');
      cv.className = 'g-thumb';
      drawSchematicThumb(cv, ex.data);
      const name = document.createElement('div');
      name.className = 'g-name'; name.textContent = ex.name;
      const desc = document.createElement('div');
      desc.className = 'g-desc'; desc.textContent = ex.desc;
      const badges = document.createElement('div');
      badges.className = 'g-badges';
      badges.innerHTML = `<span class="badge">${ex.level}</span><span class="badge sim">${ex.simLabel}</span>`;
      a.append(cv, name, desc, badges);
      gallery.appendChild(a);
    }
  }

  // --- Vitrine de composants 3D ---------------------------------------------
  document.querySelectorAll('.show-card canvas').forEach((cv, i) => {
    const type = cv.dataset.comp;
    const viz = createViz3D(cv, { pitch: 0.55, yaw: -0.4 + i * 0.5, fov: 36 * Math.PI / 180, time: 14 });
    // Petit plateau + composant seul
    viz.box(0, -6, 0, 112, 6, 112, '#17663b');
    const comp = { x: 0, y: 0, rot: 0, closed: true, high: true };
    (BUILDERS3D[type] || (() => {}))(viz, comp);
    viz.target = [0, 8, 0];
    viz.fit(62);
    runWhenVisible(viz, cv);
  });
});

// N'anime une vue 3D que lorsqu'elle est à l'écran (économise le processeur)
function runWhenVisible(viz, canvas) {
  window.addEventListener('resize', () => viz.resize());
  if (!('IntersectionObserver' in window)) { viz.start(); return; }
  viz.resize(); viz.render(); // première image immédiate
  new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) { viz.resize(); viz.start(); } else viz.stop();
    }
  }, { rootMargin: '120px' }).observe(canvas);
}

// Vignette 2D d'un schéma (mêmes tracés que l'éditeur)
function drawSchematicThumb(cv, data) {
  const dpr = window.devicePixelRatio || 1;
  const W = 260, H = 130;
  cv.width = W * dpr; cv.height = H * dpr;
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const acc = (x, y) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };
  for (const c of data.components) { const b = SYMBOLS[c.type].bbox; acc(c.x + b.x, c.y + b.y); acc(c.x + b.x + b.w, c.y + b.y + b.h); }
  for (const w of data.wires) for (const p of w.points) acc(p.x, p.y);
  const s = Math.min((W - 28) / (maxX - minX), (H - 22) / (maxY - minY), 0.6);
  ctx.translate(W / 2 - (minX + maxX) / 2 * s, H / 2 - (minY + maxY) / 2 * s);
  ctx.scale(s, s);
  if (data.wires.some((w) => w.kind === 'wall') && typeof computeRooms === 'function') {
    const info = computeRooms(data.components, data.wires);
    info.rooms.forEach((room, i) => {
      if (room.leaked || room.sharedWith !== null) return;
      ctx.beginPath();
      for (const r of roomRuns(info, i)) ctx.rect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = room.color; ctx.globalAlpha = 0.16; ctx.fill(); ctx.globalAlpha = 1;
      const lab = data.components.find((c) => c.id === room.id);
      if (lab) lab.__area = room.area;
    });
  }
  ctx.strokeStyle = '#c3cddd'; ctx.fillStyle = '#c3cddd';
  ctx.lineWidth = 1.7 / s; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const w of data.wires) {
    ctx.lineWidth = (w.kind === 'wall' ? 7 : w.kind === 'conduit' ? 3.5 : 1.7) / s;
    ctx.globalAlpha = w.kind === 'conduit' ? 0.55 : 1;
    ctx.beginPath();
    w.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.lineWidth = 1.7 / s;
  for (const j of computeJunctions(data.components, data.wires, SYMBOLS)) {
    ctx.beginPath(); ctx.arc(j.x, j.y, 3 / s, 0, Math.PI * 2); ctx.fill();
  }
  for (const c of data.components) {
    ctx.save(); ctx.translate(c.x, c.y); ctx.rotate((c.rot * Math.PI) / 180);
    SYMBOLS[c.type].draw(ctx, c); ctx.restore();
  }
}

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
