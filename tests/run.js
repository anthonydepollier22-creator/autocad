/*
 * Suite de tests ÉlectriCAD — sans dépendance : `node tests/run.js`
 *
 * Charge les modules du navigateur dans un contexte isolé et vérifie la
 * physique des exemples (valeurs attendues calculées à la main), la logique,
 * le plan de maison (surfaces, conformité NF C 15-100), la 3D et les exports.
 * Code de sortie non nul au moindre échec : le déploiement est alors bloqué.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const sb = { Math, JSON, console, TextEncoder, TextDecoder };
vm.createContext(sb);
for (const f of ['symbols', 'netlist', 'plan', 'simulate', 'digital', 'examples', 'houses', 'install', 'day', 'materials', 'svg', 'viz3d', 'export3d', 'dossier']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f + '.js'), 'utf8'), sb, { filename: f + '.js' });
}
const run = (code) => vm.runInContext(code, sb);

let passed = 0, failed = 0, section = '';
function group(name) { section = name; console.log('\n' + name); }
function check(name, cond, info) {
  if (cond) passed++; else failed++;
  console.log(`  ${cond ? 'ok  ' : 'ÉCHEC'} ${name}${info !== undefined ? '  [' + info + ']' : ''}`);
}
function near(a, b, tol) { return typeof a === 'number' && Math.abs(a - b) <= tol; }
// Évalue une expression dans le contexte avec un exemple chargé dans `d`
function ex(id, body) {
  return run(`(function(){ var d = getExampleData(${JSON.stringify(id)}); ${body} })()`);
}

// ---------------------------------------------------------------------------
group('Symboles');
const noop = () => {};
sb.__ctx = new Proxy({}, { get: (t, p) => (p in t ? t[p] : noop), set: (t, p, v) => { t[p] = v; return true; } });
const symErrors = run(`(function(){
  var errs = [];
  SYMBOLS.__order.forEach(function(k){
    var s = SYMBOLS[k];
    ['name','category','terminals','bbox','draw'].forEach(function(f){ if (!(f in s)) errs.push(k + ': ' + f + ' manquant'); });
    if (!s.plan && !s.terminals.length) errs.push(k + ': aucune borne');
    try { s.draw(__ctx, { closed: true, high: true, value: 'x' }); } catch (e) { errs.push(k + ': ' + e.message); }
  });
  return errs;
})()`);
check(`${run('SYMBOLS.__order.length')} symboles complets et dessinables`, symErrors.length === 0, symErrors.join(' | ') || undefined);

// ---------------------------------------------------------------------------
group('Simulation continue (DC)');
let r = ex('lamp', 'return simulateDC(d.components, d.wires, SYMBOLS).compI.LA1 || 0;');
check('Lampe, interrupteur ouvert : 0 A', Math.abs(r) < 1e-9, r);
r = ex('lamp', "d.components.find(function(c){return c.id==='SW1';}).closed = true; return simulateDC(d.components, d.wires, SYMBOLS).compI.LA1;");
check('Lampe, interrupteur fermé : 4,5 V / 100 Ω = 45 mA', near(r, 0.045, 1e-4), r);
r = ex('divider', 'return simulateDC(d.components, d.wires, SYMBOLS).compI.R1;');
check('Diviseur 9 V / 2 kΩ : 4,5 mA', near(r, 4.5e-3, 1e-5), r);
r = ex('led', 'return simulateDC(d.components, d.wires, SYMBOLS).compI.D1;');
check('LED + 330 Ω sous 5 V : ~10 mA (non linéaire)', r > 8e-3 && r < 12e-3, r);
r = ex('bjt', 'return simulateDC(d.components, d.wires, SYMBOLS).compI.Q1;');
check('Transistor β=100, Rb=100 kΩ : Ic ≈ 4,25 mA', near(r, 4.25e-3, 2e-4), r);
r = ex('tableau', 'var s = simulateDC(d.components, d.wires, SYMBOLS); return [s.compI.LA1, s.compI.H1, Math.abs(s.compI.ID1)];');
check('Tableau NF : lampe 2,3 A, sonnerie 4,6 A, différentiel 6,9 A',
  near(r[0], 2.3, 0.01) && near(r[1], 4.6, 0.01) && near(r[2], 6.9, 0.02), r.map((x) => x.toFixed(2)).join(' / '));
r = ex('tableau', "d.components.find(function(c){return c.id==='Q1';}).closed = false; var s = simulateDC(d.components, d.wires, SYMBOLS); return [s.compI.LA1 || 0, s.compI.H1];");
check('Tableau NF : Q1 ouvert coupe la lampe, pas la sonnerie', Math.abs(r[0]) < 1e-8 && near(r[1], 4.6, 0.01));
r = ex('tableau', "d.components.find(function(c){return c.id==='ID1';}).closed = false; var s = simulateDC(d.components, d.wires, SYMBOLS); return Math.abs(s.compI.LA1 || 0) + Math.abs(s.compI.H1 || 0);");
check('Tableau NF : différentiel ouvert coupe tout', r < 1e-7, r);

// ---------------------------------------------------------------------------
group('Transitoire et fréquentiel');
r = ex('rc', "var net = buildNets(d.components, d.wires, SYMBOLS).terminalNet.C1[0]; var res = simulateTransient(d.components, d.wires, SYMBOLS, { time: 5, steps: 500 }); var s = res.series.find(function(x){return x.net===net;}); return s.values[res.t.findIndex(function(t){return t>=1;})];");
check('Charge RC : 5 V × (1 − e⁻¹) ≈ 3,16 V à t = τ', near(r, 3.16, 0.1), r);
r = ex('rectifier', "var net = buildNets(d.components, d.wires, SYMBOLS).terminalNet.R1[0]; var res = simulateTransient(d.components, d.wires, SYMBOLS, { f: 50, time: 40, steps: 800 }); var v = res.series.find(function(x){return x.net===net;}).values; return [Math.min.apply(null, v), Math.max.apply(null, v)];");
check('Redresseur : alternances négatives bloquées, crête ≈ 9,3 V', r[0] > -0.5 && r[1] > 8.5 && r[1] < 10, r.map((x) => x.toFixed(2)).join(' / '));
r = ex('lowpass', "var net = buildNets(d.components, d.wires, SYMBOLS).terminalNet.C1[0]; var res = simulateAC(d.components, d.wires, SYMBOLS, { fmin: 1, fmax: 1e6, pts: 200 }); var s = res.series.find(function(x){return x.net===net;}); var fc = 1/(2*Math.PI*1000*1e-6), bi = 0; res.freqs.forEach(function(f,i){ if (Math.abs(f-fc) < Math.abs(res.freqs[bi]-fc)) bi = i; }); return [s.mag[bi], s.phase[bi]];");
check('Filtre RC : −3 dB et −45° à fc = 159 Hz', near(r[0], -3.01, 0.5) && near(r[1], -45, 6), r.map((x) => x.toFixed(1)).join(' dB / ') + '°');

// ---------------------------------------------------------------------------
group('Logique');
const trans = "function tr(v){ var n = 0; for (var i = 1; i < v.length; i++) if (v[i] !== v[i-1]) n++; return n; }";
function halfAdder(a, b) {
  return ex('halfadder', `d.components.find(function(c){return c.id==='A';}).high = ${a}; d.components.find(function(c){return c.id==='B';}).high = ${b};
    var tn = buildNets(d.components, d.wires, SYMBOLS).terminalNet, res = simulateDigital(d.components, d.wires, SYMBOLS, {});
    var last = function(net){ var s = res.signals.find(function(x){return x.net===net;}); return s.values[s.values.length-1]; };
    return [last(tn.U1[2]), last(tn.U2[2])];`);
}
check('Demi-additionneur : table de vérité complète',
  [[false, false, 0, 0], [true, false, 1, 0], [false, true, 1, 0], [true, true, 0, 1]].every(([a, b, s, c]) => {
    const o = halfAdder(a, b); return o[0] === s && o[1] === c;
  }));
r = ex('sevenseg', "simulateDigital(d.components, d.wires, SYMBOLS, {}); return d.components.find(function(c){return c.id==='AFF1';}).__digit;");
check('Afficheur 7 segments : 1001 → 9', r === 9, r);
r = ex('divfreq', trans + " var tn = buildNets(d.components, d.wires, SYMBOLS).terminalNet, res = simulateDigital(d.components, d.wires, SYMBOLS, {}); var sig = function(net){ return res.signals.find(function(x){return x.net===net;}).values; }; return [tr(sig(tn.CK[0])), tr(sig(tn.U1[2]))];");
check('Bascule D rebouclée : fréquence divisée par 2', Math.abs(r[0] / 2 - r[1]) <= 1, r.join(' → '));
r = ex('counter', trans + " var tn = buildNets(d.components, d.wires, SYMBOLS).terminalNet, res = simulateDigital(d.components, d.wires, SYMBOLS, {}); var sig = function(net){ return res.signals.find(function(x){return x.net===net;}).values; }; return [tr(sig(tn.CK[0])), tr(sig(tn.U1[2])), tr(sig(tn.U2[2]))];");
check('Compteur 2 bits : Q0 à f/2, Q1 à f/4', Math.abs(r[0] / 2 - r[1]) <= 1 && Math.abs(r[0] / 4 - r[2]) <= 1, r.join(' → '));

// ---------------------------------------------------------------------------
group('Flux de courant animé');
r = ex('divider', 'var fl = computeWireFlows(d.components, d.wires, SYMBOLS, simulateDC(d.components, d.wires, SYMBOLS)); return Math.max.apply(null, fl.map(function(e){return Math.abs(e.I);}));');
check('Diviseur : 4,5 mA dans la boucle', near(r, 4.5e-3, 5e-5), r);
r = ex('lamp', 'var fl = computeWireFlows(d.components, d.wires, SYMBOLS, simulateDC(d.components, d.wires, SYMBOLS)); return Math.max.apply(null, fl.map(function(e){return Math.abs(e.I);}));');
check('Lampe éteinte : aucun flux', r < 1e-6, r);

// ---------------------------------------------------------------------------
group('Plan de maison — pièces et NF C 15-100');
r = ex('maison', 'var info = computeRooms(d.components, d.wires); return info.rooms.map(function(x){ return [x.name, x.area]; });');
const area = (n) => (r.find((x) => x[0] === n) || [])[1];
check('Chambre 3,40 × 5,20 m ≈ 17,7 m²', near(area('Chambre'), 17.68, 0.3), area('Chambre'));
check('Séjour 4,60 × 5,20 m ≈ 23,9 m²', near(area('Séjour'), 23.92, 0.3), area('Séjour'));
const nf = (filter) => ex('maison', (filter ? `d.components = d.components.filter(function(c){ return ${filter}; });` : '') + ' return checkNFC15100(d.components, d.wires);');
const room = (rep, n) => rep.rooms.find((x) => x.name === n);
r = nf();
check('Exemple conforme : 0 non-conformité', r.ok && r.errors === 0 && r.warnings === 0, `${r.errors} err. / ${r.warnings} avert.`);
check('Séjour : 6 prises exigées (1 par 4 m², min 5), 6 posées', room(r, 'Séjour').socketsReq === 6 && room(r, 'Séjour').sockets === 6);
check('Chambre : 3 prises exigées, 3 posées', room(r, 'Chambre').socketsReq === 3 && room(r, 'Chambre').sockets === 3);
r = nf("c.id !== 'PC9'");
check('Prise retirée : séjour non conforme', room(r, 'Séjour').status === 'err' && !r.ok, room(r, 'Séjour').msgs.join());
r = nf("c.id !== 'p2'");
check('Porte intérieure retirée : pièces fusionnées signalées', r.rooms.some((x) => /même espace/.test(x.msgs.join())));
r = nf("c.id !== 'p1'");
check('Porte d’entrée retirée : chambre « non fermée »', room(r, 'Chambre').status === 'err' && /non fermée/.test(room(r, 'Chambre').msgs.join()));
check('… et ses prises ne sont pas comptées dans le séjour', room(r, 'Séjour').sockets === 6 && room(r, 'Séjour').switches === 1);
r = nf("c.type !== 'gtl'");
check('GTL absente : erreur', !r.ok && r.global.some((g) => g.level === 'err' && /GTL/.test(g.msg)));
r = run("[roomType('Séjour').key, roomType('Salle de bain').key, roomType('WC').key, roomType('Entrée').key, roomType('Cuisine').key, roomType('Grenier')]");
check('Types de pièces reconnus d’après leur nom', r.join() === 'sejour,sdb,wc,circ,cuisine,', r.join());
r = ex('maison', 'return wallDimensions(d.wires).map(function(x){ return x.text; });');
check('Cotations en mètres (8,00 m, 5,20 m…)', r.includes('8,00 m') && r.includes('5,20 m'), r.join(' '));
r = ex('maison', 'return [computeJunctions(d.components, d.wires, SYMBOLS).length, runERC(d.components, d.wires, SYMBOLS).filter(function(i){return i.level===\'err\';}).length];');
check('Murs et goulottes hors électrique : 0 jonction, 0 erreur ERC', r[0] === 0 && r[1] === 0, r.join(' / '));

// ---------------------------------------------------------------------------
group('Types de maison — génération, mobilier, implantation');
const houseKeys = run('HOUSE_TYPES.map(function(h){ return h.key; })');
for (const k of houseKeys) {
  r = run(`(function(){
    var d = buildHouse(${JSON.stringify(k)}), T = HOUSE_TYPES.find(function(h){ return h.key === ${JSON.stringify(k)}; });
    var info = computeRooms(d.components, d.wires), rep = checkNFC15100(d.components, d.wires);
    var area = info.rooms.reduce(function(s, x){ return s + (x.area || 0); }, 0);
    var closed = info.rooms.every(function(x){ return !x.leaked && x.sharedWith === null; });
    var furn = d.components.filter(function(c){ return FURN[c.type] && c.type !== 'gtl' && c.type !== 'panel_house'; });
    var overlaps = [];
    for (var i = 0; i < furn.length; i++) for (var j = i + 1; j < furn.length; j++)
      if (_overlap(_footprint(furn[i], -1), _footprint(furn[j], -1))) overlaps.push(furn[i].type + '/' + furn[j].type);
    var des = designInstallation(d.components, d.wires);
    var off = Object.keys(des.route).filter(function(id){ return des.route[id].off; }).length;
    return { name: T.name, rooms: info.rooms.length, area: area, closed: closed, err: rep.errors, warn: rep.warnings,
      overlaps: overlaps, off: off, circuits: des.circuits.length, conduits: d.wires.filter(function(w){ return w.kind === 'conduit'; }).length };
  })()`);
  check(`${r.name} : ${r.rooms} pièces fermées, ${r.area.toFixed(1).replace('.', ',')} m², 0 non-conformité`, r.closed && r.err === 0 && r.warn === 0, `${r.err} err. / ${r.warn} avert.`);
  check(`${r.name} : mobilier sans chevauchement, ${r.circuits} circuits, chaque appareil desservi par une goulotte`, !r.overlaps.length && r.off === 0 && r.conduits > 0, r.overlaps.join(', ') || `${r.conduits} goulottes`);
}
r = run('JSON.stringify(buildHouse("t3")) === JSON.stringify(buildHouse("t3"))');
check('Génération déterministe (même type → même plan)', r === true);
r = run(`(function(){
  var d = getExampleData('maison');
  d.components = d.components.filter(function(c){ return ['room','door','window_a','panel_house','gtl'].indexOf(c.type) >= 0; });
  d.wires = d.wires.filter(function(w){ return w.kind === 'wall'; });
  var a = autoImplant(d), k = autoConduits(d), rep = checkNFC15100(d.components, d.wires);
  return [a.added, k.conduits, rep.errors, rep.warnings];
})()`);
check('Plan dessiné à la main : implantation automatique puis goulottes → conforme', r[0] > 10 && r[1] > 5 && r[2] === 0 && r[3] === 0, `${r[0]} appareils, ${r[1]} goulottes, ${r[2]} err., ${r[3]} avert.`);

// ---------------------------------------------------------------------------
group('Installation — conception du tableau');
const des = (k) => run(`(function(){ var d = buildHouse(${JSON.stringify(k)}), x = designInstallation(d.components, d.wires);
  return { rcds: x.rcds.map(function(r){ return r.In + r.type; }).join(' '), kva: x.agcp.kva,
    lightMax: Math.max.apply(null, x.circuits.filter(function(c){ return c.kind === 'light'; }).map(function(c){ return c.points; })),
    kitchenMax: Math.max.apply(null, x.circuits.filter(function(c){ return c.name.indexOf('cuisine') >= 0; }).map(function(c){ return c.points; })),
    cook: x.circuits.filter(function(c){ return c.appliance === 'cooktop'; }).map(function(c){ return c.In + 'A/' + c.S + '/' + x.rcds.find(function(r){ return r.id === c.rcd; }).type; }).join(),
    dUok: x.circuits.every(function(c){ return c.ok; }), n: x.circuits.length }; })()`);
r = des('studio');
check('Studio (28,7 m² ≤ 35 m²) : 1 différentiel 25 A type AC + 1 type A', r.rcds === '25AC 40A', r.rcds);
r = des('t3');
check('T3 (78,9 m²) : 2 différentiels 40 A type AC + 1 type A', r.rcds === '40AC 40AC 40A', r.rcds);
check('T3 : ≤ 8 points par circuit d’éclairage, ≤ 6 prises sur le circuit cuisine', r.lightMax <= 8 && r.kitchenMax <= 6, `${r.lightMax} / ${r.kitchenMax}`);
check('T3 : plaque de cuisson en 32 A / 6 mm² sous différentiel type A', r.cook === '32A/6/A', r.cook);
check('T3 : chutes de tension ≤ 3 % (éclairage) et ≤ 5 % (autres)', r.dUok);
r = des('t5');
check('T5 + garage (157 m² > 100 m²) : 3 × AC + type A + type F dédié à la borne', r.rcds === '40AC 40AC 40AC 40A 40F', r.rcds);
check('T5 : abonnement 18 kVA (chauffage, cuisson, borne de recharge)', r.kva === 18, r.kva + ' kVA');

// ---------------------------------------------------------------------------
group('Physique de l’installation (valeurs calculées à la main)');
// Tableau + 10 m de goulotte + une prise : ΔU = 2·ρ·L·I/S
run(`function mini(power) {
  var d = { components: [
      { id: 'TB', type: 'panel_house', x: 0, y: 0, rot: 0, label: 'TB1', value: '' },
      { id: 'P', type: 'socket_wall', x: 1000, y: 0, rot: 0, label: 'PC1', value: power + ' W', on: true } ],
    wires: [{ id: 'g', kind: 'conduit', points: [{ x: 0, y: 0 }, { x: 1000, y: 0 }] }] };
  var des = designInstallation(d.components, d.wires), sim = new InstallSim();
  des.agcp.setting = 90; // on isole le disjoncteur divisionnaire
  sim.setDesign(des);
  return { d: d, des: des, sim: sim };
}`);
r = run(`(function(){ var m = mini(2300), s = m.sim.step(0.1, m.d.components, m.d.wires); return [m.des.route.P.len, s.devices.P.U]; })()`);
const L = r[0], dU = (2 * 0.0225 * L * 10) / 2.5;
check(`Chute de tension : 2 × 0,0225 × ${L.toFixed(1).replace('.', ',')} m × 10 A / 2,5 mm² = ${dU.toFixed(2).replace('.', ',')} V`, near(r[1], 230 - dU, 0.01), r[1].toFixed(3) + ' V');
r = run(`(function(){ var m = mini(7500), t = 0, I = 0;
  for (var k = 0; k < 3000; k++) { var s = m.sim.step(0.1, m.d.components, m.d.wires); if (k === 0) I = s.circuits[0].I; t += 0.1; if (m.sim.breakers.C1.tripped) break; }
  var th = Math.pow(I / 20, 2); return [t, 120 * Math.log(th / (th - 1.13 * 1.13)), I]; })()`);
check(`Surcharge ${r[2].toFixed(1).replace('.', ',')} A sur 20 A : déclenchement thermique à τ·ln(θ∞/(θ∞ − 1,13²)) = ${r[1].toFixed(1).replace('.', ',')} s`, near(r[0], r[1], 0.3), r[0].toFixed(1) + ' s');
r = run(`(function(){ var m = mini(4800); for (var k = 0; k < 6000; k++) m.sim.step(0.1, m.d.components, m.d.wires); return m.sim.breakers.C1.tripped; })()`);
check('20,6 A sur 20 A (< 1,13 In) : aucun déclenchement en 10 min', r === false);
r = run(`(function(){ var m = mini(0); m.sim.setFault('P', 'short'); m.sim.step(0.1, m.d.components, m.d.wires);
  return [m.sim.breakers.C1.tripped, 230 / (0.35 + 2 * 0.0225 * m.des.route.P.len / 2.5)]; })()`);
check(`Court-circuit : Icc = U / Zboucle ≈ ${Math.round(r[1])} A ≥ 10 In → déclenchement magnétique instantané`, r[0] === true);
r = run(`(function(){ var m = mini(0); m.sim.setFault('P', 'leak'); m.sim.step(0.1, m.d.components, m.d.wires);
  return m.sim.rcds[m.des.circuits[0].rcd].tripped && !m.sim.breakers.C1.tripped; })()`);
check('Défaut d’isolement (≈ 230 mA ≥ 30 mA) : le différentiel déclenche, pas le disjoncteur', r === true);
r = run(`(function(){ var m = mini(6000); m.des.agcp.setting = 15; m.sim.setDesign(m.des);
  for (var k = 0; k < 600; k++) { m.sim.step(0.1, m.d.components, m.d.wires); if (m.sim.agcp.tripped) break; }
  return [m.sim.agcp.tripped, m.sim.breakers.C1.tripped]; })()`);
check('Dépassement de la puissance souscrite : le disjoncteur de branchement coupe avant le divisionnaire', r[0] === true && r[1] === false, r.join(' / '));
r = run(`(function(){ var m = mini(2300); m.sim.speed = 60; var s;
  for (var k = 0; k < 600; k++) s = m.sim.step(0.1, m.d.components, m.d.wires); return [m.sim.energy, s.P]; })()`);
check(`Énergie : ${Math.round(r[1])} W pendant 1 h simulée = ${(r[1] / 1000).toFixed(2).replace('.', ',')} kWh`, near(r[0], r[1], 1), (r[0] / 1000).toFixed(3) + ' kWh');
r = run(`(function(){ var d = getExampleData('maison'), des = designInstallation(d.components, d.wires), sim = new InstallSim(); sim.setDesign(des);
  var s1 = d.components.find(function(c){ return c.id === 'SW1'; }), s2 = d.components.find(function(c){ return c.id === 'SW2'; }), out = [];
  [[false, false], [true, false], [false, true], [true, true]].forEach(function(p){ s1.closed = p[0]; s2.closed = p[1];
    out.push(sim.step(0.1, d.components, d.wires).lit.has('DCL1') ? 1 : 0); });
  return out.join(''); })()`);
check('Va-et-vient : la chambre s’éclaire quand un seul des deux interrupteurs est basculé (OU exclusif)', r === '0110', r);

// ---------------------------------------------------------------------------
group('3D et exports');
sb.__cv = { width: 600, height: 400, style: {}, getContext: () => sb.__ctx, getBoundingClientRect: () => ({ width: 600, height: 400 }), addEventListener: noop };
r = run(`(function(){
  var viz = new Viz3D(__cv, { interactive: false }), out = [];
  EXAMPLES.forEach(function(e){ var d = getExampleData(e.id); buildBoard(viz, d.components, d.wires, SYMBOLS); out.push(viz.faces.length); });
  return out;
})()`);
check(`Les ${r.length} exemples se construisent en 3D`, r.every((n) => n > 50), r.join(' '));
r = run('SYMBOLS.__order.filter(function(k){ return !BUILDERS3D[k]; })');
check('Chacun des symboles a sa représentation 3D', r.length === 0, r.join(', ') || undefined);
r = run(`(function(){
  var d = buildHouse('t3'), des = designInstallation(d.components, d.wires), sim = new InstallSim(); sim.setDesign(des);
  d.components.forEach(function(c){ if (c.type === 'switch_sa') c.closed = true; if (c.type === 'cooktop') c.on = true; });
  var snap = sim.step(0.1, d.components, d.wires), viz = new Viz3D(__cv, { interactive: false });
  buildBoard(viz, d.components, d.wires, SYMBOLS, { xray: true, sim: { snap: snap, design: des, sim: sim } });
  var cables = viz.faces.filter(function(f){ return f.obj && String(f.obj).indexOf('cable:') === 0; }).length;
  var inside = viz.lights.every(function(l){ return l.room >= 0; });
  return [snap.lit.size, viz.lights.length, inside, cables, viz.flows.length];
})()`);
check('Lampes allumées → sources de lumière rattachées à leur pièce', r[0] > 0 && r[1] === r[0] && r[2], `${r[0]} lampes, ${r[1]} lumières`);
check('Rayons X : câbles de chaque circuit et courant animé vers les appareils en marche', r[3] > 100 && r[4] > 0, `${r[3]} faces de câble, ${r[4]} flux`);
r = run(`(function(){
  var scene = { colliders: { segs: [{ a: { x: 0, y: -500 }, b: { x: 0, y: 500 }, r: 5 }], polys: [] } };
  var p = collideCircle(scene, 8, 0, 22);
  return p.x;
})()`);
check('Visite : le visiteur ne traverse pas les murs (cercle repoussé à R + e/2)', near(r, 27, 1e-6), r);
r = run(`(function(){
  var viz = new Viz3D(__cv, { interactive: false }), empty = [];
  Object.keys(BUILDERS3D).forEach(function(k){
    if (k[0] === '_' || k === 'room' || k === 'level_title') return;
    viz.clear(); BUILDERS3D[k](viz, { x: 0, y: 0, rot: 45, closed: true, high: true });
    if (!viz.faces.length) empty.push(k);
  });
  return empty;
})()`);
check('Chaque composant a un volume 3D', r.length === 0, r.join(', ') || undefined);
r = ex('maison', 'return buildSVG(d.components, d.wires, SYMBOLS, { title: "T2" });');
check('Export SVG du plan : murs épais, sols, cotations, surfaces',
  r.startsWith('<?xml') && r.includes('stroke-width="9"') && r.includes('fill-opacity="0.14"') && r.includes('5,20 m'));

// ---------------------------------------------------------------------------
group('Journée type');
r = run(`(function(){
  var d = buildHouse('t3'), ctx = dayContext(d.components, d.wires);
  var sejour = ctx.info.rooms.findIndex(function(r){ return r.type && r.type.key === 'sejour'; });
  var sw = ctx.switches[sejour][0];
  dayApply(d.components, ctx, 19.5, 'hiver'); var soir = sw.closed;
  var rad = d.components.filter(function(c){ return c.type === 'radiator'; }).some(function(c){ return c.on; });
  dayApply(d.components, ctx, 12, 'hiver'); var midi = sw.closed;
  var eau = d.components.find(function(c){ return c.type === 'water_heater'; });
  dayApply(d.components, ctx, 23, 'hiver'); var hc = eau.on;
  dayApply(d.components, ctx, 12, 'hiver'); var hp = eau.on;
  return [soir, midi, rad, hc, hp];
})()`);
check('Emploi du temps : séjour éclairé à 19 h 30 en hiver, éteint à midi, radiateurs le soir',
  r[0] === true && r[1] === false && r[2] === true, r.join(' / '));
check('Chauffe-eau en heures creuses (23 h), arrêté à midi', r[3] === true && r[4] === false);
r = run(`(function(){
  var d = buildHouse('t3'), des = designInstallation(d.components, d.wires);
  var before = JSON.stringify(d.components.map(function(c){ return [c.on, c.closed]; }));
  var w = simulateDay(d.components, d.wires, des, 'hiver', 5), s = simulateDay(d.components, d.wires, des, 'ete', 5);
  var after = JSON.stringify(d.components.map(function(c){ return [c.on, c.closed]; }));
  var sum = function(a, k){ return a.bins.reduce(function(t, b){ return t + b[k]; }, 0); };
  var bins = w.bins.reduce(function(t, b){ return t + b.heat + b.appl + b.water + b.light + b.other + b.ev; }, 0);
  return [w.total, s.total, sum(w, 'heat'), sum(s, 'heat'), w.hc / w.total, Math.abs(bins - w.total), before === after, w.peak.P, des.agcp.kva * 1000, dayCost(w).base / w.total];
})()`);
check('T3 : 20 à 120 kWh un jour d’hiver, moins l’été (pas de chauffage)', r[0] > 20 && r[0] < 120 && r[1] < r[0] && r[2] > 0 && r[3] === 0,
  `${r[0].toFixed(1)} / ${r[1].toFixed(1)} kWh`);
check('Énergie par heure et par usage = total ; une part en heures creuses', r[5] < 1e-6 && r[4] > 0.1 && r[4] < 0.9, `${(r[4] * 100).toFixed(0)} % HC`);
check('Pointe sous la puissance souscrite, coût au tarif base, maison remise dans son état', r[7] < r[8] && near(r[9], 0.2516, 1e-9) && r[6], `pointe ${Math.round(r[7])} W / ${r[8]} W`);

r = run(`(function(){
  var e = function(s){ var t = 0; for (var h = 0; h < 24; h += 0.05) t += pvPower(1, h, s) * 0.05 / 1000; return t; };
  var d = buildHouse('t3'), des = designInstallation(d.components, d.wires);
  var a = simulateDay(d.components, d.wires, des, 'ete', 5, 6, false), b = simulateDay(d.components, d.wires, des, 'ete', 5, 6, true);
  return [e('hiver'), e('ete'), pvPower(6, 3, 'ete'), a.pv, a.self / a.pv, b.self / b.pv, b.self <= b.pv + 1e-9 && b.self <= b.total + 1e-9, dayCost(b).saving > dayCost(a).saving];
})()`);
check('Solaire : ~1,5 kWh/kWc un jour d’hiver, ~6,5 en été, rien la nuit', near(r[0], 1.5, 0.15) && near(r[1], 6.5, 0.4) && r[2] === 0, r[0].toFixed(2) + ' / ' + r[1].toFixed(2));
check('Pilotage solaire : l’autoconsommation augmente (lessive, vaisselle, chauffe-eau à midi)', r[5] > r[4] * 2 && r[6] && r[7], Math.round(r[4] * 100) + ' % → ' + Math.round(r[5] * 100) + ' %');

// ---------------------------------------------------------------------------
group('Extérieur et export 3D');
r = run(`(function(){
  var d = getExampleData('maison-t3'), viz = new Viz3D(__cv, { interactive: false });
  buildBoard(viz, d.components, d.wires, SYMBOLS, { walls: 'roof', ground: true });
  var roof = viz.faces.filter(function(f){ return f.obj === 'roof'; });
  var garden = viz.faces.filter(function(f){ return f.obj === 'garden'; });
  var topRoof = Math.max.apply(null, roof.map(function(f){ return Math.max.apply(null, f.pts.map(function(p){ return p[1]; })); }));
  viz.clear();
  buildBoard(viz, d.components, d.wires, SYMBOLS, { walls: 'full', ground: false });
  var noRoof = viz.faces.filter(function(f){ return f.obj === 'roof' || f.obj === 'garden'; }).length;
  return [roof.length, garden.length, topRoof, noRoof];
})()`);
check('Toiture à deux pans au-dessus des murs, jardin autour ; rien en mode « Murs » sans terrain', r[0] > 20 && r[1] > 50 && r[2] > 400 && r[2] < 600 && r[3] === 0, `${r[0]} faces de toit, faîtage ${Math.round(r[2])} cm, ${r[1]} faces de jardin`);
r = run(`(function(){
  var d = getExampleData('maison-t3'), viz = new Viz3D(__cv, { interactive: false });
  buildBoard(viz, d.components, d.wires, SYMBOLS, { walls: 'roof', ground: true, pv: 6 });
  var faces = viz.faces.filter(function(f){ return f.obj === 'pv'; }).length;
  return [viz.scene.pv.want, viz.scene.pv.placed, faces];
})()`);
check('Panneaux solaires sur le pan sud : 6 kWc = 15 modules de 400 Wc', r[0] === 15 && r[1] === 15 && r[2] === 45, `${r[1]} posés, ${r[2]} faces`);
r = run(`(function(){
  var d = getExampleData('maison-t3'), viz = new Viz3D(__cv, { interactive: false });
  buildBoard(viz, d.components, d.wires, SYMBOLS, { walls: 'roof', ground: true });
  var tris = viz.faces.reduce(function(s, f){ return s + f.pts.length - 2; }, 0);
  var buf = buildGLB(viz.faces, { name: 'Appartement T3' }), dv = new DataView(buf);
  var jl = dv.getUint32(12, true);
  var js = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jl)));
  var verts = js.meshes[0].primitives.reduce(function(s, p){ return s + js.accessors[p.attributes.POSITION].count; }, 0);
  var bin = dv.getUint32(20 + jl, true);
  var mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  js.meshes[0].primitives.forEach(function(p){ var a = js.accessors[p.attributes.POSITION]; for (var k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], a.min[k]); mx[k] = Math.max(mx[k], a.max[k]); } });
  return [dv.getUint32(0, true) === 0x46546c67, dv.getUint32(4, true), dv.getUint32(8, true) === buf.byteLength, verts === tris * 3, bin === js.buffers[0].byteLength,
    js.materials.length === js.meshes[0].primitives.length, js.nodes[0].name, mx[1] - mn[1], js.materials.every(function(m){ return m.doubleSided; })];
})()`);
check('Export .glb : en-tête glTF 2.0, JSON + binaire, un matériau par primitive, tous les triangles', r[0] && r[1] === 2 && r[2] && r[3] && r[4] && r[5] && r[8], r.slice(0, 6).join(' / '));
check('Export .glb : nom accentué, dimensions en mètres (hauteur totale 5 à 7 m avec arbres et toit)', r[6] === 'Appartement T3' && r[7] > 4 && r[7] < 8, `${r[7].toFixed(2)} m`);
r = run(`(function(){
  var d = getExampleData('maison-t3'), viz = new Viz3D(__cv, { interactive: false });
  var info = computeRooms(d.components, d.wires);
  var cuisine = info.rooms.findIndex(function(r){ return r.type && r.type.key === 'cuisine'; });
  buildBoard(viz, d.components, d.wires, SYMBOLS, { walls: 'cut', energy: { color: function(i){ return i === cuisine ? '#a83d12' : '#efe7de'; } } });
  var hot = viz.faces.filter(function(f){ return f.color[0] === 0xa8 && f.color[1] === 0x3d && f.color[2] === 0x12; }).length;
  return [cuisine >= 0, hot];
})()`);
check('Vue Énergie : le sol de chaque pièce prend la teinte de sa puissance', r[0] && r[1] > 0, `${r[1]} faces teintées`);

r = run(`(function(){
  var out = [];
  ['studio', 't3', 't5'].forEach(function(k){
    var d = buildHouse(k, { furnish: false, elec: false }), info = computeRooms(d.components, d.wires);
    var pts = tourPath(d.components, d.wires);
    var rooms = info.rooms.filter(function(r){ return !r.leaked && r.sharedWith === null; }).length;
    var stops = new Set(pts.filter(function(p){ return p.stop; }).map(function(p){ return p.room; })).size;
    // aucun segment du parcours ne traverse un mur (les portes sont des ouvertures)
    var cross = function(a, b, c, e){
      var d1 = (e.x - c.x) * (a.z - c.y) - (e.y - c.y) * (a.x - c.x), d2 = (e.x - c.x) * (b.z - c.y) - (e.y - c.y) * (b.x - c.x);
      var d3 = (b.x - a.x) * (c.y - a.z) - (b.z - a.z) * (c.x - a.x), d4 = (b.x - a.x) * (e.y - a.z) - (b.z - a.z) * (e.x - a.x);
      return d1 * d2 < 0 && d3 * d4 < 0;
    };
    var hits = 0;
    d.wires.filter(function(w){ return w.kind === 'wall'; }).forEach(function(w){
      for (var i = 1; i < w.points.length; i++) for (var j = 1; j < pts.length; j++) if (cross(pts[j - 1], pts[j], w.points[i - 1], w.points[i])) hits++;
    });
    out.push([k, stops, rooms, hits]);
  });
  return out;
})()`);
check('Visite guidée : toutes les pièces, sans jamais traverser un mur', r.every(function (x) { return x[1] === x[2] && x[3] === 0; }), r.map(function (x) { return x[0] + ' ' + x[1] + '/' + x[2] + (x[3] ? ' (' + x[3] + ' murs traversés)' : ''); }).join(', '));

// ---------------------------------------------------------------------------
group('Matériel et budget');
r = run(`(function(){
  var d = getExampleData('maison-t3'), des = designInstallation(d.components, d.wires);
  var m = materialList(d.components, d.wires, des);
  var q = function(re){ return m.lines.filter(function(l){ return re.test(l.name); }).reduce(function(s, l){ return s + l.qty; }, 0); };
  var cable = m.lines.filter(function(l){ return /Gaine ICTA/.test(l.name); }).reduce(function(s, l){ return s + l.qty; }, 0);
  var sockets = d.components.filter(function(c){ return c.type === 'socket_wall'; }).length;
  var csv = materialCSV(m);
  return [q(/différentiel/), des.rcds.length, q(/^Disjoncteur/), des.circuits.length, cable, des.cableTotal, q(/^Prise 2P.T/) >= sockets, m.material, csv.split('\\n').length - 1 === m.lines.length + 3, m.equipment];
})()`);
check('Tableau : un interrupteur différentiel et un disjoncteur par élément conçu', r[0] === r[1] && r[2] === r[3], `${r[0]} ID, ${r[2]} disjoncteurs`);
check('Câble : longueurs des circuits + 10 % de chutes ; toutes les prises comptées', r[4] >= r[5] * 1.1 - 1 && r[4] <= r[5] * 1.1 + 6 && r[6], `${r[4]} m pour ${Math.round(r[5])} m mesurés`);
check('Budget matériel d’un T3 plausible (400 à 3 000 €), CSV complet', r[7] > 400 && r[7] < 3000 && r[8] && r[9] > 0, `${r[7].toFixed(0)} € + ${r[9].toFixed(0)} € d’équipements`);

// ---------------------------------------------------------------------------
group('Dossier du projet');
r = run(`(function(){
  var d = getExampleData('maison-t3'), des = designInstallation(d.components, d.wires);
  var html = buildDossier({
    meta: { title: 'T3 <test>' }, design: des, report: checkNFC15100(d.components, d.wires),
    planSVG: buildSVG(d.components, d.wires, SYMBOLS, { title: 'T3' }), unifilarSVG: unifilarSVG(des, { title: 'T3' }),
    materials: materialList(d.components, d.wires, des), images: [],
    day: { acc: simulateDay(d.components, d.wires, des, 'hiver', 10, 3), season: 'hiver' },
  });
  var h2 = (html.match(/<h2>/g) || []).length, svgs = (html.match(/<svg/g) || []).length;
  return [html.indexOf('<!DOCTYPE html>') === 0, h2, svgs, html.indexOf('T3 &lt;test&gt;') > 0, html.indexOf('C1') > 0, html.indexOf('Production solaire') > 0];
})()`);
check('Dossier : plan, norme, tableau, matériel, journée ; titre échappé', r[0] && r[1] === 5 && r[2] === 3 && r[3] && r[4] && r[5], `${r[1]} sections, ${r[2]} SVG`);

// ---------------------------------------------------------------------------
group('Maison à étage (R+1)');
r = run(`(function(){
  var d = buildHouse('r1'), lv = d.meta.levels, des = designInstallation(d.components, d.wires);
  var levelOf = function(x){ var i = lv.findIndex(function(l){ return x >= l.x0 && x < l.x1; }); return i < 0 ? 0 : i; };
  var byId = {}; d.components.forEach(function(c){ byId[c.id] = c; });
  var risers = d.wires.filter(function(w){ return w.kind === 'conduit' && w.riser; });
  var mixed = des.circuits.filter(function(ct){
    if (ct.kind !== 'light' && ct.kind !== 'socket') return false;
    var ls = {}; ct.devices.forEach(function(id){ if (byId[id]) ls[levelOf(byId[id].x)] = 1; });
    return Object.keys(ls).length > 1;
  }).map(function(ct){ return ct.name; });
  var up = des.circuits.filter(function(ct){ return ct.devices.some(function(id){ return byId[id] && levelOf(byId[id].x) === 1; }); });
  var viaRiser = up.every(function(ct){ return ct.edges.some(function(ei){ return des.net.edges[ei].riser; }) && ct.length >= 3; });
  var stairs = d.components.filter(function(c){ return c.type === 'stairs'; }).map(function(c){ return c.value; }).sort().join('/');
  return { levels: lv.length, stairs: stairs, risers: risers.length, riserLen: risers.every(function(w){ return w.len === 300; }),
    mixed: mixed, up: up.length, viaRiser: viaRiser, ok: des.ok, n: des.circuits.length };
})()`);
check('Deux niveaux, un escalier (bas / haut), montée de 3 m entre les goulottes', r.levels === 2 && r.stairs === 'bas/haut' && r.risers > 0 && r.riserLen, `${r.risers} montée(s)`);
check('Circuits d’éclairage et de prises par niveau (aucun ne mélange rez-de-chaussée et étage)', r.ok && r.mixed.length === 0, r.mixed.join(', ') || `${r.n} circuits`);
check('Circuits de l’étage : passent par la montée, longueur comptée', r.up > 0 && r.viaRiser, `${r.up} circuits à l’étage`);
r = run(`(function(){
  var d = buildHouse('r1'), lv = d.meta.levels, des = designInstallation(d.components, d.wires), sim = new InstallSim(); sim.setDesign(des);
  d.components.forEach(function(c){ if (c.type === 'switch_sa') c.closed = true; });
  var snap = sim.step(0.1, d.components, d.wires), viz = new Viz3D(__cv, { interactive: false });
  var dx = lv[1].dx, dy = lv[1].dy;
  var all = function(level, extra){ var o = { walls: 'cut', levels: lv, level: level, ground: false, xray: true, sim: { snap: snap, design: des, sim: sim } }; for (var k in extra) o[k] = extra[k]; buildBoard(viz, d.components, d.wires, SYMBOLS, o); return viz.faces; };
  var minY = function(f){ return Math.min.apply(null, f.pts.map(function(p){ return p[1]; })); };
  var maxY = function(f){ return Math.max.apply(null, f.pts.map(function(p){ return p[1]; })); };
  var f = all('all'), upper = f.filter(function(x){ return x.dx === dx; });
  var elevated = upper.length > 500 && upper.every(function(x){ return minY(x) >= dy - 24 - 0.01; });
  var riser = f.some(function(x){ return String(x.obj).indexOf('cable:') === 0 && x.dx === 0 && minY(x) < 20 && maxY(x) > dy; });
  var flowsUp = viz.flows.some(function(fl){ return fl.pts.some(function(p){ return p[1] > dy; }); });
  // trémie : aucun sol de l'étage au-dessus de la volée
  var st = d.components.find(function(c){ return c.type === 'stairs' && c.value === 'haut'; });
  var hx = st.x + dx, hz = st.y;
  var covered = upper.some(function(x){
    if (Math.abs(minY(x) - maxY(x)) > 0.01 || Math.abs(minY(x) - dy) > 1) return false;
    var xs = x.pts.map(function(p){ return p[0]; }), zs = x.pts.map(function(p){ return p[2]; });
    return hx > Math.min.apply(null, xs) && hx < Math.max.apply(null, xs) && hz > Math.min.apply(null, zs) && hz < Math.max.apply(null, zs);
  });
  var f0 = all(0), only0 = f0.every(function(x){ return x.dx === 0; });
  var f1 = all(1), only1 = f1.every(function(x){ return x.dx === dx || maxY(x) <= 0.01 || minY(x) >= dy - 24 - 0.01; });
  var lamps = all('all').length && viz.lights.filter(function(l){ return l.y > dy; }).length;
  return [elevated, upper.length, riser, flowsUp, covered, only0, only1, lamps];
})()`);
check('3D : l’étage est posé sur le rez-de-chaussée (décalé de 2,80 m, dalle comprise)', r[0], `${r[1]} faces à l’étage`);
check('3D : trémie ouverte au-dessus de l’escalier', r[4] === false);
check('3D rayons X : câbles et courant montent à l’étage par la colonne', r[2] && r[3]);
check('3D : filtre par niveau (rez-de-chaussée seul, étage seul)', r[5] && r[6]);
check('3D : les lampes de l’étage éclairent à l’étage', r[7] > 0, `${r[7]} lampes`);

r = run(`(function(){
  var d = buildHouse('r1'), viz = new Viz3D(__cv, { interactive: false });
  buildBoard(viz, d.components, d.wires, SYMBOLS, { walls: 'full', ceiling: true, levels: d.meta.levels, level: 'all' });
  var st = viz.scene.stairs, lo = st.lo, seen = [];
  viz.onLevel = function(i){ seen.push(i); };
  viz.mode = 'walk';
  // devant la première marche, face à la volée (le haut de la volée est vers y local −157)
  var a = (lo.rot || 0) * Math.PI / 180, fx = Math.sin(a), fz = -Math.cos(a); // direction « vers le haut » dans le plan
  var start = _lp(lo, 0, 157 + 45);
  viz.walk = { x: start[0], z: start[1], yaw: Math.atan2(-fx, -fz), pitch: 0, vx: 0, vz: 0, bob: 0, phase: 0, level: 0, lift: 0, stair: false };
  var go = function(yaw, n){ viz.walk.yaw = yaw; viz.keys = { z: true }; for (var i = 0; i < n; i++) viz.update(1 / 30); viz.keys = {}; for (var j = 0; j < 20; j++) viz.update(1 / 30); };
  go(viz.walk.yaw, 150);
  var top = [Math.round(viz.walk.lift), viz.walk.stair];
  // la volée finit contre le mur : on sort sur le côté (x local −, vers le palier)
  go(Math.atan2(Math.cos(a), Math.sin(a)), 60);
  var up = [viz.walk.level, viz.walk.stair, Math.round(viz._walkCam().eye[1])];
  // demi-tour vers la trémie (x local +), puis on redescend
  go(Math.atan2(-Math.cos(a), -Math.sin(a)), 60);
  var mid = [viz.walk.level, viz.walk.stair];
  go(Math.atan2(fx, fz), 200);
  return { top: top, up: up, mid: mid, end: [viz.walk.level, viz.walk.stair, Math.round(viz.walk.lift)], seen: seen.join(',') };
})()`);
check('Visite : on monte l’escalier jusqu’à l’étage (yeux à 2,80 + 1,62 m)', r.top[0] > 250 && r.top[1] && r.up[0] === 1 && !r.up[1] && Math.abs(r.up[2] - 442) <= 3, JSON.stringify(r.up));
check('Visite : on redescend par la trémie jusqu’au rez-de-chaussée', r.mid[1] === true && r.end[0] === 0 && !r.end[1] && r.end[2] === 0 && r.seen === '1,0', r.seen);

console.log(`\n${passed} réussis, ${failed} échoué${failed > 1 ? 's' : ''}`);
process.exit(failed ? 1 : 0);
