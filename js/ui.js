/*
 * ui.js — Construction de l'interface : palette de composants, barre d'outils,
 * panneau de propriétés, barre d'état, et opérations fichier (nouveau, ouvrir,
 * enregistrer, exporter PNG).
 */

// Icônes vectorielles (trait 1.8, coins arrondis)
const ICONS = {
  file: '<svg viewBox="0 0 24 24"><path d="M13 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V8z"/><path d="M13 3v5h5"/></svg>',
  folder: '<svg viewBox="0 0 24 24"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18z"/></svg>',
  save: '<svg viewBox="0 0 24 24"><path d="M5 4h11l3 3v13a0 0 0 0 1 0 0H5a0 0 0 0 1 0 0V4z"/><path d="M8 4v4h7V4"/><path d="M7 20v-7h10v7"/></svg>',
  image: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.6"/><path d="M3 17l5.5-5.5 4 4 2.5-2.5L21 19"/></svg>',
  vector: '<svg viewBox="0 0 24 24"><path d="M5 16c3-8 11-8 14 0"/><rect x="2.5" y="14.5" width="4.5" height="4.5" rx="1"/><rect x="17" y="14.5" width="4.5" height="4.5" rx="1"/><circle cx="12" cy="10" r="1.6"/></svg>',
  layers: '<svg viewBox="0 0 24 24"><path d="M12 3.5l8.5 4.5-8.5 4.5L3.5 8z"/><path d="M3.5 12.2L12 16.7l8.5-4.5"/><path d="M3.5 16.2L12 20.7l8.5-4.5"/></svg>',
  printer: '<svg viewBox="0 0 24 24"><path d="M7 8V3.5h10V8"/><path d="M7 16.5H4.5A1.5 1.5 0 0 1 3 15V9.5A1.5 1.5 0 0 1 4.5 8h15A1.5 1.5 0 0 1 21 9.5V15a1.5 1.5 0 0 1-1.5 1.5H17"/><path d="M7 13.5h10v7H7z"/></svg>',
  cursor: '<svg viewBox="0 0 24 24"><path d="M5.5 3.5l6.7 16.3 2.2-6.4 6.4-2.2z"/></svg>',
  wire: '<svg viewBox="0 0 24 24"><path d="M4 18h5v-6h6V6h5"/><circle cx="4" cy="18" r="1.7"/><circle cx="20" cy="6" r="1.7"/></svg>',
  dxf: '<svg viewBox="0 0 24 24"><path d="M4 20V8l6-4 10 6v10z"/><path d="M4 20h16M10 4v16"/><path d="M13.5 13h4M13.5 16h4"/></svg>',
  ruler: '<svg viewBox="0 0 24 24"><path d="M3.5 15.5l12-12 5 5-12 12z"/><path d="M7 12l2 2M9.5 9.5l1.5 1.5M12 7l2 2M14.5 4.5l1.5 1.5"/></svg>',
  move: '<svg viewBox="0 0 24 24"><path d="M12 3v18M3 12h18"/><path d="M9.5 5.5L12 3l2.5 2.5M9.5 18.5L12 21l2.5-2.5M5.5 9.5L3 12l2.5 2.5M18.5 9.5L21 12l-2.5 2.5"/></svg>',
  rotate: '<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.9-6.2"/><path d="M20 3.5V8h-4.5"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect x="8.5" y="8.5" width="12" height="12" rx="1.5"/><path d="M15.5 8.5V5A1.5 1.5 0 0 0 14 3.5H5A1.5 1.5 0 0 0 3.5 5v9A1.5 1.5 0 0 0 5 15.5h3.5"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 6.5h16"/><path d="M9.5 6.5V4h5v2.5"/><path d="M6 6.5L7 20.5h10l1-14"/><path d="M10 10.5v6M14 10.5v6"/></svg>',
  undo: '<svg viewBox="0 0 24 24"><path d="M4.5 9.5h9.5a5.5 5.5 0 0 1 0 11h-3"/><path d="M8.5 5.5l-4 4 4 4"/></svg>',
  redo: '<svg viewBox="0 0 24 24"><path d="M19.5 9.5H10a5.5 5.5 0 0 0 0 11h3"/><path d="M15.5 5.5l4 4-4 4"/></svg>',
  'zoom-in': '<svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/><path d="M8 10.5h5M10.5 8v5"/></svg>',
  'zoom-out': '<svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/><path d="M8 10.5h5"/></svg>',
  fit: '<svg viewBox="0 0 24 24"><path d="M3.5 8.5V5A1.5 1.5 0 0 1 5 3.5h3.5M15.5 3.5H19A1.5 1.5 0 0 1 20.5 5v3.5M20.5 15.5V19a1.5 1.5 0 0 1-1.5 1.5h-3.5M8.5 20.5H5A1.5 1.5 0 0 1 3.5 19v-3.5"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M7.5 4.5l12 7.5-12 7.5z"/></svg>',
  book: '<svg viewBox="0 0 24 24"><path d="M12 6.5C10 4.8 7 4.5 4 4.5v14.5c3 0 6 .3 8 2 2-1.7 5-2 8-2V4.5c-3 0-6 .3-8 2z"/><path d="M12 6.5V21"/></svg>',
  grid: '<svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="17" height="17" rx="1.5"/><path d="M3.5 9.2h17M3.5 14.9h17M9.2 3.5v17M14.9 3.5v17"/></svg>',
  magnet: '<svg viewBox="0 0 24 24"><path d="M6.5 3.5v8a5.5 5.5 0 0 0 11 0v-8"/><path d="M6.5 3.5H10V8H6.5zM14 3.5h3.5V8H14z"/></svg>',
  sun: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M18.7 5.3l-1.8 1.8M7.1 16.9l-1.8 1.8"/></svg>',
  video: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10.5l5-3v9l-5-3z"/></svg>',
  cube: '<svg viewBox="0 0 24 24"><path d="M12 2.8l8 4.6v9.2l-8 4.6-8-4.6V7.4z"/><path d="M12 12l8-4.6M12 12L4 7.4M12 12v9.2"/></svg>',
  wall: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="1"/><path d="M3 9.7h18M3 14.3h18M9 5v4.7M15 5v4.7M6 9.7v4.6M12 9.7v4.6M18 9.7v4.6M9 14.3V19M15 14.3V19"/></svg>',
  conduit: '<svg viewBox="0 0 24 24"><path d="M3 17v-7h8V5h10"/><path d="M6.5 20v-6.5H14V8.5h7"/></svg>',
  moon: '<svg viewBox="0 0 24 24"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/></svg>',
  house: '<svg viewBox="0 0 24 24"><path d="M3.5 11 12 4l8.5 7"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-5.5h4V20"/></svg>',
  board: '<svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="17" height="17" rx="1.5"/><path d="M3.5 12h17"/><path d="M7 6.5v3M10 6.5v3M13 6.5v3M7 14.5v3M10 14.5v3"/></svg>',
  components: '<svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/></svg>',
  panel: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M14.5 4v16"/><path d="M17 8.5h1.5M17 12h1.5"/></svg>',
  download: '<svg viewBox="0 0 24 24"><path d="M12 4v11"/><path d="M7.5 10.5 12 15l4.5-4.5"/><path d="M5 19.5h14"/></svg>',
};

document.addEventListener('DOMContentLoaded', () => {
  // Injection des icônes
  document.querySelectorAll('[data-icon]').forEach((b) => {
    const svg = ICONS[b.dataset.icon];
    if (svg) b.insertAdjacentHTML('afterbegin', svg);
  });

  // --- Écrans étroits : palette et panneau en tiroirs ------------------------
  const narrow = () => window.matchMedia('(max-width: 900px)').matches;
  const backdrop = document.getElementById('drawer-backdrop');
  function setDrawer(side) {
    document.body.classList.toggle('show-left', side === 'left');
    document.body.classList.toggle('show-right', side === 'right');
    document.getElementById('btn-drawer-left').setAttribute('aria-expanded', side === 'left' ? 'true' : 'false');
    document.getElementById('btn-drawer-right').setAttribute('aria-expanded', side === 'right' ? 'true' : 'false');
    backdrop.hidden = !side;
  }
  document.getElementById('btn-drawer-left').addEventListener('click', () => setDrawer(document.body.classList.contains('show-left') ? null : 'left'));
  document.getElementById('btn-drawer-right').addEventListener('click', () => setDrawer(document.body.classList.contains('show-right') ? null : 'right'));
  backdrop.addEventListener('click', () => setDrawer(null));
  const topbarH = () => document.documentElement.style.setProperty('--topbar-h', document.querySelector('.topbar').offsetHeight + 'px');
  topbarH();
  window.addEventListener('resize', () => { topbarH(); if (!narrow()) setDrawer(null); });

  // --- Installation comme application (PWA) ----------------------------------
  let installEvt = null;
  const installBtn = document.getElementById('btn-install');
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installEvt = e;
    if (!standalone) installBtn.hidden = false;
  });
  installBtn.addEventListener('click', async () => {
    if (!installEvt) return;
    installEvt.prompt();
    const choice = await installEvt.userChoice.catch(() => null);
    if (choice && choice.outcome === 'accepted') installBtn.hidden = true;
    installEvt = null;
  });
  window.addEventListener('appinstalled', () => { installBtn.hidden = true; });

  const canvas = document.getElementById('canvas');
  const editor = new Editor(canvas);
  editor.view = { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2, scale: 1 };
  editor.render();

  // --- Thème clair / sombre ------------------------------------------------
  const themeBtn = document.getElementById('btn-theme');
  function applyTheme(light) {
    document.body.classList.toggle('light', light);
    editor.setTheme(light ? 'light' : 'dark');
    themeBtn.innerHTML = light ? ICONS.moon : ICONS.sun;
    document.querySelector('meta[name="theme-color"]').content = light ? '#eceef3' : '#12151c';
    try { localStorage.setItem('electricad-theme', light ? 'light' : 'dark'); } catch (_) {}
    if (typeof repaintThumbs === 'function') repaintThumbs();
  }
  themeBtn.addEventListener('click', () => applyTheme(!document.body.classList.contains('light')));

  // --- Palette ------------------------------------------------------------
  const palette = document.getElementById('palette');
  const cats = {};
  for (const key of SYMBOLS.__order) {
    const sym = SYMBOLS[key];
    (cats[sym.category] = cats[sym.category] || []).push(key);
  }
  for (const cat of Object.keys(cats)) {
    const h = document.createElement('div');
    h.className = 'cat-title';
    h.textContent = cat;
    palette.appendChild(h);
    const grid = document.createElement('div');
    grid.className = 'cat-grid';
    for (const key of cats[cat]) {
      const btn = document.createElement('button');
      btn.className = 'sym-btn';
      btn.title = SYMBOLS[key].name;
      btn.dataset.type = key;
      const c = document.createElement('canvas');
      c.width = 64; c.height = 48;
      drawThumb(c, key);
      const span = document.createElement('span');
      span.textContent = SYMBOLS[key].name;
      btn.appendChild(c);
      btn.appendChild(span);
      btn.addEventListener('click', () => {
        editor.placeRot = 0;
        editor.setTool('place', key);
        setActiveTool(null);
        document.querySelectorAll('.sym-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        if (narrow()) { setDrawer(null); showToast(`Touche le plan pour poser : <b>${SYMBOLS[key].name}</b>`, 2200); }
      });
      grid.appendChild(btn);
    }
    palette.appendChild(grid);
  }

  // Recherche dans la palette
  const searchInput = document.getElementById('palette-search');
  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim().toLowerCase();
    document.querySelectorAll('.sym-btn').forEach((b) => {
      const name = SYMBOLS[b.dataset.type].name.toLowerCase();
      b.style.display = !q || name.includes(q) ? '' : 'none';
    });
    // Masquer les titres de catégorie vides
    document.querySelectorAll('.cat-grid').forEach((grid) => {
      const visible = [...grid.querySelectorAll('.sym-btn')].some((b) => b.style.display !== 'none');
      grid.style.display = visible ? '' : 'none';
      const title = grid.previousElementSibling;
      if (title && title.classList.contains('cat-title')) title.style.display = visible ? '' : 'none';
    });
  });

  function thumbColor() {
    return document.body.classList.contains('light') ? '#3a4656' : '#cdd6e3';
  }
  function drawThumb(c, key) {
    const ctx = c.getContext('2d');
    const sym = SYMBOLS[key];
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.save();
    ctx.translate(c.width / 2, c.height / 2);
    const b = sym.bbox;
    const s = Math.min((c.width - 10) / b.w, (c.height - 10) / b.h, 0.55);
    ctx.scale(s, s);
    ctx.strokeStyle = thumbColor(); ctx.fillStyle = thumbColor();
    ctx.lineWidth = 2 / s; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    sym.draw(ctx);
    ctx.restore();
  }
  function repaintThumbs() {
    document.querySelectorAll('.sym-btn').forEach((b) => {
      const cv = b.querySelector('canvas');
      if (cv) drawThumb(cv, b.dataset.type);
    });
  }

  // --- Barre d'outils -----------------------------------------------------
  const toolButtons = document.querySelectorAll('[data-tool]');
  function setActiveTool(tool) {
    toolButtons.forEach((b) => b.classList.toggle('active', b.dataset.tool === tool));
    if (tool) document.querySelectorAll('.sym-btn').forEach((b) => b.classList.remove('active'));
  }
  toolButtons.forEach((b) => {
    b.addEventListener('click', () => {
      editor.setTool(b.dataset.tool);
      setActiveTool(b.dataset.tool);
    });
  });
  setActiveTool('select');

  // Actions
  document.getElementById('btn-rotate').addEventListener('click', () => editor.rotateSelection());
  document.getElementById('btn-delete').addEventListener('click', () => editor.deleteSelection());
  document.getElementById('btn-dup').addEventListener('click', () => editor.duplicateSelection());
  document.getElementById('btn-undo').addEventListener('click', () => editor.undo());
  document.getElementById('btn-redo').addEventListener('click', () => editor.redo());
  document.getElementById('btn-zoom-in').addEventListener('click', () => editor.zoomBy(1.2));
  document.getElementById('btn-zoom-out').addEventListener('click', () => editor.zoomBy(1 / 1.2));
  document.getElementById('btn-zoom-fit').addEventListener('click', () => editor.zoomFit());

  const tglSnap = document.getElementById('tgl-snap');
  tglSnap.addEventListener('click', () => {
    editor.snapEnabled = !editor.snapEnabled;
    tglSnap.classList.toggle('active', editor.snapEnabled);
  });
  const tglGrid = document.getElementById('tgl-grid');
  tglGrid.addEventListener('click', () => {
    editor.showGrid = !editor.showGrid;
    tglGrid.classList.toggle('active', editor.showGrid);
    editor.render();
  });

  // --- Fichier ------------------------------------------------------------
  document.getElementById('btn-new').addEventListener('click', () => {
    if (confirm('Effacer le schéma actuel ?')) editor.clearAll();
  });
  document.getElementById('btn-save').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(editor.serialize(), null, 2)], { type: 'application/json' });
    download(blob, 'schema.elec.json');
  });
  // --- Calque : plan importé (image) à décalquer ------------------------------
  const ulInput = document.getElementById('ul-input'), ulPanel = document.getElementById('ul-panel'), ulBtn = document.getElementById('btn-underlay');
  const ulSync = () => {
    const on = !!editor.underlay;
    ulBtn.classList.toggle('on', on);
    if (on) document.getElementById('ul-opacity').value = Math.round(editor.underlay.opacity * 100);
    document.querySelectorAll('#ul-panel [data-ul-tool]').forEach((b) => b.classList.toggle('on', editor.tool === b.dataset.ulTool));
  };
  const ulShow = (show) => {
    ulPanel.hidden = !show;
    if (!show) return;
    const r = ulBtn.getBoundingClientRect();
    ulPanel.style.left = Math.max(8, Math.min(window.innerWidth - ulPanel.offsetWidth - 8, r.left)) + 'px';
    ulPanel.style.top = r.bottom + 6 + 'px';
    ulSync();
  };
  ulBtn.addEventListener('click', () => {
    if (!editor.underlay) { ulInput.click(); return; }
    ulShow(ulPanel.hidden);
  });
  ulInput.addEventListener('change', () => {
    const f = ulInput.files[0];
    ulInput.value = '';
    if (!f) return;
    if (!/^image\//.test(f.type)) { showToast('Choisis une image du plan (PNG ou JPEG). Un PDF peut être exporté en image depuis sa visionneuse.', 4200); return; }
    const img = new Image(), url = URL.createObjectURL(f);
    img.onload = () => {
      // réduit à 2 400 px au plus (JPEG) : le calque tient dans le stockage du navigateur
      const k = Math.min(1, 2400 / Math.max(img.naturalWidth, img.naturalHeight));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.naturalWidth * k); cv.height = Math.round(img.naturalHeight * k);
      const g = cv.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
      g.drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      editor.setUnderlay(cv.toDataURL('image/jpeg', 0.85)).then((saved) => {
        ulShow(true);
        showToast('Plan importé en calque. <b>Mettre à l’échelle</b> : clique les deux bouts d’une cote connue. Puis trace les murs par-dessus (outil Mur).' +
          (saved ? '' : ' (Image trop lourde pour être gardée après fermeture.)'), 6000);
      });
    };
    img.onerror = () => { URL.revokeObjectURL(url); showToast('Image illisible.'); };
    img.src = url;
  });
  document.getElementById('ul-opacity').addEventListener('input', (e) => {
    if (!editor.underlay) return;
    editor.underlay.opacity = +e.target.value / 100;
    editor.render();
  });
  document.getElementById('ul-opacity').addEventListener('change', () => editor.saveUnderlay());
  ulPanel.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.ulTool) {
      editor.setTool(editor.tool === b.dataset.ulTool ? 'select' : b.dataset.ulTool);
      if (editor.tool === 'ul-calib') showToast('Clique le premier puis le second point d’une distance connue (une cote, un mur mesuré).', 4200);
      if (editor.tool === 'ul-move') showToast('Glisse le calque pour l’aligner sur ton dessin. Échap pour finir.', 3000);
    } else if (b.dataset.ul === 'replace') ulInput.click();
    else if (b.dataset.ul === 'remove') { editor.clearUnderlay(); ulShow(false); showToast('Calque retiré.'); }
    else if (b.dataset.ul === 'close') ulShow(false);
    ulSync();
  });
  editor.onCalibrate = (a, b) => {
    const v = prompt('Distance réelle entre ces deux points, en mètres :', '');
    const m = v === null ? NaN : parseFloat(String(v).replace(',', '.'));
    if (!(m > 0)) { showToast('Mise à l’échelle annulée.'); editor.setTool('select'); ulSync(); return; }
    editor.calibrateUnderlay(a, b, m);
    editor.setTool('select'); ulSync();
    if (!editor.components.length && !editor.wires.length) editor.zoomFit(); // le plan à la bonne échelle, en entier
    showToast(`Échelle réglée : ${String(m).replace('.', ',')} m entre les deux points. Les cotes des murs que tu traces sont maintenant justes.`, 4200);
  };
  window.addEventListener('pointerdown', (e) => { if (!ulPanel.hidden && !ulPanel.contains(e.target) && e.target !== ulBtn && !ulBtn.contains(e.target) && editor.tool !== 'ul-calib' && editor.tool !== 'ul-move') ulShow(false); });
  editor.restoreUnderlay().then((ok) => {
    ulSync();
    if (editor.underlay && !editor.components.length && !editor.wires.length) editor.zoomFit(); // reprise : le plan importé à l'écran
  });

  const fileInput = document.getElementById('file-input');
  document.getElementById('btn-open').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f) return;
    openFile(f);
    fileInput.value = '';
  });
  // Schéma ÉlectriCAD (.json) ou plan d'architecte (.dxf)
  function openFile(f) {
    const ext = (f.name.split('.').pop() || '').toLowerCase();
    if (ext === 'dwg') {
      showToast('Le <b>DWG</b> est un format fermé : dans AutoCAD, <i>Enregistrer sous › DXF</i> (ou convertis-le avec LibreCAD, QCAD ou ODA File Converter), puis importe le <b>.dxf</b>.', 9000);
      return;
    }
    const r = new FileReader();
    if (ext === 'dxf') {
      r.onload = () => {
        try { openDXF(parseDXF(decodeDXFBytes(r.result)), f.name.replace(/\.dxf$/i, '')); }
        catch (err) { showToast('Import DXF impossible : ' + _escHtml(err.message), 8000); }
      };
      r.readAsArrayBuffer(f);
      return;
    }
    r.onload = () => {
      try { editor.load(JSON.parse(r.result)); }
      catch (err) { alert('Fichier invalide : ' + err.message); }
    };
    r.readAsText(f);
  }
  document.getElementById('btn-png').addEventListener('click', () => {
    const url = editor.exportPNG();
    const a = document.createElement('a');
    a.href = url; a.download = 'schema.png'; a.click();
  });
  // Plan d'implantation : légende des symboles et repères de circuits dans les exports
  const planMeta = () => {
    const plan = editor.wires.some((w) => w.kind === 'wall');
    const d = plan && houseUI ? houseUI.design() : null;
    return { ...editor.meta, date: new Date().toISOString().slice(0, 10), legend: plan, tags: d && d.ok ? circuitTags(d) : null,
      routesSVG: d && d.ok && editor.showRoutes ? routesSVG(d, editor.components) : '' }; // câbles affichés : exportés aussi (SVG, impression)
  };
  document.getElementById('btn-svg').addEventListener('click', () => {
    const blob = new Blob([buildSVG(editor.components, editor.wires, SYMBOLS, planMeta())], { type: 'image/svg+xml' });
    download(blob, (editor.meta.title || 'schema') + '.svg');
  });
  document.getElementById('btn-dxf').addEventListener('click', () => {
    if (!editor.components.length && !editor.wires.length) { showToast('Rien à exporter : le plan est vide.'); return; }
    const dxf = buildDXF(editor.components, editor.wires, SYMBOLS, planMeta());
    download(new Blob([dxf], { type: 'application/dxf' }), (editor.meta.title || 'plan') + '.dxf');
    showToast('Plan exporté en DXF (mètres, un calque par nature d’objet) : s’ouvre dans AutoCAD, LibreCAD, DraftSight, QCAD…', 4200);
  });
  document.getElementById('btn-print').addEventListener('click', () => editor.print(buildSVG(editor.components, editor.wires, SYMBOLS, planMeta())));

  // Nom de fichier sûr partout (Windows, Android, systèmes sans UTF-8) : sans accents ni caractères interdits
  function fileName(name) {
    return String(name).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[–—]/g, '-').replace(/[’']/g, ' ')
      .replace(/[^\w .+()-]/g, '_').replace(/\s+/g, ' ').trim() || 'fichier';
  }
  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName(name);
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // --- Panneau de propriétés / barre d'état -------------------------------
  const propBox = document.getElementById('props');
  const labelInput = document.getElementById('prop-label');
  const valueInput = document.getElementById('prop-value');
  const labelWrap = document.getElementById('prop-label-wrap');
  const valueLbl = document.getElementById('prop-value-lbl');
  const propEmpty = document.getElementById('props-empty');
  const propType = document.getElementById('prop-type');

  const switchWrap = document.getElementById('prop-switch-wrap');
  const closedChk = document.getElementById('prop-closed');
  const onWrap = document.getElementById('prop-on-wrap');
  const onChk = document.getElementById('prop-on');
  const propCircuit = document.getElementById('prop-circuit');
  // Hauteur de pose des appareils muraux (cm) : vide = hauteur usuelle NF
  const WALL_MOUNT = new Set(['socket_wall', 'switch_sa', 'switch_vv_wall', 'rj45', 'wall_light']);
  const hWrap = document.getElementById('prop-h-wrap'), hInput = document.getElementById('prop-h');
  hInput.addEventListener('change', () => {
    const v = Math.round(+hInput.value);
    for (const id of editor.selection) {
      const c = editor.components.find((x) => x.id === id);
      if (!c || !WALL_MOUNT.has(c.type)) continue;
      if (v > 0) c.h = Math.max(5, Math.min(250, v)); else delete c.h;
    }
    editor.pushHistory(); editor.render();
    if (houseUI) houseUI.redesign();
    editor._emit();
  });
  onChk.addEventListener('change', () => {
    for (const id of editor.selection) {
      const c = editor.components.find((x) => x.id === id);
      if (c) c.on = onChk.checked;
    }
    editor.autosave(); editor.render();
  });
  function applyProps() {
    editor.updateSelectedProps(labelInput.value, valueInput.value);
  }
  labelInput.addEventListener('change', applyProps);
  valueInput.addEventListener('change', applyProps);
  closedChk.addEventListener('change', () => editor.toggleSelectedSwitch());

  // --- Cartouche / métadonnées projet ------------------------------------
  const metaTitle = document.getElementById('meta-title');
  const metaAuthor = document.getElementById('meta-author');
  metaTitle.addEventListener('change', () => { editor.meta.title = metaTitle.value; editor.autosave(); });
  metaAuthor.addEventListener('change', () => { editor.meta.author = metaAuthor.value; editor.autosave(); });

  // --- Onglets -----------------------------------------------------------
  const tabs = document.querySelectorAll('.tab');
  const panels = document.querySelectorAll('.tab-panel');
  let activeTab = 'props';
  tabs.forEach((t) => t.addEventListener('click', () => {
    activeTab = t.dataset.tab;
    tabs.forEach((x) => x.classList.toggle('active', x === t));
    panels.forEach((p) => (p.style.display = p.dataset.panel === activeTab ? '' : 'none'));
    if (activeTab === 'bom') renderBOM();
    if (activeTab === 'norm') renderNorm(true);
    if (activeTab === 'install' && houseUI) houseUI.refresh();
  }));

  // --- Contrôle NF C 15-100 (plan de maison) ------------------------------
  const normBox = document.getElementById('norm-report');
  const normTab = document.querySelector('.tab[data-tab="norm"]');
  let normKey = null;
  const STATUS_ICON = { ok: '✓', warn: '!', err: '✕' };
  // Espaces fermés sans étiquette : proposer de les étiqueter d'un clic
  function unlabeledHTML(list) {
    if (!list.length) return '';
    const m2 = list.reduce((t, r) => t + r.area, 0).toFixed(1).replace('.', ',');
    return `<div class="norm-unlabeled"><b>${list.length} espace${list.length > 1 ? 's' : ''} fermé${list.length > 1 ? 's' : ''} sans étiquette de pièce</b>` +
      `<span>${m2} m² ni comptés ni contrôlés.</span><button class="btn-primary" id="norm-label">Étiqueter ${list.length > 1 ? 'ces pièces' : 'cette pièce'}</button></div>`;
  }
  function bindUnlabeled(list) {
    const b = document.getElementById('norm-label');
    if (!b) return;
    b.addEventListener('click', () => {
      const added = [];
      for (const r of list) {
        const c = { id: editor.uid(), type: 'room', x: r.x, y: r.y, rot: 0, label: editor.nextRef('room'), value: 'Pièce' };
        editor.components.push(c); added.push(c.id);
      }
      editor.pushHistory();
      editor.selection = new Set(added.slice(0, 1));
      editor.render(); editor._emit();
      showTab('props');
      showToast('Étiquettes posées. Renomme chacune (Chambre, Séjour, Cuisine, Salle de bains…) : le type de pièce fixe les prises et l’éclairage exigés.', 6000);
    });
  }
  function renderNorm(force) {
    const rep = checkNFC15100(editor.components, editor.wires);
    const unl = rep.hasPlan ? unlabeledRooms(editor.components, editor.wires) : [];
    const key = JSON.stringify(rep) + unl.length;
    if (!force && key === normKey) return; // évite de reconstruire le panneau à chaque mouvement de souris
    normKey = key;
    if (rep.hasPlan && !rep.rooms.length && unl.length) { // des murs, aucune étiquette encore
      normBox.innerHTML = unlabeledHTML(unl) + '<p class="norm-foot">Chaque pièce a besoin d’une étiquette <b>Pièce</b> (palette « Plan de maison ») pour sa surface et le contrôle NF C 15-100.</p>';
      bindUnlabeled(unl);
      return;
    }
    if (!rep.hasPlan) {
      normBox.innerHTML =
        '<div class="norm-empty"><b>Aucun plan de maison</b>' +
        '<p>Trace des murs (<kbd>M</kbd>), pose une étiquette <b>Pièce</b> dans chaque pièce, puis l’appareillage : ' +
        'surfaces, prises exigées et éclairage sont contrôlés en direct.</p>' +
        '<button id="norm-load-ex" class="btn-primary">Ouvrir l’exemple Maison T2</button></div>';
      document.getElementById('norm-load-ex').addEventListener('click', () => loadExample(EXAMPLES.find((e) => e.id === 'maison')));
      return;
    }
    const verdict = rep.errors ? 'err' : rep.warnings || !rep.rooms.length ? 'warn' : 'ok';
    const title = rep.errors
      ? `${rep.errors} non-conformité${rep.errors > 1 ? 's' : ''}`
      : verdict === 'warn' ? 'À vérifier' : 'Installation conforme';
    const area = rep.rooms.reduce((s, r) => s + (r.area || 0), 0);
    const sockets = rep.rooms.reduce((s, r) => s + r.sockets, 0);
    let html =
      `<div class="norm-verdict v-${verdict}"><span class="nv-icon">${STATUS_ICON[verdict]}</span>` +
      `<div><b>${title}</b><span>Contrôle simplifié NF C 15-100</span></div></div>` +
      `<div class="norm-kpis"><div><b>${rep.rooms.length}</b><span>pièce${rep.rooms.length > 1 ? 's' : ''}</span></div>` +
      `<div><b>${area.toFixed(1).replace('.', ',')}</b><span>m² habitables</span></div>` +
      `<div><b>${sockets}</b><span>prise${sockets > 1 ? 's' : ''}</span></div></div>` + unlabeledHTML(unl);
    for (const r of rep.rooms) {
      const req = r.socketsReq;
      const pct = req ? Math.min(100, (r.sockets / req) * 100) : 100;
      html +=
        `<div class="nr-card st-${r.status}" data-id="${r.id}" title="Cliquer pour centrer la pièce">` +
        `<div class="nr-top"><span class="nr-dot" style="background:${r.color}"></span><b>${_escHtml(r.name)}</b>` +
        `<span class="nr-area">${r.area ? fmtArea(r.area) : '—'}</span><span class="nr-st">${STATUS_ICON[r.status]}</span></div>`;
      if (req !== null) {
        html += `<div class="nr-row"><span>Prises</span><div class="nr-bar"><i style="width:${pct}%"></i></div><b>${r.sockets} / ${req}</b></div>`;
      }
      if (r.area) {
        html += `<div class="nr-row"><span>Éclairage</span><em>${r.lights} point${r.lights > 1 ? 's' : ''} · ${r.switches} commande${r.switches > 1 ? 's' : ''}</em></div>`;
      }
      for (const m of r.msgs) html += `<div class="nr-msg">${_escHtml(m)}</div>`;
      if (r.note && r.status !== 'err') html += `<div class="nr-note">${r.typeLabel} : ${r.note}</div>`;
      html += '</div>';
    }
    html += '<ul class="erc">';
    for (const g of rep.global) {
      const ic = g.level === 'err' ? '❌' : g.level === 'warn' ? '⚠️' : '✅';
      html += `<li${g.compId ? ' class="clickable" data-id="' + g.compId + '"' : ''}>${ic} ${_escHtml(g.msg)}</li>`;
    }
    html += '</ul>';
    const onStud = rep.global.filter((g) => /sur un montant|sur une fourrure/.test(g.msg)).length;
    if (onStud) html += `<button type="button" class="btn-ghost norm-fix" id="norm-fix-studs">Décaler ${onStud > 1 ? `les ${onStud} boîtes` : 'la boîte'} hors des montants</button>`;
    // Autocontrôle avant le Consuel : points vérifiés sur le plan et le tableau, puis cases à cocher sur place
    if (typeof selfCheckList === 'function') {
      const d = houseUI && houseUI.design();
      const L = selfCheckList(rep, d && d.ok ? d : null), done = (editor.meta && editor.meta.selfcheck) || {};
      const ic = { ok: '✅', warn: '⚠️', err: '❌', todo: '☐' };
      const nDone = L.manual.filter((_, i) => done[i]).length;
      html += `<div class="norm-self"><h4>Autocontrôle avant le Consuel</h4><ul class="erc">` +
        L.auto.map((x) => `<li>${ic[x.st]} ${_escHtml(x.label)}${x.note ? ` <em>— ${_escHtml(x.note)}</em>` : ''}</li>`).join('') + '</ul>' +
        `<p class="norm-self-sub">Sur place <b>${nDone} / ${L.manual.length}</b> :</p>` +
        L.manual.map((m, i) => `<label class="check-row norm-self-item"><input type="checkbox" data-self="${i}"${done[i] ? ' checked' : ''}> ${_escHtml(m)}</label>`).join('') + '</div>';
    }
    html += '<p class="norm-foot">Contrôle indicatif (nombre de prises, éclairage, GTL). Il ne remplace pas la vérification d’un professionnel ni l’attestation Consuel.</p>';
    normBox.innerHTML = html;
    bindUnlabeled(unl);
    normBox.querySelectorAll('[data-self]').forEach((el) => el.addEventListener('change', () => {
      const m = editor.meta.selfcheck = { ...(editor.meta.selfcheck || {}) };
      if (el.checked) m[el.dataset.self] = true; else delete m[el.dataset.self];
      editor.autosave(); renderNorm(true);
    }));
    normBox.querySelectorAll('[data-id]').forEach((el) => el.addEventListener('click', () => editor.focusComponent(el.dataset.id)));
    const fx = document.getElementById('norm-fix-studs');
    if (fx) fx.addEventListener('click', () => {
      const n = fixStudBoxes(editor.components, editor.wires);
      editor.pushHistory(); editor.render(); editor._emit();
      showToast(`${n} boîte${n > 1 ? 's' : ''} décalée${n > 1 ? 's' : ''} de quelques centimètres, entre deux montants. Annulable (Ctrl+Z).`, 3500);
    });
  }
  function _escHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
  // Pastille de statut sur l'onglet « Norme » (visible dès qu'il y a un plan)
  function updateNormDot() {
    const rep = checkNFC15100(editor.components, editor.wires);
    const st = !rep.hasPlan ? '' : rep.errors ? 'err' : rep.warnings || !rep.rooms.length ? 'warn' : 'ok';
    normTab.dataset.status = st;
    return rep;
  }

  // --- Nomenclature (BOM) ------------------------------------------------
  const bomTable = document.getElementById('bom-table');
  let bomExtra = null; // matériel et budget (installation de maison), branché plus bas
  function renderBOM() {
    const rows = buildBOM(editor.components, SYMBOLS);
    if (!rows.length) { bomTable.innerHTML = '<div class="empty">Aucun composant.</div>'; lastBomHtml = ''; return; }
    let html = bomExtra ? bomExtra.html() : '';
    if (html) html += '<h4 class="bom-sub">Nomenclature du plan</h4>';
    html += '<table><thead><tr><th>Réf.</th><th>Composant</th><th>Valeur</th><th>Qté</th></tr></thead><tbody>';
    for (const r of rows) html += `<tr><td>${r.refs.join(', ')}</td><td>${r.name}</td><td>${r.value || '—'}</td><td>${r.qty}</td></tr>`;
    html += '</tbody></table>';
    // pas de reconstruction si rien n'a changé : un clic en cours n'est pas perdu
    if (html === lastBomHtml) return;
    lastBomHtml = html;
    bomTable.innerHTML = html;
  }
  let lastBomHtml = '';
  bomTable.addEventListener('click', (e) => { if (e.target.closest('[data-mat-csv]') && bomExtra) bomExtra.csv(); });
  document.getElementById('btn-csv').addEventListener('click', () => {
    const rows = buildBOM(editor.components, SYMBOLS);
    let csv = 'Reference;Composant;Valeur;Quantite\n';
    for (const r of rows) csv += `"${r.refs.join(', ')}";"${r.name}";"${r.value}";${r.qty}\n`;
    download(new Blob(['﻿' + csv], { type: 'text/csv' }), 'nomenclature.csv');
  });

  // --- Simulation --------------------------------------------------------
  const simStatus = document.getElementById('sim-status');
  const simResults = document.getElementById('sim-results');
  function runSim() {
    const r = editor.runSim();
    let html = '';
    if (r.warnings.length) html += '<div class="warn">⚠️ ' + r.warnings.join('<br>⚠️ ') + '</div>';
    if (r.ok) {
      simStatus.textContent = '✅ Simulation OK — tensions (vert) et courants (orange) affichés sur le schéma.';
      const comps = editor.components.filter((c) => r.compI[c.id] !== undefined)
        .sort((a, b) => (a.label || '').localeCompare(b.label || ''));
      if (comps.length) {
        html += '<table><thead><tr><th>Réf.</th><th>Courant</th></tr></thead><tbody>';
        for (const c of comps) html += `<tr><td>${c.label || c.type}</td><td>${fmtAmp(r.compI[c.id])}</td></tr>`;
        html += '</tbody></table>';
      }
    } else {
      simStatus.textContent = '❌ Simulation impossible.';
    }
    simResults.innerHTML = html;
  }
  const scope = document.getElementById('scope');
  document.getElementById('btn-sim').addEventListener('click', () => { showTab('sim'); runSim(); });
  document.getElementById('btn-sim2').addEventListener('click', runSim);
  document.getElementById('btn-sim-stop').addEventListener('click', () => {
    editor.clearSim();
    simStatus.textContent = 'Simulation arrêtée.';
    simResults.innerHTML = '';
    scope.style.display = 'none';
  });
  document.getElementById('btn-scope-png').addEventListener('click', () => {
    if (scope.style.display === 'none') { showToast('Lance d’abord une analyse Transitoire, Bode ou Logique.'); return; }
    const a = document.createElement('a');
    a.href = scope.toDataURL('image/png');
    a.download = fileName((editor.meta.title || 'graphique') + '.png');
    a.click();
  });

  // Analyse transitoire (oscilloscope)
  document.getElementById('btn-trans').addEventListener('click', () => {
    editor.clearSim();
    const f = parseFloat(document.getElementById('trans-f').value) || 50;
    const time = parseFloat(document.getElementById('trans-t').value) || 60;
    const res = simulateTransient(editor.components, editor.wires, SYMBOLS, { f, time });
    let html = '';
    if (res.warnings && res.warnings.length) html += '<div class="warn">⚠️ ' + res.warnings.join('<br>⚠️ ') + '</div>';
    if (res.ok) {
      simStatus.textContent = `📈 Transitoire sur ${time} ms — ${res.series.length} net(s) tracé(s).`;
      drawScope(res);
    } else {
      simStatus.textContent = '❌ Transitoire impossible.';
      scope.style.display = 'none';
    }
    simResults.innerHTML = html;
  });

  // Analyse fréquentielle (Bode)
  document.getElementById('btn-bode').addEventListener('click', () => {
    editor.clearSim();
    const res = simulateAC(editor.components, editor.wires, SYMBOLS, { fmin: 1, fmax: 1e6, pts: 120 });
    let html = '';
    if (res.warnings && res.warnings.length) html += '<div class="warn">⚠️ ' + res.warnings.join('<br>⚠️ ') + '</div>';
    if (res.ok) {
      simStatus.textContent = '〰️ Réponse en fréquence (1 Hz → 1 MHz) — gain (haut) et phase (bas).';
      drawBode(res);
    } else {
      simStatus.textContent = '❌ Bode impossible.';
      scope.style.display = 'none';
    }
    simResults.innerHTML = html;
  });

  // Simulation logique (chronogramme)
  document.getElementById('btn-logic').addEventListener('click', () => {
    editor.clearSim();
    const res = simulateDigital(editor.components, editor.wires, SYMBOLS, {});
    let html = '';
    if (res.warnings && res.warnings.length) html += '<div class="warn">⚠️ ' + res.warnings.join('<br>⚠️ ') + '</div>';
    if (res.ok) {
      simStatus.textContent = '🔢 Simulation logique — chronogramme des signaux.';
      drawTiming(res);
      editor.render(); // met à jour les indicateurs de sortie
    } else {
      simStatus.textContent = '❌ Simulation logique impossible.';
      scope.style.display = 'none';
    }
    simResults.innerHTML = html;
  });

  // ERC : vérification des règles électriques
  document.getElementById('btn-erc').addEventListener('click', () => {
    editor.clearSim();
    scope.style.display = 'none';
    const issues = runERC(editor.components, editor.wires, SYMBOLS);
    simStatus.textContent = '🔍 Vérification des règles électriques (ERC) :';
    let html = '<ul class="erc">';
    for (const it of issues) {
      const ic = it.level === 'err' ? '❌' : it.level === 'warn' ? '⚠️' : '✅';
      const cls = it.compId ? ' class="clickable" data-id="' + it.compId + '"' : '';
      html += `<li${cls}>${ic} ${it.msg}</li>`;
    }
    html += '</ul>';
    simResults.innerHTML = html;
    simResults.querySelectorAll('.erc .clickable').forEach((li) => {
      li.addEventListener('click', () => editor.focusComponent(li.dataset.id));
    });
  });

  const SCOPE_COLORS = ['#5ce08a', '#7fd1ff', '#ffb454', '#ff7a90', '#c08bff', '#ffe06a', '#6ad7d0', '#ff9d5c'];
  function drawScope(res) {
    scope.style.display = 'block';
    const W = scope.clientWidth || 260, H = 180;
    const dpr = window.devicePixelRatio || 1;
    scope.width = W * dpr; scope.height = H * dpr;
    const ctx = scope.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0d1016'; ctx.fillRect(0, 0, W, H);
    const padL = 38, padB = 18, padT = 8, padR = 6;
    const x0 = padL, x1 = W - padR, y0 = padT, y1 = H - padB;
    // bornes
    let vmin = Infinity, vmax = -Infinity;
    for (const s of res.series) for (const v of s.values) { vmin = Math.min(vmin, v); vmax = Math.max(vmax, v); }
    if (!isFinite(vmin)) { vmin = -1; vmax = 1; }
    if (vmax - vmin < 1e-9) { vmax += 1; vmin -= 1; }
    const pad = (vmax - vmin) * 0.1; vmin -= pad; vmax += pad;
    const tmax = res.t[res.t.length - 1] || 1;
    const sx = (t) => x0 + (t / tmax) * (x1 - x0);
    const sy = (v) => y1 - ((v - vmin) / (vmax - vmin)) * (y1 - y0);
    // grille + axes
    ctx.strokeStyle = '#222a36'; ctx.lineWidth = 1; ctx.fillStyle = '#6b7888'; ctx.font = '9px sans-serif';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let i = 0; i <= 4; i++) {
      const v = vmin + (i / 4) * (vmax - vmin), y = sy(v);
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
      ctx.fillText(v.toFixed(1), x0 - 4, y);
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let i = 0; i <= 4; i++) {
      const t = (i / 4) * tmax, x = sx(t);
      ctx.fillText(t.toFixed(0), x, y1 + 4);
    }
    ctx.fillStyle = '#8a97ab'; ctx.fillText('ms', x1, y1 + 4);
    // courbes
    res.series.forEach((s, i) => {
      ctx.strokeStyle = SCOPE_COLORS[i % SCOPE_COLORS.length]; ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let k = 0; k < s.values.length; k++) {
        const X = sx(res.t[k]), Y = sy(s.values[k]);
        k ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y);
      }
      ctx.stroke();
    });
    // légende
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.font = '9px sans-serif';
    res.series.forEach((s, i) => {
      const ly = y0 + 8 + i * 12;
      ctx.fillStyle = SCOPE_COLORS[i % SCOPE_COLORS.length];
      ctx.fillRect(x0 + 4, ly - 3, 10, 6);
      ctx.fillStyle = '#aebacb'; ctx.fillText(s.label, x0 + 18, ly);
    });
  }

  function drawBode(res) {
    scope.style.display = 'block';
    const W = scope.clientWidth || 260, H = 220;
    const dpr = window.devicePixelRatio || 1;
    scope.width = W * dpr; scope.height = H * dpr;
    const ctx = scope.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0d1016'; ctx.fillRect(0, 0, W, H);
    const padL = 40, padR = 6;
    const x0 = padL, x1 = W - padR;
    const f0 = res.freqs[0], f1 = res.freqs[res.freqs.length - 1];
    const lf0 = Math.log10(f0), lf1 = Math.log10(f1);
    const sx = (f) => x0 + (Math.log10(f) - lf0) / (lf1 - lf0) * (x1 - x0);

    // bornes magnitude
    let mmin = Infinity, mmax = -Infinity;
    for (const s of res.series) for (const v of s.mag) { if (isFinite(v)) { mmin = Math.min(mmin, v); mmax = Math.max(mmax, v); } }
    if (!isFinite(mmin)) { mmin = -60; mmax = 0; }
    mmax = Math.ceil((mmax + 3) / 10) * 10; mmin = Math.floor((mmin - 3) / 10) * 10;
    if (mmax - mmin < 10) mmax = mmin + 10;

    function panel(yT, yB, vmin, vmax, get, unit, dash) {
      const sy = (v) => yB - (v - vmin) / (vmax - vmin) * (yB - yT);
      ctx.strokeStyle = '#222a36'; ctx.lineWidth = 1; ctx.fillStyle = '#6b7888'; ctx.font = '9px sans-serif';
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      for (let i = 0; i <= 4; i++) { const v = vmin + i / 4 * (vmax - vmin), y = sy(v); ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke(); ctx.fillText(v.toFixed(0), x0 - 4, y); }
      // décades verticales
      for (let d = Math.ceil(lf0); d <= Math.floor(lf1); d++) { const x = sx(Math.pow(10, d)); ctx.beginPath(); ctx.moveTo(x, yT); ctx.lineTo(x, yB); ctx.stroke(); }
      ctx.fillStyle = '#8a97ab'; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(unit, x0 + 2, yT + 1);
      res.series.forEach((s, i) => {
        ctx.strokeStyle = SCOPE_COLORS[i % SCOPE_COLORS.length]; ctx.lineWidth = 1.5;
        ctx.setLineDash(dash ? [3, 2] : []);
        ctx.beginPath();
        const arr = get(s);
        for (let k = 0; k < arr.length; k++) { const X = sx(res.freqs[k]), Y = sy(Math.max(vmin, Math.min(vmax, arr[k]))); k ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }
        ctx.stroke();
      });
      ctx.setLineDash([]);
    }
    panel(8, H * 0.5 - 6, mmin, mmax, (s) => s.mag, 'dB');
    panel(H * 0.5 + 8, H - 16, -180, 180, (s) => s.phase, '°');
    // axe fréquence
    ctx.fillStyle = '#8a97ab'; ctx.font = '9px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let d = Math.ceil(lf0); d <= Math.floor(lf1); d++) {
      const f = Math.pow(10, d), lbl = f >= 1e6 ? '1M' : f >= 1e3 ? (f / 1e3) + 'k' : '' + f;
      ctx.fillText(lbl, sx(f), H - 12);
    }
    ctx.textAlign = 'right'; ctx.fillText('Hz', x1, H - 12);
  }

  function drawTiming(res) {
    scope.style.display = 'block';
    const rows = res.signals.length || 1;
    const rowH = 26;
    const W = scope.clientWidth || 260, H = Math.max(120, rows * rowH + 24);
    const dpr = window.devicePixelRatio || 1;
    scope.width = W * dpr; scope.height = H * dpr;
    const ctx = scope.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0d1016'; ctx.fillRect(0, 0, W, H);
    const padL = 44, padR = 8;
    const x0 = padL, x1 = W - padR;
    const tmax = res.t[res.t.length - 1] || 1;
    const sx = (tt) => x0 + (tt / tmax) * (x1 - x0);
    ctx.font = '10px sans-serif';
    res.signals.forEach((s, i) => {
      const top = 8 + i * rowH, hi = top + 3, lo = top + rowH - 9;
      // étiquette
      ctx.fillStyle = '#aebacb'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText(s.label, x0 - 6, (hi + lo) / 2);
      // ligne de base
      ctx.strokeStyle = '#1e2430'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x0, lo); ctx.lineTo(x1, lo); ctx.stroke();
      // signal
      ctx.strokeStyle = SCOPE_COLORS[i % SCOPE_COLORS.length]; ctx.lineWidth = 1.6;
      ctx.beginPath();
      let prev = s.values[0];
      ctx.moveTo(sx(res.t[0]), prev ? hi : lo);
      for (let k = 1; k < s.values.length; k++) {
        const X = sx(res.t[k]);
        if (s.values[k] !== prev) { ctx.lineTo(X, prev ? hi : lo); ctx.lineTo(X, s.values[k] ? hi : lo); prev = s.values[k]; }
        else ctx.lineTo(X, prev ? hi : lo);
      }
      ctx.stroke();
    });
    // axe temps
    ctx.fillStyle = '#8a97ab'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    for (let i = 0; i <= 4; i++) { const tt = (i / 4) * tmax; ctx.fillText(tt.toFixed(tt < 10 ? 1 : 0), sx(tt), H - 2); }
    ctx.textAlign = 'right'; ctx.fillText(res.unit || 'ms', x1, H - 2);
  }
  function showTab(name) {
    activeTab = name;
    tabs.forEach((x) => x.classList.toggle('active', x.dataset.tab === name));
    panels.forEach((p) => (p.style.display = p.dataset.panel === name ? '' : 'none'));
    if (name === 'bom') renderBOM();
    if (name === 'norm') renderNorm(true);
    if (name === 'install' && houseUI) houseUI.refresh();
  }

  // --- Toast ---------------------------------------------------------------
  const toast = document.getElementById('toast');
  let toastTimer = null;
  function showToast(html, ms) {
    toast.innerHTML = html;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, ms || 4200);
  }

  // --- Modal des exemples ---------------------------------------------------
  const modal = document.getElementById('examples-modal');
  const exGrid = document.getElementById('examples-grid');
  const SIM_TAB_BTN = { dc: 'btn-sim2', trans: 'btn-trans', bode: 'btn-bode', logic: 'btn-logic' };

  function renderExThumb(cv, data) {
    const dpr = window.devicePixelRatio || 1;
    const W = 218, H = 110;
    cv.width = W * dpr; cv.height = H * dpr;
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Boîte englobante du circuit
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const acc = (x, y) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };
    for (const c of data.components) { const b = SYMBOLS[c.type].bbox; acc(c.x + b.x, c.y + b.y); acc(c.x + b.x + b.w, c.y + b.y + b.h); }
    for (const w of data.wires) for (const p of w.points) acc(p.x, p.y);
    const s = Math.min((W - 24) / (maxX - minX), (H - 20) / (maxY - minY), 0.6);
    ctx.translate(W / 2 - (minX + maxX) / 2 * s, H / 2 - (minY + maxY) / 2 * s);
    ctx.scale(s, s);
    // Plan de maison : pièces teintées et surfaces sur les étiquettes
    if (data.wires.some((w) => w.kind === 'wall')) {
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
    const col = thumbColor();
    ctx.strokeStyle = col; ctx.fillStyle = col;
    ctx.lineWidth = 1.6 / s; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const w of data.wires) {
      ctx.lineWidth = (w.kind === 'wall' ? 7 : w.kind === 'conduit' ? 3.5 : 1.6) / s;
      ctx.globalAlpha = w.kind === 'conduit' ? 0.55 : 1;
      ctx.beginPath();
      w.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.lineWidth = 1.6 / s;
    for (const j of computeJunctions(data.components, data.wires, SYMBOLS)) {
      ctx.beginPath(); ctx.arc(j.x, j.y, 3 / s, 0, Math.PI * 2); ctx.fill();
    }
    for (const c of data.components) {
      ctx.save(); ctx.translate(c.x, c.y); ctx.rotate((c.rot * Math.PI) / 180);
      SYMBOLS[c.type].draw(ctx, c); ctx.restore();
    }
  }

  function buildExamplesGrid() {
    exGrid.innerHTML = '';
    for (const ex of EXAMPLES) {
      const card = document.createElement('button');
      card.className = 'ex-card';
      const cv = document.createElement('canvas');
      cv.className = 'ex-thumb';
      renderExThumb(cv, ex.data);
      const name = document.createElement('div');
      name.className = 'ex-name'; name.textContent = ex.name;
      const desc = document.createElement('div');
      desc.className = 'ex-desc'; desc.textContent = ex.desc;
      const badges = document.createElement('div');
      badges.className = 'ex-badges';
      badges.innerHTML = `<span class="badge level">${ex.level}</span><span class="badge sim-${ex.sim}">${ex.simLabel}</span>`;
      card.append(cv, name, desc, badges);
      card.addEventListener('click', () => loadExample(ex));
      exGrid.appendChild(card);
    }
  }

  function loadExample(ex) {
    if ((editor.components.length || editor.wires.length) &&
        !confirm('Remplacer le schéma actuel par « ' + ex.name + ' » ?')) return;
    editor.load(getExampleData(ex.id));
    closeModal();
    let btnId;
    if (ex.sim === 'plan') {
      // surfaces et conformité pièce par pièce, ou tableau simulé pour les maisons équipées
      showTab(ex.id.startsWith('maison-') ? 'install' : 'norm');
      showToast(`<b>${ex.name}</b> chargé — clique <b>3D</b> pour visiter la maison !`);
      btnId = 'btn-3d';
    } else {
      showTab('sim');
      showToast(`<b>${ex.name}</b> chargé — lance l'analyse « ${ex.simLabel} » dans le panneau Simulation.`);
      btnId = SIM_TAB_BTN[ex.sim] || 'btn-sim2';
    }
    const btn = document.getElementById(btnId);
    if (btn) { btn.style.outline = '2px solid var(--accent)'; setTimeout(() => { btn.style.outline = ''; }, 2600); }
  }

  function openModal() {
    buildExamplesGrid();
    modal.hidden = false;
    document.body.classList.add('modal-open');
  }
  function closeModal() {
    modal.hidden = true;
    document.body.classList.remove('modal-open');
  }
  document.getElementById('btn-examples').addEventListener('click', openModal);
  document.getElementById('es-examples').addEventListener('click', openModal);
  document.getElementById('modal-close').addEventListener('click', closeModal);
  modal.querySelector('.modal-backdrop').addEventListener('click', closeModal);
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) closeModal(); }, true);

  // --- Maison, tableau simulé, vue 3D (house-ui.js) -------------------------
  let boardUI = null;
  const houseUI = initHouseUI({
    editor, showTab, showToast, download, fileName, esc: _escHtml,
    activeTab: () => activeTab, renderThumb: renderExThumb,
    openBoard: () => boardUI && boardUI.open(),
  });
  // --- Tableau électrique et schéma unifilaire (board-ui.js) ------------------
  boardUI = initBoardUI({ editor, houseUI, showToast, download, fileName, esc: _escHtml });
  bomExtra = { html: houseUI.materialsHTML, csv: houseUI.exportMaterials };

  // --- Import d'un plan DXF (AutoCAD, LibreCAD, ArchiCAD, Revit…) ------------
  const dxfModal = document.getElementById('dxf-modal');
  const dxf = { P: null, name: '', walls: new Set(), im: null, err: null, levels: true, levelsSeen: false };
  const $d = (id) => document.getElementById(id);
  const UNIT_NAMES = { 0.1: 'millimètres', 1: 'centimètres', 10: 'décimètres', 100: 'mètres', 2.54: 'pouces', 30.48: 'pieds' };
  function openDXF(P, name) {
    const g = dxfGuessLayers(P);
    if (!g.info.some((l) => l.segs)) throw new Error('aucun trait dans ce fichier.');
    Object.assign(dxf, { P, name, walls: new Set(g.walls), levels: true, levelsSeen: false });
    $d('dxf-units').value = 'auto';
    $d('dxf-levels').checked = true;
    $d('dxf-layers').innerHTML = g.info.filter((l) => l.segs).slice(0, 80).map((l) =>
      `<label class="dxf-layer"><input type="checkbox" value="${_escHtml(l.name)}"${dxf.walls.has(l.name) ? ' checked' : ''} />` +
      `<span class="dxf-ln" title="${_escHtml(l.name)}">${_escHtml(l.name)}${l.guess === 'menuiseries' ? ' <em>menuiseries</em>' : ''}</span>` +
      `<small>${l.segs}</small></label>`).join('');
    $d('dxf-sub').textContent = `${name} — ${Object.keys(P.layers).length} calques, ${P.segs.length} traits, ${P.texts.length} textes`;
    dxfModal.hidden = false;
    document.body.classList.add('modal-open');
    dxfUpdate();
  }
  function closeDXF() { dxfModal.hidden = true; document.body.classList.remove('modal-open'); dxf.P = dxf.im = null; }
  function dxfUpdate() {
    const u = $d('dxf-units').value, opts = { layers: [...dxf.walls], levels: dxf.levels };
    if (u !== 'auto') opts.scale = +u;
    const auto = dxfScale(dxf.P, opts.layers);
    $d('dxf-units').options[0].textContent = `Automatique : ${UNIT_NAMES[auto.scale] || auto.scale + ' cm'}${auto.guessed ? ' (deviné)' : ''}`;
    try { dxf.im = dxf.walls.size ? importDXFPlan(dxf.P, opts) : null; dxf.err = null; }
    catch (err) { dxf.im = null; dxf.err = err.message; }
    const im = dxf.im, st = $d('dxf-stats'), warn = [];
    let html = '';
    if (im && im.wires.length) {
      const s = im.stats, n = (k, one, many) => `${k} ${k > 1 ? many : one}`;
      const info = computeRooms(im.components, im.wires);
      const open = info.rooms.filter((r) => r.leaked).map((r) => r.name);
      const f1 = (v) => v.toFixed(1).replace('.', ',');
      html = `<b>${f1(s.size[0])} × ${f1(s.size[1])} m</b> · ${n(s.walls, 'mur', 'murs')} (${s.ext} extérieur${s.ext > 1 ? 's' : ''}) · ` +
        `${n(s.doors, 'porte', 'portes')} · ${n(s.windows, 'fenêtre', 'fenêtres')}${s.garages ? ' · ' + n(s.garages, 'porte de garage', 'portes de garage') : ''} · ${n(s.rooms, 'pièce nommée', 'pièces nommées')}`;
      if (s.levels.length > 1) {
        html += ` · <b>${s.levels.length} niveaux</b> : ${_escHtml(s.levels.join(', '))}${s.stairs ? ', escalier' : ''}`;
        if (!s.stairs) warn.push('Aucun escalier reconnu : pose-le sur les deux plans (Architecture › Escalier droit) pour relier les niveaux.');
      }
      if (Math.max(...s.size) > 60 || Math.max(...s.size) < 3) warn.push(`Plan de ${f1(Math.max(...s.size))} m : vérifie les unités.`);
      if (open.length) warn.push(`Pièce${open.length > 1 ? 's' : ''} non fermée${open.length > 1 ? 's' : ''} : ${_escHtml(open.join(', '))}. Un calque de murs manque peut-être.`);
      if (!s.rooms) warn.push('Aucun nom de pièce lu sur le plan : ajoute des étiquettes <b>Pièce</b> après l’import (surfaces, contrôle NF, implantation).');
    } else {
      warn.push(dxf.err ? _escHtml(dxf.err) : 'Aucun mur reconnu : coche le ou les calques qui contiennent les murs.');
    }
    st.innerHTML = html + warn.map((w) => `<span class="dxf-warn">${w}</span>`).join('');
    if (im && im.stats.levels.length > 1) dxf.levelsSeen = true;
    $d('dxf-levels-row').hidden = !dxf.levelsSeen;
    $d('dxf-go').disabled = !(im && im.wires.length);
    drawDXFPreview();
  }
  function drawDXFPreview() {
    const cv = $d('dxf-preview'), dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth || 560, H = cv.clientHeight || 360;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const P = dxf.P, im = dxf.im;
    if (!P) return;
    const css = getComputedStyle(document.body), col = (v) => css.getPropertyValue(v).trim();
    const sc = im ? im.stats.scale : dxfScale(P).scale, off = im ? im.offset : { x: 0, y: 0 };
    const X = (x) => x * sc + off.x, Y = (y) => -y * sc + off.y;
    // avec des niveaux, chaque plan du dessin suit son déplacement
    const seg = (g) => {
      if (!im || !im.levels) return [X(g.ax), Y(g.ay), X(g.bx), Y(g.by)];
      const d = im.shiftAt(((g.ax + g.bx) / 2) * sc, (-(g.ay + g.by) / 2) * sc);
      return [g.ax * sc + d.x, -g.ay * sc + d.y, g.bx * sc + d.x, -g.by * sc + d.y];
    };
    // Cadrage : les murs importés (sinon tout le dessin)
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const acc = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
    if (im && im.wires.length) for (const w of im.wires) for (const p of w.points) acc(p.x, p.y);
    else for (const g of P.segs) { const q = seg(g); acc(q[0], q[1]); acc(q[2], q[3]); }
    if (im && im.levels) for (const c of im.components) if (c.type === 'level_title') acc(c.x, c.y - 40);
    if (!isFinite(x0)) return;
    const s = Math.min((W - 40) / Math.max(1, x1 - x0), (H - 40) / Math.max(1, y1 - y0));
    const tx = W / 2 - ((x0 + x1) / 2) * s, ty = H / 2 - ((y0 + y1) / 2) * s;
    ctx.save();
    ctx.translate(tx, ty); ctx.scale(s, s);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // Dessin d'origine, en filigrane (calques des murs en bleu)
    for (const wall of [false, true]) {
      ctx.beginPath();
      for (const g of P.segs) {
        if (dxf.walls.has(g.layer) !== wall) continue;
        const q = seg(g);
        ctx.moveTo(q[0], q[1]); ctx.lineTo(q[2], q[3]);
      }
      ctx.strokeStyle = wall ? col('--accent') : col('--faint');
      ctx.globalAlpha = wall ? 0.45 : 0.35; ctx.lineWidth = 1 / s; ctx.stroke();
    }
    ctx.globalAlpha = 1;
    const labels = [];
    if (im && im.wires.length) {
      // Pièces teintées
      const info = computeRooms(im.components, im.wires);
      info.rooms.forEach((room, i) => {
        if (room.leaked || room.sharedWith !== null) return;
        ctx.beginPath();
        let rx0 = Infinity, rx1 = -Infinity;
        for (const r of roomRuns(info, i)) { ctx.rect(r.x, r.y, r.w, r.h); rx0 = Math.min(rx0, r.x); rx1 = Math.max(rx1, r.x + r.w); }
        ctx.fillStyle = room.color; ctx.globalAlpha = 0.2; ctx.fill(); ctx.globalAlpha = 1;
        const lab = im.components.find((c) => c.id === room.id);
        if (lab) labels.push({ x: lab.x, y: lab.y, name: room.name, area: room.area, w: rx1 - rx0 });
      });
      // Murs à leur épaisseur
      ctx.strokeStyle = col('--text');
      for (const w of im.wires) {
        ctx.lineWidth = w.ext ? 20 : 10;
        ctx.beginPath(); ctx.moveTo(w.points[0].x, w.points[0].y); ctx.lineTo(w.points[1].x, w.points[1].y); ctx.stroke();
      }
      // Portes et fenêtres
      for (const c of im.components) {
        if (c.type === 'room' || c.type === 'level_title') continue;
        ctx.save(); ctx.translate(c.x, c.y); ctx.rotate((c.rot * Math.PI) / 180);
        ctx.strokeStyle = c.type === 'door' ? '#ffb454' : c.type === 'stairs' ? col('--muted') : '#4fd1e8'; ctx.lineWidth = (c.type === 'stairs' ? 1.5 : 3) / s;
        SYMBOLS[c.type].draw(ctx, c);
        ctx.restore();
      }
    }
    ctx.restore();
    // Noms des pièces et des niveaux (à taille d'écran)
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = col('--text');
    if (im) for (const c of im.components) {
      if (c.type !== 'level_title') continue;
      ctx.font = '700 12px system-ui, sans-serif';
      ctx.fillText(c.value.toUpperCase(), tx + c.x * s, ty + c.y * s + 10);
    }
    for (const l of labels) {
      // texte réduit pour tenir dans la pièce (petites pièces, petit écran)
      const px = tx + l.x * s, py = ty + l.y * s, room = l.w * s - 6;
      ctx.font = '600 12px system-ui, sans-serif';
      const k = Math.min(1, room / Math.max(1, ctx.measureText(l.name).width));
      const fs = Math.max(8, 12 * k), dy = fs * 0.55;
      ctx.font = `600 ${fs.toFixed(1)}px system-ui, sans-serif`; ctx.fillText(l.name, px, l.area ? py - dy : py, Math.max(room, 20));
      if (l.area) { ctx.font = `${(fs * 0.92).toFixed(1)}px system-ui, sans-serif`; ctx.globalAlpha = 0.7; ctx.fillText(l.area.toFixed(1).replace('.', ',') + ' m²', px, py + dy + 1, Math.max(room, 20)); ctx.globalAlpha = 1; }
    }
  }
  function dxfImport() {
    const im = dxf.im;
    if (!im || !im.wires.length) return;
    if ((editor.components.length || editor.wires.length) && !confirm('Remplacer le plan actuel par « ' + dxf.name + ' » ?')) return;
    const doc = {
      version: 1, meta: { title: dxf.name, author: '', ...(im.levels ? { levels: im.levels } : {}) }, counters: {},
      components: im.components.map((c) => ({ ...c })),
      wires: im.wires.map((w) => ({ ...w, points: w.points.map((p) => ({ ...p })) })),
    };
    const furn = $d('dxf-furnish').checked ? furnishPlan(doc).placed : 0;
    let added = 0;
    if ($d('dxf-elec').checked) { added = autoImplant(doc).added; autoConduits(doc); }
    const go3D = $d('dxf-3d').checked, st = im.stats;
    closeDXF();
    const d = houseUI.loadPlan(doc, go3D);
    const pl = (k, w) => `${k} ${w}${k > 1 ? 's' : ''}`;
    showToast(`<b>${_escHtml(doc.meta.title)}</b> importé : ${pl(st.walls, 'mur')}, ${pl(st.doors + st.windows + st.garages, 'ouverture')}, ${pl(st.rooms, 'pièce')}` +
      (furn ? `, ${furn} meubles` : '') + (added ? `, ${added} appareils posés` : '') + (d && d.ok ? ` — ${d.circuits.length} circuits.` : '.'), 6500);
  }
  // Plan d'exemple (samples/) : pour essayer sans fichier sous la main
  async function openSampleDXF(which) {
    const r1 = which === 'etage';
    try {
      const res = await fetch(r1 ? 'samples/plan-exemple-r1.dxf' : 'samples/plan-exemple-t4.dxf');
      if (!res.ok) throw new Error(String(res.status));
      openDXF(parseDXF(decodeDXFBytes(await res.arrayBuffer())), r1 ? 'Plan d’exemple R+1' : 'Plan d’exemple T4');
    } catch (_) {
      showToast('Plan d’exemple inaccessible ici : télécharge-le depuis l’aide (<b>?</b>), puis importe-le.', 6500);
    }
  }
  $d('es-dxf').addEventListener('click', () => fileInput.click());
  $d('es-dxf-sample').addEventListener('click', () => openSampleDXF());
  $d('dxf-layers').addEventListener('change', (e) => {
    const cb = e.target;
    if (cb.type !== 'checkbox') return;
    if (cb.checked) dxf.walls.add(cb.value); else dxf.walls.delete(cb.value);
    dxfUpdate();
  });
  $d('dxf-units').addEventListener('change', dxfUpdate);
  $d('dxf-levels').addEventListener('change', () => { dxf.levels = $d('dxf-levels').checked; dxfUpdate(); });
  $d('dxf-go').addEventListener('click', dxfImport);
  $d('dxf-cancel').addEventListener('click', closeDXF);
  $d('dxf-close').addEventListener('click', closeDXF);
  dxfModal.querySelector('.modal-backdrop').addEventListener('click', closeDXF);
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !dxfModal.hidden) closeDXF(); }, true);
  window.addEventListener('resize', () => { if (!dxfModal.hidden) drawDXFPreview(); });

  const statTool = document.getElementById('stat-tool');
  const TOOL_NAMES = { select: 'Sélection', wire: 'Fil', wall: 'Mur', conduit: 'Goulotte', pan: 'Panoramique', place: 'Placement', measure: 'Règle', 'ul-move': 'Calque', 'ul-calib': 'Échelle' };
  const emptyState = document.getElementById('empty-state');

  const statCoord = document.getElementById('stat-coord');
  const statZoom = document.getElementById('stat-zoom');
  const statCount = document.getElementById('stat-count');

  // Propriétés d'un mur : matériau, façade, doublage (boîtes placo / maçonnerie, 3D)
  const pw = { box: document.getElementById('prop-wall'), mat: document.getElementById('pw-mat'), ext: document.getElementById('pw-ext'),
    doub: document.getElementById('pw-doub'), doubWrap: document.getElementById('pw-doub-wrap'), len: document.getElementById('pw-len'), note: document.getElementById('pw-note') };
  const selWall = () => { const ids = [...editor.selection]; return ids.length === 1 ? editor.wires.find((w) => w.id === ids[0] && w.kind === 'wall') : null; };
  function showWallProps(w) {
    pw.box.hidden = !w;
    if (!w) return;
    const m = wallMaterial(w);
    let L = 0;
    for (let i = 1; i < w.points.length; i++) L += Math.hypot(w.points[i].x - w.points[i - 1].x, w.points[i].y - w.points[i - 1].y);
    pw.len.textContent = fmtMeters(L);
    pw.mat.value = m.mat; pw.ext.checked = !!w.ext;
    pw.doubWrap.style.display = w.ext && !WALL_MATS[m.mat].hollow ? '' : 'none';
    pw.doub.checked = m.doublage;
    pw.note.textContent = m.hollow ? (m.doublage ? 'Boîtes étanches à l’air dans le doublage (RE 2020), gaines dans l’isolant.' : 'Boîtes pour cloison sèche (à griffes), gaines ICTA dans le vide de la cloison.')
      : 'Boîtes à sceller, saignées pour les gaines (ou gaines en plinthe / goulotte).';
  }
  const wallEdit = (fn) => { const w = selWall(); if (!w) return; fn(w); editor.pushHistory(); editor.render(); if (houseUI) houseUI.redesign(); };
  pw.mat.addEventListener('change', () => wallEdit((w) => { w.mat = pw.mat.value; }));
  pw.ext.addEventListener('change', () => wallEdit((w) => { if (pw.ext.checked) w.ext = true; else delete w.ext; }));
  pw.doub.addEventListener('change', () => wallEdit((w) => { w.doublage = pw.doub.checked; }));

  editor.onChange = () => {
    // propriétés
    const sel = [...editor.selection].map((id) => editor.components.find((c) => c.id === id)).filter(Boolean);
    const wsel = sel.length ? null : selWall();
    showWallProps(wsel);
    if (wsel) { propBox.style.display = 'none'; propEmpty.style.display = 'none'; }
    else if (sel.length === 1) {
      propBox.style.display = 'block'; propEmpty.style.display = 'none';
      const sym = SYMBOLS[sel[0].type];
      propType.textContent = sym.name;
      // ne pas écraser un champ en cours de saisie (onChange suit la souris)
      if (document.activeElement !== labelInput) labelInput.value = sel[0].label || '';
      if (document.activeElement !== valueInput) valueInput.value = sel[0].value || '';
      // libellés adaptés : nom de pièce, note de circuit, ou rien pour le mobilier
      const isRoom = sel[0].type === 'room';
      const bare = sym.plan && !sym.prefix && !isRoom;
      labelWrap.style.display = sym.plan && !sym.prefix ? 'none' : '';
      valueInput.parentElement.style.display = bare ? 'none' : '';
      const load = typeof LOADS !== 'undefined' && LOADS[sel[0].type];
      valueLbl.textContent = isRoom ? 'Nom de la pièce' : load && load.cls === 'socket' ? 'Charge branchée' : load ? 'Puissance' : sym.plan ? 'Remarque' : 'Valeur';
      valueInput.placeholder = isRoom ? 'Chambre, Séjour, Cuisine…' : load && load.cls === 'socket' ? 'ex. 2000 W (radiateur d’appoint)'
        : load ? fmtW(loadPower(sel[0])) : sym.plan ? '' : '1 kΩ';
      const mount = WALL_MOUNT.has(sel[0].type);
      hWrap.style.display = mount ? '' : 'none';
      if (mount && document.activeElement !== hInput) {
        hInput.value = +sel[0].h > 0 ? sel[0].h : '';
        hInput.placeholder = String(Math.round((MOUNT_H[sel[0].type] || 0.3) * 100)) + ' (NF)';
      }
      const isSwitch = SWITCHABLE.has(sel[0].type);
      switchWrap.style.display = isSwitch ? '' : 'none';
      closedChk.checked = !!sel[0].closed;
      const canRun = load && load.cls !== 'light' && !load.always;
      onWrap.style.display = canRun ? '' : 'none';
      onChk.checked = !!sel[0].on;
      const d = houseUI && houseUI.design();
      const bd = d && d.ok && d.byDevice[sel[0].id];
      if (bd) {
        const ct = d.circuits.find((x) => x.id === bd.circuit);
        propCircuit.innerHTML = `<b>${ct.id} · ${_escHtml(ct.name)}</b><span>${ct.In} A · ${String(ct.S).replace('.', ',')} mm² · ${ct.rcd} · câble ${bd.len.toFixed(1).replace('.', ',')} m</span>`;
        propCircuit.hidden = false;
      } else propCircuit.hidden = true;
    } else {
      propBox.style.display = 'none';
      propEmpty.style.display = 'block';
      propEmpty.textContent = editor.selection.size > 1
        ? `${editor.selection.size} éléments sélectionnés`
        : 'Aucune sélection';
    }
    // cartouche
    if (document.activeElement !== metaTitle) metaTitle.value = editor.meta.title || '';
    if (document.activeElement !== metaAuthor) metaAuthor.value = editor.meta.author || '';
    // nomenclature / norme si visibles
    if (activeTab === 'bom') renderBOM();
    const normRep = updateNormDot();
    if (activeTab === 'norm') renderNorm(false);
    // barre d'état
    statTool.textContent = editor.tool === 'place' && editor.placeType
      ? 'Placement : ' + SYMBOLS[editor.placeType].name
      : TOOL_NAMES[editor.tool] || editor.tool;
    statCoord.textContent = `X: ${Math.round(editor.mouse.wx)}  Y: ${Math.round(editor.mouse.wy)}`;
    statZoom.textContent = `Zoom: ${Math.round(editor.view.scale * 100)}%`;
    if (normRep.hasPlan && normRep.rooms.length) {
      const area = normRep.rooms.reduce((s, r) => s + (r.area || 0), 0);
      statCount.textContent = `${normRep.rooms.length} pièce${normRep.rooms.length > 1 ? 's' : ''} · ${fmtArea(area)} · ${editor.components.length} éléments`;
    } else {
      statCount.textContent = `${editor.components.length} composants · ${editor.wires.length} fils`;
    }
    // écran d'accueil sur document vide
    emptyState.hidden = editor.components.length > 0 || editor.wires.length > 0 || editor.tool === 'place' || !!editor.underlay;
  };

  // Restauration de la dernière session (sauvegarde auto)
  if (editor.restoreAuto()) editor.zoomFit();

  // Liens partageables : ?ex=<id> charge un exemple, ?theme=light force le thème
  const params = new URLSearchParams(location.search);
  applyTheme(params.get('theme') === 'light' ||
    (params.get('theme') !== 'dark' && localStorage.getItem('electricad-theme') === 'light'));
  const exParam = params.get('ex');
  if (exParam) {
    const ex = EXAMPLES.find((e) => e.id === exParam);
    if (ex) {
      editor.load(getExampleData(ex.id));
      if (ex.sim === 'plan') {
        showTab(ex.id.startsWith('maison-') ? 'install' : 'norm');
        showToast(`<b>${ex.name}</b> chargé — clique <b>3D</b> pour visiter la maison !`);
      } else {
        showTab('sim');
        showToast(`<b>${ex.name}</b> chargé — lance l'analyse « ${ex.simLabel} ».`);
      }
    }
  }
  if (params.get('tab') && document.querySelector(`.tab[data-tab="${params.get('tab')}"]`)) showTab(params.get('tab'));
  if (params.get('modal') === 'examples') openModal();
  if (params.get('houses') === '1') houseUI.openHouses();
  if (params.get('3d') === '1') houseUI.open3D();
  if (params.get('dxf')) openSampleDXF(params.get('dxf')); // ?dxf=exemple | etage : import d'un plan d'exemple
  if (params.get('calque') === '1') { // arrivée depuis « Décalquer mon plan »
    ulBtn.classList.add('pulse');
    setTimeout(() => ulBtn.classList.remove('pulse'), 6000);
    setTimeout(() => showToast('Clique l’icône <b>Calque</b> (feuilles superposées, en haut) pour importer le plan de ta maison, puis mets-le à l’échelle sur une cote connue.', 7000), 600);
  }
  // Nouveautés : une fois par version (pas quand on arrive par un lien de démo)
  try {
    const NEWS = '1.13';
    if (localStorage.getItem('electricad-news') !== NEWS) {
      localStorage.setItem('electricad-news', NEWS);
      if (!location.search) {
        setTimeout(() => showToast('<b>Nouveau</b> : <b>tableau divisionnaire</b> à poser sur le plan ou en 3D (garage, atelier : ses appareils en partent) ; <b>photovoltaïque</b> dans le tableau (onduleur, deux sources) ; sur placo, les boîtes <b>évitent les montants</b>. Exemple : Maison T5 + garage — tableau divisionnaire.', 9000), 1200);
      }
    }
  } catch (_) { /* stockage indisponible */ }
  // ?sim=dc|logic|trans|bode : lance l'analyse au chargement
  const simParam = params.get('sim');
  if (simParam) {
    showTab('sim');
    if (simParam === 'dc') runSim();
    else {
      const btn = { logic: 'btn-logic', trans: 'btn-trans', bode: 'btn-bode' }[simParam];
      if (btn) document.getElementById(btn).click();
    }
  }
  editor.onChange();

  // Glisser-déposer un fichier JSON
  canvas.addEventListener('dragover', (e) => e.preventDefault());
  canvas.addEventListener('drop', (e) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) openFile(f);
  });

  // Relâchement de Shift / Espace
  window.addEventListener('keyup', (e) => {
    if (e.key === 'Shift') editor.wireVertFirst = false;
    if (e.key === ' ') { editor._space = false; editor.canvas.style.cursor = editor.tool === 'pan' ? 'grab' : 'default'; }
    // synchroniser le surlignage si l'outil change au clavier (Échap)
    setActiveTool(editor.tool === 'place' ? null : editor.tool);
  });

  window.__editor = editor; // pratique pour le débogage
});
