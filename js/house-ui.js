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
  const { editor, showTab, showToast, download, esc } = app;
  const $ = (s) => document.getElementById(s);
  const sim = new InstallSim();
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
    const relevant = editor.components.some((c) => c.type === 'panel_house');
    design = relevant ? designInstallation(editor.components, editor.wires) : null;
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
    if (day.running) dayApply(editor.components, day.ctx, day.h, day.season);
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
        (hasPlan() ? '<button class="btn-ghost" data-act="implant">Implanter automatiquement</button>' : '') +
        '</div></div>';
      bindActions();
      return;
    }
    const kinds = { light: 'Éclairage', socket: 'Prises', heating: 'Chauffage', dedicated: 'Spécialisé' };
    let h = '<div class="inst-actions">' +
      '<button data-act="implant" title="Ajoute l’appareillage NF C 15-100 manquant puis retrace les goulottes">Implanter</button>' +
      '<button data-act="conduits" title="Retrace toutes les goulottes depuis le tableau">Goulottes</button>' +
      '<button data-act="furnish" title="Meuble les pièces vides">Meubler</button>' +
      '<button data-act="unifilar" title="Télécharger le schéma unifilaire (SVG)">Unifilaire</button></div>';
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
      `<div class="board-info"><b>Abonnement ${d.agcp.kva} kVA</b><span>${d.circuits.length} circuits · ${d.rcds.length} différentiels 30 mA · ${Math.round(d.cableTotal)} m de câble · réserve ${d.reserve} modules</span></div></div>`;
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
    if (act === 'unifilar') {
      const d = ensureDesign(true);
      if (!d || !d.ok) return;
      download(new Blob([unifilarSVG(d, editor.meta)], { type: 'image/svg+xml' }), (editor.meta.title || 'installation') + ' - unifilaire.svg');
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
    } else if (act === 'furnish') {
      const r = furnishPlan(doc);
      editor.pushHistory(); editor.render();
      showToast(r.placed ? `<b>${r.placed} meubles</b> posés dans ${r.rooms} pièce${r.rooms > 1 ? 's' : ''}` + (r.missed.length ? ` — sans place : ${esc(r.missed.join(', '))}` : '.') : 'Toutes les pièces reconnues sont déjà meublées.');
    }
    ensureDesign(true);
    tick(0, true);
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
  $('btn-houses').addEventListener('click', openHouses);
  $('houses-close').addEventListener('click', closeHouses);
  hModal.querySelector('.modal-backdrop').addEventListener('click', closeHouses);
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !hModal.hidden) closeHouses(); }, true);

  // ---- Journée type ---------------------------------------------------------
  // 24 heures simulées : emploi du temps (day.js) → simulation physique →
  // énergie par heure et par usage ; en 3D, le soleil et les lampes suivent.
  const day = { season: 'hiver', rate: 0.5, running: false, h: 0, acc: null, saved: null, ctx: null, design: null, prevTime: null, hover: -1, instant: false };
  const hhmm = (h) => {
    const H = Math.floor(h), M = Math.min(59, Math.floor((h - H) * 60));
    return String(H % 24).padStart(2, '0') + ':' + String(M).padStart(2, '0');
  };
  const fmtKWh1 = (k) => (k < 10 ? k.toFixed(1) : Math.round(k).toString()).replace('.', ',') + ' kWh';

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
      '<div class="day-chart-wrap" data-day-wrap><canvas class="day-chart" data-day-chart aria-label="Énergie consommée heure par heure"></canvas>' +
      '</div>' +
      '<p class="day-head" data-day-head></p><ul class="day-legend" data-day-legend></ul>' +
      '<p class="day-sum" data-day-sum>Réveil 6 h 30, départ 8 h 15, retour 17 h 15, coucher 23 h ; lessive, vaisselle, chauffe-eau et recharge en heures creuses.</p>' +
      '</details>';
  }

  function daySetTime3D(h) {
    const t = Math.round((h % 24) * 4) / 4;
    if (viz && viz.setTime) viz.setTime(h % 24);
    $('v3-time').value = t;
    $('v3-time-lbl').textContent = hhmm(h);
    $('v3-time-ico').textContent = h > 6.5 && h < 19.5 ? '☀' : '☾';
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
    dayAccumulate(day.acc, snap, editor.components, day.h, dh);
    day.h = Math.min(24, day.h + dh);
    if (viz && !$('view3d').hidden) daySetTime3D(day.h);
    if (day.h >= 24) dayFinish(true);
  }
  function dayFinish(completed) {
    day.running = false;
    sim.speed = 1;
    if (day.saved) dayRestoreStates(day.saved);
    day.saved = null;
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
    day.acc = simulateDay(editor.components, editor.wires, d, day.season, 2);
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
    const max = bins ? Math.max(...bins.map(tot)) : 0;
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
    ctx.textAlign = 'center';
    for (const hh of [0, 6, 12, 18, 24]) ctx.fillText(hh + ' h', g.left + hh * g.slot, H - 6);
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
    legend.innerHTML = DAY_CATS.map((c, i) => `<li><i style="background:var(--dc${i + 1})"></i><span>${esc(c.name)}</span><b class="num">${bins ? fmtKWh1(vals[i]) : '—'}</b></li>`).join('');
    const sum = panel.querySelector('[data-day-sum]');
    if (day.acc && day.acc.total > 0) {
      const c = dayCost(day.acc), a = day.acc;
      sum.innerHTML = `<b class="num">${fmtKWh1(a.total)}</b> ${day.h < 24 ? 'depuis minuit' : 'dans la journée'} · <b class="num">${fmtEur(c.base)}</b> en tarif base, <b class="num">${fmtEur(c.hphc)}</b> en heures creuses (${Math.round((a.hc / a.total) * 100)} % consommés la nuit) · pointe <b class="num">${fmtW(a.peak.P)}</b> à ${hhmm(a.peak.h)}` +
        (a.peak.P > (day.design || design || {}).agcp?.kva * 1000 ? ' — au-delà de l’abonnement !' : '');
    }
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
  let energySig = '';
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
      const el = document.createElement('div');
      el.className = 'v3-lab';
      const name = document.createElement('span'); name.textContent = room.name;
      const val = document.createElement('b'); val.className = 'num';
      el.append(name, val);
      labelsBox.appendChild(el);
      items.push({ el, val, i, p: [lab.x, 150, lab.y] });
    });
    const legend = document.createElement('div');
    legend.className = 'v3-energy-legend';
    legend.innerHTML = '<span>0</span><i></i><span>4 kW</span>';
    labelsBox.appendChild(legend);
    const place = () => {
      for (const it of items) {
        const q = viz.project && viz.project(it.p);
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
    update();
    viz.onFrame = place;
    place();
  }
  // À chaque pas de simulation : valeurs des étiquettes, et teintes si la puissance a bougé
  function energyTick() {
    if (!v3.energy || !viz || view3d.hidden || !labelsBox.__update) return;
    labelsBox.__update();
    const { P } = roomPowers();
    const sig = Object.keys(P).map((k) => k + ':' + Math.round(P[k] / 150)).join('|');
    if (sig !== energySig) { energySig = sig; build3D(false); }
  }

  // ---- Vue 3D ---------------------------------------------------------------
  const view3d = $('view3d'), cv3 = $('canvas3d'), tip = $('v3-tip'), map = $('v3-map'), hud = $('v3-hud');
  let viz = null;
  const v3 = { walls: 'full', xray: false, time: 15, energy: false };
  function build3D(first) {
    const d = ensureDesign();
    const house = hasPlan();
    const walking = viz.mode === 'walk';
    const energy = v3.energy && house ? roomPowers() : null;
    const r = buildBoard(viz, editor.components, editor.wires, SYMBOLS, {
      walls: walking ? 'full' : v3.walls, xray: v3.xray, ceiling: walking, ground: house, keepCamera: !first,
      sim: d && d.ok ? { snap: sim.snap, design: d, sim } : null,
      energy: energy ? { color: (i) => energyColor(energy.P[i] || 0) } : null,
    });
    energyLabels(energy);
    if (first) viz.fit(r * (house ? 0.82 : 1));
  }
  function open3D() {
    view3d.hidden = false;
    if (!viz) {
      viz = createViz3D(cv3, { sky: true, time: v3.time });
      window.__viz3d = viz; // débogage et captures d'écran
      viz.onPick = onPick;
      viz.onHover = onHover;
      if (!viz.webgl) $('v3-time-wrap').hidden = true;
    }
    const house = hasPlan();
    viz.mode = 'orbit'; viz.walk = null; viz.trans = null;
    viz.pitch = house ? 0.8 : 0.82; viz.yaw = -0.55;
    viz.autoRotate = !house;
    tick(0);
    build3D(true);
    viz.start();
    $('view3d-title').textContent = house ? 'Vue 3D de la maison' : 'Vue 3D de la carte';
    $('v3-house-controls').hidden = !house;
    setViewButtons('orbit');
    updateHint();
    if (!editor.components.length && !editor.wires.length) showToast('Plan vide — crée une maison ou pose des composants, puis reviens en 3D !', 3200);
  }
  function close3D() {
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
  }));
  $('v3-energy').addEventListener('click', () => {
    v3.energy = !v3.energy;
    $('v3-energy').classList.toggle('on', v3.energy);
    $('v3-energy').setAttribute('aria-pressed', v3.energy ? 'true' : 'false');
    energySig = '';
    build3D(false);
    if (v3.energy && !(design && design.ok)) showToast('Vue Énergie : il faut un tableau (onglet Tableau → Implanter) pour mesurer la puissance.');
  });
  $('v3-day').addEventListener('click', () => {
    if (!(ensureDesign() || {}).ok) { showToast('La journée type a besoin d’un tableau : onglet Tableau → Implanter.'); return; }
    if (day.running) dayPause(); else dayStart();
  });
  $('v3-xray').addEventListener('click', () => {
    v3.xray = !v3.xray;
    $('v3-xray').classList.toggle('on', v3.xray);
    $('v3-xray').setAttribute('aria-pressed', v3.xray ? 'true' : 'false');
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
  });

  function onPick(id) {
    const c = id && byId(id);
    if (!c) return;
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
    const b = viz.bounds; if (!b || !viz.walk) return;
    const W = map.width, H = map.height, ctx = map.getContext('2d');
    const s = Math.min((W - 16) / (b.maxX - b.minX), (H - 16) / (b.maxZ - b.minZ));
    const ox = (W - (b.maxX - b.minX) * s) / 2 - b.minX * s, oy = (H - (b.maxZ - b.minZ) * s) / 2 - b.minZ * s;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(14,17,24,0.78)'; ctx.fillRect(0, 0, W, H);
    const info = computeRooms(editor.components, editor.wires);
    info.rooms.forEach((room, i) => {
      if (room.leaked || room.sharedWith !== null) return;
      const lit = editor.components.some((c) => LIGHT_T.has(c.type) && snap.lit.has(c.id) && roomAt(info, c.x, c.y) === i);
      ctx.fillStyle = lit ? 'rgba(255,214,120,0.35)' : 'rgba(120,140,170,0.14)';
      for (const r of roomRuns(info, i)) ctx.fillRect(ox + r.x * s, oy + r.y * s, r.w * s + 0.5, r.h * s + 0.5);
    });
    ctx.strokeStyle = '#dfe6f0'; ctx.lineWidth = 2; ctx.lineCap = 'round';
    for (const w of editor.wires) {
      if (w.kind !== 'wall') continue;
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
    const glb = buildGLB(viz.faces, { name: title });
    download(new Blob([glb], { type: 'model/gltf-binary' }), title + ' - 3D.glb');
    showToast(`Modèle 3D exporté (${(glb.byteLength / 1048576).toFixed(1).replace('.', ',')} Mo) : s’ouvre dans Blender, la visionneuse 3D, SketchUp…`, 4200);
  });
  $('btn-3d-photo').addEventListener('click', () => {
    if (viz && viz.render) viz.render();
    const a = document.createElement('a');
    a.href = cv3.toDataURL('image/png');
    a.download = (editor.meta.title || 'vue') + '-3d.png';
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
    if (e.target.tagName === 'INPUT') return;
    if (viz.keyDown(e)) e.preventDefault();
    // le plan est masqué : ses raccourcis (supprimer, pivoter, outils…) ne doivent pas agir
    e.stopPropagation();
  }, true);
  window.addEventListener('keyup', (e) => { if (viz) viz.keyUp(e); }, true);
  window.addEventListener('blur', () => { if (viz) viz.keys = {}; });
  window.addEventListener('resize', () => { if (!view3d.hidden && viz) viz.resize(); });

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
    open3D, close3D, openHouses, sim, materialsHTML, exportMaterials,
    design: () => ensureDesign(),
    refresh: () => { structKey = null; tick(0, true); },
  };
}
