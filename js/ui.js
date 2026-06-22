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
  document.getElementById('btn-sim').addEventListener('click', () => { showTab('sim'); runSim(); });
  document.getElementById('btn-sim2').addEventListener('click', runSim);
  document.getElementById('btn-sim-stop').addEventListener('click', () => {
    editor.clearSim();
    simStatus.textContent = 'Simulation arrêtée.';
    simResults.innerHTML = '';
  });
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
