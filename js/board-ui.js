/*
 * board-ui.js — Éditeur du tableau électrique et du schéma unifilaire.
 *
 * À gauche, le tableau : abonnement, parafoudre, coffret, interrupteurs
 * différentiels et leurs circuits (repère, désignation, type, calibre,
 * section, charge, longueur, contacteur / télérupteur), contrôles NF C 15-100
 * en direct. À droite, l'aperçu : folio unifilaire, câblage, note de calcul, schémas
 * développés de l'éclairage, élévations des murs, communication (VDI), face
 * avant, étiquettes.
 * La première modification fige le tableau automatique en tableau
 * personnalisé (annulable, et réversible). Sans plan, on part d'un modèle.
 */
function initBoardUI(app) {
  const { editor, houseUI, showToast, download, fileName, esc } = app;
  const $ = (id) => document.getElementById(id);
  const modal = $('board-modal'), left = $('bd-edit'), sheet = $('bd-sheet');
  const st = { view: 'uni', folio: 0, zoom: 1 };
  const num = (v, d) => Number(v).toLocaleString('fr-FR', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 });
  const hasPlan = () => editor.wires.some((w) => w.kind === 'wall');
  const design = () => houseUI.design();
  const meta = () => ({ ...editor.meta, date: new Date().toISOString().slice(0, 10) });
  const devSVGs = (d) => developedSVGs(d, meta(), editor.components, editor.wires);
  const vdiPages = (d) => vdiSVGs(d, meta(), editor.components, editor.wires);
  const elevPages = (d) => elevationSVGs(d, meta(), editor.components, editor.wires);

  function open() {
    modal.hidden = false;
    document.body.classList.add('modal-open');
    st.folio = 0;
    render();
  }
  function close() { modal.hidden = true; document.body.classList.remove('modal-open'); }

  // Toute modification passe par ici : le tableau automatique devient personnalisé
  function mutate(fn) {
    let b = editor.meta.board;
    if (!b) {
      const d = design();
      if (!d || !d.ok) return;
      b = editor.meta.board = boardFromDesign(d);
      showToast('Tableau <b>personnalisé</b> : il ne suit plus la répartition automatique du plan (bouton « Revenir à l’automatique » pour annuler).', 5500);
    }
    fn(b);
    editor.pushHistory();
    houseUI.redesign();
    render();
  }

  // ---- Rendu ---------------------------------------------------------------
  function render() {
    const d = design();
    if (!d || !d.ok) { renderCreate(); renderPreview(null); return; }
    const custom = !!editor.meta.board;
    $('bd-sub').textContent = `${editor.meta.title || 'Installation'} — ${d.circuits.length} circuits, ${d.rcds.length} différentiels · ${custom ? 'tableau personnalisé' : 'tableau déduit du plan (automatique)'}`;
    const tri = d.supply && d.supply.phases === 3;
    const kvaOpts = (tri ? KVA_STEPS_TRI : KVA_STEPS).map((k) => `<option value="${k}"${d.agcp.kva === k && custom && editor.meta.board.supply && +editor.meta.board.supply.kva === k ? ' selected' : ''}>${k} kVA</option>`).join('');
    const rowsWant = custom && editor.meta.board.supply ? +editor.meta.board.supply.rows || 0 : 0;
    const M = boardModules(d);
    let h = '<div class="bd-mode">' +
      `<span class="bd-badge ${custom ? 'on' : ''}">${custom ? 'Personnalisé' : 'Automatique'}</span>` +
      `<span class="bd-mode-txt">${custom ? 'Tes réglages priment sur la répartition automatique.' : 'Déduit du plan : modifie une valeur pour personnaliser.'}</span>` +
      (d.orphans && d.orphans.length ? `<button type="button" class="btn-ghost" data-bact="distribute">Répartir ${d.orphans.length} appareil${d.orphans.length > 1 ? 's' : ''}</button>` : '') +
      (custom && d.panel ? '<button type="button" class="btn-ghost" data-bact="auto">Revenir à l’automatique</button>' : '') + '</div>';
    h += '<div class="bd-supply">' +
      `<label>Réseau <select data-sf="phases"><option value="1"${tri ? '' : ' selected'}>Monophasé 230 V</option><option value="3"${tri ? ' selected' : ''}>Triphasé 400 V</option></select></label>` +
      `<label>Abonnement <select data-sf="kva"><option value="">auto (${d.agcp.auto || d.agcp.kva} kVA)</option>${kvaOpts}</select></label>` +
      `<label>Coffret <select data-sf="rows"><option value="">auto (${M.rowsCount} rangée${M.rowsCount > 1 ? 's' : ''})</option>${[1, 2, 3, 4, 5].map((n) => `<option value="${n}"${rowsWant === n ? ' selected' : ''}>${n} rangée${n > 1 ? 's' : ''} × 13</option>`).join('')}</select></label>` +
      (d.panel ? '' : `<label>Surface <input type="number" min="10" max="1000" step="1" data-sf="area" value="${Math.round(d.area || 0)}"> m²</label>`) +
      `<label title="Résistance de la prise de terre mesurée (100 Ω au plus avec l’AGCP 500 mA)">Terre <input type="number" min="0" max="2000" step="1" data-sf="ra" value="${d.supply && d.supply.ra ? d.supply.ra : ''}" placeholder="à mesurer"> Ω</label>` +
      `<label class="check-row"><input type="checkbox" data-sf="surge"${d.supply && d.supply.surge ? ' checked' : ''}> Parafoudre</label>` +
      `<span class="bd-agcp">AGCP ${tri ? '4P' : '2P'} ${d.agcp.setting} A · 500 mA${tri && d.phaseLoad ? ` · L1 ${num(d.phaseLoad.L1 / 1000, 1)} / L2 ${num(d.phaseLoad.L2 / 1000, 1)} / L3 ${num(d.phaseLoad.L3 / 1000, 1)} kW` : ''}</span></div>`;
    // Tableau des circuits, par différentiel
    const checks = d.checks || [];
    const flag = (ref) => { const l = checks.filter((c) => c.ref === ref && (c.level === 'err' || c.level === 'warn')); return l.length ? { cls: l.some((c) => c.level === 'err') ? 'err' : 'warn', tip: l.map((c) => c.msg).join('\n') } : null; };
    const opt = (list, v, fmt) => list.map((x) => `<option value="${x}"${+v === +x || v === x ? ' selected' : ''}>${fmt ? fmt(x) : x}</option>`).join('');
    const rcdOpts = (v) => `<option value=""${!v ? ' selected' : ''}>—</option>` + d.rcds.map((r) => `<option value="${esc(r.id)}"${r.id === v ? ' selected' : ''}>${esc(r.id)}</option>`).join('');
    h += '<div class="bd-scroll"><table class="bd-table"><thead><tr><th>Repère</th><th>Désignation</th><th>Type</th><th>Calibre</th><th>Section</th><th>Charge</th><th>Long.</th>' + (tri ? '<th>Ph.</th>' : '') + '<th>ID</th><th><span class="sr-only">Actions</span></th></tr></thead>';
    const groups = d.rcds.map((r) => ({ r, cs: d.circuits.filter((c) => c.rcd === r.id) }));
    const loose = d.circuits.filter((c) => !d.rcds.some((r) => r.id === c.rcd));
    if (loose.length) groups.push({ r: null, cs: loose });
    for (const g of groups) {
      const f = g.r && flag(g.r.id);
      h += `<tbody data-rcd="${g.r ? esc(g.r.id) : ''}"><tr class="bd-rcd ${f ? f.cls : ''}"${f ? ` title="${esc(f.tip)}"` : ''}><td colspan="${tri ? 10 : 9}">`;
      if (g.r) {
        h += `<b>${esc(g.r.id)}</b> Interrupteur différentiel <select data-rf="In" aria-label="Calibre">${opt(BOARD_RCD_IN, g.r.In, (x) => x + ' A')}</select> 30 mA type <select data-rf="type" aria-label="Type">${opt(BOARD_RCD_TYPES, g.r.type)}</select>` +
          `<span class="bd-count">${g.cs.length}/8 circuits</span>` + (g.cs.length ? '' : '<button type="button" class="bd-x" data-ract="del" title="Supprimer ce différentiel">Supprimer</button>');
      } else h += '<b class="bad">Sans différentiel 30 mA</b> — rattache ces circuits à un ID';
      h += '</td></tr>';
      for (const c of g.cs) {
        const fc = flag(c.id);
        const load = c.devices.length ? `<span class="bd-ro" title="D’après le plan">${c.kind === 'light' ? c.points + (c.points > 1 ? ' pts' : ' pt') : c.kind === 'socket' ? c.points + ' PC' : num(c.power) + ' W'}</span>`
          : c.kind === 'light' || c.kind === 'socket' ? `<input type="number" min="0" max="30" data-cf="points" value="${c.points}" aria-label="Points"><em>${c.kind === 'light' ? 'pts' : 'PC'}</em>`
            : `<input type="number" min="0" step="100" data-cf="P" value="${Math.round(c.power)}" aria-label="Puissance"><em>W</em>`;
        const len = c.devices.length ? `<span class="bd-ro" title="Mesurée sur le plan">${num(c.length, 1)} m</span>` : `<input type="number" min="1" max="200" step="0.5" data-cf="length" value="${num(c.length, 1).replace(/\s/g, '').replace(',', '.')}" aria-label="Longueur"><em>m</em>`;
        h += `<tr data-c="${esc(c.id)}" class="${fc ? fc.cls : ''}"${fc ? ` title="${esc(fc.tip)}"` : ''}>` +
          `<td class="bd-idc"><input class="bd-id" data-cf="id" value="${esc(c.id)}" maxlength="8" aria-label="Repère"><span class="bd-move"><button type="button" data-cact="up" title="Monter">▲</button><button type="button" data-cact="down" title="Descendre">▼</button></span></td>` +
          `<td><input class="bd-name" data-cf="name" value="${esc(c.name)}" maxlength="40" aria-label="Désignation">${c.rooms ? `<small>${esc(c.rooms)}</small>` : ''}</td>` +
          `<td><select data-cf="kind" aria-label="Type">${Object.entries(BOARD_KINDS).map(([k, v]) => `<option value="${k}"${c.kind === k ? ' selected' : ''}>${v}</option>`).join('')}</select></td>` +
          `<td><select data-cf="In" aria-label="Calibre">${opt(BOARD_IN, c.In, (x) => 'C' + x)}</select></td>` +
          `<td><select data-cf="S" aria-label="Section">${opt(BOARD_S, c.S, (x) => String(x).replace('.', ',') + ' mm²')}</select></td>` +
          `<td class="bd-load">${load}</td><td class="bd-load">${len}</td>` +
          (tri ? `<td><select data-cf="phase" aria-label="Phase" class="${c.phaseAuto ? 'bd-auto' : ''}" title="${c.phaseAuto ? 'Phase choisie pour équilibrer' : 'Phase'}">${['L1', 'L2', 'L3', '3P'].map((p) => `<option value="${p}"${c.phase === p ? ' selected' : ''}>${p === '3P' ? '3P+N' : p}</option>`).join('')}</select></td>` : '') +
          `<td><select data-cf="rcd" aria-label="Différentiel">${rcdOpts(c.rcd)}</select></td>` +
          `<td class="bd-acts"><button type="button" data-cact="hc" aria-pressed="${c.contactor ? 'true' : 'false'}" title="Contacteur jour / nuit (heures creuses)">HC</button>` +
          `<button type="button" data-cact="tl" aria-pressed="${c.teleruptor ? 'true' : 'false'}" title="Télérupteur">TL</button>` +
          '<button type="button" data-cact="del" class="bd-x" title="Supprimer le circuit">✕</button></td></tr>';
      }
      h += '</tbody>';
    }
    h += '</table></div>';
    h += '<div class="bd-add"><select id="bd-preset" aria-label="Circuit à ajouter">' + BOARD_PRESETS.map((p) => `<option value="${p.key}">${esc(p.name)} — C${p.In}, ${String(p.S).replace('.', ',')} mm²</option>`).join('') + '</select>' +
      '<button type="button" class="btn-primary" data-bact="add">+ Circuit</button><button type="button" class="btn-ghost" data-bact="rcd">+ Différentiel</button></div>';
    const icon = { ok: '✓', info: 'ℹ', warn: '⚠', err: '✗' };
    const order = { err: 0, warn: 1, info: 2, ok: 3 };
    h += '<ul class="bd-checks">' + checks.slice().sort((a, b) => order[a.level] - order[b.level]).map((c) => `<li class="${c.level}"><span aria-hidden="true">${icon[c.level]}</span>${esc(c.msg)}</li>`).join('') + '</ul>';
    const keep = left.scrollTop, keepX = left.querySelector('.bd-scroll') ? left.querySelector('.bd-scroll').scrollLeft : 0;
    left.innerHTML = h;
    left.scrollTop = keep; // la liste ne saute pas à chaque modification
    const sc = left.querySelector('.bd-scroll');
    if (sc) sc.scrollLeft = keepX;
    renderPreview(d);
  }

  // Sans tableau : créer un tableau sans plan, ou implanter le plan
  function renderCreate() {
    $('bd-sub').textContent = 'Aucun tableau pour l’instant';
    left.innerHTML = '<div class="bd-create">' +
      (hasPlan() ? '<p>Ce plan n’a pas encore de tableau électrique. L’implantation automatique pose la GTL, le tableau et l’appareillage NF C 15-100, puis répartit les circuits.</p><button type="button" class="btn-primary" data-bact="implant">Implanter le plan</button><hr>' : '') +
      '<h3>Tableau sans plan</h3><p>Pour tracer le schéma unifilaire d’un logement existant : un modèle de départ selon la surface, puis modifie chaque circuit.</p>' +
      '<label>Surface habitable <input type="number" id="bd-area" min="10" max="1000" value="80"> m²</label>' +
      '<label class="check-row"><input type="checkbox" id="bd-heat" checked> Chauffage électrique</label>' +
      '<label class="check-row"><input type="checkbox" id="bd-cook" checked> Plaque de cuisson électrique</label>' +
      '<label class="check-row"><input type="checkbox" id="bd-ev"> Borne de recharge (IRVE)</label>' +
      '<label class="check-row"><input type="checkbox" id="bd-tri"> Alimentation triphasée (400 V)</label>' +
      '<button type="button" class="btn-primary" data-bact="create">Créer le tableau</button></div>';
  }

  function renderPreview(d) {
    $('bd-folios').hidden = true;
    if (!d || !d.ok) { sheet.innerHTML = '<p class="bd-empty">L’aperçu du schéma unifilaire apparaîtra ici.</p>'; return; }
    let svg = '';
    if (st.view === 'uni') {
      const pages = unifilarSVGs(d, meta());
      st.folio = Math.min(st.folio, pages.length - 1);
      svg = pages[st.folio];
      $('bd-folios').hidden = pages.length < 2;
      $('bd-folio-lbl').textContent = `Folio ${st.folio + 1} / ${pages.length}`;
    } else if (st.view === 'calc' || st.view === 'dev' || st.view === 'vdi' || st.view === 'elev' || st.view === 'wiring') {
      const pages = st.view === 'calc' ? calcNoteSVGs(d, meta()) : st.view === 'dev' ? devSVGs(d) : st.view === 'elev' ? elevPages(d) : st.view === 'wiring' ? boardWiringSVGs(d, meta()) : vdiPages(d);
      st.folio = Math.min(st.folio, pages.length - 1);
      svg = pages[st.folio];
      $('bd-folios').hidden = pages.length < 2;
      $('bd-folio-lbl').textContent = `Folio ${st.folio + 1} / ${pages.length}`;
    } else if (st.view === 'front') svg = boardFrontSVG(d, meta());
    else svg = boardLabelsSVG(d, meta());
    modal.querySelector('[data-bx="csv"]').hidden = st.view !== 'calc';
    sheet.innerHTML = svg.replace(/width="[^"]*mm" height="[^"]*mm"/, `style="width:${Math.round(st.zoom * 100)}%;height:auto"`);
    modal.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === st.view));
  }

  // ---- Modifications -------------------------------------------------------
  const findC = (b, id) => b.circuits.find((c) => c.id === id);
  left.addEventListener('change', (e) => {
    const t = e.target;
    const tr = t.closest('tr[data-c]'), tb = t.closest('tbody[data-rcd]');
    if (t.dataset.cf && tr) {
      const id = tr.dataset.c, f = t.dataset.cf;
      let v = t.value;
      if (f === 'id') {
        v = v.trim().toUpperCase().replace(/\s+/g, '');
        const b0 = editor.meta.board, d = design();
        const taken = (b0 ? b0.circuits : d.circuits).some((c) => c.id === v && c.id !== id);
        if (!v || taken) { showToast(v ? `Le repère <b>${esc(v)}</b> existe déjà.` : 'Un repère ne peut pas être vide.'); t.value = id; return; }
      }
      mutate((b) => {
        const c = findC(b, id);
        if (!c) return;
        if (['In', 'S', 'points', 'P', 'length'].includes(f)) v = Math.max(0, +v || 0);
        c[f] = v;
        if (f === 'rcd' && !v) c.rcd = null;
      });
    } else if (t.dataset.rf && tb) {
      const id = tb.dataset.rcd, f = t.dataset.rf;
      mutate((b) => { const r = b.rcds.find((x) => x.id === id); if (r) r[f] = f === 'In' ? +t.value : t.value; });
    } else if (t.dataset.sf) {
      const f = t.dataset.sf;
      mutate((b) => {
        b.supply = b.supply || {};
        if (f === 'surge') b.supply.surge = t.checked;
        else if (f === 'kva') b.supply.kva = t.value ? +t.value : null;
        else if (f === 'rows') b.supply.rows = t.value ? +t.value : 0;
        else if (f === 'area') b.supply.area = Math.max(10, +t.value || 0);
        else if (f === 'ra') b.supply.ra = +t.value > 0 ? +t.value : null;
        else if (f === 'phases') { b.supply.phases = +t.value; b.supply.kva = null; if (+t.value === 1) b.circuits.forEach((c) => { if (c.phase === '3P') c.phase = null; }); }
      });
    }
  });
  left.addEventListener('click', (e) => {
    const bt = e.target.closest('button');
    if (!bt) return;
    const tr = bt.closest('tr[data-c]'), tb = bt.closest('tbody[data-rcd]');
    if (bt.dataset.cact && tr) {
      const id = tr.dataset.c, a = bt.dataset.cact;
      mutate((b) => {
        const i = b.circuits.findIndex((c) => c.id === id), c = b.circuits[i];
        if (!c) return;
        if (a === 'hc') c.contactor = c.contactor ? null : 'hc';
        else if (a === 'tl') c.teleruptor = !c.teleruptor;
        else if (a === 'del') b.circuits.splice(i, 1);
        else {
          // échange avec le circuit voisin du même différentiel
          const same = b.circuits.map((x, k) => [x, k]).filter(([x]) => x.rcd === c.rcd).map(([, k]) => k);
          const j = same[same.indexOf(i) + (a === 'up' ? -1 : 1)];
          if (j !== undefined) [b.circuits[i], b.circuits[j]] = [b.circuits[j], b.circuits[i]];
        }
      });
    } else if (bt.dataset.ract === 'del' && tb) {
      const id = tb.dataset.rcd;
      mutate((b) => { b.rcds = b.rcds.filter((r) => r.id !== id); b.circuits.forEach((c) => { if (c.rcd === id) c.rcd = null; }); });
    } else if (bt.dataset.bact) {
      const a = bt.dataset.bact;
      if (a === 'add') {
        const key = $('bd-preset').value;
        let added = null;
        mutate((b) => { added = boardAddCircuit(b, key); });
        if (added) showToast(`<b>${esc(added.id)}</b> ${esc(added.name)} ajouté sous ${esc(added.rcd || '—')}.`, 2500);
      } else if (a === 'rcd') mutate((b) => { b.rcds.push({ id: boardNextId(b, 'ID'), In: 40, type: 'AC', sens: 30 }); });
      else if (a === 'distribute') {
        let n = 0;
        mutate((b) => { n = boardDistribute(b, editor.components, design()); });
        showToast(`${n} appareil${n > 1 ? 's' : ''} rangé${n > 1 ? 's' : ''} sur les circuits du tableau.`, 3000);
      } else if (a === 'auto') {
        if (!confirm('Revenir au tableau déduit automatiquement du plan ? Tes réglages du tableau seront perdus (annulable avec Ctrl+Z dans le plan).')) return;
        delete editor.meta.board;
        editor.pushHistory(); houseUI.redesign(); render();
      } else if (a === 'implant') { houseUI.implant(); render(); }
      else if (a === 'create') {
        editor.meta.board = boardTemplate(+$('bd-area').value || 80, { heating: $('bd-heat').checked, cooktop: $('bd-cook').checked, ev: $('bd-ev').checked, tri: $('bd-tri').checked });
        if (!editor.meta.title) editor.meta.title = 'Tableau électrique';
        editor.pushHistory(); houseUI.redesign(); render();
        showToast('Tableau créé : ajuste les circuits, le schéma unifilaire suit.', 3500);
      }
    }
  });

  // ---- Aperçu, exports ----------------------------------------------------------
  modal.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => { st.view = b.dataset.view; st.folio = 0; renderPreview(design()); }));
  $('bd-prev').addEventListener('click', () => { st.folio = Math.max(0, st.folio - 1); renderPreview(design()); });
  $('bd-next').addEventListener('click', () => { st.folio++; renderPreview(design()); });
  $('bd-zoom-in').addEventListener('click', () => { st.zoom = Math.min(3, st.zoom * 1.25); renderPreview(design()); });
  $('bd-zoom-out').addEventListener('click', () => { st.zoom = Math.max(0.5, st.zoom / 1.25); renderPreview(design()); });
  const base = () => (editor.meta.title || 'tableau');
  modal.querySelectorAll('[data-bx]').forEach((b) => b.addEventListener('click', () => {
    const d = design();
    if (!d || !d.ok) { showToast('Crée d’abord le tableau.'); return; }
    const k = b.dataset.bx;
    if (k === 'svg') {
      const folio = (pages) => pages[st.folio] || pages[0];
      const svg = st.view === 'uni' ? unifilarSVG(d, meta()) : st.view === 'calc' ? folio(calcNoteSVGs(d, meta())) : st.view === 'dev' ? folio(devSVGs(d)) : st.view === 'vdi' ? folio(vdiPages(d)) : st.view === 'elev' ? folio(elevPages(d)) : st.view === 'wiring' ? folio(boardWiringSVGs(d, meta())) : st.view === 'front' ? boardFrontSVG(d, meta()) : boardLabelsSVG(d, meta());
      const what = { uni: 'unifilaire', calc: 'note de calcul', dev: 'schémas développés', vdi: 'communication', elev: 'élévations', wiring: 'câblage du tableau', front: 'face avant', labels: 'étiquettes' }[st.view];
      download(new Blob([svg], { type: 'image/svg+xml' }), fileName(base() + ' - ' + what + '.svg'));
    } else if (k === 'dxf') {
      if (st.view === 'calc') {
        download(new Blob([calcNoteDXF(d, meta())], { type: 'application/dxf' }), fileName(base() + ' - note de calcul.dxf'));
        showToast('Note de calcul exportée en <b>DXF</b> (millimètres, calques TEXTES et CARTOUCHE).', 3500);
      } else if (st.view === 'wiring') {
        download(new Blob([boardWiringDXF(d, meta())], { type: 'application/dxf' }), fileName(base() + ' - câblage du tableau.dxf'));
        showToast('Câblage du tableau exporté en <b>DXF</b> (millimètres, calques SCHEMA, TEXTES, CARTOUCHE).', 3500);
      } else if (st.view === 'elev') {
        download(new Blob([elevationDXF(d, meta(), editor.components, editor.wires)], { type: 'application/dxf' }), fileName(base() + ' - élévations.dxf'));
        showToast('Élévations exportées en <b>DXF</b> (millimètres, calques SCHEMA, TEXTES, CARTOUCHE).', 3500);
      } else if (st.view === 'vdi') {
        download(new Blob([vdiDXF(d, meta(), editor.components, editor.wires)], { type: 'application/dxf' }), fileName(base() + ' - communication.dxf'));
        showToast('Schéma de communication exporté en <b>DXF</b> (millimètres, calques SCHEMA, TEXTES, CARTOUCHE).', 3500);
      } else if (st.view === 'dev') {
        download(new Blob([developedDXF(d, meta(), editor.components, editor.wires)], { type: 'application/dxf' }), fileName(base() + ' - schémas développés.dxf'));
        showToast('Schémas développés exportés en <b>DXF</b> (millimètres, calques SCHEMA, TEXTES, CARTOUCHE).', 3500);
      } else {
        download(new Blob([unifilarDXF(d, meta())], { type: 'application/dxf' }), fileName(base() + ' - unifilaire.dxf'));
        showToast('Schéma unifilaire exporté en <b>DXF</b> (millimètres, calques UNIFILAIRE, TEXTES, CARTOUCHE).', 3500);
      }
    } else if (k === 'csv') {
      download(new Blob(['\ufeff' + calcNoteCSV(d)], { type: 'text/csv;charset=utf-8' }), fileName(base() + ' - note de calcul.csv'));
    } else if (k === 'print') printAll(d);
    else if (k === 'schema') {
      if ((editor.components.length || editor.wires.length) && !confirm('Le schéma unifilaire va remplacer le document ouvert dans l’éditeur (plan compris). Enregistre-le d’abord (bouton Enregistrer) pour le retrouver. Continuer ?')) return;
      const doc = boardToSchematic(d, meta());
      close();
      editor.load(doc);
      houseUI.redesign();
      showToast('Schéma unifilaire ouvert dans l’éditeur : déplace, modifie ou complète chaque symbole (catégorie « Domestique (NF) » de la palette) ; disjoncteurs et différentiels se manœuvrent au double-clic.', 7000);
    }
  }));

  // Impression : folios A3 paysage, face avant et étiquettes à l'échelle 1
  function printAll(d) {
    const win = window.open('', '_blank');
    if (!win) { showToast('Autorise les fenêtres surgissantes pour imprimer.'); return; }
    const strip = (s) => s.replace(/width="[^"]*mm" height="[^"]*mm"/, '');
    const pages = unifilarSVGs(d, meta()).concat(boardWiringSVGs(d, meta()), calcNoteSVGs(d, meta()), devSVGs(d), editor.wires.some((w) => w.kind === 'wall') ? elevPages(d) : [], editor.components.some((c) => c.type === 'rj45') ? vdiPages(d) : []).map((s) => `<section class="a3">${strip(s)}</section>`).join('');
    const front = boardFrontSVG(d, meta()), labels = boardLabelsSVG(d, meta());
    const mm = (s) => { const m = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(s); return m ? [+m[1], +m[2]] : [210, 297]; };
    const [fw, fh] = mm(front);
    const html = '<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>' + esc(base()) + ' — tableau électrique</title><style>' +
      '@page a3{size:A3 landscape;margin:0}@page a4p{size:A4 portrait;margin:8mm}@page a4l{size:A4 landscape;margin:0}' +
      'body{margin:0;font-family:sans-serif;background:#888}section{background:#fff;margin:0 auto 10px;break-after:page}' +
      '.a3{page:a3;width:420mm;height:297mm}.a3 svg{width:420mm;height:297mm;display:block}' +
      `.a4p{page:a4p;width:194mm}.a4p svg{width:${Math.min(194, fw)}mm;height:auto;display:block}` +
      '.a4l{page:a4l;width:297mm;height:210mm}.a4l svg{width:297mm;height:auto;display:block}' +
      '@media print{body{background:#fff}section{margin:0}}</style></head><body>' + pages +
      `<section class="a4p">${front.replace(/width="[^"]*mm" height="[^"]*mm"/, fh > 280 ? 'style="width:100%;height:auto"' : '')}</section>` +
      `<section class="a4l">${labels.replace(/height="[^"]*mm"/, '')}</section>` +
      '<script>window.onload=function(){setTimeout(function(){window.print();},300);};<\/script></body></html>';
    win.document.open(); win.document.write(html); win.document.close();
  }

  $('board-close').addEventListener('click', close);
  modal.querySelector('.modal-backdrop').addEventListener('click', close);
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) close(); }, true);
  $('btn-board').addEventListener('click', open);
  return { open, render };
}
