/*
 * ui.js — Construction de l'interface : palette de composants, barre d'outils,
 * panneau de propriétés, barre d'état, et opérations fichier (nouveau, ouvrir,
 * enregistrer, exporter PNG).
 */

document.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('canvas');
  const editor = new Editor(canvas);
  editor.view = { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2, scale: 1 };
  editor.render();

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

  function drawThumb(c, key) {
    const ctx = c.getContext('2d');
    const sym = SYMBOLS[key];
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.save();
    ctx.translate(c.width / 2, c.height / 2);
    const b = sym.bbox;
    const s = Math.min((c.width - 10) / b.w, (c.height - 10) / b.h, 0.55);
    ctx.scale(s, s);
    ctx.strokeStyle = '#cdd6e3'; ctx.fillStyle = '#cdd6e3';
    ctx.lineWidth = 2 / s; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    sym.draw(ctx);
    ctx.restore();
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

  const snapChk = document.getElementById('chk-snap');
  snapChk.addEventListener('change', () => { editor.snapEnabled = snapChk.checked; });
  const gridChk = document.getElementById('chk-grid');
  gridChk.addEventListener('change', () => { editor.showGrid = gridChk.checked; editor.render(); });

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
  function showTab(name) {
    activeTab = name;
    tabs.forEach((x) => x.classList.toggle('active', x.dataset.tab === name));
    panels.forEach((p) => (p.style.display = p.dataset.panel === name ? '' : 'none'));
  }

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
      const isSwitch = sel[0].type === 'switch' || sel[0].type === 'push_button';
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
    statCoord.textContent = `X: ${Math.round(editor.mouse.wx)}  Y: ${Math.round(editor.mouse.wy)}`;
    statZoom.textContent = `Zoom: ${Math.round(editor.view.scale * 100)}%`;
    statCount.textContent = `${editor.components.length} composants · ${editor.wires.length} fils`;
  };

  // Restauration de la dernière session (sauvegarde auto)
  if (editor.restoreAuto()) editor.zoomFit();
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
