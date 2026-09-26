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
const sb = { Math, JSON, console, TextEncoder, TextDecoder, performance };
vm.createContext(sb);
for (const f of ['symbols', 'netlist', 'plan', 'simulate', 'digital', 'examples', 'houses', 'install', 'day', 'materials', 'svg', 'dxf', 'board', 'vdi', 'viz3d', 'gl3d', 'export3d', 'dossier']) {
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
r = run(`(function(){
  var d = buildHouse('t3'), zones = wetZones(d.components, d.wires), info = computeRooms(d.components, d.wires);
  var wet = d.components.filter(function(c){ return c.type === 'shower' || c.type === 'bathtub'; }).length;
  var z = zones[0], S = info.step, area = z.v2.reduce(function(t, r){ return t + r.w * r.h; }, 0) / (PLAN_UNITS_PER_M * PLAN_UNITS_PER_M);
  // chaque bande du volume 2 : dans la pièce de l'appareil, à moins de 60 cm (au pas de la grille près)
  var ok = zones.every(function(z){ return z.v2.every(function(r){ var cx = r.x + S / 2, cy = r.y + r.h / 2; return roomAt(info, cx, cy) === z.room && _distToFootprint(cx, cy, z.c) < 60 + S; }); });
  // aucune prise ni commande implantée dans le volume 2
  var bad = d.components.filter(function(c){ return (c.type === 'socket_wall' || c.type === 'switch_sa' || c.type === 'switch_vv_wall') && zones.some(function(z){ return z.v2.some(function(r){ return c.x >= r.x && c.x < r.x + r.w && c.y >= r.y && c.y < r.y + r.h; }); }); }).length;
  return [zones.length, wet, area, ok, bad, z.v1.length];
})()`);
check('Volumes de salle d’eau : volume 1 (emprise) et volume 2 (60 cm, arrêté aux murs), rien d’implanté dedans', r[0] === r[1] && r[0] > 0 && r[2] > 0.5 && r[3] && r[4] === 0 && r[5] === 4, `${r[0]} appareil(s), V2 ${r[2].toFixed(2)} m²`);
r = run(`(function(){
  // 10 × 6 m, une cloison à 4 m : deux pièces ; seule la première est étiquetée
  var U = PLAN_UNITS_PER_M, wall = function(pts){ return { id: 'w' + pts[0][0] + pts[0][1] + pts.length, kind: 'wall', points: pts.map(function(p){ return { x: p[0] * U, y: p[1] * U }; }) }; };
  var wires = [wall([[0, 0], [10, 0], [10, 6], [0, 6], [0, 0]]), wall([[4, 0], [4, 6]])];
  var none = unlabeledRooms([], wires);
  var comps = [{ id: 'r1', type: 'room', x: 2 * U, y: 3 * U, rot: 0, value: 'Séjour' }];
  var one = unlabeledRooms(comps, wires);
  comps.push({ id: 'r2', type: 'room', x: one[0].x, y: one[0].y, rot: 0, value: 'Chambre' });
  var info = computeRooms(comps, wires), cham = info.rooms.find(function(r){ return r.name === 'Chambre'; });
  return [none.length, one.length, Math.round(one[0].area), unlabeledRooms(comps, wires).length, cham && !cham.leaked && Math.round(cham.area)];
})()`);
check('Espaces fermés sans étiquette détectés (2 puis 1), étiquette posée au bon endroit → 0', r[0] === 2 && r[1] === 1 && r[3] === 0 && Math.abs(r[2] - 36) <= 3 && Math.abs(r[4] - 36) <= 3, `${r[0]} / ${r[1]} (${r[2]} m²) / ${r[3]}`);

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
  var d = buildHouse('t3'), des = designInstallation(d.components, d.wires), sim = new InstallSim(); sim.setDesign(des);
  d.components.forEach(function(c){ if (c.type === 'switch_sa') c.closed = true; });
  var snap = sim.step(0.1, d.components, d.wires), viz = new Viz3D(__cv, { interactive: false });
  var ct = des.circuits.find(function(c){ return c.kind === 'light'; });
  buildBoard(viz, d.components, d.wires, SYMBOLS, { xray: true, circuit: ct.id, sim: { snap: snap, design: des, sim: sim } });
  var mine = viz.faces.filter(function(f){ return f.obj === 'cable:' + ct.id; });
  var others = viz.faces.filter(function(f){ return f.obj && String(f.obj).indexOf('cable:') === 0 && f.obj !== 'cable:' + ct.id; });
  var marks = mine.filter(function(f){ return f.em > 1; }).length;
  var flowsOk = viz.flows.length > 0;
  return [mine.every(function(f){ return f.alpha === 1; }), others.length > 0 && others.every(function(f){ return f.alpha < 0.2 && !f.em; }), marks >= 6 * ct.devices.filter(function(id){ return des.route[id] && !des.route[id].off; }).length, flowsOk];
})()`);
check('Rayons X : un circuit isolé ressort (repère sur chaque point), les autres s’estompent', r.every(Boolean), r.join(' / '));
r = run(`(function(){
  // défaut provoqué en 3D : le simulateur déclenche la bonne protection, la 3D reçoit une gerbe d'étincelles
  var d = buildHouse('t3'), des = designInstallation(d.components, d.wires), sim = new InstallSim(); sim.setDesign(des);
  var oven = d.components.find(function(c){ return c.type === 'oven'; }), ct = des.circuits.find(function(c){ return c.devices.indexOf(oven.id) >= 0; });
  sim.setFault(oven.id, 'short'); sim.step(0.1, d.components, d.wires);
  var tripped = sim.breakers[ct.id].tripped;
  var wm = d.components.find(function(c){ return c.type === 'washer'; }), ct2 = des.circuits.find(function(c){ return c.devices.indexOf(wm.id) >= 0; });
  sim.setFault(wm.id, 'leak'); sim.step(0.1, d.components, d.wires);
  var rcd = sim.rcds[ct2.rcd].tripped;
  var viz = new Viz3D(__cv, { interactive: false });
  viz.spark(oven.x, 90, oven.y, { room: 3 });
  var sp = viz.sparks[0];
  return [tripped, rcd, sp.rays.length >= 40, !!sp.flash && sp.room === 3, sim.events[0].level];
})()`);
check('Défaut en 3D : court-circuit → disjoncteur, fuite → différentiel, étincelles et éclair dans la pièce', r[0] && r[1] && r[2] && r[3] && r[4] === 'err', r.join(' / '));
r = run(`(function(){
  var d = buildHouse('t3'), des = designInstallation(d.components, d.wires), sim = new InstallSim(); sim.setDesign(des);
  var viz = new Viz3D(__cv, { interactive: false }), glow = function(){ return d.components.filter(function(c){ return c.type === 'window_a' && c.__glow; }).length; };
  var snap0 = sim.step(0.1, d.components, d.wires);
  buildBoard(viz, d.components, d.wires, SYMBOLS, { walls: 'roof', sim: { snap: snap0, design: des, sim: sim } }); var off = glow();
  d.components.forEach(function(c){ if (c.type === 'switch_sa') c.closed = true; });
  var snap = sim.step(0.1, d.components, d.wires);
  buildBoard(viz, d.components, d.wires, SYMBOLS, { walls: 'roof', sim: { snap: snap, design: des, sim: sim } }); var on = glow();
  var warm = viz.faces.some(function(f){ return f.em > 0.5 && f.alpha > 0.5 && f.alpha < 0.7; });
  buildBoard(viz, d.components, d.wires, SYMBOLS, { walls: 'full', ceiling: true, sim: { snap: snap, design: des, sim: sim } }); var walk = glow();
  return [off, on, warm, walk];
})()`);
check('Nuit : les fenêtres des pièces éclairées rayonnent vues du dehors, pas en visite', r[0] === 0 && r[1] > 0 && r[2] && r[3] === 0, r.join(' / '));
r = run(`(function(){
  var d = buildHouse('t5'), des = designInstallation(d.components, d.wires), sim = new InstallSim(); sim.setDesign(des);
  var snap = sim.step(0.1, d.components, d.wires), viz = new Viz3D(__cv, { interactive: false }), info = computeRooms(d.components, d.wires);
  buildBoard(viz, d.components, d.wires, SYMBOLS, { walls: 'cut', sim: { snap: snap, design: des, sim: sim } });
  var none = !viz.scene.earth && !viz.faces.some(function(f){ return f.obj === 'earth'; });
  buildBoard(viz, d.components, d.wires, SYMBOLS, { walls: 'cut', xray: true, sim: { snap: snap, design: des, sim: sim } });
  var e = viz.scene.earth, faces = viz.faces.filter(function(f){ return f.obj === 'earth'; });
  var deep = faces.some(function(f){ return f.pts.some(function(p){ return p[1] <= -149; }); });
  return [none, !!e && roomAt(info, e.rod.x, e.rod.z) < 0, e && e.length, faces.length, deep];
})()`);
check('Rayons X : prise de terre — conducteur vert/jaune jusqu’au piquet (1,50 m) hors de la maison', r[0] && r[1] && r[2] > 2 && r[2] < 20 && r[3] > 20 && r[4], `${r[2] && r[2].toFixed(1)} m de conducteur`);
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
// Export DXF (AutoCAD R12) : structure, calques, entités, unités
r = run(`(function(){
  var d = buildHouse('t3'), dxf = buildDXF(d.components, d.wires, SYMBOLS, { title: 'T3 à tester' });
  var lines = dxf.split('\\r\\n'); if (lines[lines.length - 1] === '') lines.pop();
  var codesOk = true, n = { POLYLINE: 0, VERTEX: 0, SEQEND: 0, TEXT: 0 }, layers = {}, maxX = -1e9, minX = 1e9;
  for (var i = 0; i < lines.length; i += 2) {
    if (!/^-?\\d+$/.test(lines[i].trim())) { codesOk = false; break; }
    var code = +lines[i], v = lines[i + 1];
    if (code === 0 && n[v] !== undefined) n[v]++;
    if (code === 8) layers[v] = 1;
    if (code === 10) { maxX = Math.max(maxX, +v); minX = Math.min(minX, +v); }
  }
  var walls = d.wires.filter(function(w){ return w.kind === 'wall'; }).length;
  var murs = (dxf.match(/\\r\\n0\\r\\nPOLYLINE\\r\\n8\\r\\nMURS\\r\\n/g) || []).length;
  // symboles : aucun n'échoue dans le contexte DXF
  var bad = [];
  SYMBOLS.__order.forEach(function(k){ try { buildDXF([{ id: 'x', type: k, x: 0, y: 0, rot: 30, value: 'haut' }], [], SYMBOLS, {}); } catch (e) { bad.push(k); } });
  return [lines.length % 2 === 0, codesOk, dxf.indexOf('AC1009') > 0 && /EOF\\r\\n$/.test(dxf), n, Object.keys(layers).sort().join(','), murs === walls, walls, maxX - minX, dxf.indexOf('\\\\U+00E0') > 0, bad];
})()`);
check('Export DXF R12 : paires code/valeur, en-tête, calques, un mur = une polyligne épaisse', r[0] && r[1] && r[2] && r[3].POLYLINE === r[3].SEQEND && r[3].VERTEX > r[3].POLYLINE && r[3].TEXT > 20 && r[5], `${r[3].POLYLINE} polylignes, ${r[3].TEXT} textes, ${r[6]} murs`);
check('Export DXF : en mètres (largeur 5 à 30 m), accents en \\U+, chaque symbole exportable', r[7] > 5 && r[7] < 30 && r[8] && r[9].length === 0, `${r[7].toFixed(1)} m · calques ${r[4]}`);
// l'export SVG a son propre contexte de dessin : chaque symbole doit s'y dessiner
r = run(`(function(){
  var bad = [];
  SYMBOLS.__order.forEach(function(k){
    [undefined, 'haut'].forEach(function(v){
      try { buildSVG([{ id: 'x1', type: k, x: 0, y: 0, rot: 0, value: v }], [], SYMBOLS, {}); } catch (e) { bad.push(k + ' : ' + e.message); }
    });
  });
  return bad;
})()`);
check('Export SVG : chacun des symboles se dessine (contexte SVG)', r.length === 0, r.join(', ') || undefined);

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

r = run(`(function(){
  var d = buildHouse('t3'), des = designInstallation(d.components, d.wires);
  var y = simulateYear(d.components, d.wires, des, 10, 0, false), y6 = simulateYear(d.components, d.wires, des, 10, 6, true);
  var byDays = y.winter.total * 212 + y.summer.total * 153;
  var cats = DAY_CATS.reduce(function(t, c){ return t + y.cats[c.key]; }, 0);
  // puissance appelée (pointe) ≠ énergie : un lave-linge de 2,2 kW sur 1 h 30 consomme ~1,3 kWh
  var w = simulateDay(d.components, d.wires, des, 'ete', 5), appl = w.bins.reduce(function(t, b){ return t + b.appl; }, 0);
  return [y.total, Math.abs(byDays - y.total), Math.abs(cats - y.total), y.cost.base - y.cost.energyBase, y.kva, y6.self <= y6.pv + 1e-6, y6.cost.saving > 0, Math.abs(y6.surplus - (y6.pv - y6.self)), appl, w.peak.P];
})()`);
check('Bilan annuel : 212 jours d’hiver + 153 d’été, 6 000 à 13 000 kWh pour un T3 tout électrique', r[0] > 6000 && r[0] < 13000 && r[1] < 1e-6 && r[2] < 1e-3, Math.round(r[0]) + ' kWh/an');
check('Bilan annuel : abonnement ajouté selon la puissance souscrite, solaire autoconsommé ≤ produit', r[3] > 100 && r[5] && r[6] && r[7] < 1e-6, `abonnement ${Math.round(r[3])} € (${r[4]} kVA)`);
check('Énergie des appareils selon leurs cycles (cuisson + lavage < 8 kWh/j), pointe à pleine puissance', r[8] > 3 && r[8] < 8 && r[9] > 3000, `${r[8].toFixed(1)} kWh/j, pointe ${Math.round(r[9])} W`);
r = run(`(function(){
  var d = buildHouse('t3'), des = designInstallation(d.components, d.wires), y = simulateYear(d.components, d.wires, des, 10, 0, false);
  var sc = yearScenarios(y), pac = sc.find(function(s){ return s.key === 'pac'; }), cet = sc.find(function(s){ return s.key === 'cet'; });
  return [sc.length, pac && Math.abs(pac.kwh - y.cats.heat * 2 / 3) < 1e-6, cet && cet.kwh < y.cats.water, sc.every(function(s){ return s.eur > 0 && s.years > 1 && s.years < 60; })];
})()`);
check('Rénovation : PAC (chauffage ÷ 3), isolation, chauffe-eau thermodynamique — économies et retour', r[0] === 3 && r[1] && r[2] && r[3], r.join(' / '));

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
  ['studio', 't3', 't5', 'r1'].forEach(function(k){
    var d = buildHouse(k, { furnish: false, elec: false }), info = computeRooms(d.components, d.wires), lv = d.meta.levels;
    var pts = tourPath(d.components, d.wires, lv);
    var lvOf = function(p){ if (!lv) return 0; var i = lv.findIndex(function(l){ return p.x >= l.x0 && p.x < l.x1; }); return i < 0 ? 0 : i; };
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
      // (le passage d'un niveau à l'autre se fait par l'escalier : pas un segment du plan)
      for (var i = 1; i < w.points.length; i++) for (var j = 1; j < pts.length; j++) if (lvOf(pts[j - 1]) === lvOf(pts[j]) && cross(pts[j - 1], pts[j], w.points[i - 1], w.points[i])) hits++;
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
    year: simulateYear(d.components, d.wires, des, 10, 3), lighting: lightingStudy(d.components, d.wires),
  });
  var h2 = (html.match(/<h2>/g) || []).length, svgs = (html.match(/<svg/g) || []).length;
  return [html.indexOf('<!DOCTYPE html>') === 0, h2, svgs, html.indexOf('T3 &lt;test&gt;') > 0, html.indexOf('C1') > 0, html.indexOf('Production solaire') > 0, html.indexOf('Bilan annuel') > 0,
    html.indexOf('<h2>Éclairement</h2>') > 0 && (html.match(/class="st err">Insuffisant/g) || []).length === 1 && (html.match(/class="st warn">Un peu juste/g) || []).length === 1];
})()`);
check('Dossier : plan, norme, éclairement, tableau, matériel, journée, bilan annuel ; titre échappé', r[0] && r[1] === 7 && r[2] === 3 && r[3] && r[4] && r[5] && r[6] && r[7], `${r[1]} sections, ${r[2]} SVG`);

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
  // rien de l'étage sous le haut des murs du rez-de-chaussée (la dalle repose dessus, sans jour)
  var elevated = upper.length > 500 && upper.every(function(x){ return minY(x) >= HOUSE3D.H - 0.01; }) && upper.some(function(x){ return Math.abs(minY(x) - HOUSE3D.H) < 0.01; });
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
check('3D : l’étage est posé sur le rez-de-chaussée (plancher à 2,80 m, dalle sur les murs, sans jour)', r[0], `${r[1]} faces à l’étage`);
check('3D : trémie ouverte au-dessus de l’escalier', r[4] === false);
check('3D rayons X : câbles et courant montent à l’étage par la colonne', r[2] && r[3]);
check('3D : filtre par niveau (rez-de-chaussée seul, étage seul)', r[5] && r[6]);
check('3D : les lampes de l’étage éclairent à l’étage', r[7] > 0, `${r[7]} lampes`);

r = run(`(function(){
  var d = buildHouse('r1'), des = designInstallation(d.components, d.wires);
  var svg = buildSVG(d.components, d.wires, SYMBOLS, { title: 'R+1' });
  var html = buildDossier({ meta: { title: 'R+1' }, design: des, report: checkNFC15100(d.components, d.wires), planSVG: svg,
    unifilarSVG: unifilarSVG(des, { title: 'R+1' }), materials: materialList(d.components, d.wires, des), images: [] });
  return [svg.indexOf('stroke-dasharray') > 0, svg.indexOf('montée 3,00 m') > 0, html.indexOf('Éclairage étage') > 0];
})()`);
check('Plan SVG et dossier de la maison à étage : escalier et montée en tirets, circuits par niveau', r[0] && r[1] && r[2], r.join(' / '));
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

r = run(`(function(){
  var d = buildHouse('r1'), lv = d.meta.levels, viz = new Viz3D(__cv, { interactive: false });
  buildBoard(viz, d.components, d.wires, SYMBOLS, { walls: 'full', levels: lv, level: 'all', ground: true });
  var b = viz.bounds, cx = (b.minX + b.maxX) / 2;
  viz.setCut(cx);
  var caps = viz.faces.filter(function(f){ return f.cap; });
  var onPlane = caps.every(function(f){ return f.pts.every(function(p){ return Math.abs(p[0] - cx) < 1e-6; }); });
  var up = caps.some(function(f){ return Math.min.apply(null, f.pts.map(function(p){ return p[1]; })) >= lv[1].dy - 24 - 1e-6; });
  var slabs = caps.filter(function(f){ return f.pts.every(function(p){ return p[1] <= 0.01; }); }).length;
  // reconstruction (changement de vue) : la coupe reste
  buildBoard(viz, d.components, d.wires, SYMBOLS, { walls: 'cut', levels: lv, level: 'all', ground: true, keepCamera: true });
  var kept = viz.faces.filter(function(f){ return f.cap; }).length, cutH = Math.max.apply(null, viz.faces.filter(function(f){ return f.cap; }).map(function(f){ return Math.max.apply(null, f.pts.map(function(p){ return p[1]; })); }));
  viz.setCut(null);
  return [caps.length, onPlane, up, slabs, kept, cutH, viz.faces.filter(function(f){ return f.cap; }).length];
})()`);
check('Vue en coupe : murs et dalles tranchés remplis, sur le plan de coupe, aux deux niveaux', r[0] >= 6 && r[1] && r[2] && r[3] >= 1, `${r[0]} faces de coupe`);
check('Vue en coupe : conservée quand la vue change (murs coupés : 1,15 m), retirée ensuite', r[4] > 0 && Math.abs(r[5] - (280 + 115)) < 1e-6 && r[6] === 0, `${r[4]} faces, ${r[5]} cm`);
r = run(`(function(){
  var d = buildHouse('t5'), viz = new Viz3D(__cv, { interactive: false });
  buildBoard(viz, d.components, d.wires, SYMBOLS, { walls: 'full', ground: true });
  var b = viz.bounds, cz = (b.minZ + b.maxZ) / 2;
  viz.setCut(cz, 'z');
  var caps = viz.faces.filter(function(f){ return f.cap; });
  var onPlane = caps.every(function(f){ return f.pts.every(function(p){ return Math.abs(p[2] - cz) < 1e-6; }); });
  // une coupe en long d'une maison de plain-pied traverse toutes les cloisons perpendiculaires
  var walls = caps.filter(function(f){ return Math.max.apply(null, f.pts.map(function(p){ return p[1]; })) > 100; }).length;
  return [caps.length, onPlane, walls, viz.cutAxis];
})()`);
check('Vue en coupe en long (plan z) : remplissages sur le plan, à chaque mur traversé', r[0] >= 5 && r[1] && r[2] >= 4 && r[3] === 'z', `${r[0]} faces, ${r[2]} murs`);

// ---------------------------------------------------------------------------
group('Soleil selon la saison (46° N)');
r = run(`(function(){
  var g = Object.create(GL3D.prototype), deg = function(){ return Math.asin(g.sunDir[1]) * 180 / Math.PI; }, out = {};
  g.setSeason('hiver');
  g.setTime(12.75); out.wNoon = deg(); out.wSouth = g.sunDir[2] > 0 && Math.abs(g.sunDir[0]) < 1e-6;
  g.setTime(8.2); out.wBefore = g.sunDir[1] < 0; g.setTime(8.8); out.wAfter = g.sunDir[1] > 0;
  g.setTime(17.3); out.wNight = g.sunDir[1] < 0 && g.day < 0.5;
  g.setSeason('ete');
  g.setTime(14); out.sNoon = deg();
  g.setTime(7); out.sNE = g.sunDir[0] > 0 && g.sunDir[2] < 0; // lever au nord-est
  g.setTime(21.5); out.sEvening = g.sunDir[1] > 0;
  g.setSeason(null); g.setTime(12); out.neutral = deg();
  return out;
})()`);
check('Hiver : soleil au sud à 12 h 45, hauteur 20,6°, levé vers 8 h 30, couché vers 17 h', near(r.wNoon, 20.6, 0.2) && r.wSouth && r.wBefore && r.wAfter && r.wNight, r.wNoon.toFixed(1) + '°');
check('Été : hauteur 67,4° à 14 h, lever au nord-est, encore levé à 21 h 30', near(r.sNoon, 67.4, 0.2) && r.sNE && r.sEvening, r.sNoon.toFixed(1) + '°');
check('Sans saison : course du soleil habituelle (6 h – 18 h, 51° à midi)', near(r.neutral, 51.3, 0.2), r.neutral.toFixed(1) + '°');

// ---------------------------------------------------------------------------
group('Import DXF');
// Aller-retour : chaque maison exportée en DXF puis réimportée garde ses pièces et ses ouvertures
r = run(`(function(){
  return HOUSE_TYPES.map(function(T){
    var d = buildHouse(T.key), im = importDXFPlan(parseDXF(buildDXF(d.components, d.wires, SYMBOLS, {})));
    var area = function(doc){ var o = {}; computeRooms(doc.components, doc.wires).rooms.forEach(function(r){ o[r.name.toLowerCase()] = r.area; }); return o; };
    var a0 = area(d), a1 = area(im), bad = [];
    Object.keys(a0).forEach(function(k){ if (!a0[k] || !a1[k] || Math.abs(a0[k] - a1[k]) > 0.2) bad.push(k); });
    var n = function(doc, t){ return doc.components.filter(function(c){ return c.type === t; }).length; };
    ['door', 'window_a', 'garage_door'].forEach(function(t){ if (n(d, t) !== n(im, t)) bad.push(t + ' ' + n(d, t) + '→' + n(im, t)); });
    return T.key + (bad.length ? ' ✗ ' + bad.join(',') : '');
  });
})()`);
check('Aller-retour DXF des 6 maisons : mêmes surfaces (±0,2 m²), portes, fenêtres, garage', r.every((x) => x.indexOf('✗') < 0), r.join(' · '));

// Plan d'architecte (ezdxf, R2018, mm) : murs en double et triple trait, blocs, MTEXT
sb.__archi = fs.readFileSync(path.join(__dirname, 'fixtures', 'plan-architecte.dxf'));
sb.__sketch = fs.readFileSync(path.join(__dirname, 'fixtures', 'croquis-metres.dxf'));
r = run(`(function(){
  var P = parseDXF(decodeDXFBytes(__archi)), g = dxfGuessLayers(P), im = importDXFPlan(P);
  var info = computeRooms(im.components, im.wires), rooms = {};
  info.rooms.forEach(function(r){ rooms[r.name] = r.leaked ? -1 : +r.area.toFixed(1); });
  var doc = { components: im.components, wires: im.wires, counters: {} };
  furnishPlan(doc); autoImplant(doc); autoConduits(doc);
  var nf = checkNFC15100(doc.components, doc.wires), des = designInstallation(doc.components, doc.wires);
  return { units: P.units, walls: g.walls, open: g.openings, st: im.stats, rooms: rooms, nf: nf.errors, circuits: des.ok ? des.circuits.length : 0,
    ins: P.inserts.map(function(i){ return i.kind + ' ' + Math.round(i.w); }) };
})()`);
check('Plan d’architecte : calques des murs devinés, millimètres lus dans l’en-tête, blocs porte/fenêtre reconnus',
  r.units === 4 && r.walls.join() === 'MURS_EXT,CLOISONS' && r.open.join() === 'MENUISERIES' && r.st.scale === 0.1 && !r.st.guessed && r.ins.join() === 'door 900,window_a 1200', r.walls.join('+') + ' · ' + r.ins.join(', '));
check('Double trait → axe : 6 murs dont 4 extérieurs (30 cm, doublage absorbé), 11,7 × 8,7 m', r.st.walls === 6 && r.st.ext === 4 && near(r.st.size[0], 11.7, 0.05) && near(r.st.size[1], 8.7, 0.05), `${r.st.walls} murs · ${r.st.size.join(' × ')} m`);
check('Ouvertures : 4 portes (bloc, arcs, trou de 83 cm), 2 fenêtres (bloc, vitrage dans le mur)', r.st.doors === 4 && r.st.windows === 2 && r.st.garages === 0, `${r.st.doors} portes · ${r.st.windows} fenêtres`);
check('Pièces lues (MTEXT mis en forme décodé) et fermées : Séjour 49,9, Chambre 1 et Salle de bain 24,9 m²', r.rooms['Séjour'] === 49.9 && r.rooms['Chambre 1'] === 24.9 && r.rooms['Salle de bain'] === 24.9, JSON.stringify(r.rooms));
check('Plan importé → meublé, électricité implantée : conforme NF C 15-100', r.nf === 0 && r.circuits >= 6, `${r.circuits} circuits`);

// Exemple fourni (samples/plan-exemple-t4.dxf) : T4 d'architecte, faces coupées aux T, blocs tournés, cotes, cartouche
sb.__t4 = fs.readFileSync(path.join(ROOT, 'samples', 'plan-exemple-t4.dxf'));
r = run(`(function(){
  var im = importDXFPlan(parseDXF(decodeDXFBytes(__t4))), d = buildHouse('t4'), bad = [];
  var area = function(doc){ var o = {}; computeRooms(doc.components, doc.wires).rooms.forEach(function(r){ o[r.name.toLowerCase()] = r.area; }); return o; };
  var a0 = area(d), a1 = area(im);
  Object.keys(a0).forEach(function(k){ if (!a1[k] || Math.abs(a0[k] - a1[k]) > 0.2) bad.push(k + ' ' + (a1[k] || 0).toFixed(1)); });
  return { st: im.stats, bad: bad, n: Object.keys(a1).length };
})()`);
check('Plan d’exemple T4 (double trait, blocs) : les 10 pièces retrouvées à ±0,2 m² du plan d’origine', r.bad.length === 0 && r.n === 10, r.bad.join(', ') || `${r.n} pièces`);
check('Plan d’exemple T4 : 10 portes, 11 fenêtres, 4 murs de façade, cotes et cartouche ignorés', r.st.doors === 10 && r.st.windows === 11 && r.st.ext === 4 && near(r.st.size[0], 12.4, 0.05) && near(r.st.size[1], 8.4, 0.05), `${r.st.walls} murs · ${r.st.size.join(' × ')} m`);

// Maison à étage : rez-de-chaussée et étage dessinés l'un sous l'autre, titres, escalier
sb.__r1 = fs.readFileSync(path.join(__dirname, 'fixtures', 'maison-etage.dxf'));
r = run(`(function(){
  var im = importDXFPlan(parseDXF(decodeDXFBytes(__r1))), d = buildHouse('r1'), bad = [];
  var area = function(doc){ var o = {}; computeRooms(doc.components, doc.wires).rooms.forEach(function(r){ o[r.name.toLowerCase()] = r.area; }); return o; };
  var a0 = area(d), a1 = area(im);
  Object.keys(a0).forEach(function(k){ if (!a1[k] || Math.abs(a0[k] - a1[k]) > 0.2) bad.push(k); });
  var st = im.components.filter(function(c){ return c.type === 'stairs'; });
  var L = im.levels, lvOf = function(x){ return x >= L[1].x0 && x < L[1].x1 ? 1 : 0; };
  var wallsOk = im.wires.every(function(w){ return lvOf(w.points[0].x) === lvOf(w.points[1].x); });
  var doc = { meta: { levels: L }, components: im.components, wires: im.wires, counters: {} };
  furnishPlan(doc); autoImplant(doc); autoConduits(doc);
  var des = designInstallation(doc.components, doc.wires);
  return { names: im.stats.levels, L: L, bad: bad, n: Object.keys(a1).length, st: st.map(function(c){ return [c.x, c.y, c.value]; }), wallsOk: wallsOk,
    risers: doc.wires.filter(function(w){ return w.riser; }).length, ok: des.ok, nf: checkNFC15100(doc.components, doc.wires).errors,
    single: importDXFPlan(parseDXF(decodeDXFBytes(__r1)), { levels: false }).levels };
})()`);
check('Maison à étage (DXF) : deux plans reconnus à leurs titres, superposés par l’escalier (bas / haut)',
  r.names.join() === 'Rez-de-chaussée,Étage' && r.L[1].dy === 280 && r.st.length === 2 && r.st[0][2] === 'bas' && r.st[1][2] === 'haut' && r.st[1][0] + r.L[1].dx === r.st[0][0] && r.st[1][1] === r.st[0][1] && r.wallsOk && r.single === null,
  r.names.join(' + ') + ' · décalage ' + r.L[1].dx);
check('Maison à étage (DXF) : les 12 pièces à ±0,2 m², colonne montante par l’escalier, installation conforme', r.bad.length === 0 && r.n === 12 && r.risers >= 1 && r.ok && r.nf === 0, r.bad.join(', ') || `${r.n} pièces · ${r.risers} montée`);

// Croquis R12 en simple trait, en mètres, sans unités déclarées
r = run(`(function(){
  var P = parseDXF(decodeDXFBytes(__sketch)), im = importDXFPlan(P);
  var info = computeRooms(im.components, im.wires);
  var doc = { components: im.components, wires: im.wires, counters: {} };
  furnishPlan(doc); autoImplant(doc); autoConduits(doc);
  var nf = checkNFC15100(doc.components, doc.wires);
  var flat = im.wires.every(function(w){ var a = w.points[0], b = w.points[1]; return a.x === b.x || a.y === b.y; });
  return { st: im.stats, closed: info.rooms.filter(function(r){ return !r.leaked; }).length, names: info.rooms.map(function(r){ return r.name; }), nf: nf.errors, flat: flat,
    daaf: doc.components.filter(function(c){ return c.type === 'smoke_detector'; }).length };
})()`);
check('Croquis : mètres devinés, murs extérieurs trouvés par l’extérieur, trait presque droit redressé', r.st.guessed && r.st.scale === 100 && r.st.walls === 6 && r.st.ext === 4 && r.flat, `${r.st.walls} murs, ${r.st.ext} ext.`);
check('Croquis : passage de 90 cm → porte, 3 pièces fermées (CUISINE → Cuisine, SDB gardé)', r.st.doors === 1 && r.closed === 3 && r.names.join() === 'Cuisine,Chambre,SDB', r.names.join(', '));
check('Sans circulation : le DAAF va au séjour ou à la cuisine, plan conforme', r.daaf === 1 && r.nf === 0);

// Lecture : Windows-1252, DXF binaire, arcs de polyligne, bloc tourné
{
  const cp = '0\nSECTION\n2\nENTITIES\n0\nTEXT\n8\nPIECES\n10\n1\n20\n1\n40\n0.2\n1\nSéjour\n0\nENDSEC\n0\nEOF\n';
  sb.__cp1252 = Uint8Array.from(cp, (ch) => ch.charCodeAt(0)); // é = 0xE9 : pas de l'UTF-8
  sb.__bin = new TextEncoder().encode('AutoCAD Binary DXF\r\n\x1a\0');
  sb.__arc = '0\nSECTION\n2\nENTITIES\n0\nLWPOLYLINE\n8\nM\n90\n2\n70\n0\n10\n0\n20\n0\n42\n1\n10\n2\n20\n0\n0\nENDSEC\n0\nEOF\n';
  sb.__blk = '0\nSECTION\n2\nBLOCKS\n0\nBLOCK\n2\nMEUBLE\n10\n0\n20\n0\n0\nLINE\n8\n0\n10\n0\n20\n0\n11\n100\n21\n0\n0\nENDBLK\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n0\nINSERT\n8\nMURS\n2\nMEUBLE\n10\n50\n20\n50\n41\n2\n50\n90\n0\nENDSEC\n0\nEOF\n';
}
r = run(`(function(){
  var out = {};
  out.cp1252 = parseDXF(decodeDXFBytes(__cp1252)).texts[0].text;
  try { decodeDXFBytes(__bin); out.bin = 'accepté'; } catch (e) { out.bin = e.message; }
  var A = parseDXF(__arc).segs, far = 0;
  A.forEach(function(s){ far = Math.max(far, Math.abs(Math.hypot(s.ax - 1, s.ay) - 1)); });
  out.arc = [A.length, A.every(function(s){ return s.arc; }), far < 1e-9, Math.min.apply(null, A.map(function(s){ return s.ay; }))];
  var B = parseDXF(__blk).segs[0];
  out.blk = [B.layer, Math.round(B.ax), Math.round(B.ay), Math.round(B.bx), Math.round(B.by)];
  try { parseDXF('bonjour'); out.bad = 'accepté'; } catch (e) { out.bad = e.message; }
  return out;
})()`);
check('Lecture : accents Windows-1252, DXF binaire et fichier non DXF refusés avec un message clair', r.cp1252 === 'Séjour' && /binaire/.test(r.bin) && /DXF/.test(r.bad), `${r.cp1252} · ${r.bin.slice(0, 22)}…`);
check('Lecture : arc de polyligne (bulge) en segments sur le cercle, bloc inséré tourné et mis à l’échelle, calque 0 hérité', r.arc[0] >= 6 && r.arc[1] && r.arc[2] && near(r.arc[3], -1, 1e-9) && r.blk.join() === 'MURS,50,50,50,250', JSON.stringify(r.arc) + ' ' + r.blk.join(','));

// ---------------------------------------------------------------------------
group('Tableau électrique et schéma unifilaire');
r = run(`(function(){
  var d = buildHouse('t5'), auto = designInstallation(d.components, d.wires);
  var b = boardFromDesign(auto), cust = designInstallation(d.components, d.wires, b);
  var same = auto.circuits.every(function(c, i){ var x = cust.circuits[i]; return x && x.id === c.id && x.In === c.In && x.S === c.S && x.rcd === c.rcd && Math.abs(x.length - c.length) < 1e-9 && Math.abs(x.dUpct - c.dUpct) < 1e-9 && x.points === c.points; });
  // modifications : 32 A sur 1,5 mm², plaque sous un ID type AC, circuit sans ID
  var b2 = JSON.parse(JSON.stringify(b));
  var light = b2.circuits.find(function(c){ return c.kind === 'light'; }); light.In = 32;
  var cook = b2.circuits.find(function(c){ return c.appliance === 'cooktop'; }); cook.rcd = b2.rcds.find(function(r){ return r.type === 'AC'; }).id;
  var oven = b2.circuits.find(function(c){ return c.appliance === 'oven'; }); oven.rcd = null;
  var d2 = designInstallation(d.components, d.wires, b2), errs = d2.checks.filter(function(c){ return c.level === 'err'; });
  var has = function(ref, re){ return errs.some(function(c){ return c.ref === ref && re.test(c.msg); }); };
  // simulation : fuite sur un circuit sans différentiel → pas de coupure, alerte
  var sim = new InstallSim(); sim.setDesign(d2);
  var ov = d.components.find(function(c){ return c.type === 'oven'; });
  sim.setFault(ov.id, 'leak'); ov.on = true; sim.step(0.5, d.components, d.wires);
  // appareils ajoutés au plan après coup : répartis
  var d3 = buildHouse('t5'), b3 = boardFromDesign(designInstallation(d3.components, d3.wires));
  var room = d3.components.find(function(c){ return c.type === 'socket_wall'; });
  d3.components.push({ id: 'newS', type: 'socket_wall', x: room.x + 40, y: room.y, rot: room.rot || 0 }, { id: 'newL', type: 'dcl', x: room.x, y: room.y + 60 });
  var before = designInstallation(d3.components, d3.wires, b3).orphans.length;
  var placed = boardDistribute(b3, d3.components, designInstallation(d3.components, d3.wires, b3));
  var after = designInstallation(d3.components, d3.wires, b3).orphans.length;
  return { same: same, n: auto.circuits.length, custom: cust.custom, autoErr: auto.checks.filter(function(c){ return c.level === 'err'; }).length,
    e1: has(light.id, /1,5 mm²/), e2: has(cook.id, /type A/), e3: has(oven.id, /aucun interrupteur/),
    log: sim.events.map(function(e){ return e.msg; }).join(' | '), ovenLive: sim.snap.circuits.find(function(c){ return c.id === oven.id; }).live,
    before: before, placed: placed, after: after };
})()`);
check('Tableau personnalisé tiré du plan : mêmes circuits, longueurs, ΔU et différentiels que l’automatique', r.same && r.custom && r.autoErr === 0, `${r.n} circuits`);
check('Contrôles NF : 32 A sur 1,5 mm², plaque sous un ID type AC, circuit sans différentiel signalés', r.e1 && r.e2 && r.e3);
check('Simulation : fuite sur un circuit sans différentiel → rien ne coupe, alerte de danger', /aucun différentiel/.test(r.log) && r.ovenLive === true);
check('Appareils ajoutés au plan après coup : repérés puis rangés sur les circuits', r.before === 2 && r.placed === 2 && r.after === 0, `${r.before} → ${r.after}`);

r = run(`(function(){
  // Tableau sans plan : modèle selon la surface
  var b = boardTemplate(90, { heating: true, cooktop: true, ev: true }), d = designInstallation([], [], b);
  var checks = d.checks.filter(function(c){ return c.level === 'err' || c.level === 'warn'; }).map(function(c){ return c.msg; });
  var svg = unifilarSVG(d, { title: 'Sans plan' }), M = boardModules(d);
  // grand tableau : plusieurs folios
  var big = boardTemplate(90); for (var i = 0; i < 26; i++) boardAddCircuit(big, 'socket', { name: 'Prises ' + (i + 10) });
  var dbig = designInstallation([], [], big), folios = unifilarSVGs(dbig, {}).length;
  var inFolios = unifilarLayout(dbig).folios.reduce(function(s, f){ return s + f.groups.reduce(function(t, g){ return t + g.cs.length; }, 0); }, 0);
  // DXF de l'unifilaire
  var dxf = unifilarDXF(d, { title: 'X' }), L = dxf.split('\\r\\n');
  var rot = 0; for (var k = 0; k < L.length - 1; k += 2) if (L[k] === '50' && Math.abs(+L[k + 1] - 90) < 0.01) rot++;
  var mat = materialList([], [], Object.assign(d, { supply: Object.assign(d.supply, { surge: true }) }));
  var hasMat = function(re){ return mat.lines.some(function(l){ return re.test(l.name); }); };
  return { ok: d.ok, n: d.circuits.length, ids: d.rcds.map(function(r){ return r.type; }).join(''), checks: checks, svg: svg.indexOf('<svg') === 0 && svg.indexOf('rotate(-90') > 0 && svg.indexOf('Folio') > 0,
    reserve: M.reservePct, rowsOk: M.rows.every(function(row){ return row.reduce(function(s, m){ return s + m.w; }, 0) <= 13; }),
    folios: folios, inFolios: inFolios, nbig: dbig.circuits.length, dxf: [L.length % 2 === 1 || L[L.length - 1] === '', dxf.indexOf('UNIFILAIRE') > 0, /\\$INSUNITS\\r\\n70\\r\\n4/.test(dxf), rot],
    mat: [hasMat(/Parafoudre/), hasMat(/Contacteur/), hasMat(/type F/), hasMat(/Coffret \\d rangée/)] };
})()`);
check('Tableau sans plan (90 m²) : circuits usuels, 2 ID AC + 1 A + 1 F (IRVE), aucune erreur', r.ok && r.n >= 12 && r.ids === 'ACACAF' && r.checks.length === 0, `${r.n} circuits · ${r.checks.join(' | ') || 'conforme'}`);
check('Face avant : rangées de 13 modules au plus, 20 % de réserve au moins', r.rowsOk && r.reserve >= 20, r.reserve + ' %');
check('Folio unifilaire SVG : désignations verticales, cartouche ; grand tableau réparti sur plusieurs folios sans perte', r.svg && r.folios >= 2 && r.inFolios === r.nbig, `${r.nbig} circuits sur ${r.folios} folios`);
check('Unifilaire DXF (mm, calques, textes à 90°) et matériel : parafoudre, contacteur HC, ID type F, coffret', r.dxf[1] && r.dxf[2] && r.dxf[3] > 10 && r.mat.every(Boolean), `${r.dxf[3]} textes verticaux`);

// Le tableau en schéma modifiable : connexions exactes, symboles NF simulés
r = run(`(function(){
  var d = buildHouse('t3'), des = designInstallation(d.components, d.wires); des.supply.surge = true;
  var doc = boardToSchematic(des, { title: 'T3' });
  var tn = buildNets(doc.components, doc.wires, SYMBOLS).terminalNet;
  var find = function(t, l){ return doc.components.find(function(c){ return c.type === t && c.label === l; }); };
  var okC = des.circuits.every(function(c){ var b = find('breaker', c.id), r = find('rcd', c.rcd); return b && r && tn[b.id][0] === tn[r.id][1]; });
  var agcp = doc.components.find(function(c){ return c.type === 'agcp'; });
  var okR = des.rcds.every(function(r){ return tn[find('rcd', r.id).id][0] === tn[agcp.id][1]; });
  var hc = doc.components.filter(function(c){ return c.type === 'contactor'; }).length;
  // AGCP, compteur, contacteur : une pile, un AGCP fermé, un compteur, une lampe → le courant passe ; AGCP ouvert → plus rien
  var mk = function(closed){ return { components: [
      { id: 'B', type: 'dc_source', x: 0, y: 0, rot: 90, value: '9 V' }, { id: 'Q', type: 'agcp', x: 100, y: -80, rot: 0, closed: closed },
      { id: 'K', type: 'meter_kwh', x: 240, y: -80, rot: 0 }, { id: 'L', type: 'lamp', x: 380, y: -80, rot: 0, value: '100' },
      { id: 'G', type: 'ground', x: 0, y: 80, rot: 0 } ],
    wires: [ { id: 'w1', points: [{ x: 0, y: -40 }, { x: 0, y: -80 }, { x: 60, y: -80 }] }, { id: 'w2', points: [{ x: 140, y: -80 }, { x: 200, y: -80 }] },
      { id: 'w3', points: [{ x: 280, y: -80 }, { x: 340, y: -80 }] }, { id: 'w4', points: [{ x: 420, y: -80 }, { x: 460, y: -80 }, { x: 460, y: 40 }, { x: 0, y: 40 }] },
      { id: 'w5', points: [{ x: 0, y: 40 }, { x: 0, y: 60 }] } ] }; };
  var on = mk(true), off = mk(false);
  var Ion = simulateDC(on.components, on.wires, SYMBOLS).compI.L, Ioff = simulateDC(off.components, off.wires, SYMBOLS).compI.L;
  return { okC: okC, okR: okR, hc: hc, surge: doc.components.some(function(c){ return c.type === 'surge'; }), Ion: Ion, Ioff: Ioff || 0, title: doc.meta.title };
})()`);
check('Tableau → schéma dans l’éditeur : chaque disjoncteur sous son ID, chaque ID sur le jeu de barres, contacteur HC, parafoudre', r.okC && r.okR && r.hc === 1 && r.surge && /unifilaire/.test(r.title));
check('Symboles NF en simulation : AGCP fermé et compteur conduisent (9 V / 100 Ω = 90 mA), AGCP ouvert coupe', near(Math.abs(r.Ion), 0.09, 1e-3) && Math.abs(r.Ioff) < 1e-9, `${(Math.abs(r.Ion) * 1000).toFixed(1)} mA`);

// Triphasé : phases équilibrées, AGCP 4P, ΔU sous 400 V, simulation par phase
r = run(`(function(){
  var b = boardTemplate(180, { tri: true, ev: true }), d = designInstallation([], [], b);
  var L = d.phaseLoad, v = [L.L1, L.L2, L.L3], spread = (Math.max.apply(null, v) - Math.min.apply(null, v)) / Math.max.apply(null, v);
  var ev = d.circuits.find(function(c){ return c.appliance === 'ev_charger'; });
  var expDU = Math.sqrt(3) * RHO_CU * ev.length * (ev.power / (Math.sqrt(3) * 400)) / ev.S / 400 * 100;
  var errs = d.checks.filter(function(c){ return c.level === 'err'; }).map(function(c){ return c.msg; });
  // simulation : la phase la plus chargée décide du déclenchement de l'AGCP
  var sim = new InstallSim(); sim.setDesign(d); sim.step(0.1, [], []);
  // un départ 3P+N sur une alimentation monophasée est refusé
  var b1 = JSON.parse(JSON.stringify(b)); b1.supply.phases = 1; b1.supply.kva = null;
  var d1 = designInstallation([], [], b1), bad = d1.checks.some(function(c){ return c.level === 'err' && /triphasé sur une alimentation monophasée/.test(c.msg); });
  var svg = unifilarSVG(d, {}), mat = materialList([], [], d).lines.map(function(l){ return l.name; }).join('|');
  return { kva: d.agcp.kva, setting: d.agcp.setting, poles: d.agcp.poles, spread: spread, evPhase: ev.phase, du: [ev.dUpct, expDU], errs: errs, sim: !!sim.snap && !!sim.snap.phases, bad: bad,
    svg: svg.indexOf('3P+N') > 0 && /4P/.test(svg) && /5G6/.test(svg), mat: /4P 40 A/.test(mat) && mat.indexOf('3P+N 20 A') >= 0 && /5G6/.test(mat) };
})()`);
check('Triphasé : AGCP 4P réglé à kVA × 5/3, phases équilibrées (écart < 10 %), borne 11 kW en 3P+N', r.poles === 4 && r.setting === r.kva * 5 / 3 && r.spread < 0.1 && r.evPhase === '3P' && r.errs.length === 0, `${r.kva} kVA · ${r.setting} A · écart ${(r.spread * 100).toFixed(1)} %`);
check('Triphasé : ΔU d’un départ 3P+N = √3·ρ·L·I / S sous 400 V ; 3P+N sur du monophasé refusé', near(r.du[0], r.du[1], 1e-9) && r.bad && r.sim, r.du[0].toFixed(2) + ' %');
check('Triphasé : folio (barre 3P+N, 4P, câble 5G6) et métré (ID 4P, disjoncteurs 3P+N, 5G)', r.svg && r.mat);

// Note de calcul : Iz, Icc mini en bout de ligne, longueur maximale protégée, prise de terre
r = run(`(function(){
  var lm = [calcLmax(1.5, 16, 'C'), calcLmax(2.5, 20, 'C'), calcLmax(6, 32, 'C'), calcLmax(1.5, 16, 'B')];
  var h = buildHouse('t3'), dh = designInstallation(h.components, h.wires), N = calcNote(dh);
  var r0 = N.rows[0], icc = 0.8 * 230 * r0.S / (2 * 0.023 * r0.L);
  // éclairage de 50 m en 1,5 mm² : C16 non protégé (Icc mini < 160 A), C10 conforme
  var b = boardTemplate(80), light = b.circuits.find(function(c){ return c.kind === 'light'; });
  light.length = 50;
  var d1 = designInstallation([], [], b), e1 = d1.checks.filter(function(c){ return c.level === 'err' && c.ref === light.id; }).map(function(c){ return c.msg; });
  var row1 = calcNote(d1).rows.find(function(x){ return x.id === light.id; });
  light.In = 10; var d2 = designInstallation([], [], b), e2 = d2.checks.filter(function(c){ return c.level === 'err' && c.ref === light.id; }).length;
  // prise de terre : 150 Ω refusée (AGCP 500 mA → 100 Ω), 40 Ω acceptée
  b.supply.ra = 150; var ra1 = designInstallation([], [], b).checks.some(function(c){ return c.level === 'err' && /Prise de terre/.test(c.msg); });
  b.supply.ra = 40; var d3 = designInstallation([], [], b), ra2 = d3.checks.some(function(c){ return /Prise de terre/.test(c.msg); });
  // triphasé : 3 conducteurs chargés, Iz = 15,5 A en 1,5 mm² → un 3P+N 16 A est refusé
  var bt = boardTemplate(120, { tri: true }); boardAddCircuit(bt, 'other', { name: 'Moteur', phase: '3P', In: 16, S: 1.5, P: 3000 });
  var dt = designInstallation([], [], bt), izErr = dt.checks.some(function(c){ return c.level === 'err' && /Iz = 15,5 A/.test(c.msg); });
  var svgs = calcNoteSVGs(dh, { title: 'T3' }), dxf = calcNoteDXF(dh, {}), csv = calcNoteCSV(dh);
  return { lm: lm, allOk: N.rows.every(function(x){ return x.ok; }) && N.errors === 0, icc: [r0.icc, icc], iz: r0.Iz, e1: e1, row1: row1, e2: e2, ra1: ra1, ra2: ra2, ra: calcNote(d3).ra, izErr: izErr,
    svg: svgs.length === 1 && svgs[0].indexOf('Note de calcul') > 0 && svgs[0].indexOf('Lmax') > 0 && svgs[0].indexOf('conforme') > 0,
    dxf: dxf.indexOf('CARTOUCHE') > 0 && dxf.indexOf('Icc mini') > 0, csv: csv.trim().split('\\n').length === dh.circuits.length + 1 };
})()`);
check('Longueur maximale protégée Lmax = 0,8·U0·S / (2·ρ·Im) : C16 1,5 mm² ≈ 37,5 m, C20 2,5 mm² = 50 m, C32 6 mm² = 75 m, courbe B × 2', near(r.lm[0], 37.5, 0.01) && near(r.lm[1], 50, 0.01) && near(r.lm[2], 75, 0.01) && near(r.lm[3], 75, 0.01), r.lm.map(function(v){ return v.toFixed(1); }).join(' · ') + ' m');
check('Note de calcul du T3 : tous les circuits conformes, Icc mini = 0,8·U0·S / (2·ρ·L), Iz 17,5 A en 1,5 mm²', r.allOk && near(r.icc[0], r.icc[1], 1e-9) && r.iz === 17.5, `${r.icc[0].toFixed(0)} A en bout de C1`);
check('Éclairage de 50 m en C16 refusé (Icc mini < 160 A), accepté en C10 ; 3P+N 16 A en 1,5 mm² refusé (Iz 15,5 A)', r.e1.length === 1 && /50,0 m > 38 m/.test(r.e1[0]) && !r.row1.okL && r.e2 === 0 && r.izErr, r.e1[0]);
check('Prise de terre : 150 Ω refusés (AGCP 500 mA → 100 Ω au plus), 40 Ω acceptés et reportés dans la note', r.ra1 && !r.ra2 && r.ra === 40);
check('Note de calcul : folio A3 SVG, DXF (calques TEXTES / CARTOUCHE) et tableur CSV', r.svg && r.dxf && r.csv);

// Schémas développés : une commande par pièce, d'après les interrupteurs du plan
r = run(`(function(){
  var h = buildHouse('r1'), d = designInstallation(h.components, h.wires), L = lightingControls(d, h.components, h.wires);
  var lamps = h.components.filter(function(c){ return LOADS[c.type] && LOADS[c.type].cls === 'light'; }).length;
  var drawn = L.reduce(function(s, g){ return s + g.lamps.length; }, 0);
  var kinds = {}; L.forEach(function(g){ kinds[g.kind] = (kinds[g.kind] || 0) + 1; });
  var tl = L.filter(function(g){ return g.kind === 'tl'; }), vv = L.filter(function(g){ return g.kind === 'vv'; })[0];
  var tlOk = tl.length > 0 && tl.every(function(g){ return g.switches.length >= 3 && g.ct.teleruptor && !g.tlAdvice; });
  var svgs = developedSVGs(d, { title: 'R+1' }, h.components, h.wires), dxf = developedDXF(d, {}, h.components, h.wires);
  var mat = materialList(h.components, h.wires, d).lines.find(function(l){ return /Télérupteur/.test(l.name); });
  // tableau sans plan : un schéma type par circuit d'éclairage (télérupteur si coché)
  var b = boardTemplate(90); b.circuits.find(function(c){ return c.kind === 'light'; }).teleruptor = true;
  var dt = designInstallation([], [], b), G = lightingControls(dt, [], []);
  return { lamps: lamps, drawn: drawn, kinds: kinds, tlOk: tlOk, vv: vv && vv.switches.length === 2, n: svgs.length, svg: svgs[0].indexOf('Va-et-vient') > 0 && svgs[0].indexOf('navettes') > 0 && svgs.join('').indexOf('KL') > 0,
    dxf: dxf.indexOf('SCHEMA') > 0, mat: mat ? mat.qty : 0, tls: tl.length, gen: G.length === dt.circuits.filter(function(c){ return c.kind === 'light'; }).length && G[0].kind === 'tl' && G[0].generic };
})()`);
check('Schémas développés du R+1 : chaque point lumineux dessiné, simple allumage, va-et-vient (2 commandes), télérupteur (3 commandes et plus)', r.drawn === r.lamps && r.kinds.sa > 0 && r.vv && r.tlOk, `${r.lamps} points · ${Object.keys(r.kinds).map(function(k){ return r.kinds[k] + ' ' + k; }).join(', ')}`);
check('Télérupteur posé au tableau pour 3 commandes (métré), folios A3 SVG et DXF (calque SCHEMA), schéma type sans plan', r.mat === r.tls && r.n >= 2 && r.svg && r.dxf && r.gen, `${r.mat} télérupteur(s) · ${r.n} folios`);

// Communication (VDI) : coffret en GTL, étoile catégorie 6 le long des goulottes
r = run(`(function(){
  var h = buildHouse('t5'), v = vdiDesign(h.components, h.wires), rj = h.components.filter(function(c){ return c.type === 'rj45'; });
  var gtl = h.components.find(function(c){ return c.type === 'gtl'; });
  // chaque lien est au moins aussi long que la distance à vol d'oiseau, remontées et lovage compris
  var longer = v.links.every(function(l){ var c = h.components.find(function(x){ return x.id === l.id; }); return l.len >= Math.hypot(c.x - gtl.x, c.y - gtl.y) / 100 + 1; });
  var rooms = v.links.map(function(l){ return l.room; }).join(',');
  var mat = materialList(h.components, h.wires, designInstallation(h.components, h.wires)).lines.filter(function(l){ return l.cat === 'Communication'; });
  var cable = mat.find(function(l){ return /catégorie 6/.test(l.name); });
  // lien trop long : prise RJ45 déplacée à 100 m du coffret, hors des goulottes
  var far = JSON.parse(JSON.stringify(rj[0])); far.id = 'far'; far.label = 'RJ9'; far.x = gtl.x + 9000; far.y = gtl.y;
  var v2 = vdiDesign(h.components.concat([far]), h.wires), err = v2.checks.find(function(c){ return c.level === 'err'; });
  var d = designInstallation(h.components, h.wires), svg = vdiSVGs(d, { title: 'T5' }, h.components, h.wires)[0], dxf = vdiDXF(d, {}, h.components, h.wires);
  return { ok: v.ok && v.links.length === rj.length && v.ports === rj.length && v.panel >= rj.length, longer: longer, rooms: rooms, total: v.total,
    mat: mat.length === 3 && cable.qty === Math.ceil(v.total * 1.1), err: err && err.msg, svg: svg.indexOf('Coffret de communication') > 0 && svg.indexOf('DTIo') > 0 && svg.indexOf('RJ1') > 0, dxf: dxf.indexOf('SCHEMA') > 0 };
})()`);
check('Communication : une prise RJ45 par port du coffret (GTL), liens mesurés sur les goulottes, remontées et lovage compris', r.ok && r.longer && /Séjour/.test(r.rooms), `${r.total.toFixed(0)} m · ${r.rooms}`);
check('Communication : lien de plus de 90 m refusé ; métré (coffret 2TV, câble catégorie 6 + 10 %, cordons) ; folio A3 SVG et DXF', /RJ9.*> 90 m/.test(r.err) && r.mat && r.svg && r.dxf, r.err);

// ---------------------------------------------------------------------------
group('Murs : placo, maçonnerie, implantation en 3D');
r = run(`(function(){
  var d = buildHouse('t3'), walls = d.wires.filter(function(w){ return w.kind === 'wall'; });
  var ext = walls.find(function(w){ return w.ext; }), int = walls.find(function(w){ return !w.ext; });
  var mExt = wallMaterial(ext), mInt = wallMaterial(int);
  // boîtes du métré : placo (cloisons), étanches à l'air (doublage des façades), maçonnerie
  var des = designInstallation(d.components, d.wires);
  var line = function(re){ var l = materialList(d.components, d.wires, des).lines.find(function(x){ return re.test(x.name); }); return l ? l.qty : 0; };
  var b0 = [line(/cloison sèche/), line(/étanche/), line(/maçonnerie/)];
  walls.forEach(function(w){ if (!w.ext) w.mat = 'brique'; });
  var b1 = [line(/cloison sèche/), line(/étanche/), line(/maçonnerie/)];
  // prise la plus proche d'un point : mur, côté, normale vers la pièce
  var sock = d.components.find(function(c){ return c.type === 'socket_wall'; }), nw = nearestWall(d.wires, sock.x, sock.y, 60);
  // 3D : matériaux et montants de placo (plus de faces), rayon de la caméra cohérent avec la projection
  walls.forEach(function(w){ delete w.mat; });
  var v = new Viz3D(__cv, { interactive: false });
  buildBoard(v, d.components, d.wires, SYMBOLS, { walls: 'cut' }); var f0 = v.faces.length;
  buildBoard(v, d.components, d.wires, SYMBOLS, { walls: 'cut', materials: true }); var f1 = v.faces.length;
  var studs = v.faces.filter(function(f){ return f.color && f.color[0] === 0xaa && f.color[1] === 0xb4 && f.color[2] === 0xc2; }).length;
  return { mExt: mExt, mInt: mInt, b0: b0, b1: b1, nw: !!nw && nw.d < 30 && Math.abs(Math.hypot(nw.nx, nw.ny) - 1) < 1e-9, f0: f0, f1: f1, studs: studs };
})()`);
check('Matériaux par défaut : cloison placo 72/48 à l’intérieur, parpaing + doublage placo en façade', r.mInt.mat === 'placo' && r.mInt.hollow && r.mExt.mat === 'parpaing' && r.mExt.doublage && r.mExt.hollow, `${r.mInt.label} · ${r.mExt.label}`);
check('Métré : boîtes cloison sèche, étanches à l’air (doublage RE 2020) et maçonnerie selon le mur', r.b0[0] > 0 && r.b0[1] > 0 && r.b0[2] === 0 && r.b1[0] === 0 && r.b1[2] === r.b0[0] && r.b1[1] === r.b0[1], `placo ${r.b0[0]} · étanches ${r.b0[1]} → maçonnerie ${r.b1[2]}`);
check('3D (implantation) : murs teintés par matériau, doublage côté pièce, montants de placo tous les 60 cm', r.f1 > r.f0 && r.studs > 20 && r.nw, `${r.studs} faces de montants`);

// Hauteurs de pose choisies (c.h en cm) : remontées de câble, 3D et contrôles NF
r = run(`(function(){
  var d = buildHouse('t3'), nf0 = checkNFC15100(d.components, d.wires);
  var sock = d.components.find(function(c){ return c.type === 'socket_wall'; }), sw = d.components.find(function(c){ return c.type === 'switch_sa'; });
  var len0 = designInstallation(d.components, d.wires).circuits.find(function(c){ return c.devices.indexOf(sock.id) >= 0; }).length;
  sock.h = 110; // prise au-dessus d'un plan de travail
  var len1 = designInstallation(d.components, d.wires).circuits.find(function(c){ return c.devices.indexOf(sock.id) >= 0; }).length;
  var v = new Viz3D(__cv, { interactive: false }); buildBoard(v, d.components, d.wires, SYMBOLS, { walls: 'cut' });
  var top = Math.max.apply(null, v.faces.filter(function(f){ return f.obj === sock.id; }).map(function(f){ return Math.max.apply(null, f.pts.map(function(p){ return p[1]; })); }));
  var onPlan = buildSVG(d.components, d.wires, SYMBOLS, {}).indexOf(sock.label + ' h110') > 0 && buildDXF(d.components, d.wires, SYMBOLS, {}).indexOf(sock.label + ' h110') > 0;
  sock.h = 3; sw.h = 150;
  var nf1 = checkNFC15100(d.components, d.wires);
  var eSock = nf1.global.find(function(g){ return g.compId === sock.id; }), wSw = nf1.global.find(function(g){ return g.compId === sw.id; });
  sock.h = 5; sw.h = 90; var nf2 = checkNFC15100(d.components, d.wires);
  return { h: [mountH({ type: 'switch_sa' }), mountH({ type: 'switch_sa', h: 90 }), mountH({ type: 'dcl' })], rise: len1 - len0, top: top, onPlan: onPlan,
    e: nf1.errors - nf0.errors, w: nf1.warnings - nf0.warnings, eSock: eSock && eSock.level, wSw: wSw && wSw.level, back: nf2.errors === nf0.errors && nf2.warnings === nf0.warnings };
})()`);
check('Hauteur de pose : 1,10 m par défaut pour un interrupteur, celle choisie sinon ; remontée de câble allongée', r.h.join() === '1.1,0.9,2.5' && near(r.rise, 0.8, 0.02), `+${r.rise.toFixed(2)} m pour une prise passée de 30 à 110 cm`);
check('3D : l’appareil est dessiné à la hauteur choisie ; plan SVG et DXF annotés (h110)', r.top > 100 && r.top < 125 && r.onPlan, `haut de la prise à ${r.top.toFixed(0)} cm`);
check('NF C 15-100 : axe de prise sous 5 cm refusé, commande hors 0,90–1,30 m signalée (PMR), limites acceptées', r.e === 1 && r.w === 1 && r.eSock === 'err' && r.wSw === 'warn' && r.back);

// Cuisine : 4 prises au-dessus du plan de travail
r = run(`(function(){
  var ok = HOUSE_TYPES.filter(function(T){ return T.key !== 'studio'; }).map(function(T){
    var d = buildHouse(T.key); return !checkNFC15100(d.components, d.wires).global.some(function(g){ return /plan de travail/.test(g.msg); });
  });
  var d = buildHouse('t3'), info = computeRooms(d.components, d.wires);
  var k = info.rooms.findIndex(function(R){ return R.type && R.type.key === 'cuisine'; });
  var counter = d.components.find(function(c){ return c.type === 'counter'; });
  var top = d.components.filter(function(c){ return c.type === 'socket_wall' && _distToFootprint(c.x, c.y, counter) < 8; });
  d.components = d.components.filter(function(c){ return c !== top[0]; });
  var msg = checkNFC15100(d.components, d.wires).global.find(function(g){ return /plan de travail/.test(g.msg); });
  // une prise ailleurs dans la cuisine, remontée à 1,10 m, compte pour le plan de travail
  var other = d.components.find(function(c){ return c.type === 'socket_wall' && roomAt(info, c.x, c.y) === k && _distToFootprint(c.x, c.y, counter) >= 8; });
  other.h = 110;
  var fixed = !checkNFC15100(d.components, d.wires).global.some(function(g){ return /plan de travail/.test(g.msg); });
  return { ok: ok.every(Boolean), top: top.length, msg: msg && msg.level + ' ' + msg.msg, fixed: fixed };
})()`);
check('Cuisine : 4 prises au-dessus du plan de travail dans chaque maison générée ; 3 refusées ; une prise à 1,10 m compte', r.ok && r.top === 4 && /^err Cuisine : 3 prises/.test(r.msg) && r.fixed, r.msg);

// Plan d'implantation : légende des symboles, repères de circuits (SVG, DXF)
r = run(`(function(){
  var d = buildHouse('t3'), des = designInstallation(d.components, d.wires), tags = circuitTags(des);
  var svg = buildSVG(d.components, d.wires, SYMBOLS, { title: 'T3', legend: true, tags: tags });
  var leg = planLegend(d.components, SYMBOLS), sockets = leg.find(function(l){ return l.type === 'socket_wall'; });
  var nSock = d.components.filter(function(c){ return c.type === 'socket_wall'; }).length;
  var tagged = d.components.filter(function(c){ return tags.map[c.id]; }).length, devs = des.circuits.reduce(function(s, c){ return s + c.devices.length; }, 0);
  var dxf = buildDXF(d.components, d.wires, SYMBOLS, { title: 'T3', tags: tags });
  var cLayer = (dxf.match(/\\r\\nCIRCUITS\\r\\n/g) || []).length;
  return { legend: svg.indexOf('Légende') > 0 && svg.indexOf('Circuits') > 0, sockets: sockets && sockets.count === nSock, tagged: tagged === devs, noArea: svg.indexOf('— m²') < 0, cLayer: cLayer, n: tags.list.length };
})()`);
check('Plan d’implantation : légende (symboles et quantités), repère de circuit sur chaque appareil, surfaces, calque DXF CIRCUITS', r.legend && r.sockets && r.tagged && r.noArea && r.cLayer > 20, `${r.n} circuits · ${r.cLayer} entités DXF`);

// ---------------------------------------------------------------------------
group('Éclairement (lux)');
r = run(`(function(){
  var W = function(a, b){ return { id: 'w' + a.x + a.y + b.x + b.y, kind: 'wall', points: [a, b] }; };
  var P = function(x, y){ return { x: x, y: y }; };
  // deux pièces de 4 × 4 m côte à côte ; plafonnier 40 W au centre de la première, applique 25 W dans la seconde
  var wires = [W(P(0,0), P(800,0)), W(P(800,0), P(800,400)), W(P(800,400), P(0,400)), W(P(0,400), P(0,0)), W(P(400,0), P(400,400))];
  var comps = [
    { id: 'r1', type: 'room', x: 200, y: 200, value: 'Chambre' }, { id: 'r2', type: 'room', x: 600, y: 200, value: 'Bureau' },
    { id: 'L1', type: 'dcl', x: 200, y: 200 },
  ];
  var A = lightingStudy(comps, wires);
  var at = function(L, x, y){ var gx = Math.round((x - L.x0) / L.step), gy = Math.round((y - L.y0) / L.step); return L.lux[gy * L.nx + gx]; };
  var ch = A.rooms.find(function(R){ return R.name === 'Chambre'; }), bu = A.rooms.find(function(R){ return R.name === 'Bureau'; });
  var h = 1.65, lm = 40 * LUX_EFFICACY, area = ch.area;
  var expect = lm / (Math.PI * h * h) + lm / (2 * area + 4.4 * Math.sqrt(area) * 2.5);
  comps.push({ id: 'L2', type: 'wall_light', x: 790, y: 200 });
  var B = lightingStudy(comps, wires), bu2 = B.rooms.find(function(R){ return R.name === 'Bureau'; });
  var d = buildHouse('t3'), before = lightingStudy(d.components, d.wires).rooms.filter(function(R){ return R.status !== 'ok'; }).map(function(R){ return R.name; });
  var fixes = HOUSE_TYPES.map(function(T){
    var doc = buildHouse(T.key), f = autoLighting(doc), L = lightingStudy(doc.components, doc.wires);
    var left = L.rooms.filter(function(R){ return R.status !== 'ok'; }).length;
    return { k: T.key, added: f.added, left: left, nf: checkNFC15100(doc.components, doc.wires).errors, ok: designInstallation(doc.components, doc.wires).ok };
  });
  return { under: at(A, 200, 200), expect: expect, corner: at(A, 30, 30), dark: bu.avg, lit: bu2.avg, wallUnder: at(B, 770, 200), ch: ch, before: before, fixes: fixes };
})()`);
check('Plafonnier 40 W (2 400 lm) à 2,5 m : sous la lampe E = Φ·h²/(π·d⁴) + réflexions', near(r.under, r.expect, r.expect * 0.02), `${r.under.toFixed(0)} lx attendus ${r.expect.toFixed(0)}`);
check('Éclairement qui décroît vers les angles ; la lumière reste dans sa pièce (portes fermées)', r.corner < r.under / 3 && r.dark === 0 && r.lit > 50, `angle ${r.corner.toFixed(0)} lx · pièce voisine ${r.dark} → ${r.lit.toFixed(0)} lx avec une applique`);
check('Chambre de 16 m² avec un plafonnier : objectif 100 lx atteint', r.ch.status === 'ok' && r.ch.target === 100 && r.ch.lamps === 1, `${r.ch.avg.toFixed(0)} lx`);
check('T3 généré : séjour et cuisine sous l’objectif (un seul point lumineux)', r.before.join() === 'Séjour,Cuisine', r.before.join(', '));
check('Compléter l’éclairage : plus aucune pièce sous l’objectif, installation toujours conforme', r.fixes.every(function(f){ return f.left === 0 && f.nf === 0 && f.ok; }), r.fixes.map(function(f){ return f.k + ' +' + f.added; }).join(' · '));

// ---------------------------------------------------------------------------
group('Éditeur 2D : tracés et calque');
{
  // contexte séparé : l'éditeur a besoin d'un faux navigateur (fenêtre, canevas, stockage)
  const store = {};
  const ctx2d = new Proxy({}, { get: (t, p) => (p in t ? t[p] : noop), set: (t, p, v) => { t[p] = v; return true; } });
  const eb = {
    Math, JSON, console, performance, TextEncoder, TextDecoder,
    window: { addEventListener: noop, devicePixelRatio: 1, open: () => null },
    document: { body: { classList: { contains: () => false } }, createElement: () => ({ getContext: () => ctx2d, style: {} }) },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
  };
  vm.createContext(eb);
  for (const f of ['symbols', 'netlist', 'plan', 'editor']) vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f + '.js'), 'utf8'), eb, { filename: f + '.js' });
  eb.__cv = {
    getContext: () => ctx2d, addEventListener: noop, setPointerCapture: noop, style: {}, width: 800, height: 600,
    parentElement: { getBoundingClientRect: () => ({ width: 800, height: 600 }) },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
  };
  const er = (code) => vm.runInContext(code, eb);
  r = er(`(function(){
    var ed = new Editor(__cv), out = {};
    ed.view = { x: 0, y: 0, scale: 1 };
    var ev = function(x, y){ return { clientX: x, clientY: y, button: 0, shiftKey: false, pointerType: 'mouse' }; };
    var click = function(x, y){ ed._down(ev(x, y)); ed._up(ev(x, y)); };
    var key = function(k){ ed._key({ key: k, target: { tagName: 'BODY' }, preventDefault: function(){}, ctrlKey: false, metaKey: false, altKey: false }); };
    // mur terminé au double-clic (le double-clic ajoute un point en double, retiré)
    ed.setTool('wall'); click(0, 0); click(200, 0); click(200, 100); click(200, 100); ed._dblclick(ev(200, 100));
    out.dbl = ed.wires.filter(function(w){ return w.kind === 'wall'; }).map(function(w){ return w.points.length; });
    // goulotte terminée par Entrée
    ed.setTool('conduit'); click(0, 200); click(300, 200); key('Enter');
    out.enter = ed.wires.filter(function(w){ return w.kind === 'conduit'; }).length;
    // contour de mur fermé en revenant au point de départ
    ed.setTool('wall'); click(400, 0); click(600, 0); click(600, 200); click(400, 200); click(400, 0);
    out.loop = ed.wireDraft === null && ed.wires.filter(function(w){ return w.kind === 'wall'; }).length;
    // calque : mise à l'échelle sur une cote connue (le premier point reste fixe)
    ed.underlay = { src: 'data:x', img: { naturalWidth: 1000, naturalHeight: 700, complete: true }, x: 0, y: 0, scale: 1, opacity: 0.5 };
    var k = ed.calibrateUnderlay({ x: 100, y: 630 }, { x: 900, y: 630 }, 10);
    out.calib = [k, ed.underlay.scale, ed.underlay.x, ed.underlay.y];
    out.saved = !!localStorage.getItem('electricad-underlay');
    ed.clearUnderlay(); out.cleared = ed.underlay === null && !localStorage.getItem('electricad-underlay');
    // règle : 3 m × 4 m → 5 m
    ed.setTool('measure'); ed._down(ev(1000, 1000)); ed._move(ev(1000 + 3 * PLAN_UNITS_PER_M, 1000 + 4 * PLAN_UNITS_PER_M)); ed._up(ev(1000 + 3 * PLAN_UNITS_PER_M, 1000 + 4 * PLAN_UNITS_PER_M));
    var L = ed.measureLength(ed.measure);
    out.ruler = [L.d, L.dx, L.dy, ed.measure.live];
    ed.setTool('select'); out.rulerGone = ed.measure === null;
    return out;
  })()`);
  check('Mur terminé au double-clic (points en double retirés), goulotte à Entrée', r.dbl.length === 1 && r.dbl[0] === 3 && r.enter === 1, JSON.stringify(r.dbl));
  check('Mur fermé en revenant au point de départ', r.loop === 2);
  check('Règle : 3 m × 4 m = 5,00 m, effacée en changeant d’outil', near(r.ruler[0], 5, 1e-9) && near(r.ruler[1], 3, 1e-9) && near(r.ruler[2], 4, 1e-9) && r.ruler[3] === false && r.rulerGone, r.ruler.slice(0, 3).join(' / '));
  const U = er('PLAN_UNITS_PER_M');
  check('Calque : 800 px = 10 m → échelle, premier point fixe, gardé puis retiré', near(r.calib[1], (10 * U) / 800, 1e-9) && near(r.calib[2], 100 - 100 * r.calib[1], 1e-9) && near(r.calib[3], 630 - 630 * r.calib[1], 1e-9) && r.saved && r.cleared, r.calib.map((v) => +v.toFixed(3)).join(' / '));
}

console.log(`\n${passed} réussis, ${failed} échoué${failed > 1 ? 's' : ''}`);
process.exit(failed ? 1 : 0);
