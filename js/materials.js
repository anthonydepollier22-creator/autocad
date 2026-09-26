/*
 * materials.js — Liste du matériel électrique et estimation du budget,
 * déduites de l'installation conçue (install.js) et du plan.
 *
 * Prix indicatifs TTC (entrée de gamme, grande surface de bricolage, 2026),
 * hors main-d'œuvre. Le disjoncteur de branchement (AGCP) et le compteur
 * sont fournis par le gestionnaire de réseau : ils n'y figurent pas.
 */

const MAT_PRICES = {
  rowPanel: [0, 38, 62, 88, 118, 150],       // coffret selon le nombre de rangées de 13 modules
  rcd: { AC25: 42, AC40: 46, AC63: 62, A: 78, A63: 95, 'A-SI': 98, F: 135, B: 290 },
  breaker: { 2: 9, 6: 9, 10: 8, 16: 8, 20: 8.5, 25: 10, 32: 11.5, 40: 15, 50: 24, 63: 28 },
  surge: 69, contactor: 22, teleruptor: 18, shed: 95, timer: 34,
  tri: { rcd: 2.6, breaker3P: 45, surge: 145 }, // triphasé : ID 4P (≈ 2,6 × le prix 2P), disjoncteurs 3P+N
  isolator: { 40: 18, 63: 24, 80: 45, 100: 55 },
  ddr: { AC: 48, A: 68, 'A-SI': 88, F: 125, B: 320 },
  pvIsolator: 38, pvLabel: 6, tpc: 2.2, mesh: 0.6, // fourreau TPC rouge Ø 63, grillage avertisseur (€/m) // interrupteur-sectionneur AC près de l'onduleur, étiquettes « deux sources »  // disjoncteur différentiel 1P+N 30 mA (3P+N : × 2,5) // interrupteur-sectionneur de tête d'un tableau divisionnaire (2P)
  comb: 8.5,            // peigne d'alimentation, par rangée
  link: { 10: 2.9, 16: 4.4, 25: 6.8 }, // conducteur de liaison AGCP → tableau, €/m
  earthBar: 14,         // bornier de terre / répartiteur
  earthKit: 48,         // piquet de terre, câble 16 mm², barrette de coupure
  cable: { 1.5: 0.82, 2.5: 1.18, 4: 2.1, 6: 3.25, 10: 5.6, 16: 8.9 }, // gaine ICTA préfilée 3G…, €/m
  conduit: 4.6,         // goulotte / plinthe technique, €/m
  socket: 4.9, switchSa: 5.2, switchVv: 6.4, push: 5.9, dcl: 3.6, rj45: 12.5, cableOut32: 9.5, cableOut20: 6.5, smoke: 19.9,
  box: 0.65, boxDcl: 3.2, boxPlaco: 0.95, boxAir: 1.9, // boîtes : maçonnerie, cloison sèche, étanche à l'air (doublage)
  gtl: 95,
  vdiBox: 185, cat6: 0.78, patch: 3.5, // coffret de communication grade 2TV, câble catégorie 6 (€/m), cordon
  // équipements (facultatifs)
  radiator: 240, vmc: 115, evCharger: 690,
};

function materialList(components, wires, design) {
  const lines = [];
  const add = (cat, name, qty, unit, price, note) => {
    if (!qty) return;
    const q = Math.round(qty * 100) / 100;
    lines.push({ cat, name, qty: q, unit, price, total: Math.round(q * price * 100) / 100, note: note || '' });
  };
  const pushIds = new Set(); // repères des commandes câblées en poussoirs (télérupteur)
  const count = (t) => components.filter((c) => c.type === t && !pushIds.has(c.label || c.id)).length;
  const P = MAT_PRICES;

  // --- Tableau ---------------------------------------------------------------
  if (design && design.ok) {
    // coffret : rangées de la face avant (board.js), 20 % de réserve comprise
    const M = typeof boardModules === 'function' ? boardModules(design) : null;
    const rows = M ? M.rowsCount : Math.max(1, Math.ceil((design.rcds.length * 2 + design.circuits.length + design.reserve) / 13));
    const modules = M ? M.used : design.rcds.length * 2 + design.circuits.length;
    add('Tableau', `Coffret ${rows} rangée${rows > 1 ? 's' : ''} (13 modules)`, 1, 'u', P.rowPanel[Math.min(rows, 5)], `${modules} modules occupés sur ${rows * 13}`);
    const rcdKind = {};
    for (const r of design.rcds) {
      const k = r.type === 'AC' ? (r.In <= 25 ? 'AC25' : r.In >= 63 ? 'AC63' : 'AC40') : r.type === 'A' && r.In >= 63 ? 'A63' : r.type;
      rcdKind[k] = (rcdKind[k] || 0) + 1;
    }
    const rcdName = {
      AC25: 'Interrupteur différentiel 25 A 30 mA type AC', AC40: 'Interrupteur différentiel 40 A 30 mA type AC', AC63: 'Interrupteur différentiel 63 A 30 mA type AC',
      A: 'Interrupteur différentiel 40 A 30 mA type A', A63: 'Interrupteur différentiel 63 A 30 mA type A', 'A-SI': 'Interrupteur différentiel 40 A 30 mA type A-SI (haute immunité)', F: 'Interrupteur différentiel 40 A 30 mA type F', B: 'Interrupteur différentiel 40 A 30 mA type B',
    };
    const tri = design.supply && design.supply.phases === 3;
    for (const k of ['AC25', 'AC40', 'AC63', 'A', 'A63', 'A-SI', 'F', 'B']) add('Tableau', rcdName[k].replace('différentiel', tri ? 'différentiel 4P' : 'différentiel'), rcdKind[k], 'u', tri ? Math.round(P.rcd[k] * P.tri.rcd) : P.rcd[k]);
    const byIn = {}, byIn3 = {};
    const ddr = {}; // disjoncteurs différentiels : un appareil par circuit, compté à part
    for (const c of design.circuits) {
      if (c.ddr) { const k = `${c.phase === '3P' ? '3P+N' : '1P+N'} ${c.In} A 30 mA type ${c.ddr}`; ddr[k] = ddr[k] || { n: 0, price: Math.round(P.ddr[c.ddr] * (c.phase === '3P' ? 2.5 : 1)) }; ddr[k].n++; continue; }
      const m = c.phase === '3P' ? byIn3 : byIn; m[c.In] = (m[c.In] || 0) + 1;
    }
    for (const k of Object.keys(ddr).sort()) add('Tableau', `Disjoncteur différentiel ${k}`, ddr[k].n, 'u', ddr[k].price);
    if (design.supply && design.supply.surge) {
      add('Tableau', tri ? 'Parafoudre type 2 (triphasé)' : 'Parafoudre type 2 (monophasé)', 1, 'u', tri ? P.tri.surge : P.surge);
      const m = tri ? byIn3 : byIn; m[10] = (m[10] || 0) + 1; // son disjoncteur de déconnexion
    }
    for (const In of Object.keys(byIn3).map(Number).sort((a, b) => a - b)) add('Tableau', `Disjoncteur 3P+N ${In} A courbe C`, byIn3[In], 'u', P.tri.breaker3P);
    if (design.supply && design.supply.shed) add('Tableau', `Délesteur ${Math.min(4, Math.max(1, design.circuits.filter((c) => c.kind === 'heating').length))} voie(s) (fil pilote)`, 1, 'u', P.shed, 'pilote les circuits de chauffage');
    add('Tableau', 'Contacteur jour / nuit 20 A (heures creuses)', design.circuits.filter((c) => c.contactor && c.contactor !== 'ih').length, 'u', P.contactor);
    add('Tableau', 'Interrupteur horaire modulaire (programmation journalière)', design.circuits.filter((c) => c.contactor === 'ih').length, 'u', P.timer);
    // un télérupteur par éclairage à poussoirs (pièce à trois commandes ou plus), un au moins par circuit coché
    const tlRooms = typeof lightingControls === 'function' ? lightingControls(design, components, wires).filter((g) => g.kind === 'tl' && !g.generic) : [];
    add('Tableau', 'Télérupteur 16 A', Math.max(design.circuits.filter((c) => c.teleruptor).length, tlRooms.length), 'u', P.teleruptor);
    for (const g of tlRooms) for (const ref of g.switches) pushIds.add(ref);
    for (const In of Object.keys(byIn).map(Number).sort((a, b) => a - b)) {
      add('Tableau', `Disjoncteur phase + neutre ${In} A courbe C`, byIn[In], 'u', P.breaker[In] || 9);
    }
    add('Tableau', 'Peigne d’alimentation', rows, 'u', P.comb);
    if (typeof boardLinkSection === 'function' && design.agcp) {
      const S = boardLinkSection(design.agcp.setting), n = tri ? 4 : 2; // phase(s) + neutre, 1,5 m chacun
      add('Tableau', `Conducteurs de liaison AGCP → tableau ${S} mm² (H07V-R)`, n * 1.5, 'm', P.link[S] || 4, `${n} conducteurs de 1,5 m`);
    }
    add('Tableau', 'Bornier de terre et répartiteur', 1, 'u', P.earthBar);
    // Production photovoltaïque (côté alternatif) : sectionnement près de l'onduleur, signalisation des deux sources
    const pv = design.circuits.filter((c) => c.kind === 'pv');
    for (const c of pv) add('Tableau', `Interrupteur-sectionneur AC ${c.phase === '3P' ? '4P' : '2P'} ${Math.max(c.In, 20)} A (près de l’onduleur ${c.id})`, 1, 'u', c.phase === '3P' ? P.pvIsolator * 2 : P.pvIsolator);
    if (pv.length) add('Tableau', 'Étiquettes « Attention — présence de deux sources de tension »', 2, 'u', P.pvLabel, 'tableau et coffret de comptage');
    // Tableaux divisionnaires : coffret, interrupteur-sectionneur de tête, peignes, bornier de terre
    for (const T of design.panels || []) {
      const MP = typeof boardModules === 'function' ? boardModules(design, T.id) : null;
      if (!MP) break;
      const f = T.feeder, four = f.phase === '3P', In = boardSubSwitch(f.In);
      add('Tableau', `Coffret ${T.ref} ${MP.rowsCount} rangée${MP.rowsCount > 1 ? 's' : ''} (13 modules) — ${T.name}`, 1, 'u', P.rowPanel[Math.min(MP.rowsCount, 5)], `${MP.used} modules occupés sur ${MP.rowsCount * 13}`);
      add('Tableau', `Interrupteur-sectionneur ${four ? '4P' : '2P'} ${In} A (tête ${T.ref})`, 1, 'u', Math.round((P.isolator[In] || 24) * (four ? 2.2 : 1)));
      add('Tableau', `Peigne d’alimentation (${T.ref})`, MP.rowsCount, 'u', P.comb);
      add('Tableau', `Bornier de terre (${T.ref})`, 1, 'u', P.earthBar);
    }
    add('Tableau', 'Prise de terre : piquet, câble 16 mm², barrette', 1, 'lot', P.earthKit);

    // --- Câbles et conduits : longueurs des circuits + 10 % de chutes --------
    const bySection = {};
    for (const c of design.circuits) if (c.phase !== '3P' && c.kind !== 'sub' && !c.buried) bySection[c.S] = (bySection[c.S] || 0) + c.length;
    for (const S of Object.keys(bySection).map(Number).sort((a, b) => a - b)) {
      add('Câbles et conduits', `Gaine ICTA préfilée 3G${String(S).replace('.', ',')} mm²`, Math.ceil(bySection[S] * 1.1), 'm', P.cable[S] || 1.2, `${Math.round(bySection[S])} m mesurés + 10 %`);
    }
    const bySection5 = {};
    for (const c of design.circuits) if (c.phase === '3P' && c.kind !== 'sub') bySection5[c.S] = (bySection5[c.S] || 0) + c.length;
    for (const S of Object.keys(bySection5).map(Number).sort((a, b) => a - b)) {
      add('Câbles et conduits', `Câble U1000 R2V 5G${String(S).replace('.', ',')} mm² (triphasé)`, Math.ceil(bySection5[S] * 1.1), 'm', (P.cable[S] || 1.2) * 1.6, `${Math.round(bySection5[S])} m mesurés + 10 %`);
    }
    // ligne de chaque tableau divisionnaire : câble rigide (enterré sous fourreau TPC vers une annexe)
    for (const c of design.circuits.filter((x) => (x.kind === 'sub' || x.buried) && !(x.phase === '3P' && x.kind !== 'sub'))) {
      const five = c.phase === '3P';
      add('Câbles et conduits', `Câble U1000 R2V ${five ? '5G' : '3G'}${String(c.S).replace('.', ',')} mm² (${c.kind === 'sub' ? 'ligne ' + (c.panelRef || 'TD') : c.id + ' ' + c.name})`, Math.ceil(Math.round(c.length * 110) / 100), 'm', Math.round((P.cable[c.S] || 1.2) * (five ? 1.6 : 1.3) * 100) / 100, `${Math.round(c.length)} m + 10 %${c.buried ? ' ; enterré' : ' ; sous fourreau TPC rouge s’il est enterré'}`);
    }
    // liaisons enterrées : fourreau TPC rouge et grillage avertisseur (0,50 m de profondeur au moins)
    const bur = design.circuits.filter((c) => c.buried).reduce((s, c) => s + c.length, 0);
    add('Câbles et conduits', 'Fourreau TPC rouge Ø 63 (liaison enterrée)', Math.ceil(bur * 1.1), 'm', P.tpc, 'tranchée de 0,50 m au moins');
    add('Câbles et conduits', 'Grillage avertisseur rouge', Math.ceil(bur * 1.1), 'm', P.mesh);
  }
  const conduitLen = wires.filter((w) => w.kind === 'conduit').reduce((s, w) => {
    if (w.riser) return s + (w.len || 300); // montée d'étage : hauteur réelle, pas l'écart entre les plans
    for (let i = 1; i < w.points.length; i++) s += Math.hypot(w.points[i].x - w.points[i - 1].x, w.points[i].y - w.points[i - 1].y);
    return s;
  }, 0) / PLAN_UNITS_PER_M;
  add('Câbles et conduits', 'Goulotte / plinthe technique', Math.ceil(conduitLen), 'm', P.conduit);
  add('Câbles et conduits', 'Gaine technique logement (GTL)', count('gtl'), 'u', P.gtl);

  // --- Appareillage --------------------------------------------------------------
  const special20 = ['washer', 'dishwasher', 'dryer', 'oven'].reduce((s, t) => s + count(t), 0);
  add('Appareillage', 'Prise 2P+T 16 A (mécanisme + plaque)', count('socket_wall') + special20, 'u', P.socket, special20 ? `dont ${special20} spécialisée${special20 > 1 ? 's' : ''}` : '');
  add('Appareillage', 'Interrupteur simple allumage', count('switch_sa'), 'u', P.switchSa);
  add('Appareillage', 'Interrupteur va-et-vient', count('switch_vv_wall'), 'u', P.switchVv);
  add('Appareillage', 'Bouton poussoir (télérupteur)', pushIds.size, 'u', P.push);
  add('Appareillage', 'Point de centre DCL (douille + fiche)', count('dcl') + count('wall_light'), 'u', P.dcl);
  add('Appareillage', 'Prise RJ45 grade 2TV', count('rj45'), 'u', P.rj45);
  add('Appareillage', 'Sortie de câble 32 A (plaque)', count('cooktop'), 'u', P.cableOut32);
  add('Appareillage', 'Sortie de câble 20 A (chauffe-eau, radiateurs)', count('water_heater') + count('radiator'), 'u', P.cableOut20);
  add('Appareillage', 'Détecteur de fumée (DAAF)', count('smoke_detector'), 'u', P.smoke);
  // Boîtes d'encastrement selon le mur : cloison sèche (placo, ossature bois), doublage
  // d'un mur extérieur (boîte étanche à l'air, RE 2020) ou maçonnerie
  const BOXED = new Set(['socket_wall', 'switch_sa', 'switch_vv_wall', 'rj45', 'cooktop', 'water_heater', 'radiator', 'washer', 'dishwasher', 'dryer', 'oven']);
  const box = { placo: 0, air: 0, mac: 0 };
  for (const c of components) {
    if (!BOXED.has(c.type)) continue;
    const nw = typeof nearestWall === 'function' ? nearestWall(wires, c.x, c.y, 60) : null;
    const m = nw ? wallMaterial(nw.w) : null;
    if (m && m.doublage) box.air++; else if (m && m.hollow) box.placo++; else box.mac++;
  }
  add('Appareillage', 'Boîte d’encastrement cloison sèche (placo) Ø 67', box.placo, 'u', P.boxPlaco);
  add('Appareillage', 'Boîte d’encastrement étanche à l’air (doublage, RE 2020)', box.air, 'u', P.boxAir);
  add('Appareillage', 'Boîte d’encastrement maçonnerie', box.mac, 'u', P.box);
  add('Appareillage', 'Boîte DCL de plafond', count('dcl'), 'u', P.boxDcl);

  // --- Communication -----------------------------------------------------------
  // coffret en GTL, câblage en étoile catégorie 6 (longueurs mesurées)
  const vdi = typeof vdiDesign === 'function' && count('rj45') ? vdiDesign(components, wires) : null;
  if (vdi && vdi.ok) {
    add('Communication', `Coffret de communication grade 2TV (brassage ${vdi.panel} ports)`, 1, 'u', P.vdiBox, 'box opérateur fournie par l’opérateur');
    add('Communication', 'Câble catégorie 6 grade 2TV (4 paires)', Math.ceil(vdi.total * 1.1), 'm', P.cat6, `${Math.round(vdi.total)} m mesurés + 10 %`);
    add('Communication', 'Cordon de brassage RJ45', vdi.ports, 'u', P.patch);
  }

  // --- Équipements (facultatifs, souvent achetés à part) -------------------------
  add('Équipements', 'Radiateur à inertie 1 000 W', count('radiator'), 'u', P.radiator);
  add('Équipements', 'VMC simple flux hygroréglable', count('vmc'), 'u', P.vmc);
  add('Équipements', 'Borne de recharge 7,4 kW', count('ev_charger'), 'u', P.evCharger);

  const sum = (f) => Math.round(lines.filter(f).reduce((s, l) => s + l.total, 0) * 100) / 100;
  return {
    lines,
    material: sum((l) => l.cat !== 'Équipements'),
    equipment: sum((l) => l.cat === 'Équipements'),
  };
}

// Export tableur (séparateur « ; », virgule décimale : ouvre proprement dans Excel en français)
function materialCSV(list) {
  const num = (v) => String(v).replace('.', ',');
  let csv = 'Catégorie;Article;Quantité;Unité;Prix unitaire (€);Total (€);Remarque\n';
  for (const l of list.lines) csv += `"${l.cat}";"${l.name}";${num(l.qty)};${l.unit};${num(l.price.toFixed(2))};${num(l.total.toFixed(2))};"${l.note}"\n`;
  csv += `;"Matériel électrique";;;;${num(list.material.toFixed(2))};\n`;
  csv += `;"Équipements";;;;${num(list.equipment.toFixed(2))};\n`;
  return csv;
}
