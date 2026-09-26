/*
 * house-ui.js — Interface « maison » :
 *  • fenêtre « Nouvelle maison » (types générés, options) ;
 *  • onglet Tableau : installation simulée en temps réel — disjoncteurs à
 *    manette, charges, énergie, défauts (court-circuit, fuite), journal ;
 *  • vue 3D : WebGL (repli 2D), orbite / dessus / visite, murs, rayons X,
 *    heure du jour, clic sur les interrupteurs et les appareils ;
 *  • liaison simulation ↔ plan 2D (lampes allumées, appareils en marche).
 */
function initHouseUI(app) {
  const { editor, showTab, showToast, download, fileName, esc } = app;
  const $ = (s) => document.getElementById(s);
  const sim = new InstallSim();
  try { editor.showTags = localStorage.getItem('electricad-tags') === '1'; } catch (_) { editor.showTags = false; }
  let design = null, designRev = null;
  const SWITCH_ALL = new Set(['switch_sa', 'switch_vv_wall', 'switch', 'push_button', 'sw_vv']);
  const LIGHT_T = new Set(['dcl', 'wall_light']);
  const hasPlan = () => editor.wires.some((w) => w.kind === 'wall');
  const byId = (id) => editor.components.find((c) => c.id === id);
  const fmtA = (i) => (i < 10 ? i.toFixed(1) : Math.round(i)).toString().replace('.', ',') + ' A';
  const fmtKWh = (wh) => (wh / 1000).toFixed(wh < 10000 ? 2 : 1).replace('.', ',') + ' kWh';
  const fmtEur = (e) => e.toFixed(2).replace('.', ',') + ' €';
  const fmtClock = (t) => {
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60);
    return (h ? h + ' h ' : '') + String(m).padStart(2, '0') + ' min ' + String(s).padStart(2, '0') + ' s';
  };

  // ---- Conception : recalculée quand le document change -------------------
  function ensureDesign(force) {
    const rev = editor.history[editor.history.length - 1];
    if (!force && rev === designRev) return design;
    designRev = rev;
    const board = editor.meta && editor.meta.board && Array.isArray(editor.meta.board.circuits) ? editor.meta.board : null;
    const relevant = board || editor.components.some((c) => c.type === 'panel_house');
    design = relevant ? designInstallation(editor.components, editor.wires, board) : null;
    editor.circuitTags = design && design.ok && typeof circuitTags === 'function' ? circuitTags(design).map : null;
    if (design && design.ok) sim.setDesign(design);
    structKey = null;
    return design;
  }

  // Pièce commandée par un interrupteur (champ ctrl ou position)
  function roomOfSwitch(info, c) {
    if (c.ctrl) { const i = info.rooms.findIndex((r) => r.id === c.ctrl); if (i >= 0) return i; }
    return roomAt(info, c.x, c.y);
  }
  // Allume / éteint une pièce : bascule sa première commande
  function toggleRoomLight(room) {
    const info = computeRooms(editor.components, editor.wires);
    const sw = editor.components.find((c) => (c.type === 'switch_sa' || c.type === 'switch_vv_wall') && roomOfSwitch(info, c) === room);
    if (sw) { sw.closed = !sw.closed; return true; }
    const lights = editor.components.filter((c) => LIGHT_T.has(c.type) && roomAt(info, c.x, c.y) === room);
    lights.forEach((c) => { c.on = !c.on; });
    return lights.length > 0;
  }
  // Changement d'état sans entrée d'historique (on ne « modifie » pas le plan)
  function touched() {
    editor.autosave();
    tick(0, true);
  }

  // ---- Boucle de simulation ------------------------------------------------
  let lastTick = performance.now(), lastSig = '', uiT = 0, dayT = 0;
  function tick(dtOverride, forceUi) {
    const now = performance.now();
    const dt = dtOverride !== undefined ? dtOverride : Math.min(day.running ? 1 : 0.5, (now - lastTick) / 1000);
    lastTick = now;
    const d = ensureDesign();
    if (!d || !d.ok) {
      if (editor.planState) { editor.planState = null; editor.render(); }
      if (forceUi || (app.activeTab() === 'install' && now - uiT > 1000)) { uiT = now; renderInstall(); }
      return;
    }
    if (day.running && d !== day.design) dayFinish(false); // plan modifié : on arrête
    if (day.running) dayApply(editor.components, day.ctx, day.h, day.season, pvShift());
    const snap = sim.step(dt, editor.components, editor.wires);
    if (day.running && dt > 0) dayAdvance(snap, dt);
    const on = new Set();
    for (const id in snap.devices) if (snap.devices[id].on) on.add(id);
    for (const c of editor.components) {
      const sock = d.plugs[c.id];
      if (sock && snap.devices[sock] && snap.devices[sock].U > 0 && (c.on || (LOADS[c.type] && LOADS[c.type].always))) on.add(c.id);
    }
    editor.planState = { lit: snap.lit, on };
    const sig = [...snap.lit].join() + '|' + [...on].join() + '|' +
      Object.values(sim.breakers).map((b) => (b.tripped ? 't' : b.closed ? '1' : '0') + Math.min(4, Math.floor(b.heat * 3))).join('') +
      Object.values(sim.rcds).map((r) => (r.tripped ? 't' : r.closed ? '1' : '0')).join('') + (sim.agcp.closed ? 'A' : 'a');
    if (sig !== lastSig) {
      lastSig = sig;
      editor.render();
      if (viz && !$('view3d').hidden) build3D(false);
    }
    if (app.activeTab() === 'install' && (forceUi || now - uiT > 250)) { uiT = now; renderInstall(); }
    if (viz && !$('view3d').hidden) updateHud(snap);
    if (app.activeTab() === 'install' && (day.running || forceUi) && now - dayT > 200) { dayT = now; renderDay(); }
  }
  setInterval(() => tick(), 100);

  // ---- Onglet Tableau -----------------------------------------------------
  const panel = $('install-panel');
  let structKey = null;
  function renderInstall() {
    const d = ensureDesign();
    const key = designRev + '|' + (d && d.ok ? 'ok' : 'no');
    if (key !== structKey) { structKey = key; renderStructure(d); }
    if (d && d.ok && sim.snap) renderLive(d, sim.snap);
  }

  function renderStructure(d) {
    if (!d || !d.ok) {
      const msg = !hasPlan()
        ? 'Crée une maison type — plan, mobilier, installation NF C 15-100 et goulottes en un clic — ou dessine la tienne.'
        : 'Ce plan n’a pas encore de tableau électrique : l’implantation automatique pose la GTL, le tableau et tout l’appareillage manquant.';
      panel.innerHTML =
        '<div class="norm-empty"><b>Tableau électrique</b><p>' + msg + '</p>' +
        '<div class="inst-empty-actions">' +
        '<button class="btn-primary" data-act="houses">Nouvelle maison…</button>' +
        (hasPlan() ? '<button class="btn-ghost" data-act="implant">Implanter automatiquement</button>' : '<button class="btn-ghost" data-act="board" title="Schéma unifilaire d’un tableau, sans dessiner de plan">Tableau sans plan…</button>') +
        '</div></div>';
      bindActions();
      return;
    }
    const kinds = { light: 'Éclairage', socket: 'Prises', heating: 'Chauffage', dedicated: 'Spécialisé' };
    let h = '<div class="inst-actions">' +
      '<button data-act="implant" title="Ajoute l’appareillage NF C 15-100 manquant puis retrace les goulottes">Implanter</button>' +
      '<button data-act="conduits" title="Retrace toutes les goulottes depuis le tableau">Goulottes</button>' +
      '<button data-act="furnish" title="Meuble les pièces vides">Meubler</button>' +
      '<button data-act="board" title="Tableau électrique et folios : modifier les circuits, unifilaire, note de calcul, schémas développés, élévations, communication, face avant, étiquettes ; exports SVG / DXF / PDF">Folios</button>' +
      `<button data-act="tags" aria-pressed="${editor.showTags ? 'true' : 'false'}" title="Repère du circuit (C1, C2…) à côté de chaque appareil du plan, aux couleurs des câbles">Repères</button>` +
      '<button data-act="dossier" title="Dossier du projet à imprimer ou enregistrer en PDF : plan, norme, tableau, matériel, 3D, journée type">Dossier</button></div>';
    // Puissance et énergie
    h += '<div class="inst-live">' +
      '<div class="il-top"><div><b data-l="P" class="num">0 W</b><span data-l="Psub"></span></div></div>' +
      '<div class="il-gauge"><i data-l="gauge"></i></div>' +
      '<div class="norm-kpis"><div><b data-l="I" class="num">0 A</b><span>intensité</span></div>' +
      '<div><b data-l="E" class="num">0</b><span>énergie</span></div><div><b data-l="C" class="num">0 €</b><span>coût (tarif base)</span></div></div>' +
      '<div class="il-clock"><span>Temps simulé<br><b data-l="T" class="num"></b></span>' +
      '<div class="il-speed seg" role="group" aria-label="Vitesse de simulation">' +
      [[0, '❚❚'], [1, '×1'], [10, '×10'], [60, '×60']].map(([v, t]) => `<button data-speed="${v}" class="${sim.speed === v ? 'on' : ''}" title="${v ? 'Temps ×' + v : 'Pause'}">${t}</button>`).join('') +
      '</div></div></div>';
    h += dayHTML();
    // Tableau (rangées sur rail DIN)
    h += '<div class="board"><div class="board-row"><button class="dm dm-agcp" data-agcp title="Disjoncteur de branchement : cliquer pour ouvrir / réarmer">' +
      '<span class="dm-lever"></span><b>AGCP</b><em>' + d.agcp.setting + ' A</em></button>' +
      `<div class="board-info"><b>Abonnement ${d.agcp.kva} kVA${d.custom ? ' <em class="bd-badge">personnalisé</em>' : ''}</b><span>${d.circuits.length} circuits · ${d.rcds.length} différentiels 30 mA · ${Math.round(d.cableTotal)} m de câble · réserve ${d.reserve} modules</span>` +
      `<button class="bd-open" data-act="board">Modifier le tableau · folios</button></div></div>`;
    for (const r of d.rcds) {
      const cs = d.circuits.filter((c) => c.rcd === r.id);
      if (!cs.length) continue;
      h += `<div class="board-row"><button class="dm dm-rcd" data-rcd="${r.id}" title="Interrupteur différentiel ${r.In} A 30 mA type ${r.type}"><span class="dm-lever"></span><b>${r.id}</b><em>${r.In} A · ${r.type}</em></button><div class="board-mods">`;
      for (const c of cs) {
        h += `<button class="dm" data-ct="${c.id}" title="${esc(c.id + ' ' + c.name + ' — ' + c.rooms)}&#10;${c.In} A · ${String(c.S).replace('.', ',')} mm² · ${c.length.toFixed(1).replace('.', ',')} m · ΔU ${c.dUpct.toFixed(1).replace('.', ',')} %">` +
          `<span class="dm-lever"></span><b>${c.id}</b><em>${c.In} A</em><i class="dm-load"><u data-load="${c.id}"></u></i><small>${esc(c.name)}</small></button>`;
      }
      h += '</div></div>';
    }
    h += '</div>';
    // Circuits
    h += '<details class="inst-sec" open><summary>Circuits <span>' + d.circuits.length + '</span></summary><table class="ct-table"><thead><tr><th>Circuit</th><th>Protection</th><th>ΔU max</th><th>I</th></tr></thead><tbody>';
    for (const c of d.circuits) {
      h += `<tr data-row="${c.id}" title="${esc(c.rooms)}"><td><b>${c.id}</b> ${esc(c.name)}<small>${kinds[c.kind]} · ${c.points} pt${c.points > 1 ? 's' : ''} · ${c.length.toFixed(1).replace('.', ',')} m</small></td>` +
        `<td class="num">${c.In} A<small>${String(c.S).replace('.', ',')} mm²</small></td>` +
        `<td class="num ${c.ok ? '' : 'bad'}">${c.dUpct.toFixed(1).replace('.', ',')} %<small>max ${c.limit} %</small></td><td class="num" data-i="${c.id}">—</td></tr>`;
    }
    h += '</tbody></table></details>';
    // Pièces et appareils
    h += '<details class="inst-sec" open><summary>Pièces et appareils</summary>' + renderRooms(d) + '</details>';
    for (const i of d.issues) h += `<div class="inst-issue ${i.level}">${esc(i.msg)}</div>`;
    for (const i of (d.checks || []).filter((c) => c.level === 'err' || c.level === 'warn')) h += `<div class="inst-issue ${i.level}">${esc(i.msg)}</div>`;
    h += '<details class="inst-sec" open><summary>Journal</summary><ul class="inst-log" data-l="log"></ul></details>';
    h += '<p class="norm-foot">Simulation pédagogique : charges résistives, chute de tension 2·ρ·L·I/S, disjoncteurs courbe C (thermique du 1er ordre, magnétique au-delà de 10 In), différentiels 30 mA. Elle ne remplace pas une étude d’installation.</p>';
    panel.innerHTML = h;
    bindActions();
    bindDay();
    renderDay();
  }

  function renderRooms(d) {
    const info = computeRooms(editor.components, editor.wires);
    let h = '<div class="ap-rooms">';
    info.rooms.forEach((room, i) => {
      if (room.leaked || room.sharedWith !== null) return;
      const inRoom = (c) => roomAt(info, c.x, c.y) === i;
      const lights = editor.components.filter((c) => LIGHT_T.has(c.type) && inRoom(c));
      const apps = editor.components.filter((c) => LOADS[c.type] && ['dedicated', 'heating', 'plug'].includes(LOADS[c.type].cls) && inRoom(c));
      const sockets = editor.components.filter((c) => c.type === 'socket_wall' && inRoom(c));
      if (!lights.length && !apps.length && !sockets.length) return;
      h += `<div class="ap-room" data-room="${i}"><div class="ap-head"><span class="nr-dot" style="background:${room.color}"></span><b>${esc(room.name)}</b>`;
      if (lights.length) h += `<button class="ap-light" data-light="${i}" aria-pressed="false" title="Allumer / éteindre la pièce"><span></span>Lumière</button>`;
      h += '</div>';
      for (const c of apps) {
        const s = LOADS[c.type];
        h += `<div class="ap"><span class="ap-name">${esc(s.name)}${c.label ? ' <small>' + esc(c.label) + '</small>' : ''}</span><em class="num" data-dev="${c.id}">${fmtW(loadPower(c))}</em>` +
          (s.always ? '<span class="ap-always" title="Toujours alimenté">24 h/24</span>' : `<button class="tgl" data-on="${c.id}" aria-pressed="${c.on ? 'true' : 'false'}" title="Marche / arrêt"></button>`) +
          (s.cls !== 'plug' ? `<button class="flt" data-fault="${c.id}:leak" title="Défaut d’isolement (fuite à la terre)">💧</button><button class="flt" data-fault="${c.id}:short" title="Court-circuit">⚡</button>` : '') + '</div>';
      }
      if (sockets.length) {
        const s0 = sockets[0];
        h += `<div class="ap"><span class="ap-name">Prises <small>${sockets.length}</small></span><em class="num" data-dev="${s0.id}">${s0.on && parsePower(s0.value) ? fmtW(parsePower(s0.value)) : 'libre'}</em>` +
          `<button class="tgl" data-heater="${s0.id}" aria-pressed="${s0.on ? 'true' : 'false'}" title="Brancher un radiateur d’appoint de 2 kW sur ${esc(s0.label)}"></button>` +
          `<button class="flt" data-fault="${s0.id}:short" title="Court-circuit sur ${esc(s0.label)}">⚡</button></div>`;
      }
      h += '</div>';
    });
    return h + '</div>';
  }

  function renderLive(d, snap) {
    const q = (k) => panel.querySelector(`[data-l="${k}"]`);
    if (!q('P')) return;
    const load = snap.agcpLoad;
    q('P').textContent = fmtW(snap.P);
    q('Psub').textContent = `sur ${d.agcp.kva} kVA souscrits · ${Math.round(load * 100)} %`;
    const g = q('gauge');
    g.style.width = Math.min(100, load * 100) + '%';
    g.className = load > 1 ? 'over' : load > 0.8 ? 'high' : '';
    q('I').textContent = fmtA(snap.I);
    q('E').textContent = fmtKWh(snap.energy);
    q('C').textContent = fmtEur(snap.cost);
    q('T').textContent = fmtClock(snap.t);
    const setDm = (el, st) => { el.dataset.state = st; };
    const ag = panel.querySelector('[data-agcp]');
    if (ag) setDm(ag, sim.agcp.tripped ? 'tripped' : sim.agcp.closed ? 'on' : 'off');
    panel.querySelectorAll('[data-rcd]').forEach((el) => { const r = sim.rcds[el.dataset.rcd]; setDm(el, r.tripped ? 'tripped' : r.closed ? 'on' : 'off'); });
    for (const c of snap.circuits) {
      const el = panel.querySelector(`[data-ct="${c.id}"]`);
      if (!el) continue;
      const b = sim.breakers[c.id], ct = d.circuits.find((x) => x.id === c.id);
      setDm(el, b.tripped ? 'tripped' : b.closed ? 'on' : 'off');
      el.classList.toggle('dead', !c.live && b.closed);
      const u = panel.querySelector(`[data-load="${c.id}"]`);
      const ratio = c.I / ct.In;
      u.style.width = Math.min(100, ratio * 100) + '%';
      u.className = ratio > 1.13 ? 'over' : b.heat > 0.8 ? 'high' : '';
      const cell = panel.querySelector(`[data-i="${c.id}"]`);
      if (cell) cell.textContent = c.live ? fmtA(c.I) : b.tripped ? 'déclenché' : 'coupé';
    }
    panel.querySelectorAll('[data-dev]').forEach((el) => {
      const dv = snap.devices[el.dataset.dev], c = byId(el.dataset.dev);
      if (!c) return;
      if (c.type === 'socket_wall') el.textContent = dv && dv.P ? fmtW(dv.P) + ' · ' + Math.round(dv.U) + ' V' : c.on ? 'sans tension' : 'libre';
      else if (LOADS[c.type].cls === 'plug') el.textContent = editor.planState && editor.planState.on.has(c.id) ? fmtW(loadPower(c)) : fmtW(loadPower(c)) + ' · arrêt';
      else el.textContent = dv && dv.P ? fmtW(dv.P) + ' · ' + Math.round(dv.U) + ' V' : fmtW(loadPower(c)) + (dv && !dv.U && (c.on || LOADS[c.type].always) ? ' · sans tension' : '');
    });
    panel.querySelectorAll('[data-on]').forEach((el) => { const c = byId(el.dataset.on); if (c) el.setAttribute('aria-pressed', c.on ? 'true' : 'false'); });
    panel.querySelectorAll('[data-heater]').forEach((el) => { const c = byId(el.dataset.heater); if (c) el.setAttribute('aria-pressed', c.on ? 'true' : 'false'); });
    panel.querySelectorAll('[data-fault]').forEach((el) => { const [id, k] = el.dataset.fault.split(':'); el.classList.toggle('on', sim.faults[id] === k); });
    const info = computeRooms(editor.components, editor.wires);
    panel.querySelectorAll('[data-light]').forEach((el) => {
      const i = +el.dataset.light;
      const lit = editor.components.some((c) => LIGHT_T.has(c.type) && snap.lit.has(c.id) && roomAt(info, c.x, c.y) === i);
      el.setAttribute('aria-pressed', lit ? 'true' : 'false');
    });
    const log = q('log');
    const html = sim.events.slice(0, 12).map((e) => `<li class="${e.level}"><span class="num">${fmtClock(e.t)}</span>${esc(e.msg)}</li>`).join('') || '<li class="info">Aucun événement. Allume des appareils, provoque un défaut…</li>';
    if (log.innerHTML !== html) log.innerHTML = html;
  }

  function bindActions() {
    panel.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => action(b.dataset.act)));
    panel.querySelectorAll('[data-speed]').forEach((b) => b.addEventListener('click', () => {
      if (day.running) dayPause();
      sim.speed = +b.dataset.speed;
      panel.querySelectorAll('[data-speed]').forEach((x) => x.classList.toggle('on', x === b));
    }));
    const ag = panel.querySelector('[data-agcp]');
    if (ag) ag.addEventListener('click', () => { sim.toggleAgcp(); tick(0, true); });
    panel.querySelectorAll('[data-rcd]').forEach((b) => b.addEventListener('click', () => { sim.toggleRcd(b.dataset.rcd); tick(0, true); }));
    panel.querySelectorAll('[data-ct]').forEach((b) => {
      b.addEventListener('click', () => { sim.toggleBreaker(b.dataset.ct); tick(0, true); });
      b.addEventListener('mouseenter', () => highlightCircuit(b.dataset.ct));
      b.addEventListener('mouseleave', () => highlightCircuit(null));
    });
    panel.querySelectorAll('[data-row]').forEach((r) => {
      r.addEventListener('mouseenter', () => highlightCircuit(r.dataset.row));
      r.addEventListener('mouseleave', () => highlightCircuit(null));
    });
    panel.querySelectorAll('[data-on]').forEach((b) => b.addEventListener('click', () => {
      const c = byId(b.dataset.on); if (!c) return;
      c.on = !c.on; touched();
    }));
    panel.querySelectorAll('[data-heater]').forEach((b) => b.addEventListener('click', () => {
      const c = byId(b.dataset.heater); if (!c) return;
      c.on = !c.on;
      if (c.on && !parsePower(c.value)) c.value = '2000 W';
      touched();
    }));
    panel.querySelectorAll('[data-light]').forEach((b) => b.addEventListener('click', () => { if (toggleRoomLight(+b.dataset.light)) touched(); }));
    panel.querySelectorAll('[data-fault]').forEach((b) => b.addEventListener('click', () => {
      const [id, k] = b.dataset.fault.split(':');
      const c = byId(id);
      if (sim.faults[id] === k) { sim.setFault(id, null); sim.log(`Défaut supprimé sur ${c ? c.label || id : id} : réarme la protection.`); }
      else { sim.setFault(id, k); if (k === 'short' && c && c.type === 'socket_wall') c.on = true; }
      tick(0, true);
    }));
  }

  function highlightCircuit(id) {
    const ct = id && design && design.ok ? design.circuits.find((c) => c.id === id) : null;
    editor.highlight = ct ? new Set(ct.devices) : null;
    editor.render();
  }

  // Actions de conception (avec historique : annulables)
  function action(act) {
    if (act === 'houses') { openHouses(); return; }
    if (act === 'dossier') { openDossier(); return; }
    if (act === 'unifilar' || act === 'board') { if (app.openBoard) app.openBoard(); return; }
    if (act === 'tags') {
      editor.showTags = !editor.showTags;
      try { localStorage.setItem('electricad-tags', editor.showTags ? '1' : '0'); } catch (_) { /* stockage indisponible */ }
      editor.render(); structKey = null; tick(0, true);
      if (editor.showTags) showToast('Repères de circuits sur le plan : ils suivent aussi les exports SVG, DXF, l’impression et le dossier (avec la légende).', 4500);
      return;
    }
    const doc = { components: editor.components, wires: editor.wires, counters: editor.counters };
    if (act === 'implant') {
      const r = autoImplant(doc);
      const k = autoConduits(doc);
      editor.wires = doc.wires;
      editor.pushHistory(); editor.render();
      showToast(r.added ? `<b>${r.added} éléments posés</b> (NF C 15-100) et ${k.conduits} goulottes tracées (${k.length.toFixed(0)} m).` : 'Rien à ajouter : l’appareillage est déjà complet. Goulottes retracées.');
    } else if (act === 'conduits') {
      if (editor.wires.some((w) => w.kind === 'conduit') && !confirm('Remplacer toutes les goulottes par un tracé automatique ?')) return;
      const k = autoConduits(doc);
      editor.wires = doc.wires;
      editor.pushHistory(); editor.render();
      showToast(k.conduits ? `<b>${k.conduits} goulottes</b> tracées depuis le tableau (${k.length.toFixed(0)} m).` : 'Place d’abord un tableau électrique.');
    } else if (act === 'lighting') {
      const before = lightingStudy(editor.components, editor.wires);
      const r = autoLighting(doc);
      if (r.added && editor.wires.some((w) => w.kind === 'conduit')) { autoConduits(doc); editor.wires = doc.wires; }
      editor.pushHistory(); editor.render();
      const after = lightingStudy(editor.components, editor.wires);
      const gain = r.rooms.map((name) => {
        const a = before.rooms.find((R) => R.name === name), b = after.rooms.find((R) => R.name === name);
        return a && b ? `${esc(name)} ${Math.round(a.avg)} → ${Math.round(b.avg)} lx` : esc(name);
      });
      showToast(r.added ? `<b>${r.added} applique${r.added > 1 ? 's' : ''}</b> posée${r.added > 1 ? 's' : ''} : ${gain.join(', ')}. Annulable dans le plan (Ctrl+Z).` : 'Pas de place libre sur les murs des pièces sous-éclairées.', 6500);
    } else if (act === 'furnish') {
      const r = furnishPlan(doc);
      editor.pushHistory(); editor.render();
      showToast(r.placed ? `<b>${r.placed} meubles</b> posés dans ${r.rooms} pièce${r.rooms > 1 ? 's' : ''}` + (r.missed.length ? ` — sans place : ${esc(r.missed.join(', '))}` : '.') : 'Toutes les pièces reconnues sont déjà meublées.');
    }
    ensureDesign(true);
    tick(0, true);
    if (viz && !view3d.hidden) build3D(false); // action lancée depuis la 3D (appliques)
  }

  // ---- Nouvelle maison -----------------------------------------------------
  const hModal = $('houses-modal'), hGrid = $('houses-grid');
  const thumbs = {};
  function openHouses() {
    hGrid.innerHTML = '';
    for (const T of HOUSE_TYPES) {
      const card = document.createElement('button');
      card.className = 'ex-card house-card';
      const cv = document.createElement('canvas');
      cv.className = 'ex-thumb';
      const doc = thumbs[T.key] || (thumbs[T.key] = buildHouse(T.key, { elec: false }));
      app.renderThumb(cv, doc);
      const info = computeRooms(doc.components, doc.wires);
      const area = info.rooms.reduce((s, r) => s + (r.area || 0), 0);
      card.innerHTML = `<div class="ex-name">${esc(T.name)}</div><div class="ex-desc">${esc(T.desc)}</div>` +
        `<div class="ex-badges"><span class="badge level">${fmtArea(area)}</span><span class="badge level">${info.rooms.length} pièces</span><span class="badge sim-plan">${esc(T.tag)}</span></div>`;
      card.prepend(cv);
      card.addEventListener('click', () => createHouse(T));
      hGrid.appendChild(card);
    }
    hModal.hidden = false;
    document.body.classList.add('modal-open');
  }
  function closeHouses() { hModal.hidden = true; document.body.classList.remove('modal-open'); }
  function createHouse(T) {
    if ((editor.components.length || editor.wires.length) && !confirm('Remplacer le plan actuel par « ' + T.name + ' » ?')) return;
    const opts = { furnish: $('ho-furnish').checked, elec: $('ho-elec').checked, heating: $('ho-heating').checked, conduits: $('ho-conduits').checked };
    const doc = buildHouse(T.key, opts);
    closeHouses();
    editor.load(doc);
    sim.events = []; sim.energy = 0; sim.t = 0;
    const d = ensureDesign(true);
    showTab(d && d.ok ? 'install' : 'norm');
    const info = computeRooms(doc.components, doc.wires);
    const area = info.rooms.reduce((s, r) => s + (r.area || 0), 0);
    showToast(`<b>${esc(T.name)}</b> : ${info.rooms.length} pièces, ${fmtArea(area)}` + (d && d.ok ? `, ${d.circuits.length} circuits — ouvre la <b>3D</b> pour la visiter !` : '.'), 5200);
  }
  // Plan venu d'ailleurs (import DXF) : même accueil qu'une maison générée
  function loadPlan(doc, go3D) {
    editor.load(doc);
    sim.events = []; sim.energy = 0; sim.t = 0;
    const d = ensureDesign(true);
    showTab(d && d.ok ? 'install' : 'norm');
    if (go3D) open3D();
    return d;
  }
  $('btn-houses').addEventListener('click', openHouses);
  $('houses-close').addEventListener('click', closeHouses);
  hModal.querySelector('.modal-backdrop').addEventListener('click', closeHouses);
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !hModal.hidden) closeHouses(); }, true);

  // ---- Journée type ---------------------------------------------------------
  // 24 heures simulées : emploi du temps (day.js) → simulation physique →
  // énergie par heure et par usage ; en 3D, le soleil et les lampes suivent.
  const day = { season: 'hiver', rate: 0.5, running: false, h: 0, acc: null, saved: null, ctx: null, design: null, prevTime: null, hover: -1, instant: false, year: null, yearSig: '', yearDesign: null };
  const hhmm = (h) => {
    const H = Math.floor(h), M = Math.min(59, Math.floor((h - H) * 60));
    return String(H % 24).padStart(2, '0') + ':' + String(M).padStart(2, '0');
  };
  const fmtKWh1 = (k) => (k < 10 ? k.toFixed(1) : Math.round(k).toString()).replace('.', ',') + ' kWh';
  const pvKwc = () => +(editor.meta.pv || 0);
  const pvShift = () => !!editor.meta.pvShift && pvKwc() > 0;

  function dayHTML() {
    return '<details class="inst-sec day-sec" open><summary>Journée type <span>24 h simulées</span></summary>' +
      '<div class="day-ctl">' +
      '<button class="day-play" data-day-play title="Faire défiler 24 heures : lumières, appareils, chauffage, soleil en 3D">▶ Lancer</button>' +
      '<button class="day-btn" data-day-stop title="Arrêter et remettre la maison dans son état" hidden>■</button>' +
      '<button class="day-btn" data-day-now title="Calculer toute la journée d’un coup">Calculer</button>' +
      '<b class="day-clock num" data-day-clock>—</b>' +
      '<div class="seg day-season" role="group" aria-label="Saison">' +
      Object.entries(DAY_SEASONS).map(([k, v]) => `<button data-season="${k}" class="${day.season === k ? 'on' : ''}">${v.label}</button>`).join('') +
      '</div></div>' +
      '<div class="day-pv"><span>Solaire</span><div class="seg" role="group" aria-label="Panneaux solaires">' +
      [0, 3, 6, 9].map((k) => `<button data-pv="${k}" class="${pvKwc() === k ? 'on' : ''}">${k ? k + ' kWc' : 'Aucun'}</button>`).join('') +
      `</div><label class="day-shift" ${pvKwc() ? '' : 'hidden'}><input type="checkbox" data-pv-shift ${pvShift() ? 'checked' : ''}> Lessive, vaisselle et chauffe-eau quand le soleil produit</label></div>` +
      '<div class="day-chart-wrap" data-day-wrap><canvas class="day-chart" data-day-chart aria-label="Énergie consommée heure par heure"></canvas>' +
      '</div>' +
      '<p class="day-head" data-day-head></p><ul class="day-legend" data-day-legend></ul>' +
      '<p class="day-sum" data-day-sum>Réveil 6 h 30, départ 8 h 15, retour 17 h 15, coucher 23 h ; lessive, vaisselle, chauffe-eau et recharge en heures creuses.</p>' +
      '<div class="year-box"><div class="year-head"><b>Bilan annuel</b><span>estimation</span>' +
      '<button class="day-btn" data-year-go title="Simuler une journée d’hiver et une d’été, puis les étendre à l’année">Estimer l’année</button></div>' +
      '<div data-year-out></div></div>' +
      '</details>';
  }

  function daySetTime3D(h) {
    const t = Math.round((h % 24) * 4) / 4;
    if (viz && viz.setTime) viz.setTime(h % 24);
    $('v3-time').value = t;
    $('v3-time-lbl').textContent = hhmm(h);
    const sun = (day.saved && PV_SUN[day.season]) || [6.5, 19.5]; // lever / coucher de la saison simulée
    $('v3-time-ico').textContent = h % 24 > sun[0] && h % 24 < sun[1] ? '☀' : '☾';
  }
  function dayStart() {
    const d = ensureDesign();
    if (!d || !d.ok) { showToast('La journée type a besoin d’un tableau : crée une maison ou lance l’implantation.'); return; }
    if (!day.saved) { // nouvelle journée (sinon reprise après une pause)
      day.saved = daySnapshotStates(editor.components);
      day.ctx = dayContext(editor.components, editor.wires);
      day.acc = dayAccumulator();
      day.design = d;
      day.h = 0;
      day.instant = false;
      day.prevTime = v3.time;
      sim.events.length = 0;
      if (viz && viz.setSeason) viz.setSeason(day.season); // soleil de la saison simulée
    }
    day.running = true;
    sim.speed = day.rate * 3600;
    dayUi();
  }
  function dayPause() {
    day.running = false;
    sim.speed = 1;
    dayUi();
  }
  function dayAdvance(snap, dt) {
    const dh = dt * day.rate;
    dayAccumulate(day.acc, snap, editor.components, day.h, dh, pvKwc(), day.season);
    day.h = Math.min(24, day.h + dh);
    if (viz && !$('view3d').hidden) daySetTime3D(day.h);
    if (day.h >= 24) dayFinish(true);
  }
  function dayFinish(completed) {
    day.running = false;
    sim.speed = 1;
    if (day.saved) dayRestoreStates(day.saved);
    day.saved = null;
    if (viz && viz.setSeason) viz.setSeason(v3.sunpath && v3.walls === 'roof' ? v3.sunpath : null);
    if (day.prevTime !== null) { v3.time = day.prevTime; daySetTime3D(day.prevTime); day.prevTime = null; }
    editor.autosave();
    if (completed && day.acc) {
      const c = dayCost(day.acc);
      showToast(`Journée terminée : ${fmtKWh1(day.acc.total)} · ${fmtEur(c.base)} · pointe ${fmtW(day.acc.peak.P)} à ${hhmm(day.acc.peak.h)}`, 5000);
    }
    dayUi();
    renderDay();
  }
  function dayInstant() {
    const d = ensureDesign();
    if (!d || !d.ok) return;
    if (day.saved) dayFinish(false);
    day.acc = simulateDay(editor.components, editor.wires, d, day.season, 2, pvKwc(), pvShift());
    day.h = 24;
    day.instant = true;
    renderDay();
  }
  function dayUi() {
    const play = panel.querySelector('[data-day-play]');
    if (play) {
      play.textContent = day.running ? '❚❚ Pause' : day.saved ? '▶ Reprendre' : '▶ Lancer';
      play.classList.toggle('on', day.running);
      panel.querySelector('[data-day-stop]').hidden = !day.saved;
      panel.querySelectorAll('[data-speed]').forEach((x) => x.classList.toggle('on', !day.running && +x.dataset.speed === sim.speed));
    }
    const b3 = $('v3-day');
    if (b3) {
      b3.classList.toggle('on', day.running);
      b3.setAttribute('aria-pressed', day.running ? 'true' : 'false');
      b3.textContent = day.running ? '❚❚ ' + hhmm(day.h) : day.saved ? '▶ ' + hhmm(day.h) : 'Journée';
    }
  }
  function bindDay() {
    const q = (k) => panel.querySelector(k);
    if (!q('[data-day-play]')) return;
    q('[data-day-play]').addEventListener('click', () => (day.running ? dayPause() : dayStart()));
    q('[data-day-stop]').addEventListener('click', () => dayFinish(false));
    q('[data-day-now]').addEventListener('click', dayInstant);
    panel.querySelectorAll('[data-season]').forEach((b) => b.addEventListener('click', () => {
      day.season = b.dataset.season;
      panel.querySelectorAll('[data-season]').forEach((x) => x.classList.toggle('on', x === b));
      if (day.saved) dayFinish(false);
      if (day.instant) dayInstant();
    }));
    panel.querySelectorAll('[data-pv]').forEach((b) => b.addEventListener('click', () => {
      editor.meta.pv = +b.dataset.pv;
      panel.querySelectorAll('[data-pv]').forEach((x) => x.classList.toggle('on', x === b));
      q('.day-shift').hidden = !editor.meta.pv;
      editor.autosave();
      if (viz && !view3d.hidden) build3D(false);
      if (day.instant) dayInstant(); else renderDay();
      renderYear();
    }));
    q('[data-pv-shift]').addEventListener('change', (e) => {
      editor.meta.pvShift = e.target.checked;
      editor.autosave();
      if (day.instant) dayInstant();
      renderYear();
    });
    q('[data-year-go]').addEventListener('click', () => {
      const d = ensureDesign();
      if (!d || !d.ok) { showToast('Le bilan annuel a besoin d’un tableau : crée une maison ou lance l’implantation.'); return; }
      day.year = simulateYear(editor.components, editor.wires, d, 10, pvKwc(), pvShift());
      day.yearSig = yearSig(); day.yearDesign = d;
      renderYear();
    });
    renderYear();
    const cv = q('[data-day-chart]');
    const hourAt = (e) => {
      const r = cv.getBoundingClientRect(), g = dayGeom(r.width);
      const k = Math.floor((e.clientX - r.left - g.left) / g.slot);
      return k >= 0 && k < 24 ? k : -1;
    };
    cv.addEventListener('pointermove', (e) => { const k = hourAt(e); if (k !== day.hover) { day.hover = k; renderDay(); } });
    cv.addEventListener('pointerleave', () => { day.hover = -1; renderDay(); });
    dayUi();
  }

  const dayGeom = (W) => { const left = 34, right = 6; return { left, right, top: 10, bottom: 20, slot: (W - left - right) / 24 }; };
  function renderDay() {
    const cv = panel.querySelector('[data-day-chart]');
    if (!cv) return;
    const clock = panel.querySelector('[data-day-clock]');
    clock.textContent = day.acc ? (day.h >= 24 ? '24:00' : hhmm(day.h)) + ' · ' + DAY_SEASONS[day.season].label.toLowerCase() : '—';
    dayUi();
    const wrap = panel.querySelector('[data-day-wrap]'), cs = getComputedStyle(wrap);
    const col = (n) => cs.getPropertyValue(n).trim();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = cv.clientWidth || 280, H = cv.clientHeight || 150;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const g = dayGeom(W), plotH = H - g.top - g.bottom, base = H - g.bottom;
    const bins = day.acc ? day.acc.bins : null;
    const tot = (b) => DAY_CATS.reduce((s, c) => s + b[c.key], 0);
    const max = bins ? Math.max(...bins.map((b) => Math.max(tot(b), b.pv || 0))) : 0;
    const nice = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50].find((v) => v >= max * 1.05) || Math.ceil(max);
    const y = (v) => base - (v / nice) * plotH;
    // Heures creuses (22 h → 6 h) : bande discrète
    ctx.fillStyle = col('--dc-hc');
    ctx.fillRect(g.left, g.top, 6 * g.slot, plotH);
    ctx.fillRect(g.left + 22 * g.slot, g.top, 2 * g.slot, plotH);
    ctx.font = '9.5px ' + cs.fontFamily;
    ctx.fillStyle = col('--dc-muted');
    ctx.textAlign = 'left';
    ctx.fillText('HC', g.left + 3, g.top + 10);
    // Grille et axes (discrets)
    ctx.strokeStyle = col('--dc-grid'); ctx.lineWidth = 1;
    ctx.textAlign = 'right';
    for (const v of [0, nice / 2, nice]) {
      const yy = Math.round(y(v)) + 0.5;
      ctx.beginPath(); ctx.moveTo(g.left, yy); ctx.lineTo(W - g.right, yy); ctx.stroke();
      ctx.fillText(String(v).replace('.', ','), g.left - 5, yy + 3);
    }
    ctx.save(); ctx.translate(9, g.top + plotH / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.fillText('kWh', 0, 0); ctx.restore();
    for (const hh of [0, 6, 12, 18, 24]) {
      ctx.textAlign = hh === 24 ? 'right' : hh === 0 ? 'left' : 'center';
      ctx.fillText(hh + ' h', g.left + hh * g.slot, H - 6);
    }
    // Barres empilées par usage (2 px d'écart), coins arrondis en haut
    if (bins) {
      const bw = Math.max(2, g.slot - 2);
      bins.forEach((b, k) => {
        const x = g.left + k * g.slot + 1;
        let acc = 0;
        const t = tot(b);
        if (t <= 0) return;
        const faded = day.hover >= 0 && day.hover !== k;
        ctx.globalAlpha = faded ? 0.45 : 1;
        DAY_CATS.forEach((c, i) => {
          const v = b[c.key];
          if (v <= 0) return;
          const y0 = y(acc), y1 = y(acc + v);
          acc += v;
          const top = acc >= t - 1e-9;
          const hgt = Math.max(1, y0 - y1 - (top ? 0 : 2));
          ctx.fillStyle = col('--dc' + (i + 1));
          ctx.beginPath();
          if (top && ctx.roundRect) ctx.roundRect(x, y0 - hgt, bw, hgt, [Math.min(3, bw / 2), Math.min(3, bw / 2), 0, 0]);
          else ctx.rect(x, y0 - hgt, bw, hgt);
          ctx.fill();
        });
      });
      ctx.globalAlpha = 1;
      // Production solaire : ligne en marches (même échelle en kWh par heure)
      if (day.acc.pv > 0) {
        ctx.strokeStyle = col('--dc7'); ctx.lineWidth = 2; ctx.lineJoin = 'round';
        ctx.beginPath();
        bins.forEach((b, k) => {
          const yy = y(Math.min(nice, b.pv)), x0 = g.left + k * g.slot, x1 = x0 + g.slot;
          if (k === 0) ctx.moveTo(x0, yy); else ctx.lineTo(x0, yy);
          ctx.lineTo(x1, yy);
        });
        ctx.stroke();
      }
      // Heure courante
      if (day.h > 0 && day.h < 24) {
        const xx = g.left + day.h * g.slot;
        ctx.strokeStyle = col('--dc-text'); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(xx, g.top); ctx.lineTo(xx, base); ctx.stroke();
      }
    }
    // Légende = relevé : la journée entière, ou l'heure survolée (toutes les catégories)
    const legend = panel.querySelector('[data-day-legend]');
    const focus = bins && day.hover >= 0 ? bins[day.hover] : null;
    const vals = DAY_CATS.map((c) => (focus ? focus[c.key] : bins ? bins.reduce((s, b) => s + b[c.key], 0) : 0));
    const head = panel.querySelector('[data-day-head]');
    head.textContent = focus ? `${day.hover} h – ${day.hover + 1} h : ${fmtKWh1(tot(focus))}` : bins ? 'Sur la journée (survole une barre pour le détail d’une heure)' : 'Lance ou calcule la journée';
    legend.innerHTML = DAY_CATS.map((c, i) => `<li><i style="background:var(--dc${i + 1})"></i><span>${esc(c.name)}</span><b class="num">${bins ? fmtKWh1(vals[i]) : '—'}</b></li>`).join('') +
      (pvKwc() ? `<li class="pv"><i></i><span>Production solaire (${pvKwc()} kWc)</span><b class="num">${bins ? fmtKWh1(focus ? focus.pv : day.acc.pv) : '—'}</b></li>` : '');
    const sum = panel.querySelector('[data-day-sum]');
    if (day.acc && day.acc.total > 0) {
      const c = dayCost(day.acc), a = day.acc;
      sum.innerHTML = `<b class="num">${fmtKWh1(a.total)}</b> ${day.h < 24 ? 'depuis minuit' : 'dans la journée'} · <b class="num">${fmtEur(c.base)}</b> en tarif base, <b class="num">${fmtEur(c.hphc)}</b> en heures creuses (${Math.round((a.hc / a.total) * 100)} % consommés la nuit) · pointe <b class="num">${fmtW(a.peak.P)}</b> à ${hhmm(a.peak.h)}` +
        (a.peak.P > (day.design || design || {}).agcp?.kva * 1000 ? ' — au-delà de l’abonnement !' : '') +
        (a.pv > 0 ? `<br>Solaire : <b class="num">${fmtKWh1(a.pv)}</b> produits, <b class="num">${fmtKWh1(a.self)}</b> consommés sur place (${Math.round((a.self / a.pv) * 100)} % d’autoconsommation, ${Math.round((a.self / Math.max(0.001, a.total)) * 100)} % des besoins) · <b class="num">${fmtEur(c.saving)}</b> économisés` : '');
    }
  }

  // ---- Bilan annuel : deux journées types étendues à l'année ------------------
  const fmtInt = (v) => Math.round(v).toLocaleString('fr-FR');
  const yearSig = () => [pvKwc(), pvShift()].join('|');
  function renderYear() {
    const out = panel.querySelector('[data-year-out]');
    if (!out) return;
    const y = day.year, stale = y && (day.yearSig !== yearSig() || day.yearDesign !== ensureDesign());
    const go = panel.querySelector('[data-year-go]');
    if (go) go.textContent = y ? 'Recalculer' : 'Estimer l’année';
    if (!y) {
      out.innerHTML = '<p class="year-hint">Une journée d’hiver (× 212 jours, octobre → avril) et une d’été (× 153, mai → septembre) : consommation par usage, facture abonnement compris, solaire.</p>';
      return;
    }
    const cats = DAY_CATS.map((c, i) => ({ name: c.name, v: y.cats[c.key], i })).filter((c) => c.v > 0.5);
    const pct = (v) => Math.round((v / Math.max(1, y.total)) * 100);
    const best = y.cost.hphc < y.cost.base ? 'hphc' : 'base';
    out.innerHTML = (stale ? '<p class="year-stale">Plan ou solaire modifié depuis : recalcule pour mettre à jour.</p>' : '') +
      `<p class="year-total"><b class="num">${fmtInt(y.total)} kWh</b> par an · pointe ${fmtW(y.peak)}</p>` +
      '<div class="year-bar" role="img" aria-label="Répartition de la consommation annuelle par usage">' +
      cats.map((c) => `<i style="flex:${c.v.toFixed(1)};background:var(--dc${c.i + 1})" title="${esc(c.name)} : ${fmtInt(c.v)} kWh (${pct(c.v)} %)"></i>`).join('') + '</div>' +
      '<ul class="day-legend year-legend">' + cats.map((c) => `<li><i style="background:var(--dc${c.i + 1})"></i><span>${esc(c.name)}</span><b class="num">${fmtInt(c.v)} kWh · ${pct(c.v)} %</b></li>`).join('') + '</ul>' +
      '<table class="year-bill"><tbody>' +
      [['base', 'Tarif base'], ['hphc', 'Heures creuses']].map(([k, label]) => `<tr class="${best === k ? 'best' : ''}"><td>${label}${best === k ? '<small>✓ le moins cher</small>' : ''}</td>` +
        `<td class="num">${fmtInt(y.cost[k])} €/an<small>≈ ${fmtInt(y.cost[k] / 12)} €/mois</small></td></tr>`).join('') +
      `</tbody></table><p class="year-note">Abonnement ${y.kva} kVA compris (${fmtInt(y.cost.aboBase)} € en base, ${fmtInt(y.cost.aboHphc)} € en heures creuses) · ${Math.round((y.hc / Math.max(1, y.total)) * 100)} % consommés en heures creuses` +
      (y.pv > 0 ? `<br>Solaire ${pvKwc()} kWc : <b class="num">${fmtInt(y.pv)} kWh</b> produits, <b class="num">${fmtInt(y.self)} kWh</b> consommés sur place (${Math.round((y.self / y.pv) * 100)} %), <b class="num">${fmtInt(y.cost.saving)} €</b> économisés, ${fmtInt(y.surplus)} kWh injectés sur le réseau` : '') +
      '<br>Journées dégagées, tarifs réglementés 2026 indicatifs.</p>' + renoHTML(y);
  }
  // Scénarios de rénovation : économies estimées à partir du bilan annuel
  function renoHTML(y) {
    const sc = yearScenarios(y);
    if (!sc.length) return '';
    return '<p class="year-reno-head"><b>Et si l’on rénovait ?</b></p><table class="year-bill year-reno"><tbody>' +
      sc.map((r) => `<tr><td>${esc(r.name)}<small>${esc(r.note)} · ≈ ${fmtInt(r.cost)} € posé</small></td>` +
        `<td class="num">−${fmtInt(r.eur)} €/an<small>−${fmtInt(r.kwh)} kWh · retour ≈ ${r.years < 40 ? Math.round(r.years) + ' ans' : 'très long'}</small></td></tr>`).join('') +
      '</tbody></table><p class="year-note">Avant aides (MaPrimeRénov’, CEE), prix posés indicatifs.</p>';
  }

  // ---- Vue Énergie : sol des pièces teinté selon la puissance consommée --------
  // Échelle séquentielle orangée, 0 → 4 kW (racine : les petites charges restent visibles)
  const ENERGY_RAMP = ['#efe7de', '#f7c9a1', '#f1995c', '#dc6326', '#a83d12'];
  function energyColor(P) {
    const t = Math.sqrt(Math.min(1, Math.max(0, P) / 4000)) * (ENERGY_RAMP.length - 1);
    const i = Math.min(ENERGY_RAMP.length - 2, Math.floor(t)), f = t - i;
    const a = parseInt(ENERGY_RAMP[i].slice(1), 16), b = parseInt(ENERGY_RAMP[i + 1].slice(1), 16);
    const ch = (sh) => Math.round(((a >> sh) & 255) * (1 - f) + ((b >> sh) & 255) * f);
    return '#' + [16, 8, 0].map((sh) => ch(sh).toString(16).padStart(2, '0')).join('');
  }
  function roomPowers() {
    const info = computeRooms(editor.components, editor.wires);
    const P = {}, snap = sim.snap;
    if (snap) {
      for (const c of editor.components) {
        const dv = snap.devices[c.id];
        if (!dv || !dv.P) continue;
        const i = roomAt(info, c.x, c.y);
        if (i >= 0) P[i] = (P[i] || 0) + dv.P;
      }
    }
    return { info, P };
  }
  let energySig = '', pvWarned = 0;
  const labelsBox = $('v3-labels');
  function energyLabels(en) {
    labelsBox.replaceChildren();
    labelsBox.hidden = !en;
    if (!en) { viz.onFrame = null; return; }
    const items = [];
    en.info.rooms.forEach((room, i) => {
      if (room.leaked || room.sharedWith !== null) return;
      const lab = byId(room.id);
      if (!lab) return;
      const L = levelAt(lab.x);
      if (v3.level !== 'all' && L.i !== v3.level) return;
      const el = document.createElement('div');
      el.className = 'v3-lab';
      const name = document.createElement('span'); name.textContent = room.name;
      const val = document.createElement('b'); val.className = 'num';
      el.append(name, val);
      labelsBox.appendChild(el);
      items.push({ el, val, i, p: [lab.x + L.dx, 150 + L.dy, lab.y] });
    });
    const legend = document.createElement('div');
    legend.className = 'v3-energy-legend';
    legend.innerHTML = '<span>0</span><i></i><span>4 kW</span>';
    labelsBox.appendChild(legend);
    const place = () => {
      for (const it of items) {
        const q = viz.project && (viz.cutX === null || it.p[viz.cutAxis === 'z' ? 2 : 0] <= viz.cutX) && viz.project(it.p);
        it.el.style.display = q ? '' : 'none';
        if (q) it.el.style.transform = `translate(${Math.round(q.x)}px, ${Math.round(q.y)}px) translate(-50%, -50%)`;
      }
    };
    const update = () => {
      const now = roomPowers();
      for (const it of items) {
        const P = now.P[it.i] || 0;
        it.val.textContent = fmtW(P);
        it.el.classList.toggle('off', P < 1);
      }
    };
    labelsBox.__update = update;
    labelsBox.__place = place;
    update();
    viz.onFrame = place;
    place();
  }
  // Vue Lumière : éclairement moyen de chaque pièce (tout allumé) et objectif
  const LUX_STATUS = { ok: ['✓', 'atteint'], juste: ['△', 'un peu juste'], faible: ['✗', 'insuffisant'] };
  const fmtLm = (lm) => (lm >= 1000 ? (lm / 1000).toFixed(1).replace('.', ',') + ' klm' : lm + ' lm');
  function luxLabels(L) {
    labelsBox.replaceChildren();
    labelsBox.hidden = false;
    labelsBox.__update = null;
    const items = [];
    for (const R of L.rooms) {
      const lab = byId(R.id);
      if (!lab) continue;
      const Lv = levelAt(lab.x);
      if (v3.level !== 'all' && Lv.i !== v3.level) continue;
      const [icon, word] = LUX_STATUS[R.status];
      const el = document.createElement('div');
      el.className = 'v3-lab lux ' + R.status;
      el.title = `${R.name} : ${Math.round(R.avg)} lx en moyenne (min ${Math.round(R.min)}, max ${Math.round(R.max)}) — conseillé ${R.target} lx, ${word}.` +
        (R.lamps ? ` ${R.lamps} point${R.lamps > 1 ? 's' : ''} lumineux, ${fmtLm(R.lm)}.` : ' Aucun point lumineux.') + (R.need ? ` Il manque ≈ ${fmtLm(R.need)}.` : '');
      const name = document.createElement('span'); name.textContent = R.name;
      const val = document.createElement('b'); val.className = 'num'; val.textContent = Math.round(R.avg) + ' lx';
      const st = document.createElement('small'); st.textContent = `${icon} ${R.status === 'ok' ? '≥ ' + R.target : 'conseillé ' + R.target}`;
      el.append(name, val, st);
      labelsBox.appendChild(el);
      items.push({ el, p: [lab.x + Lv.dx, 150 + Lv.dy, lab.y] });
    }
    const legend = document.createElement('div');
    legend.className = 'v3-energy-legend';
    legend.innerHTML = '<span>0</span><i class="lux"></i><span>300+ lx</span><em>plan de travail · tout allumé · LED 60 lm/W</em>';
    labelsBox.appendChild(legend);
    const place = () => {
      for (const it of items) {
        const q = viz.project && (viz.cutX === null || it.p[viz.cutAxis === 'z' ? 2 : 0] <= viz.cutX) && viz.project(it.p);
        it.el.style.display = q ? '' : 'none';
        if (q) it.el.style.transform = `translate(${Math.round(q.x)}px, ${Math.round(q.y)}px) translate(-50%, -50%)`;
      }
    };
    labelsBox.__place = place;
    viz.onFrame = place;
    place();
  }
  function luxToast() {
    const L = lightingStudy(editor.components, editor.wires);
    if (!L || !L.rooms.length) { showToast('Vue Lumière : il faut des pièces fermées et nommées.'); return; }
    if (!L.rooms.some((R) => R.lamps)) { showToast('Vue Lumière : aucun point lumineux — onglet Tableau → <b>Implanter</b>.'); return; }
    const low = L.rooms.filter((R) => R.status !== 'ok');
    showToast(low.length
      ? `<b>Lumière</b> (tout allumé) : ${low.length} pièce${low.length > 1 ? 's' : ''} sous l’éclairement conseillé — ` +
        low.map((R) => `${esc(R.name)} ${Math.round(R.avg)} lx / ${R.target}`).join(', ') + '. Une applique ou un éclairage de plan de travail y suffit souvent.'
      : `<b>Lumière</b> (tout allumé) : les ${L.rooms.length} pièces atteignent l’éclairement conseillé.`, 7500);
  }
  // À chaque pas de simulation : valeurs des étiquettes, et teintes si la puissance a bougé
  function energyTick() {
    if (!v3.energy || !viz || view3d.hidden || !labelsBox.__update) return;
    labelsBox.__update();
    const { P } = roomPowers();
    const sig = Object.keys(P).map((k) => k + ':' + Math.round(P[k] / 150)).join('|');
    if (sig !== energySig) { energySig = sig; build3D(false); }
  }

  // ---- Visite guidée : la caméra parcourt les pièces en passant par les portes --
  const tour = { on: false, pts: [], i: 0, t: 0, wait: 0, raf: 0, last: 0, room: -1 };
  function tourCaption(text) {
    const el = $('v3-caption');
    if (text) el.textContent = text; // le texte reste pendant le fondu de sortie
    el.classList.toggle('show', !!text);
  }
  function tourStop() {
    if (!tour.on) return;
    tour.on = false;
    viz.guided = false;
    if (viz.walk && viz.walk.lift > 0) Object.assign(viz.walk, { stair: true, from: viz.walk.level }); // arrêté dans l'escalier
    cancelAnimationFrame(tour.raf);
    tourCaption('');
    const b = $('v3-tour');
    b.textContent = '▶ Visite guidée'; b.classList.remove('on'); b.setAttribute('aria-pressed', 'false');
  }
  function tourStart() {
    const pts = tourPath(editor.components, editor.wires, levels());
    if (pts.length < 2) { showToast('Visite guidée : il faut un plan avec des pièces fermées et des portes.'); return; }
    const info = computeRooms(editor.components, editor.wires);
    Object.assign(tour, { on: true, pts, i: 0, t: 0, wait: 0.6, fade: 0, last: performance.now(), room: -1, names: info.rooms.map((r) => r.name) });
    tourCaption(tour.names[pts[0].room] || '');
    const b = $('v3-tour');
    b.textContent = '■ Arrêter'; b.classList.add('on'); b.setAttribute('aria-pressed', 'true');
    if (viz.mode !== 'walk') enterWalk();
    if (viz.walk) Object.assign(viz.walk, { level: 0, lift: 0, stair: false }); // la visite guidée part du rez-de-chaussée
    viz.guided = true;
    const SPEED = 190; // cm/s
    const step = (now) => {
      if (!tour.on) return;
      const dt = Math.min(0.25, Math.max(0, (now - tour.last) / 1000)); // trajectoire : pas besoin de petits pas
      tour.last = now;
      const w = viz.walk;
      if (viz.mode !== 'walk' || !w || viz.trans) { tour.raf = requestAnimationFrame(step); return; }
      // un appui sur une touche de déplacement rend la main
      if (Object.values(viz.keys).some(Boolean) || viz.stick) { tourStop(); return; }
      const a = tour.pts[tour.i], b = tour.pts[tour.i + 1];
      if (!b) { tourCaption(''); tourStop(); showToast('Fin de la visite guidée.'); return; }
      // points du parcours → 3D (l'étage est décalé ; l'escalier monte avec « lift »)
      const P3 = (p) => { const L = levelAt(p.x); return { X: p.x + L.dx, Y: L.dy + (p.lift || 0), L }; };
      const place = (p, q, t) => {
        const A = P3(p), B = P3(q), L = t < 0.5 ? A.L : B.L;
        const X = A.X + (B.X - A.X) * t, Y = A.Y + (B.Y - A.Y) * t;
        w.level = L.i; w.x = X - L.dx; w.z = p.z + (q.z - p.z) * t; w.lift = Y - L.dy;
      };
      if (tour.i === 0 && tour.t === 0) place(a, a, 0);
      let yawTarget;
      if (tour.wait > 0) {
        tour.wait -= dt;
        w.yaw += dt * 0.55; // on regarde autour de soi
        if (tour.wait <= 0) tour.fade = 1.2; // le nom de la pièce s'efface peu après le départ
      } else {
        if (tour.fade > 0 && (tour.fade -= dt) <= 0) tourCaption('');
        const A = P3(a), B = P3(b);
        const len = Math.hypot(B.X - A.X, b.z - a.z, B.Y - A.Y) || 1;
        tour.t += (SPEED * dt) / len;
        const t = Math.min(1, tour.t);
        place(a, b, t);
        w.phase += SPEED * dt * 0.045;
        w.bob = Math.sin(w.phase) * 1.2;
        if (Math.hypot(B.X - A.X, b.z - a.z) > 5) yawTarget = Math.atan2(-(B.X - A.X), -(b.z - a.z));
        if (tour.t >= 1) { tour.i++; tour.t = 0; if (b.stop) { tour.wait = 1.6; tour.room = b.room; tour.fade = 0; tourCaption(tour.names[b.room] || ''); } }
      }
      if (yawTarget !== undefined) {
        let d = yawTarget - w.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        w.yaw += d * Math.min(1, dt * 4);
      }
      w.pitch += (-0.06 - w.pitch) * Math.min(1, dt * 3);
      w.vx = 0; w.vz = 0;
      viz.dirty = true;
      tour.raf = requestAnimationFrame(step);
    };
    tour.raf = requestAnimationFrame(step);
  }

  // ---- Vue 3D ---------------------------------------------------------------
  const view3d = $('view3d'), cv3 = $('canvas3d'), tip = $('v3-tip'), map = $('v3-map'), hud = $('v3-hud');
  let viz = null;
  const v3 = { walls: 'full', xray: false, time: 15, energy: false, lux: false, implant: null, level: 'all', cut: null, cutAxis: 'x', circuit: null, fault: false, faultKind: 'short', sunpath: null };
  // Course du soleil (vue Extérieur) : arc des positions du soleil sur la journée de la saison choisie
  const hhmmSun = (h) => { const m = Math.round(h * 60); return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`; };
  function sunpathUi() {
    const b = $('v3-sunpath'), ok = !!(viz && viz.setSeason) && v3.walls === 'roof' && hasPlan();
    b.hidden = !ok;
    b.textContent = v3.sunpath ? `Soleil : ${DAY_SEASONS[v3.sunpath].label.toLowerCase()}` : 'Soleil';
    b.classList.toggle('on', !!v3.sunpath);
    b.setAttribute('aria-pressed', v3.sunpath ? 'true' : 'false');
    if (!viz) return;
    const S = v3.sunpath && ok ? GL3D_SEASONS[v3.sunpath] : null, bo = viz.bounds;
    viz.markers = [];
    if (!S || !bo) return;
    const cx = (bo.minX + bo.maxX) / 2, cz = (bo.minZ + bo.maxZ) / 2, R = Math.max(bo.maxX - bo.minX, bo.maxZ - bo.minZ) * 1.35; // au-delà du jardin
    const at = (h, size, col) => { const v = gl3dSunVector(S, h); if (v[1] > -0.01) viz.markers.push({ x: cx + v[0] * R, y: Math.max(0, v[1]) * R, z: cz + v[2] * R, color: col, size }); };
    for (let h = 0; h < 24; h += 0.2) at(h, 7, [0.6, 0.45, 0.2]);
    for (let h = 0; h < 24; h++) at(h, 14, [0.95, 0.72, 0.3]);
    at(S.noon, 20, [1, 0.8, 0.35]);
    at(v3.time, 40, [1, 0.88, 0.45]); // le soleil à l'heure affichée
  }
  function sunpathToast() {
    const S = GL3D_SEASONS[v3.sunpath], lat = (46 * Math.PI) / 180, d = (S.decl * Math.PI) / 180;
    const H0 = (Math.acos(-Math.tan(lat) * Math.tan(d)) * 180) / Math.PI / 15, alt = 90 - 46 + S.decl;
    showToast(`${DAY_SEASONS[v3.sunpath].label} (46° N) : lever ${hhmmSun(S.noon - H0)}, coucher ${hhmmSun(S.noon + H0)}, ${String(alt.toFixed(1)).replace('.', ',')}° au sud à ${hhmmSun(S.noon)}. Les panneaux regardent le sud.`, 5200);
  }
  // Mode « Défaut » : un clic sur un point du circuit y provoque le défaut choisi
  function setFaultMode(on) {
    v3.fault = on;
    $('v3-fault').classList.toggle('on', on);
    $('v3-fault').setAttribute('aria-pressed', on ? 'true' : 'false');
    $('v3-fault-kind').hidden = !on;
    $('v3-repair').hidden = !on;
    view3d.classList.toggle('fault-mode', on);
  }
  function faultAt(c) {
    const d = ensureDesign();
    if (!d || !d.ok || !d.route[c.id]) { showToast('Mode défaut : clique un appareil, une prise ou une lampe raccordé au tableau.', 2600); return; }
    const k = v3.faultKind, name = esc(c.label || (LOADS[c.type] && LOADS[c.type].name) || SYMBOLS[c.type].name);
    if (sim.faults[c.id] === k) {
      sim.setFault(c.id, null);
      sim.log(`Défaut supprimé sur ${c.label || c.id} : réarme la protection.`);
      touched();
      showToast(`Défaut supprimé sur <b>${name}</b> : clique <b>Réparer</b> pour réarmer.`, 2600);
      return;
    }
    const first = sim.events[0];
    sim.setFault(c.id, k);
    if (k === 'short' && c.type === 'socket_wall') c.on = true; // l'appareil branché est en court-circuit
    touched();
    // gerbe d'étincelles (court-circuit) ou gouttes bleues (fuite) au point du défaut
    const L = levelAt(c.x), H = HOUSE3D.H;
    const h = CEILING_OBJ.has(c.type) ? H - 20 : mountH(c) * 100;
    const room = roomAt(computeRooms(editor.components, editor.wires), c.x, c.y);
    if (viz.spark) viz.spark(c.x + L.dx, h + L.dy, c.y, k === 'short' ? { room } : { color: [0.3, 0.65, 1], n: 40, speed: 140, g: 260, size: 12, dur: 1.3, flash: null });
    const ev = sim.events[0];
    if (ev && ev !== first && ev.level === 'err') showToast(esc(ev.msg), 6000);
    else showToast(`Défaut posé sur <b>${name}</b> : il agira dès que le circuit sera sous tension.`, 3200);
  }
  function repairAll() {
    const n = Object.keys(sim.faults).length;
    for (const id of Object.keys(sim.faults)) sim.setFault(id, null);
    for (const [id, b] of Object.entries(sim.breakers)) if (b.tripped) sim.toggleBreaker(id);
    for (const [id, r] of Object.entries(sim.rcds)) if (r.tripped) sim.toggleRcd(id);
    if (sim.agcp && sim.agcp.tripped) sim.toggleAgcp();
    touched();
    showToast(n ? `${n} défaut${n > 1 ? 's' : ''} supprimé${n > 1 ? 's' : ''}, protections réarmées : le courant revient.` : 'Protections réarmées.', 2800);
  }
  // Rayons X : choix d'un circuit à isoler
  function circuitSelect() {
    const sel = $('v3-circuit'), d = v3.xray ? ensureDesign() : null;
    sel.hidden = !(d && d.ok);
    if (sel.hidden) return;
    const rj = editor.components.some((c) => c.type === 'rj45');
    if (v3.circuit && !d.circuits.some((c) => c.id === v3.circuit) && !(rj && v3.circuit === 'vdi')) v3.circuit = null;
    const sig = d.circuits.map((c) => c.id + c.name).join('|') + (rj ? '|vdi' : '');
    if (sel.dataset.sig !== sig) { // seulement si les circuits ont changé (liste ouverte préservée)
      sel.dataset.sig = sig;
      sel.innerHTML = '<option value="">Tous les circuits</option>' +
        d.circuits.map((c) => `<option value="${c.id}">${c.id} · ${esc(c.name)}</option>`).join('') +
        (rj ? '<option value="vdi">VDI · Communication (RJ45)</option>' : '');
    }
    sel.value = v3.circuit || '';
  }
  // Vue en coupe : plan vertical dont la position (0 → 1) parcourt la maison d'ouest en est
  function applyCut() {
    if (!viz) return;
    const b = viz.bounds, z = v3.cutAxis === 'z';
    viz.setCut(v3.cut === null || !b ? null : z ? b.minZ + (b.maxZ - b.minZ) * v3.cut : b.minX + (b.maxX - b.minX) * v3.cut, v3.cutAxis);
    if (labelsBox.__place) labelsBox.__place();
  }
  // caméra de profil, du côté retiré par la coupe
  function cutCamera() {
    viz.animateTo(() => {
      viz.yaw = v3.cutAxis === 'z' ? 0.45 : Math.PI / 2 - 0.5; viz.pitch = 0.36;
      viz.dist = (viz.baseDist || viz.dist) * (levels() ? 1.2 : 0.95) * (v3.cutAxis === 'z' ? 1.2 : 1); // en long : plus de recul
      viz.target = [viz.target[0], levels() ? 230 : 110, viz.target[2]]; // on vise le milieu de la hauteur
    }, 800);
  }
  function setCutUi(on) {
    $('v3-cut-btn').classList.toggle('on', on);
    $('v3-cut-btn').setAttribute('aria-pressed', on ? 'true' : 'false');
    $('v3-cut-wrap').hidden = !on;
  }
  const levels = () => (hasPlan() && editor.meta.levels && editor.meta.levels.length > 1 ? editor.meta.levels : null);
  // Niveau d'un point du plan et décalage de sa géométrie en 3D
  const levelAt = (x) => {
    const lv = levels(), i = lv ? lv.findIndex((l) => x >= l.x0 && x < l.x1) : -1;
    const L = i >= 0 ? lv[i] : null;
    return { i: Math.max(0, i), dx: (L && L.dx) || 0, dy: (L && L.dy) || 0 };
  };
  // Filtre de niveau (maison à étage) : tout, rez-de-chaussée, étage
  function levelSeg() {
    const lv = levels(), seg = $('v3-level');
    seg.hidden = !lv || !!(viz && viz.mode === 'walk'); // en visite, l'escalier mène à l'étage
    if (!lv) { v3.level = 'all'; seg.innerHTML = ''; return; }
    if (v3.level !== 'all' && !lv[v3.level]) v3.level = 'all';
    const short = (n) => (/^rez/i.test(n) ? 'RDC' : n);
    seg.innerHTML = [['all', 'Tout', 'Tous les niveaux'], ...lv.map((l, i) => [String(i), short(l.name), l.name + ' seul'])]
      .map(([k, t, title]) => `<button data-l="${k}" class="${String(v3.level) === k ? 'on' : ''}" title="${title}">${t}</button>`).join('');
  }
  $('v3-level').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-l]');
    if (!b) return;
    v3.level = b.dataset.l === 'all' ? 'all' : +b.dataset.l;
    levelSeg();
    energySig = '';
    build3D(false);
  });
  function build3D(first) {
    const d = ensureDesign();
    const house = hasPlan();
    const walking = viz.mode === 'walk';
    const energy = v3.energy && house ? roomPowers() : null;
    const lux = v3.lux && house ? lightingStudy(editor.components, editor.wires) : null;
    const r = buildBoard(viz, editor.components, editor.wires, SYMBOLS, {
      walls: walking ? 'full' : v3.walls, xray: v3.xray, ceiling: walking, ground: house, keepCamera: !first,
      sim: d && d.ok ? { snap: sim.snap, design: d, sim } : null,
      energy: energy ? { color: (i) => energyColor(energy.P[i] || 0) } : null,
      lux,
      materials: !!v3.implant, // implantation : matériaux des murs, montants des cloisons placo
      pv: pvKwc(),
      circuit: v3.xray ? v3.circuit : null,
      levels: levels(), level: walking ? 'all' : v3.level, // en visite : on peut monter à l'étage
    });
    const pvs = viz.scene && viz.scene.pv;
    if (pvs && pvs.placed < pvs.want && v3.walls === 'roof' && !walking && pvWarned !== pvs.want) {
      pvWarned = pvs.want;
      showToast(`Le toit n’accueille que ${pvs.placed} panneaux (${(pvs.placed * 0.4).toFixed(1).replace('.', ',')} kWc) sur les ${pvs.want} demandés.`);
    }
    if (lux) luxLabels(lux); else energyLabels(energy);
    $('v3-lux-fix').hidden = !(lux && lux.rooms.some((R) => R.status !== 'ok'));
    if (first) viz.fit(r * (house ? 0.82 : 1));
  }
  function open3D() {
    view3d.hidden = false;
    if (!viz) {
      viz = createViz3D(cv3, { sky: true, time: v3.time });
      window.__viz3d = viz; // débogage et captures d'écran
      if (day.saved && viz.setSeason) viz.setSeason(day.season);
      viz.onPick = onPick;
      viz.onHover = onHover;
      // Visite : changement de niveau par l'escalier, pièce où l'on entre
      let levelTimer = 0;
      const caption = (text, ms) => {
        if (tour.on) return;
        tourCaption(text);
        clearTimeout(levelTimer);
        levelTimer = setTimeout(() => { if (!tour.on) tourCaption(''); }, ms);
      };
      viz.onLevel = (i) => {
        const lv = levels();
        if (lv && lv[i]) caption(lv[i].name, 1800);
      };
      viz.onRoom = (i) => {
        const info = viz.scene && viz.scene.rooms, room = info && info.rooms[i];
        if (room && room.name) caption(room.name + (room.area ? ` · ${String(room.area.toFixed(1)).replace('.', ',')} m²` : ''), 1500);
      };
      if (!viz.webgl) $('v3-time-wrap').hidden = true;
    }
    const house = hasPlan();
    viz.mode = 'orbit'; viz.walk = null; viz.trans = null;
    viz.pitch = house ? 0.8 : 0.82; viz.yaw = -0.55;
    viz.autoRotate = !house;
    tick(0);
    levelSeg();
    circuitSelect();
    build3D(true);
    sunpathUi();
    viz.start();
    $('view3d-title').textContent = house ? 'Vue 3D de la maison' : 'Vue 3D de la carte';
    $('v3-house-controls').hidden = !house;
    setViewButtons('orbit');
    updateHint();
    if (!editor.components.length && !editor.wires.length) showToast('Plan vide — crée une maison ou pose des composants, puis reviens en 3D !', 3200);
  }
  function close3D() {
    if (rec360) rec360.stop(); // vidéo en cours : on garde ce qui est enregistré
    if (viz && viz.mode === 'walk') leaveWalk();
    view3d.hidden = true;
    tip.hidden = true;
    if (viz) viz.stop();
  }
  function setViewButtons(v) {
    document.querySelectorAll('#v3-view button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
  }
  const touch = window.matchMedia('(pointer: coarse)').matches;
  view3d.classList.toggle('touch', touch);
  function updateHint() {
    const walking = viz && viz.mode === 'walk';
    $('view3d-hint').textContent = walking ? 'Visite : ZQSD ou flèches · glisser pour regarder' : 'Glisser : tourner · clic droit : déplacer · molette : zoom · clic : interrupteurs et appareils';
    if (touch) $('v3-walkhelp').textContent = 'Joystick : marcher · glisser : regarder · touche un interrupteur ou un appareil pour le basculer';
    $('v3-walkhelp').hidden = !walking;
    $('v3-tour').hidden = !walking || !hasPlan();
    levelSeg();
    if (!walking) tourStop();
    $('v3-stick').hidden = !(walking && touch);
    map.hidden = !walking;
    view3d.classList.toggle('walking', walking);
  }
  // Joystick virtuel (visite au doigt)
  const stick = $('v3-stick'), knob = stick.querySelector('i');
  let stickId = null;
  const stickMove = (e) => {
    const r = stick.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    const max = r.width / 2 - 14, l = Math.hypot(dx, dy);
    if (l > max) { dx = (dx / l) * max; dy = (dy / l) * max; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    if (viz) viz.stick = { x: dx / max, y: dy / max };
  };
  stick.addEventListener('pointerdown', (e) => { stickId = e.pointerId; stick.setPointerCapture(e.pointerId); stickMove(e); e.stopPropagation(); });
  stick.addEventListener('pointermove', (e) => { if (e.pointerId === stickId) stickMove(e); });
  const stickEnd = (e) => {
    if (e.pointerId !== stickId) return;
    stickId = null; knob.style.transform = '';
    if (viz) viz.stick = null;
  };
  stick.addEventListener('pointerup', stickEnd);
  stick.addEventListener('pointercancel', stickEnd);
  function enterWalk() {
    if (v3.cut !== null) { v3.cut = null; setCutUi(false); applyCut(); } // pas de coupe en visite
    if (touch) showToast('Joystick : marcher · glisser : regarder · touche un interrupteur ou un appareil pour le basculer.', 4200);
    viz.enterWalk();
    build3D(false);
    setViewButtons('walk');
    updateHint();
  }
  function leaveWalk() {
    viz.exitWalk();
    build3D(false);
    setViewButtons('orbit');
    updateHint();
  }
  document.querySelectorAll('#v3-view button').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.v === 'walk') { if (viz.mode !== 'walk') enterWalk(); return; }
    if (viz.mode === 'walk') viz.exitWalk(true);
    viz.setView(b.dataset.v);
    build3D(false);
    setViewButtons(b.dataset.v);
    updateHint();
  }));
  document.querySelectorAll('#v3-walls button').forEach((b) => b.addEventListener('click', () => {
    v3.walls = b.dataset.w;
    document.querySelectorAll('#v3-walls button').forEach((x) => x.classList.toggle('on', x === b));
    build3D(false);
    if (v3.sunpath && v3.walls !== 'roof' && !day.saved && viz.setSeason) viz.setSeason(null); // hors Extérieur : soleil habituel
    else if (v3.sunpath && v3.walls === 'roof' && viz.setSeason) viz.setSeason(v3.sunpath);
    sunpathUi();
  }));
  $('v3-sunpath').addEventListener('click', () => {
    v3.sunpath = v3.sunpath === null ? 'hiver' : v3.sunpath === 'hiver' ? 'ete' : null;
    if (viz.setSeason && !day.saved) viz.setSeason(v3.sunpath);
    sunpathUi();
    if (v3.sunpath) sunpathToast();
  });
  $('v3-tour').addEventListener('click', () => (tour.on ? tourStop() : tourStart()));
  const setChip = (id, on) => { $(id).classList.toggle('on', on); $(id).setAttribute('aria-pressed', on ? 'true' : 'false'); };
  $('v3-lux').addEventListener('click', () => {
    v3.lux = !v3.lux;
    if (v3.lux && v3.energy) { v3.energy = false; setChip('v3-energy', false); } // une seule teinte de sol à la fois
    setChip('v3-lux', v3.lux);
    // la nuit, pour voir les lampes allumées comme sur la carte (l'heure revient ensuite)
    if (!day.running && viz && viz.webgl) {
      const tIn = $('v3-time');
      if (v3.lux && v3.time > 7 && v3.time < 20) { v3.luxTime = v3.time; tIn.value = 21.5; tIn.dispatchEvent(new Event('input')); }
      else if (!v3.lux && v3.luxTime !== undefined) { tIn.value = v3.luxTime; tIn.dispatchEvent(new Event('input')); v3.luxTime = undefined; }
    }
    build3D(false);
    if (v3.lux) luxToast();
  });
  $('v3-lux-fix').addEventListener('click', () => action('lighting'));
  $('v3-implant').addEventListener('click', () => {
    setImplant(v3.implant ? null : 'socket_wall');
    if (v3.implant) showToast('<b>Implanter</b> : choisis un appareil puis clique un mur (ou le sol pour un point au plafond). Murs teintés selon leur matériau : placo (montants tous les 60 cm), maçonnerie, doublage.', 7000);
  });
  document.querySelectorAll('#v3-implant-kind button').forEach((b) => b.addEventListener('click', () => setImplant(b.dataset.k)));
  $('v3-energy').addEventListener('click', () => {
    v3.energy = !v3.energy;
    if (v3.energy && v3.lux) { v3.lux = false; setChip('v3-lux', false); }
    setChip('v3-energy', v3.energy);
    energySig = '';
    build3D(false);
    if (v3.energy && !(design && design.ok)) showToast('Vue Énergie : il faut un tableau (onglet Tableau → Implanter) pour mesurer la puissance.');
  });
  $('v3-day').addEventListener('click', () => {
    if (!(ensureDesign() || {}).ok) { showToast('La journée type a besoin d’un tableau : onglet Tableau → Implanter.'); return; }
    if (day.running) dayPause(); else dayStart();
  });
  $('v3-cut-btn').addEventListener('click', () => {
    const on = v3.cut === null;
    if (on && viz.mode === 'walk') leaveWalk();
    v3.cut = on ? +$('v3-cut').value / 1000 : null;
    setCutUi(on);
    applyCut();
    // de profil, du côté de la coupe
    if (on) cutCamera();
  });
  $('v3-cut-axis').addEventListener('click', (e) => {
    e.preventDefault(); // le bouton est dans le <label> du curseur
    v3.cutAxis = v3.cutAxis === 'z' ? 'x' : 'z';
    applyCut();
    cutCamera();
  });
  $('v3-cut').addEventListener('input', () => { if (v3.cut !== null) { v3.cut = +$('v3-cut').value / 1000; applyCut(); } });
  $('v3-fault').addEventListener('click', () => {
    setFaultMode(!v3.fault);
    if (v3.fault) showToast('Mode défaut : clique un appareil, une prise ou une lampe. Le disjoncteur (court-circuit) ou le différentiel 30 mA (fuite) déclenche.', 4200);
  });
  $('v3-fault-kind').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-k]');
    if (!b) return;
    v3.faultKind = b.dataset.k;
    $('v3-fault-kind').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
  });
  $('v3-repair').addEventListener('click', repairAll);
  $('v3-circuit').addEventListener('change', (e) => {
    v3.circuit = e.target.value || null;
    build3D(false);
    const d = ensureDesign(), c = v3.circuit && d && d.ok && d.circuits.find((x) => x.id === v3.circuit);
    if (v3.circuit === 'vdi') {
      const v = vdiDesign(editor.components, editor.wires);
      showToast(`<b>Communication</b> — ${v.ports} prise${v.ports > 1 ? 's' : ''} RJ45 en étoile depuis le coffret de la GTL, ${String(Math.round(v.total))} m de câble catégorie 6, lien le plus long ${Math.max(0, ...v.links.map((l) => l.len)).toFixed(1).replace('.', ',')} m.`, 5200);
    } else if (c) {
      const n = (v) => String(v).replace('.', ',');
      showToast(`${c.id} · ${esc(c.name)} — ${c.In} A, ${n(c.S)} mm², ${n(c.length.toFixed(1))} m, ΔU ${n(c.dUpct.toFixed(1))} % · ${c.points} point${c.points > 1 ? 's' : ''} : ${esc(c.rooms || '')}`, 5200);
    }
  });
  $('v3-xray').addEventListener('click', () => {
    v3.xray = !v3.xray;
    $('v3-xray').classList.toggle('on', v3.xray);
    $('v3-xray').setAttribute('aria-pressed', v3.xray ? 'true' : 'false');
    circuitSelect();
    build3D(false);
    if (v3.xray && !(design && design.ok)) showToast('Rayons X : les câbles apparaissent une fois le tableau posé (onglet Tableau → Implanter).');
  });
  const timeIn = $('v3-time');
  timeIn.addEventListener('input', () => {
    v3.time = +timeIn.value;
    const h = Math.floor(v3.time), m = Math.round((v3.time - h) * 60);
    $('v3-time-lbl').textContent = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
    $('v3-time-ico').textContent = v3.time > 6.5 && v3.time < 19.5 ? '☀' : '☾';
    if (viz && viz.setTime) viz.setTime(v3.time);
    if (v3.sunpath) sunpathUi();
  });

  // ---- Implantation en 3D : poser l'appareillage sur les murs (placo ou maçonnerie) ----
  // Un clic sur un mur pose l'appareil à sa hauteur NF, face à la pièce ; un clic
  // sur le sol pose un point au plafond, à l'aplomb. « Retirer » enlève un appareil,
  // « Mur placo / maçonné » change le matériau du mur visé.
  const IMPLANT = {
    socket_wall: { label: 'Prise', wall: true }, switch_sa: { label: 'Interrupteur', wall: true },
    switch_vv_wall: { label: 'Va-et-vient', wall: true }, wall_light: { label: 'Applique', wall: true },
    rj45: { label: 'RJ45', wall: true }, dcl: { label: 'Point lumineux', ceil: true }, smoke_detector: { label: 'DAAF', ceil: true },
    radiator: { label: 'Radiateur', wall: true, furn: true, value: '1000 W' }, vmc: { label: 'Bouche VMC', ceil: true },
  };
  const IMPLANTED = new Set([...Object.keys(IMPLANT), 'radiator', 'jbox', 'vmc']);
  const isCeil = (t) => t === 'dcl' || t === 'smoke_detector' || t === 'vmc';
  const implantH = () => { const v = +$('v3-implant-h').value; return v > 0 ? v : null; }; // hauteur choisie (cm) ou NF
  function implantHit(p) {
    const sc = viz.scene;
    if (!sc || !viz.ray) return null;
    const ray = viz.ray(p.x, p.y), H = sc.wallH || HOUSE3D.H;
    let best = null;
    for (const w of sc.walls) {
      if (w.hidden) continue;
      const L = levelAt((w.a.x + w.b.x) / 2);
      const len = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
      if (len < 1) continue;
      const ux = (w.b.x - w.a.x) / len, uz = (w.b.y - w.a.y) / len, ax = w.a.x + L.dx, az = w.a.y;
      for (const sd of [1, -1]) {
        const nx = -uz * sd, nz = ux * sd;
        const den = ray.d[0] * nx + ray.d[2] * nz;
        if (den >= -1e-6) continue; // face tournée vers la caméra seulement
        const lam = ((ax + (nx * w.t) / 2 - ray.o[0]) * nx + (az + (nz * w.t) / 2 - ray.o[2]) * nz) / den;
        if (lam <= 0 || (best && lam >= best.lam)) continue;
        const X = ray.o[0] + ray.d[0] * lam, Y = ray.o[1] + ray.d[1] * lam - L.dy, Z = ray.o[2] + ray.d[2] * lam;
        const t = (X - ax) * ux + (Z - az) * uz;
        if (t < -w.t / 2 || t > len + w.t / 2 || Y < 0 || Y > H) continue;
        if ((w.ops || []).some(([o0, o1]) => t > o0 && t < o1 && Y > 95 && Y < 215)) continue; // dans une fenêtre
        best = { lam, kind: 'wall', w, t: Math.max(0, Math.min(len, t)), y: Y, nx, nz, ux, uz };
      }
    }
    // Sol des niveaux visibles (points au plafond, à l'aplomb)
    const lv = levels() || [{ dx: 0, dy: 0 }];
    const info = computeRooms(editor.components, editor.wires);
    lv.forEach((Lv, i) => {
      if (lv.length > 1 && v3.level !== 'all' && i !== v3.level) return;
      if (Math.abs(ray.d[1]) < 1e-6) return;
      const lam = ((Lv.dy || 0) - ray.o[1]) / ray.d[1];
      if (lam <= 0 || (best && lam >= best.lam)) return;
      const x = ray.o[0] + ray.d[0] * lam - (Lv.dx || 0), y = ray.o[2] + ray.d[2] * lam;
      const r = roomAt(info, x, y);
      if (r >= 0) best = { lam, kind: 'floor', x, y, room: info.rooms[r] };
    });
    return best;
  }
  // Pièce du côté où l'appareil est posé
  const roomNameAt = (x, y) => { const info = computeRooms(editor.components, editor.wires), r = roomAt(info, x, y); return r >= 0 ? info.rooms[r].name : ''; };
  function implantTarget(hit, type) {
    const k = type || v3.implant;
    if (!hit || !(IMPLANT[k] || IMPLANTED.has(k))) return null;
    if (isCeil(k)) return hit.kind === 'floor' ? { x: Math.round(hit.x), y: Math.round(hit.y), rot: 0, room: hit.room.name } : null;
    if (hit.kind !== 'wall') return null;
    // appareil mural : boîte à 20 cm de l'axe ; radiateur : dos contre la face du mur
    const furn = k === 'radiator', off = furn ? Math.max(WALL_BACK, hit.w.t / 2 + 2) - SYMBOLS.radiator.bbox.y : 20;
    const w = hit.w, x = w.a.x + hit.ux * hit.t + hit.nx * off, y = w.a.y + hit.uz * hit.t + hit.nz * off;
    const wire = editor.wires.find((q) => q.id === w.wid);
    return { x: Math.round(x), y: Math.round(y), rot: furn ? _rotBack(hit.nx, hit.nz) : _rotDevice(hit.nx, hit.nz), room: roomNameAt(x, y), mat: wire ? wallMaterial(wire) : null };
  }
  function implantChanged(msg) {
    editor.pushHistory(); editor.render();
    ensureDesign(true); structKey = null; tick(0, true);
    build3D(false);
    if (msg) showToast(msg, 3200);
  }
  function implantClick(id, p) {
    const k = v3.implant;
    if (k === 'del') {
      const c = id && byId(id);
      if (!c || !IMPLANTED.has(c.type)) { showToast('« Retirer » : clique une prise, un interrupteur ou un point lumineux.'); return; }
      editor.components = editor.components.filter((x) => x.id !== c.id);
      implantChanged(`Retrait : <b>${esc(SYMBOLS[c.type].name)}</b> ${esc(c.label || '')}.`);
      return;
    }
    const hit = implantHit(p);
    if (k === 'move') {
      if (!v3.moving) {
        const c = id && byId(id);
        if (!c || !IMPLANTED.has(c.type)) { showToast('« Déplacer » : clique d’abord l’appareil à déplacer.'); return; }
        v3.moving = c.id; viz.hoverObj = c.id;
        showToast(`<b>${esc(SYMBOLS[c.type].name)}</b> ${esc(c.label || '')} : clique ${isCeil(c.type) ? 'le sol de la pièce visée' : 'le mur'} où le poser.`, 4000);
        return;
      }
      const c = byId(v3.moving);
      v3.moving = null; viz.hoverObj = null;
      const tg = c && implantTarget(hit, c.type);
      if (!tg) { showToast(isCeil(c && c.type) ? 'Vise le sol de la pièce.' : 'Vise un mur (la face côté pièce).'); return; }
      Object.assign(c, { x: tg.x, y: tg.y, rot: tg.rot });
      if (!isCeil(c.type) && c.type !== 'radiator' && implantH()) c.h = implantH();
      implantChanged(`Nouvel emplacement : <b>${esc(SYMBOLS[c.type].name)}</b> ${esc(c.label || '')}${tg.room ? ' — ' + esc(tg.room) : ''}${isCeil(c.type) ? '' : ', à ' + Math.round(mountH(c) * 100) + ' cm'}.`);
      return;
    }
    if (k.startsWith('mat:')) {
      const wire = hit && hit.kind === 'wall' && editor.wires.find((q) => q.id === hit.w.wid);
      if (!wire) { showToast('Clique un mur pour changer son matériau.'); return; }
      wire.mat = k.slice(4);
      implantChanged(`Mur : <b>${esc(wallMaterial(wire).label)}</b>.`);
      return;
    }
    const tg = implantTarget(hit);
    if (!tg) { showToast(IMPLANT[k].ceil ? 'Vise le sol de la pièce : le point se pose au plafond, à l’aplomb.' : 'Vise un mur (la face côté pièce).'); return; }
    const c = { id: editor.uid(), type: k, x: tg.x, y: tg.y, rot: tg.rot, label: editor.nextRef(k), value: IMPLANT[k].value || '' };
    if (!IMPLANT[k].ceil && !IMPLANT[k].furn && implantH()) c.h = implantH();
    editor.components.push(c);
    const h = Math.round(mountH(c) * 100) + ' cm';
    implantChanged(`Pose : <b>${esc(SYMBOLS[k].name)}</b> ${esc(c.label)}${tg.room ? ' — ' + esc(tg.room) : ''}` +
      (IMPLANT[k].ceil ? ' (plafond)' : IMPLANT[k].furn ? `, contre ${tg.mat ? esc(tg.mat.label.toLowerCase()) : 'le mur'} (sortie de câble à 30 cm)`
        : ` à ${h}, ${tg.mat ? esc(tg.mat.label.toLowerCase()) + (tg.mat.hollow ? ' → boîte cloison sèche' : ' → boîte maçonnerie') : ''}`) + '. Annulable (Ctrl+Z dans le plan).');
  }
  const WALL_H = new Set(['socket_wall', 'switch_sa', 'switch_vv_wall', 'rj45', 'wall_light']); // hauteur réglable
  function implantHover(id, p) {
    const k = v3.implant;
    let h = '';
    const hc = id && byId(id);
    v3.hoverDev = hc && WALL_H.has(hc.type) ? hc.id : null; v3.hoverP = p;
    if (v3.hoverDev && k !== 'del' && !(k === 'move' && v3.moving)) {
      h = `<b>${esc(SYMBOLS[hc.type].name)}</b> ${esc(hc.label || '')}<span>à ${Math.round(mountH(hc) * 100)} cm${hc.h ? '' : ' (hauteur NF)'}</span><span>↑ ↓ : hauteur ± 5 cm</span>`;
    } else if (k === 'del' || (k === 'move' && !v3.moving)) {
      const c = id && byId(id);
      h = c && IMPLANTED.has(c.type) ? `<b>${k === 'del' ? 'Retirer' : 'Déplacer'}</b> ${esc(SYMBOLS[c.type].name)} ${esc(c.label || '')}` : '';
    } else if (k === 'move') {
      const c = byId(v3.moving), tg = c && implantTarget(implantHit(p), c.type);
      if (tg) h = `<b>Poser ici</b> ${esc(SYMBOLS[c.type].name)} ${esc(c.label || '')}${tg.room ? ' · ' + esc(tg.room) : ''}`;
    } else {
      const hit = implantHit(p);
      if (k.startsWith('mat:')) {
        const wire = hit && hit.kind === 'wall' && editor.wires.find((q) => q.id === hit.w.wid);
        if (wire) h = `<b>${esc(wallMaterial(wire).label)}</b><span>Clic : ${k === 'mat:placo' ? 'cloison placo 72/48' : 'mur maçonné (parpaing)'}</span>`;
      } else {
        const tg = implantTarget(hit);
        if (tg) h = `<b>${esc(IMPLANT[k].label)}</b>${tg.room ? ' · ' + esc(tg.room) : ''}` +
          (IMPLANT[k].ceil ? '<span>au plafond, à l’aplomb</span>' : IMPLANT[k].furn ? `<span>${tg.mat ? esc(tg.mat.label) : ''}</span><span>sortie de câble à 30 cm, ${tg.mat && tg.mat.hollow ? 'fixation cloison sèche' : 'chevilles maçonnerie'}</span>`
            : `<span>à ${implantH() || Math.round((MOUNT_H[k] || 0.3) * 100)} cm · ${tg.mat ? esc(tg.mat.label) : ''}</span><span>${tg.mat && tg.mat.doublage ? 'boîte étanche à l’air (doublage)' : tg.mat && tg.mat.hollow ? 'boîte cloison sèche' : 'boîte maçonnerie'}</span>`);
      }
    }
    cv3.style.cursor = h ? 'crosshair' : '';
    if (!h) { tip.hidden = true; return; }
    tip.innerHTML = h + '<em>Clic : ' + (k === 'del' ? 'retirer' : k === 'move' ? (v3.moving ? 'poser ici' : 'choisir l’appareil') : k.startsWith('mat:') ? 'changer le matériau' : v3.hoverDev ? 'poser un appareil sur le mur derrière' : 'poser') + '</em>';
    tip.hidden = false;
    const r = view3d.getBoundingClientRect();
    tip.style.left = Math.min(p.x + 16, r.width - 260) + 'px';
    tip.style.top = Math.min(p.y + 16, r.height - 90) + 'px';
  }
  function setImplant(k) {
    v3.implant = k || null;
    v3.moving = null; v3.hoverDev = null;
    const on = !!v3.implant;
    setChip('v3-implant', on);
    $('v3-implant-kind').hidden = !on;
    $('v3-matlegend').hidden = !on;
    document.querySelectorAll('#v3-implant-kind button').forEach((b) => b.classList.toggle('on', b.dataset.k === v3.implant));
    if (on && v3.walls === 'full' && viz.mode !== 'walk') { // murs coupés : on voit l'intérieur des pièces
      v3.walls = 'cut';
      document.querySelectorAll('#v3-walls button').forEach((x) => x.classList.toggle('on', x.dataset.w === 'cut'));
    }
    tip.hidden = true;
    build3D(false);
  }

  function onPick(id, p) {
    if (v3.implant && p) { implantClick(id, p); return; }
    const c = id && byId(id);
    if (!c) return;
    if (v3.fault) { faultAt(c); return; }
    if (SWITCH_ALL.has(c.type)) {
      c.closed = !c.closed;
      touched();
      showToast(`<b>${esc(c.label || SYMBOLS[c.type].name)}</b> ${c.closed ? 'fermé' : 'ouvert'}.`, 1600);
    } else if (LIGHT_T.has(c.type)) {
      const info = computeRooms(editor.components, editor.wires);
      if (toggleRoomLight(roomAt(info, c.x, c.y))) touched();
    } else if (c.type === 'socket_wall') {
      c.on = !c.on;
      if (c.on && !parsePower(c.value)) c.value = '2000 W';
      touched();
      showToast(c.on ? `Radiateur d’appoint de ${fmtW(parsePower(c.value))} branché sur <b>${esc(c.label)}</b>.` : `<b>${esc(c.label)}</b> débranchée.`, 2200);
    } else if (LOADS[c.type] && !LOADS[c.type].always) {
      c.on = !c.on;
      touched();
      showToast(`<b>${esc(LOADS[c.type].name)}</b> ${c.on ? 'en marche' : 'à l’arrêt'}.`, 1600);
    } else if (c.type === 'panel_house' || c.type === 'gtl') {
      showTab('install');
      showToast('Le tableau est dans l’onglet <b>Tableau</b> : clique une manette pour couper ou réarmer un circuit.', 3000);
    } else if (c.type === 'breaker' || c.type === 'rcd') {
      c.closed = !c.closed; touched();
    } else {
      editor.selection = new Set([c.id]);
      editor.render(); editor._emit();
    }
  }
  function onHover(id, p) {
    if (v3.implant) { implantHover(id, p); return; }
    // surbrillance : composants et câbles seulement (pas les murs, le toit, le jardin)
    const hid = id && (byId(id) || String(id).startsWith('cable:')) ? id : null;
    if (viz.hoverObj !== hid) { viz.hoverObj = hid; if (!viz._raf) viz.render(); }
    const c = id && byId(id);
    cv3.style.cursor = c && (SWITCH_ALL.has(c.type) || LOADS[c.type] || LIGHT_T.has(c.type) || c.type === 'panel_house') ? 'pointer' : '';
    if (!c) { tip.hidden = true; return; }
    const d = design && design.ok ? design : null;
    let h = `<b>${esc(SYMBOLS[c.type].name)}</b>${c.label ? ' · ' + esc(c.label) : ''}`;
    const bd = d && d.byDevice[c.id];
    if (bd) {
      const ct = d.circuits.find((x) => x.id === bd.circuit);
      h += `<span>${ct.id} ${esc(ct.name)} · ${ct.In} A · ${String(ct.S).replace('.', ',')} mm² · câble ${bd.len.toFixed(1).replace('.', ',')} m</span>`;
    }
    const dv = sim.snap && sim.snap.devices[c.id];
    if (dv) h += `<span>${dv.U ? Math.round(dv.U) + ' V' : 'hors tension'}${dv.P ? ' · ' + fmtW(dv.P) : ''}</span>`;
    if (SWITCH_ALL.has(c.type)) h += '<em>Clic : basculer</em>';
    else if (LOADS[c.type] && !LOADS[c.type].always) h += `<em>Clic : ${c.type === 'socket_wall' ? 'brancher un radiateur 2 kW' : 'marche / arrêt'}</em>`;
    tip.innerHTML = h;
    tip.hidden = false;
    const r = view3d.getBoundingClientRect();
    tip.style.left = Math.min(p.x + 16, r.width - 260) + 'px';
    tip.style.top = Math.min(p.y + 16, r.height - 90) + 'px';
  }
  cv3.addEventListener('pointerleave', () => { tip.hidden = true; if (viz) viz.hoverObj = null; });

  function updateHud(snap) {
    if (!snap || !hasPlan()) { hud.hidden = true; return; }
    hud.hidden = false;
    const tripped = Object.values(sim.breakers).filter((b) => b.tripped).length + Object.values(sim.rcds).filter((r) => r.tripped).length + (sim.agcp.tripped ? 1 : 0);
    hud.innerHTML = (day.saved ? `<span class="hud-day num">${hhmm(day.h)} · ${DAY_SEASONS[day.season].label}</span>` : '') + `<b class="num">${fmtW(snap.P)}</b><span class="num">${fmtA(snap.I)}</span><span>${snap.lit.size} lampe${snap.lit.size > 1 ? 's' : ''}</span>` +
      (tripped ? `<span class="hud-bad">${tripped} protection${tripped > 1 ? 's' : ''} déclenchée${tripped > 1 ? 's' : ''}</span>` : '');
    if (viz.mode === 'walk') drawMinimap(snap);
    energyTick();
  }
  function drawMinimap(snap) {
    if (!viz.bounds || !viz.walk) return;
    const lvl = viz.walk.level || 0;
    let b = viz.bounds;
    if (lvl) { // bornes du niveau où l'on se trouve
      const ps = editor.wires.filter((w) => w.kind === 'wall' && levelAt(w.points[0].x).i === lvl).flatMap((w) => w.points);
      if (ps.length) b = { minX: Math.min(...ps.map((p) => p.x)) - 30, maxX: Math.max(...ps.map((p) => p.x)) + 30, minZ: Math.min(...ps.map((p) => p.y)) - 30, maxZ: Math.max(...ps.map((p) => p.y)) + 30 };
    }
    const W = map.width, H = map.height, ctx = map.getContext('2d');
    const s = Math.min((W - 16) / (b.maxX - b.minX), (H - 16) / (b.maxZ - b.minZ));
    const ox = (W - (b.maxX - b.minX) * s) / 2 - b.minX * s, oy = (H - (b.maxZ - b.minZ) * s) / 2 - b.minZ * s;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(14,17,24,0.78)'; ctx.fillRect(0, 0, W, H);
    const info = computeRooms(editor.components, editor.wires);
    info.rooms.forEach((room, i) => {
      if (room.leaked || room.sharedWith !== null) return;
      const lab = byId(room.id);
      if (lab && levelAt(lab.x).i !== lvl) return; // pièces du niveau où l'on se trouve
      const lit = editor.components.some((c) => LIGHT_T.has(c.type) && snap.lit.has(c.id) && roomAt(info, c.x, c.y) === i);
      ctx.fillStyle = lit ? 'rgba(255,214,120,0.35)' : 'rgba(120,140,170,0.14)';
      for (const r of roomRuns(info, i)) ctx.fillRect(ox + r.x * s, oy + r.y * s, r.w * s + 0.5, r.h * s + 0.5);
    });
    ctx.strokeStyle = '#dfe6f0'; ctx.lineWidth = 2; ctx.lineCap = 'round';
    for (const w of editor.wires) {
      if (w.kind !== 'wall' || levelAt(w.points[0].x).i !== lvl) continue;
      ctx.beginPath();
      w.points.forEach((p, i) => (i ? ctx.lineTo(ox + p.x * s, oy + p.y * s) : ctx.moveTo(ox + p.x * s, oy + p.y * s)));
      ctx.stroke();
    }
    const px = ox + viz.walk.x * s, py = oy + viz.walk.z * s, a = viz.walk.yaw;
    ctx.fillStyle = 'rgba(79,157,255,0.3)';
    ctx.beginPath(); ctx.moveTo(px, py);
    ctx.arc(px, py, 26, -Math.PI / 2 - a - 0.55, -Math.PI / 2 - a + 0.55); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#4f9dff'; ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2); ctx.fill();
  }

  $('btn-3d').addEventListener('click', open3D);
  $('btn-3d-close').addEventListener('click', close3D);
  $('btn-3d-glb').addEventListener('click', () => {
    if (!viz) return;
    const title = editor.meta.title || (hasPlan() ? 'maison' : 'carte');
    const glb = buildGLB(viz.faces.filter((f) => !f.cap), { name: title }); // le modèle entier, sans les faces de coupe
    download(new Blob([glb], { type: 'model/gltf-binary' }), title + ' - 3D.glb');
    showToast(`Modèle 3D exporté (${(glb.byteLength / 1048576).toFixed(1).replace('.', ',')} Mo) : s’ouvre dans Blender, la visionneuse 3D, SketchUp…`, 4200);
  });
  // Vidéo 360° : un tour complet de caméra enregistré depuis le canevas (WebM)
  let rec360 = null;
  $('btn-3d-video').addEventListener('click', () => {
    if (!viz) return;
    if (rec360) { rec360.stop(); return; } // second clic : on arrête
    const types = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    const mime = typeof MediaRecorder !== 'undefined' && cv3.captureStream && types.find((t) => MediaRecorder.isTypeSupported(t));
    if (!mime) { showToast('Vidéo indisponible dans ce navigateur (enregistrement WebM non pris en charge).'); return; }
    if (viz.mode === 'walk') leaveWalk();
    const btn = $('btn-3d-video'), chunks = [], DUR = 10000, yaw0 = viz.yaw, auto0 = viz.autoRotate;
    const rec = new MediaRecorder(cv3.captureStream(30), { mimeType: mime, videoBitsPerSecond: 8e6 });
    rec360 = rec;
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = () => {
      rec360 = null; cancelAnimationFrame(raf);
      viz.yaw = yaw0; viz.autoRotate = auto0; viz.dirty = true;
      btn.classList.remove('rec'); btn.setAttribute('aria-pressed', 'false');
      const blob = new Blob(chunks, { type: 'video/webm' });
      download(blob, (editor.meta.title || 'maison') + ' - 360.webm');
      showToast(`Vidéo 360° enregistrée (${(blob.size / 1048576).toFixed(1).replace('.', ',')} Mo, WebM).`, 3600);
    };
    viz.autoRotate = false; viz.trans = null;
    btn.classList.add('rec'); btn.setAttribute('aria-pressed', 'true');
    showToast('Enregistrement de la vidéo 360° (10 s)… clique à nouveau pour arrêter.', 2600);
    const t0 = performance.now();
    let raf = 0;
    const step = (now) => {
      const k = Math.min(1, (now - t0) / DUR);
      viz.yaw = yaw0 + 2 * Math.PI * (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2); // départ et arrivée en douceur
      viz.dirty = true;
      if (k < 1) raf = requestAnimationFrame(step); else if (rec.state !== 'inactive') rec.stop();
    };
    rec.start(250);
    raf = requestAnimationFrame(step);
  });
  $('btn-3d-photo').addEventListener('click', () => {
    if (viz && viz.render) viz.render();
    const a = document.createElement('a');
    a.href = cv3.toDataURL('image/png');
    a.download = fileName((editor.meta.title || 'vue') + '-3d.png');
    a.click();
  });
  // Clavier : visite (prioritaire sur les raccourcis de l'éditeur), Échap
  window.addEventListener('keydown', (e) => {
    if (view3d.hidden || !viz) return;
    if (e.key === 'Escape') {
      e.stopPropagation(); e.preventDefault();
      if (viz.mode === 'walk') leaveWalk(); else close3D();
      return;
    }
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    // implantation : ↑ / ↓ sur l'appareil survolé règle sa hauteur de pose par pas de 5 cm
    if (v3.implant && v3.hoverDev && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      const c = byId(v3.hoverDev);
      if (c) {
        const nh = Math.max(5, Math.min(250, Math.round(mountH(c) * 100 / 5) * 5 + (e.key === 'ArrowUp' ? 5 : -5)));
        c.h = nh;
        implantChanged();
        if (v3.hoverP) implantHover(c.id, v3.hoverP);
        e.preventDefault(); e.stopPropagation();
        return;
      }
    }
    if (viz.keyDown(e)) e.preventDefault();
    else if (!e.ctrlKey && !e.metaKey && !e.altKey && shortcut3D(e.key)) e.preventDefault();
    // le plan est masqué : ses raccourcis (supprimer, pivoter, outils…) ne doivent pas agir
    e.stopPropagation();
  }, true);
  // Raccourcis de la vue 3D (hors touches de déplacement de la visite)
  function shortcut3D(key) {
    const vis = (el) => el && !el.hidden && el.offsetParent !== null;
    const press = (sel) => { const el = document.querySelector(sel); if (!vis(el)) return false; el.click(); return true; };
    const k = key.toLowerCase();
    const map = { x: '#v3-xray', c: '#v3-cut-btn', e: '#v3-energy', l: '#v3-lux', i: '#v3-implant', j: '#v3-day', f: '#v3-fault', g: '#v3-tour', v: '#btn-3d-video', p: '#btn-3d-photo', o: '#v3-sunpath', 1: '#v3-view [data-v="orbit"]', 2: '#v3-view [data-v="top"]', 3: '#v3-view [data-v="walk"]' };
    if (map[k]) return press(map[k]);
    if (k === 'm') { // murs : pleins → coupés → plan → extérieur
      const bs = [...document.querySelectorAll('#v3-walls button')];
      if (!bs.length || !vis(bs[0])) return false;
      const i = bs.findIndex((b) => b.classList.contains('on'));
      bs[(i + 1) % bs.length].click();
      return true;
    }
    return false;
  }
  window.addEventListener('keyup', (e) => { if (viz) viz.keyUp(e); }, true);
  window.addEventListener('blur', () => { if (viz) viz.keys = {}; });
  window.addEventListener('resize', () => { if (!view3d.hidden && viz) viz.resize(); });

  // ---- Dossier du projet (impression / PDF) --------------------------------------
  function dossierImages(d) {
    const shots = [];
    if (typeof GL3D === 'undefined' || !GL3D.supported()) return shots;
    const cv = document.createElement('canvas');
    cv.width = 1200; cv.height = 760; // hors page : taille fixée à la main
    let v;
    try { v = new GL3D(cv, { sky: true, time: 11, interactive: false, autoRotate: false }); } catch (e) { return shots; }
    const lv = levels();
    // [murs, heure, légende, inclinaison, orientation, recul, niveau, coupe (0 → 1), éclairement]
    const lux = lightingStudy(editor.components, editor.wires);
    const withLux = lux && lux.rooms.some((R) => R.lamps);
    const views = lv ? [
      ['roof', 11, 'Extérieur', 0.38, -0.62, 1.05, 'all', null],
      ['roof', 15, 'Coupe verticale', 0.34, Math.PI / 2 - 0.5, 0.72, 'all', 0.33],
      ...lv.map((L, i) => ['cut', 15, `${L.name} (murs coupés à 1,15 m)`, 0.95, -0.5, 0.8, i, null]),
      ...(withLux ? lv.map((L, i) => ['cut', 21.5, `${L.name} : éclairement, tout allumé`, 0.95, -0.5, 0.8, i, null, true]) : []),
    ] : [
      ['roof', 11, 'Extérieur', 0.42, -0.62, 0.95, 'all', null], ['cut', 15, 'Intérieur (murs coupés à 1,15 m)', 0.95, -0.5, 0.8, 'all', null],
      ...(withLux ? [['cut', 21.5, 'Éclairement, tout allumé (du sombre au jaune clair : 0 à 300 lx et plus)', 0.95, -0.5, 0.8, 'all', null, true]] : []),
    ];
    for (const [walls, t, label, pitch, yaw, k, level, cut, lx] of views) {
      const r = buildBoard(v, editor.components, editor.wires, SYMBOLS, { walls, ground: true, pv: pvKwc(), levels: lv, level, lux: lx ? lux : null, sim: d && d.ok ? { snap: sim.snap, design: d, sim } : null });
      const b = v.bounds;
      v.setCut(cut === null || !b ? null : b.minX + (b.maxX - b.minX) * cut);
      // étage seul : on vise son plancher
      if (lv && level !== 'all') v.target = [v.target[0], (lv[level].dy || 0), v.target[2]];
      if (cut !== null) v.target = [v.target[0], 220, v.target[2]]; // coupe : milieu de la hauteur
      v.setTime(t); v.pitch = pitch; v.yaw = yaw;
      v.fit(r * k);
      v.render();
      shots.push({ src: cv.toDataURL('image/jpeg', 0.86), label });
    }
    const lose = v.gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
    return shots;
  }
  function openDossier() {
    const d = ensureDesign();
    const win = window.open('', '_blank');
    if (!win) { showToast('Autorise les fenêtres surgissantes pour ouvrir le dossier.'); return; }
    win.document.write('<!DOCTYPE html><title>Préparation du dossier…</title><p style="font:14px system-ui;padding:20px">Préparation du dossier…</p>');
    setTimeout(() => {
      const report = checkNFC15100(editor.components, editor.wires);
      const dayData = day.acc && day.acc.total > 0 ? { acc: day.acc, season: day.season }
        : d && d.ok ? { acc: simulateDay(editor.components, editor.wires, d, day.season, 5, pvKwc(), pvShift()), season: day.season } : null;
      const year = d && d.ok ? (day.year && day.yearDesign === d && day.yearSig === yearSig() ? day.year : simulateYear(editor.components, editor.wires, d, 10, pvKwc(), pvShift())) : null;
      const html = buildDossier({
        meta: editor.meta, design: d, report, year, lighting: lightingStudy(editor.components, editor.wires),
        planSVG: buildSVG(editor.components, editor.wires, SYMBOLS, { ...editor.meta, date: new Date().toISOString().slice(0, 10), legend: true, tags: d && d.ok ? circuitTags(d) : null }),
        unifilarSVG: d && d.ok ? unifilarSVG(d, editor.meta) : '',
        boardFrontSVG: d && d.ok ? boardFrontSVG(d, editor.meta) : '',
        wiringSVGs: d && d.ok ? boardWiringSVGs(d, editor.meta) : [],
        calcNoteSVGs: d && d.ok ? calcNoteSVGs(d, editor.meta) : [],
        developedSVGs: d && d.ok ? developedSVGs(d, editor.meta, editor.components, editor.wires) : [],
        vdiSVGs: d && d.ok && editor.components.some((c) => c.type === 'rj45') ? vdiSVGs(d, editor.meta, editor.components, editor.wires) : [],
        elevationSVGs: d && d.ok ? elevationSVGs(d, editor.meta, editor.components, editor.wires) : [],
        materials: d && d.ok ? materialList(editor.components, editor.wires, d) : null,
        images: hasPlan() ? dossierImages(d) : [],
        day: dayData,
      }).replace('</body>', '<script>window.onload = function () { setTimeout(function () { window.print(); }, 350); };<\/script></body>');
      win.document.open();
      win.document.write(html);
      win.document.close();
    }, 30);
  }

  // ---- Matériel et budget (onglet Métré) -------------------------------------
  function materialsHTML() {
    const d = ensureDesign();
    if (!d || !d.ok) return '';
    const list = materialList(editor.components, editor.wires, d);
    const eur = (v) => v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
    let h = '<section class="mat"><div class="mat-head"><div><b>Matériel et budget</b><span>d’après le tableau calculé et le plan</span></div>' +
      '<button class="btn-ghost" data-mat-csv>Exporter CSV</button></div>' +
      `<div class="mat-kpis"><div><b class="num">${eur(list.material)}</b><span>matériel électrique</span></div><div><b class="num">${eur(list.equipment)}</b><span>équipements (facultatif)</span></div></div>`;
    let cat = null;
    h += '<table class="mat-table"><tbody>';
    for (const l of list.lines) {
      if (l.cat !== cat) { cat = l.cat; h += `<tr class="mat-cat"><th colspan="3">${esc(cat)}</th></tr>`; }
      h += `<tr><td>${esc(l.name)}${l.note ? `<small>${esc(l.note)}</small>` : ''}</td><td class="num">${String(l.qty).replace('.', ',')} ${l.unit}</td><td class="num">${eur(l.total)}</td></tr>`;
    }
    h += '</tbody></table><p class="norm-foot">Prix indicatifs TTC (entrée de gamme, 2026), hors main-d’œuvre. Le disjoncteur de branchement et le compteur sont fournis par le gestionnaire de réseau.</p></section>';
    return h;
  }
  function exportMaterials() {
    const d = ensureDesign();
    if (!d || !d.ok) return;
    const csv = materialCSV(materialList(editor.components, editor.wires, d));
    download(new Blob(['\ufeff' + csv], { type: 'text/csv' }), (editor.meta.title || 'installation') + ' - materiel.csv');
  }

  return {
    open3D, close3D, openHouses, loadPlan, sim, materialsHTML, exportMaterials,
    design: () => ensureDesign(),
    refresh: () => { structKey = null; tick(0, true); },
    // tableau modifié (éditeur du tableau) : on reconçoit, on rafraîchit l'onglet et la 3D
    redesign: () => { ensureDesign(true); structKey = null; tick(0, true); if (viz && !view3d.hidden) build3D(false); },
    implant: () => action('implant'),
  };
}
