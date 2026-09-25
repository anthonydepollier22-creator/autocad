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
  rcd: { AC25: 42, AC40: 46, A: 78, F: 135 },
  breaker: { 2: 9, 10: 8, 16: 8, 20: 8.5, 32: 11.5, 40: 15 },
  comb: 8.5,            // peigne d'alimentation, par rangée
  earthBar: 14,         // bornier de terre / répartiteur
  earthKit: 48,         // piquet de terre, câble 16 mm², barrette de coupure
  cable: { 1.5: 0.82, 2.5: 1.18, 6: 3.25, 10: 5.6 }, // gaine ICTA préfilée 3G…, €/m
  conduit: 4.6,         // goulotte / plinthe technique, €/m
  socket: 4.9, switchSa: 5.2, switchVv: 6.4, dcl: 3.6, rj45: 12.5, cableOut32: 9.5, cableOut20: 6.5, smoke: 19.9,
  box: 0.65, boxDcl: 3.2,
  gtl: 95,
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
  const count = (t) => components.filter((c) => c.type === t).length;
  const P = MAT_PRICES;

  // --- Tableau ---------------------------------------------------------------
  if (design && design.ok) {
    const modules = design.rcds.length * 2 + design.circuits.length + design.reserve;
    const rows = Math.max(1, Math.ceil(modules / 13));
    add('Tableau', `Coffret ${rows} rangée${rows > 1 ? 's' : ''} (13 modules)`, 1, 'u', P.rowPanel[Math.min(rows, 5)], `${modules} modules dont ${design.reserve} de réserve`);
    const rcdKind = {};
    for (const r of design.rcds) {
      const k = r.type === 'AC' ? (r.In <= 25 ? 'AC25' : 'AC40') : r.type;
      rcdKind[k] = (rcdKind[k] || 0) + 1;
    }
    const rcdName = { AC25: 'Interrupteur différentiel 25 A 30 mA type AC', AC40: 'Interrupteur différentiel 40 A 30 mA type AC', A: 'Interrupteur différentiel 40 A 30 mA type A', F: 'Interrupteur différentiel 40 A 30 mA type F' };
    for (const k of ['AC25', 'AC40', 'A', 'F']) add('Tableau', rcdName[k], rcdKind[k], 'u', P.rcd[k]);
    const byIn = {};
    for (const c of design.circuits) byIn[c.In] = (byIn[c.In] || 0) + 1;
    for (const In of Object.keys(byIn).map(Number).sort((a, b) => a - b)) {
      add('Tableau', `Disjoncteur phase + neutre ${In} A courbe C`, byIn[In], 'u', P.breaker[In] || 9);
    }
    add('Tableau', 'Peigne d’alimentation', rows, 'u', P.comb);
    add('Tableau', 'Bornier de terre et répartiteur', 1, 'u', P.earthBar);
    add('Tableau', 'Prise de terre : piquet, câble 16 mm², barrette', 1, 'lot', P.earthKit);

    // --- Câbles et conduits : longueurs des circuits + 10 % de chutes --------
    const bySection = {};
    for (const c of design.circuits) bySection[c.S] = (bySection[c.S] || 0) + c.length;
    for (const S of Object.keys(bySection).map(Number).sort((a, b) => a - b)) {
      add('Câbles et conduits', `Gaine ICTA préfilée 3G${String(S).replace('.', ',')} mm²`, Math.ceil(bySection[S] * 1.1), 'm', P.cable[S] || 1.2, `${Math.round(bySection[S])} m mesurés + 10 %`);
    }
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
  add('Appareillage', 'Point de centre DCL (douille + fiche)', count('dcl') + count('wall_light'), 'u', P.dcl);
  add('Appareillage', 'Prise RJ45 grade 2TV', count('rj45'), 'u', P.rj45);
  add('Appareillage', 'Sortie de câble 32 A (plaque)', count('cooktop'), 'u', P.cableOut32);
  add('Appareillage', 'Sortie de câble 20 A (chauffe-eau, radiateurs)', count('water_heater') + count('radiator'), 'u', P.cableOut20);
  add('Appareillage', 'Détecteur de fumée (DAAF)', count('smoke_detector'), 'u', P.smoke);
  const boxes = count('socket_wall') + special20 + count('switch_sa') + count('switch_vv_wall') + count('rj45') + count('cooktop') + count('water_heater') + count('radiator');
  add('Appareillage', 'Boîte d’encastrement', boxes, 'u', P.box);
  add('Appareillage', 'Boîte DCL de plafond', count('dcl'), 'u', P.boxDcl);

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
