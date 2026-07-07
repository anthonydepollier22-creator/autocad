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
  printer: '<svg viewBox="0 0 24 24"><path d="M7 8V3.5h10V8"/><path d="M7 16.5H4.5A1.5 1.5 0 0 1 3 15V9.5A1.5 1.5 0 0 1 4.5 8h15A1.5 1.5 0 0 1 21 9.5V15a1.5 1.5 0 0 1-1.5 1.5H17"/><path d="M7 13.5h10v7H7z"/></svg>',
  cursor: '<svg viewBox="0 0 24 24"><path d="M5.5 3.5l6.7 16.3 2.2-6.4 6.4-2.2z"/></svg>',
  wire: '<svg viewBox="0 0 24 24"><path d="M4 18h5v-6h6V6h5"/><circle cx="4" cy="18" r="1.7"/><circle cx="20" cy="6" r="1.7"/></svg>',
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
  cube: '<svg viewBox="0 0 24 24"><path d="M12 2.8l8 4.6v9.2l-8 4.6-8-4.6V7.4z"/><path d="M12 12l8-4.6M12 12L4 7.4M12 12v9.2"/></svg>',
  wall: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="1"/><path d="M3 9.7h18M3 14.3h18M9 5v4.7M15 5v4.7M6 9.7v4.6M12 9.7v4.6M18 9.7v4.6M9 14.3V19M15 14.3V19"/></svg>',
  conduit: '<svg viewBox="0 0 24 24"><path d="M3 17v-7h8V5h10"/><path d="M6.5 20v-6.5H14V8.5h7"/></svg>',
  moon: '<svg viewBox="0 0 24 24"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/></svg>',
};

document.addEventListener('DOMContentLoaded', () => {
  // Injection des icônes
  document.querySelectorAll('[data-icon]').forEach((b) => {
    const svg = ICONS[b.dataset.icon];
    if (svg) b.insertAdjacentHTML('afterbegin', svg);
  });

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
  const fileInput = document.getElementById('file-input');
  document.getElementById('btn-open').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try { editor.load(JSON.parse(r.result)); }
      catch (err) { alert('Fichier invalide : ' + err.message); }
    };
    r.readAsText(f);
    fileInput.value = '';
  });
  document.getElementById('btn-png').addEventListener('click', () => {
    const url = editor.exportPNG();
    const a = document.createElement('a');
    a.href = url; a.download = 'schema.png'; a.click();
  });
  document.getElementById('btn-svg').addEventListener('click', () => {
    const blob = new Blob([editor.exportSVG()], { type: 'image/svg+xml' });
    download(blob, (editor.meta.title || 'schema') + '.svg');
  });
  document.getElementById('btn-print').addEventListener('click', () => editor.print());

  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // --- Panneau de propriétés / barre d'état -------------------------------
  const propBox = document.getElementById('props');
  const labelInput = document.getElementById('prop-label');
  const valueInput = document.getElementById('prop-value');
  const propEmpty = document.getElementById('props-empty');
  const propType = document.getElementById('prop-type');

  const switchWrap = document.getElementById('prop-switch-wrap');
  const closedChk = document.getElementById('prop-closed');
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
  }));

  // --- Nomenclature (BOM) ------------------------------------------------
  const bomTable = document.getElementById('bom-table');
  function renderBOM() {
    const rows = buildBOM(editor.components, SYMBOLS);
    if (!rows.length) { bomTable.innerHTML = '<div class="empty">Aucun composant.</div>'; return; }
    let html = '<table><thead><tr><th>Réf.</th><th>Composant</th><th>Valeur</th><th>Qté</th></tr></thead><tbody>';
    for (const r of rows) html += `<tr><td>${r.refs.join(', ')}</td><td>${r.name}</td><td>${r.value || '—'}</td><td>${r.qty}</td></tr>`;
    html += '</tbody></table>';
    bomTable.innerHTML = html;
  }
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
    a.download = (editor.meta.title || 'graphique') + '.png';
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
      showTab('bom'); // le métré de l'installation
      showToast(`<b>${ex.name}</b> chargé — clique <b>3D</b> pour visiter la maison en volume !`);
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

  // --- Vue 3D ----------------------------------------------------------------
  const view3d = document.getElementById('view3d');
  let viz3d = null;
  function open3D() {
    view3d.hidden = false;
    if (!viz3d) viz3d = new Viz3D(document.getElementById('canvas3d'), { bg: null });
    const radius = buildBoard(viz3d, editor.components, editor.wires, SYMBOLS);
    viz3d.fit(radius);
    viz3d.autoRotate = true;
    viz3d.start();
    if (!editor.components.length && !editor.wires.length) {
      showToast('Carte vide — pose des composants puis reviens en 3D !', 3200);
    }
  }
  function close3D() {
    view3d.hidden = true;
    if (viz3d) viz3d.stop();
  }
  if (document.getElementById('btn-3d')) {
    document.getElementById('btn-3d').addEventListener('click', open3D);
    document.getElementById('btn-3d-close').addEventListener('click', close3D);
    document.getElementById('btn-3d-photo').addEventListener('click', () => {
      const a = document.createElement('a');
      a.href = document.getElementById('canvas3d').toDataURL('image/png');
      a.download = (editor.meta.title || 'carte') + '-3d.png';
      a.click();
    });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !view3d.hidden) close3D(); }, true);
    window.addEventListener('resize', () => { if (!view3d.hidden && viz3d) viz3d.resize(); });
  }

  const statTool = document.getElementById('stat-tool');
  const TOOL_NAMES = { select: 'Sélection', wire: 'Fil', wall: 'Mur', conduit: 'Goulotte', pan: 'Panoramique', place: 'Placement' };
  const emptyState = document.getElementById('empty-state');

  const statCoord = document.getElementById('stat-coord');
  const statZoom = document.getElementById('stat-zoom');
  const statCount = document.getElementById('stat-count');

  editor.onChange = () => {
    // propriétés
    const sel = [...editor.selection].map((id) => editor.components.find((c) => c.id === id)).filter(Boolean);
    if (sel.length === 1) {
      propBox.style.display = 'block'; propEmpty.style.display = 'none';
      propType.textContent = SYMBOLS[sel[0].type].name;
      labelInput.value = sel[0].label || '';
      valueInput.value = sel[0].value || '';
      const isSwitch = SWITCHABLE.has(sel[0].type);
      switchWrap.style.display = isSwitch ? '' : 'none';
      closedChk.checked = !!sel[0].closed;
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
    // nomenclature si visible
    if (activeTab === 'bom') renderBOM();
    // barre d'état
    statTool.textContent = editor.tool === 'place' && editor.placeType
      ? 'Placement : ' + SYMBOLS[editor.placeType].name
      : TOOL_NAMES[editor.tool] || editor.tool;
    statCoord.textContent = `X: ${Math.round(editor.mouse.wx)}  Y: ${Math.round(editor.mouse.wy)}`;
    statZoom.textContent = `Zoom: ${Math.round(editor.view.scale * 100)}%`;
    statCount.textContent = `${editor.components.length} composants · ${editor.wires.length} fils`;
    // écran d'accueil sur document vide
    emptyState.hidden = editor.components.length > 0 || editor.wires.length > 0 || editor.tool === 'place';
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
      showTab('sim');
      showToast(`<b>${ex.name}</b> chargé — lance l'analyse « ${ex.simLabel} ».`);
    }
  }
  if (params.get('modal') === 'examples') openModal();
  if (params.get('3d') === '1' && document.getElementById('btn-3d')) open3D();
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
    if (!f) return;
    const r = new FileReader();
    r.onload = () => { try { editor.load(JSON.parse(r.result)); } catch (_) {} };
    r.readAsText(f);
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
