/*
 * dossier.js — « Dossier du projet » : un document imprimable (ou PDF) qui
 * réunit le plan coté, le contrôle NF C 15-100, le schéma unifilaire et les
 * circuits, le matériel et le budget, la vue 3D et la journée type.
 */
function buildDossier(o) {
  const esc = (s) => String(s === undefined || s === null ? '' : s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const num = (v, d) => Number(v).toLocaleString('fr-FR', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 });
  const eur = (v) => num(v, 2) + ' €';
  const title = (o.meta && o.meta.title) || 'Installation électrique';
  const author = (o.meta && o.meta.author) || '';
  const date = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  const d = o.design, rep = o.report;
  const area = rep && rep.rooms ? rep.rooms.reduce((s, r) => s + (r.area || 0), 0) : 0;
  let h = '';

  // En-tête et chiffres clés
  const kpis = [];
  if (rep && rep.rooms.length) kpis.push(['Surface', num(area, 1) + ' m²'], ['Pièces', rep.rooms.length]);
  if (d && d.ok) {
    kpis.push(['Circuits', `${d.circuits.length} + ${d.reserve} en réserve`], ['Différentiels 30 mA', d.rcds.length],
      ['Abonnement', d.agcp.kva + ' kVA'], ['Puissance installée', num(d.installed / 1000, 1) + ' kW'],
      ['Puissance probable', num(d.probable / 1000, 1) + ' kW'], ['Câble', num(d.cableTotal) + ' m']);
  }
  if (rep && rep.hasPlan) kpis.push(['NF C 15-100', rep.ok ? 'Conforme' : `${rep.errors} erreur(s), ${rep.warnings} point(s) à vérifier`]);
  h += `<header class="cover"><div class="brand">Électri<b>CAD</b></div><h1>${esc(title)}</h1>` +
    `<p class="sub">Dossier de l’installation électrique${author ? ' · ' + esc(author) : ''} · ${esc(date)}</p>` +
    `<dl class="kpis">${kpis.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl></header>`;

  // Vues 3D
  if (o.images && o.images.length) {
    h += '<section><h2>Vues 3D</h2><div class="shots">' +
      o.images.map((im) => `<figure><img src="${im.src}" alt="${esc(im.label)}"><figcaption>${esc(im.label)}</figcaption></figure>`).join('') + '</div></section>';
  }

  // Plan
  if (o.planSVG) h += `<section class="page"><h2>Plan</h2><div class="svg">${o.planSVG}</div></section>`;

  // Norme
  if (rep && rep.hasPlan) {
    const st = { ok: 'Conforme', warn: 'À vérifier', err: 'Non conforme' };
    h += '<section class="page"><h2>Contrôle NF C 15-100</h2><table><thead><tr><th>Pièce</th><th class="n">Surface</th><th class="n">Prises</th><th class="n">Éclairage</th><th class="n">Commandes</th><th>Statut</th><th>Remarques</th></tr></thead><tbody>';
    for (const r of rep.rooms) {
      h += `<tr><td>${esc(r.name)}</td><td class="n">${num(r.area || 0, 1)} m²</td><td class="n">${r.sockets}${r.socketsReq !== null && r.socketsReq !== undefined ? ' / ' + r.socketsReq : ''}</td><td class="n">${r.lights}</td><td class="n">${r.switches}</td>` +
        `<td class="st ${r.status}">${st[r.status] || ''}</td><td class="small">${esc(r.msgs.join(' ; '))}</td></tr>`;
    }
    h += '</tbody></table><ul class="checks">' + rep.global.map((g) => `<li class="${g.level}">${esc(g.msg)}</li>`).join('') + '</ul></section>';
  }

  // Tableau : unifilaire + circuits
  if (d && d.ok) {
    h += `<section class="page"><h2>Tableau électrique</h2>${o.unifilarSVG ? `<div class="svg">${o.unifilarSVG}</div>` : ''}`;
    h += '<table><thead><tr><th>Circuit</th><th>Pièces</th><th class="n">Protection</th><th class="n">Section</th><th class="n">Longueur</th><th class="n">ΔU</th><th>Différentiel</th></tr></thead><tbody>';
    for (const c of d.circuits) {
      h += `<tr><td><b>${esc(c.id)}</b> ${esc(c.name)}</td><td class="small">${esc(c.rooms)}</td><td class="n">${c.In} A</td><td class="n">${num(c.S, c.S % 1 ? 1 : 0)} mm²</td><td class="n">${num(c.length, 1)} m</td>` +
        `<td class="n ${c.ok ? '' : 'bad'}">${num(c.dUpct, 1)} %</td><td>${esc(c.rcd)}</td></tr>`;
    }
    h += '</tbody></table>';
    if (d.issues.length) h += '<ul class="checks">' + d.issues.map((i) => `<li class="${i.level}">${esc(i.msg)}</li>`).join('') + '</ul>';
    h += '</section>';
  }

  // Matériel et budget
  if (o.materials && o.materials.lines.length) {
    const m = o.materials;
    h += '<section class="page"><h2>Matériel et budget</h2><table><thead><tr><th>Article</th><th class="n">Quantité</th><th class="n">Prix unitaire</th><th class="n">Total</th></tr></thead><tbody>';
    let cat = null;
    for (const l of m.lines) {
      if (l.cat !== cat) { cat = l.cat; h += `<tr class="cat"><td colspan="4">${esc(cat)}</td></tr>`; }
      h += `<tr><td>${esc(l.name)}${l.note ? `<span class="small"> — ${esc(l.note)}</span>` : ''}</td><td class="n">${num(l.qty, l.qty % 1 ? 1 : 0)} ${esc(l.unit)}</td><td class="n">${eur(l.price)}</td><td class="n">${eur(l.total)}</td></tr>`;
    }
    h += `<tr class="tot"><td colspan="3">Matériel électrique</td><td class="n">${eur(m.material)}</td></tr><tr class="tot"><td colspan="3">Équipements (facultatif)</td><td class="n">${eur(m.equipment)}</td></tr></tbody></table>` +
      '<p class="small">Prix indicatifs TTC (entrée de gamme), hors main-d’œuvre. Disjoncteur de branchement et compteur fournis par le gestionnaire de réseau.</p></section>';
  }

  // Journée type
  if (o.day && o.day.acc && o.day.acc.total > 0) {
    const a = o.day.acc, c = dayCost(a);
    const sums = DAY_CATS.map((k) => a.bins.reduce((s, b) => s + b[k.key], 0));
    h += `<section class="page"><h2>Journée type (${esc(DAY_SEASONS[o.day.season].label.toLowerCase())})</h2>` + dayChartSVG(a) +
      '<table class="half"><tbody>' + DAY_CATS.map((k, i) => `<tr><td><i class="sw" style="background:${DAY_SVG_COLORS[i]}"></i>${esc(k.name)}</td><td class="n">${num(sums[i], 1)} kWh</td></tr>`).join('') +
      (a.pv > 0 ? `<tr><td><i class="sw line"></i>Production solaire</td><td class="n">${num(a.pv, 1)} kWh</td></tr>` : '') + '</tbody></table>' +
      `<p><b>${num(a.total, 1)} kWh</b> consommés · <b>${eur(c.base)}</b> en tarif base, <b>${eur(c.hphc)}</b> en heures creuses (${Math.round((a.hc / a.total) * 100)} % la nuit) · pointe <b>${num(a.peak.P / 1000, 1)} kW</b>` +
      (a.pv > 0 ? ` · solaire : ${num(a.pv, 1)} kWh produits, ${Math.round((a.self / a.pv) * 100)} % autoconsommés, ${eur(c.saving)} économisés` : '') + '.</p></section>';
  }

  // Bilan annuel (deux journées types étendues à l'année)
  if (o.year && o.year.total > 0) {
    const y = o.year, int = (v) => Math.round(v).toLocaleString('fr-FR');
    h += '<section><h2>Bilan annuel (estimation)</h2><table class="half"><tbody>' +
      DAY_CATS.map((k, i) => (y.cats[k.key] > 0.5 ? `<tr><td><i class="sw" style="background:${DAY_SVG_COLORS[i]}"></i>${esc(k.name)}</td><td class="n">${int(y.cats[k.key])} kWh</td><td class="n">${Math.round((y.cats[k.key] / y.total) * 100)} %</td></tr>` : '')).join('') +
      `<tr class="tot"><td>Total</td><td class="n">${int(y.total)} kWh</td><td></td></tr></tbody></table>` +
      `<table class="half"><tbody><tr><td>Tarif base, abonnement ${y.kva} kVA compris</td><td class="n">${int(y.cost.base)} €/an</td><td class="n">≈ ${int(y.cost.base / 12)} €/mois</td></tr>` +
      `<tr><td>Heures creuses, abonnement compris</td><td class="n">${int(y.cost.hphc)} €/an</td><td class="n">≈ ${int(y.cost.hphc / 12)} €/mois</td></tr></tbody></table>` +
      (y.pv > 0 ? `<p>Solaire : ${int(y.pv)} kWh produits par an, ${int(y.self)} kWh consommés sur place (${Math.round((y.self / y.pv) * 100)} %), ${int(y.cost.saving)} € économisés, ${int(y.surplus)} kWh injectés sur le réseau.</p>` : '') +
      `<p class="small">Une journée d’hiver × ${y.days.hiver} jours (octobre → avril) et une d’été × ${y.days.ete} jours (mai → septembre), journées dégagées ; tarifs réglementés 2026 indicatifs.</p></section>`;
  }

  h += '<footer>Document produit par ÉlectriCAD — calculs simplifiés à visée pédagogique : ce dossier ne remplace ni l’étude d’un électricien qualifié ni l’attestation de conformité du Consuel.</footer>';

  const css = `@page{size:A4;margin:14mm}*{box-sizing:border-box}body{margin:0;font:11pt/1.45 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#17202c}
header.cover{border:2px solid #17202c;padding:18px 20px;margin-bottom:18px}.brand{font-weight:600;letter-spacing:.02em;color:#555}.brand b{color:#1d5dbd}
h1{margin:6px 0 2px;font-size:24pt;line-height:1.1}.sub{margin:0 0 14px;color:#555}
.kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:0;margin:0;border-top:1px solid #17202c}.kpis div{padding:6px 8px;border-bottom:1px solid #ccc}
.kpis dt{font-size:8pt;text-transform:uppercase;letter-spacing:.08em;color:#666}.kpis dd{margin:0;font-weight:600}
h2{font-size:15pt;margin:0 0 10px;padding-bottom:4px;border-bottom:2px solid #8a4a25}section{margin:0 0 18px}.page{break-before:page}
.shots{display:grid;grid-template-columns:1fr 1fr;gap:10px}.shots figure{margin:0}.shots img{width:100%;border:1px solid #ccc;border-radius:4px}.shots figcaption{font-size:9pt;color:#555}
.svg svg{width:100%;height:auto;max-height:230mm}table{width:100%;border-collapse:collapse;font-size:9.5pt;margin:8px 0}th,td{padding:4px 6px;border-bottom:1px solid #ddd;text-align:left;vertical-align:top}
th{font-size:8pt;text-transform:uppercase;letter-spacing:.06em;color:#555;border-bottom:1.5px solid #17202c}.n{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.small{font-size:8.5pt;color:#555}.st.ok{color:#2b7a37}.st.warn{color:#9a5a00}.st.err,.bad{color:#b3261e}tr.cat td{font-weight:700;color:#1d5dbd;padding-top:10px}
tr.tot td{font-weight:700;border-top:1.5px solid #17202c}.checks{margin:8px 0;padding-left:18px;font-size:9.5pt}.checks .err{color:#b3261e}.checks .warn{color:#9a5a00}
table.half{width:60%}.sw{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;vertical-align:-1px}.sw.line{height:2px;background:#4a3aa7;vertical-align:3px}
footer{margin-top:24px;padding-top:8px;border-top:1px solid #ccc;font-size:8.5pt;color:#666}@media screen{body{max-width:190mm;margin:20px auto;padding:0 10px}}`;
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>${esc(title)} — dossier</title><style>${css}</style></head><body>${h}</body></html>`;
}

// Graphique de la journée en SVG (barres empilées par usage, production en ligne)
const DAY_SVG_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300'];
function dayChartSVG(a) {
  const W = 640, H = 220, L = 40, R = 8, T = 10, B = 26, slot = (W - L - R) / 24, plot = H - T - B;
  const tot = (b) => DAY_CATS.reduce((s, c) => s + b[c.key], 0);
  const max = Math.max(1, ...a.bins.map((b) => Math.max(tot(b), b.pv || 0)));
  const nice = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50].find((v) => v >= max * 1.05) || Math.ceil(max);
  const y = (v) => H - B - (v / nice) * plot;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="system-ui,sans-serif" font-size="10">`;
  s += `<rect x="${L}" y="${T}" width="${6 * slot}" height="${plot}" fill="#1d5dbd" fill-opacity="0.06"/><rect x="${L + 22 * slot}" y="${T}" width="${2 * slot}" height="${plot}" fill="#1d5dbd" fill-opacity="0.06"/>`;
  for (const v of [0, nice / 2, nice]) s += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#ddd"/><text x="${L - 5}" y="${y(v) + 3}" text-anchor="end" fill="#666">${String(v).replace('.', ',')}</text>`;
  s += `<text x="10" y="${T + plot / 2}" transform="rotate(-90 10 ${T + plot / 2})" text-anchor="middle" fill="#666">kWh</text>`;
  for (const hh of [0, 6, 12, 18, 24]) s += `<text x="${L + hh * slot}" y="${H - 8}" text-anchor="${hh === 24 ? 'end' : hh === 0 ? 'start' : 'middle'}" fill="#666">${hh} h</text>`;
  a.bins.forEach((b, k) => {
    let acc = 0;
    DAY_CATS.forEach((c, i) => {
      const v = b[c.key];
      if (v <= 0) return;
      const y0 = y(acc), y1 = y(acc + v);
      acc += v;
      s += `<rect x="${(L + k * slot + 1).toFixed(1)}" y="${y1.toFixed(1)}" width="${(slot - 2).toFixed(1)}" height="${Math.max(0.5, y0 - y1 - 1).toFixed(1)}" fill="${DAY_SVG_COLORS[i]}"/>`;
    });
  });
  if (a.pv > 0) {
    let dPath = '';
    a.bins.forEach((b, k) => { const yy = y(b.pv).toFixed(1); dPath += (k ? 'L' : 'M') + (L + k * slot).toFixed(1) + ' ' + yy + 'L' + (L + (k + 1) * slot).toFixed(1) + ' ' + yy; });
    s += `<path d="${dPath}" fill="none" stroke="#4a3aa7" stroke-width="2"/>`;
  }
  return s + '</svg>';
}
