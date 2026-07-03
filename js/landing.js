/*
 * landing.js — Animation du site vitrine : héros 3D, galerie d'exemples,
 * vitrine de composants 3D interactifs.
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
  // --- Héros : carte de démonstration 3D, rotation automatique -------------
  const heroCanvas = document.getElementById('hero3d');
  if (heroCanvas) {
    const viz = new Viz3D(heroCanvas, { pitch: 0.68, yaw: -0.45 });
    const radius = buildBoard(viz, DEMO_BOARD.components, DEMO_BOARD.wires, SYMBOLS);
    viz.fit(radius * 0.98);
    viz.start();
    window.addEventListener('resize', () => viz.resize());
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
    const viz = new Viz3D(cv, { pitch: 0.55, yaw: -0.4 + i * 0.5, fov: 36 * Math.PI / 180 });
    // Petit plateau + composant seul
    viz.box(0, -6, 0, 130, 6, 130, '#17663b');
    const comp = { x: 0, y: 0, rot: 0, closed: true, high: true };
    (BUILDERS3D[type] || (() => {}))(viz, comp);
    viz.target = [0, 8, 0];
    viz.fit(78);
    viz.start();
    window.addEventListener('resize', () => viz.resize());
  });
});

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
  ctx.strokeStyle = '#c3cddd'; ctx.fillStyle = '#c3cddd';
  ctx.lineWidth = 1.7 / s; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const w of data.wires) {
    ctx.beginPath();
    w.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();
  }
  for (const j of computeJunctions(data.components, data.wires, SYMBOLS)) {
    ctx.beginPath(); ctx.arc(j.x, j.y, 3 / s, 0, Math.PI * 2); ctx.fill();
  }
  for (const c of data.components) {
    ctx.save(); ctx.translate(c.x, c.y); ctx.rotate((c.rot * Math.PI) / 180);
    SYMBOLS[c.type].draw(ctx, c); ctx.restore();
  }
}
