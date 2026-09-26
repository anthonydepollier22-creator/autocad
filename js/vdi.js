/*
 * vdi.js — Réseau de communication (VDI) du logement, NF C 15-100 :
 * coffret de communication dans la GTL (grade 2TV), câblage en étoile en
 * catégorie 6 jusqu'à chaque prise RJ45, longueurs mesurées sur les goulottes
 * du plan, contrôles (lien de 90 m au plus) et folio A3 (SVG, DXF).
 */

const VDI_MAX_LINK = 90;      // m : lien permanent (ISO/IEC 11801)
const VDI_COFFRET_H = 1.3;    // m : hauteur du coffret dans la GTL (remontée depuis la plinthe)
const VDI_SLACK = 1;          // m : lovage dans le coffret et derrière la prise
const VDI_PANELS = [4, 6, 8, 12, 16, 24, 32]; // panneaux de brassage courants

function vdiDesign(components, wires) {
  const outlets = components.filter((c) => c.type === 'rj45');
  const origin = components.find((c) => c.type === 'gtl') || components.find((c) => c.type === 'panel_house');
  const info = wires.some((w) => w.kind === 'wall') ? computeRooms(components, wires) : null;
  const roomName = (c) => { const r = info ? roomAt(info, c.x, c.y) : -1; return r >= 0 ? info.rooms[r].name : ''; };
  const out = { ok: !!origin && outlets.length > 0, origin: origin || null, links: [], total: 0, grade: '2TV', ports: 0, panel: 0, checks: [] };
  if (!origin) {
    if (outlets.length) out.checks.push({ level: 'err', msg: 'Prises RJ45 sans GTL : le coffret de communication se place dans la gaine technique logement.' });
    return out;
  }
  const net = _buildNetwork(wires, [origin, ...outlets]);
  out.net = net; out.originNode = net.anchorNode[0] ? net.anchorNode[0].node : undefined;
  const oA = net.anchorNode[0];
  const sp = net.edges.length && oA ? _shortest(net, oA.node) : null;
  outlets.forEach((c, k) => {
    const A = net.anchorNode[k + 1], rise = Math.max(0, mountH(c) - 0.1) + VDI_COFFRET_H - 0.1;
    let len, off = false;
    const edges = [];
    if (sp && A && A.stub < 150 && sp.dist[A.node] < Infinity) {
      len = (sp.dist[A.node] + oA.stub + A.stub) / PLAN_UNITS_PER_M;
      for (let v = A.node; sp.via[v] >= 0;) { const e = net.edges[sp.via[v]]; edges.push(sp.via[v]); v = e.a === v ? e.b : e.a; }
    } else { off = true; len = (Math.abs(c.x - origin.x) + Math.abs(c.y - origin.y)) / PLAN_UNITS_PER_M; }
    out.links.push({ id: c.id, label: c.label || c.id, room: roomName(c), len: len + rise + VDI_SLACK, off, edges, node: A ? A.node : undefined });
  });
  const num = (s) => { const m = /(\d+)$/.exec(s); return m ? +m[1] : 0; };
  out.links.sort((a, b) => num(a.label) - num(b.label) || a.label.localeCompare(b.label));
  out.links.forEach((l, i) => { l.port = i + 1; });
  out.ports = out.links.length;
  out.panel = VDI_PANELS.find((p) => p >= out.ports) || out.ports;
  out.total = out.links.reduce((s, l) => s + l.len, 0);
  for (const l of out.links) {
    if (l.len > VDI_MAX_LINK) out.checks.push({ level: 'err', msg: `${l.label} (${l.room || 'hors pièce'}) : lien de ${_bNum(l.len, 1)} m > ${VDI_MAX_LINK} m — rapprocher la prise ou ajouter un switch intermédiaire.`, ref: l.id });
    else if (l.off) out.checks.push({ level: 'warn', msg: `${l.label} : hors des goulottes, longueur estimée à vol d’oiseau (${_bNum(l.len, 1)} m).`, ref: l.id });
  }
  if (out.ok && !out.checks.some((c) => c.level === 'err')) {
    out.checks.push({ level: 'ok', msg: `${out.ports} prise${out.ports > 1 ? 's' : ''} RJ45 en étoile depuis le coffret de communication (grade 2TV), ${_bNum(out.total)} m de câble catégorie 6.` });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Folio A3 : arrivée opérateur, coffret de communication, liens en étoile
// ---------------------------------------------------------------------------
const VDI_ROWS = 24;
function vdiFolios(vdi) { return Math.max(1, Math.ceil(vdi.links.length / VDI_ROWS)); }
function drawVDI(ctx, design, meta, vdi, folio) {
  const k = folio || 0, nF = vdiFolios(vdi);
  const ink = '#1a2230', mute = '#5b6b82', red = '#b3261e', green = '#1e7b34', blue = '#1668c4', teal = '#0f766e';
  const layer = (n) => { if ('layer' in ctx) ctx.layer = n; };
  const text = (t, x, y, o) => {
    o = o || {};
    ctx.save(); ctx.fillStyle = o.color || ink; ctx.font = `${o.bold ? 'bold ' : ''}${o.size || 8.5}px sans-serif`;
    ctx.textAlign = o.align || 'left'; ctx.fillText(t, x, y); ctx.restore();
  };
  const line = (pts, color, w) => { ctx.save(); ctx.strokeStyle = color || ink; ctx.lineWidth = w || 1.2; ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.stroke(); ctx.restore(); };
  const box = (x, y, w, h, lw) => { ctx.lineWidth = lw || 1.2; ctx.strokeRect(x, y, w, h); };
  ctx.save(); ctx.strokeStyle = ink; ctx.fillStyle = ink; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  layer('CARTOUCHE');
  _uCartouche(ctx, design, meta, 'Schéma de communication (VDI, grade 2TV)', k, nF);
  layer('TEXTES');
  text('Schéma de communication — réseau VDI', 30, 46, { bold: true, size: 17 });
  text('Câblage en étoile depuis le coffret de communication de la GTL · câble catégorie 6 grade 2TV (4 paires) · 90 m au plus par lien · NF C 15-100', 30, 62, { size: 8, color: mute });

  const links = vdi.links.slice(k * VDI_ROWS, (k + 1) * VDI_ROWS);
  const top = 96, bottom = UNI.H - 15 - 62 - 40, rh = Math.min(34, (bottom - top) / Math.max(links.length, 1));
  const cx0 = 170, cx1 = 430, cy0 = top, cy1 = Math.max(top + 330, top + links.length * rh);
  // Arrivée opérateur et DTIo
  layer('SCHEMA');
  const ay = cy0 + 60;
  line([[40, ay], [100, ay]], teal, 1.8);
  box(100, ay - 16, 42, 32); layer('TEXTES');
  text('DTIo', 121, ay + 3, { bold: true, size: 8.5, align: 'center' });
  text('Réseau opérateur', 30, ay - 26, { size: 8, color: mute }); text('fibre optique', 30, ay - 16, { size: 8, color: mute });
  text('(ou cuivre)', 30, ay + 18, { size: 7.5, color: mute });
  layer('SCHEMA'); line([[142, ay], [cx0, ay]], teal, 1.8);
  // Coffret de communication
  box(cx0, cy0, cx1 - cx0, cy1 - cy0, 1.6);
  layer('TEXTES');
  text('Coffret de communication (GTL)', cx0 + 10, cy0 + 16, { bold: true, size: 9.5 });
  text(`grade ${vdi.grade} · ${vdi.ports} prise${vdi.ports > 1 ? 's' : ''} RJ45`, cx0 + 10, cy0 + 28, { size: 8, color: mute });
  const blocks = [
    ['Box opérateur', 'routeur, Wi-Fi'],
    ['Switch Ethernet', `${Math.max(4, vdi.panel)} ports`],
    ['Répartiteur TV', 'antenne → RJ45 (grade 2TV)'],
    ['Alimentation', '2 socles 2P+T'],
  ];
  const bx = cx0 + 12, bw = 118;
  blocks.forEach(([t, s], i) => {
    const y = cy0 + 44 + i * 58;
    layer('SCHEMA'); box(bx, y, bw, 40, 1);
    layer('TEXTES'); text(t, bx + 8, y + 17, { bold: true, size: 8.5 }); text(s, bx + 8, y + 30, { size: 7.5, color: mute });
    if (i < 3) { layer('SCHEMA'); line([[bx + bw, y + 20], [bx + bw + 16, y + 20]], i === 2 ? blue : teal, 1.2); }
  });
  layer('SCHEMA'); line([[cx0, ay], [bx, ay]], teal, 1.8);
  // Panneau de brassage : un port par prise
  const px0 = cx1 - 104, px1 = cx1 - 14, py0 = cy0 + 44, py1 = cy1 - 14;
  box(px0, py0, px1 - px0, py1 - py0, 1.2);
  line([[bx + bw + 16, cy0 + 64], [bx + bw + 16, cy0 + 180], [px0, cy0 + 180]], teal, 1.2);
  layer('TEXTES');
  text('Panneau de', px0 + 8, py0 + 14, { bold: true, size: 8 }); text(`brassage ${vdi.panel} ports`, px0 + 8, py0 + 25, { bold: true, size: 8 });
  const portY = (i) => py0 + 40 + (i + 0.5) * Math.min(14, (py1 - py0 - 48) / Math.max(links.length, 1));
  // Liens en étoile vers chaque prise
  const rx = 560;
  const cols = { port: 482, rj: rx, lab: rx + 34, room: rx + 90, cable: rx + 230, len: rx + 420, ok: rx + 440 };
  layer('TEXTES');
  text('Port', cols.port, top - 4, { bold: true, size: 8, align: 'center' });
  text('Prise', cols.lab, top - 4, { bold: true, size: 8 }); text('Pièce', cols.room, top - 4, { bold: true, size: 8 });
  text('Câble', cols.cable, top - 4, { bold: true, size: 8 }); text('Longueur', cols.len, top - 4, { bold: true, size: 8, align: 'right' });
  text('Vérification', cols.ok, top - 4, { bold: true, size: 8 });
  links.forEach((l, i) => {
    const y = top + (i + 0.5) * rh, py = portY(i), bad = l.len > VDI_MAX_LINK;
    layer('SCHEMA');
    ctx.fillStyle = teal; ctx.beginPath(); ctx.rect(px1 - 8, py - 3, 8, 6); ctx.fill(); ctx.fillStyle = ink;
    line([[px1, py], [cx1 + 20, py], [cols.port - 22, y], [rx - 4, y]], bad ? red : teal, 1.1);
    // prise RJ45 : boîtier et languette
    box(rx - 4, y - 7, 24, 14, 1.1); line([[rx + 4, y + 7], [rx + 4, y + 3], [rx + 12, y + 3], [rx + 12, y + 7]], ink, 0.9);
    layer('TEXTES');
    text(String(l.port), cols.port, y - 3, { size: 7.5, align: 'center', color: mute });
    text(l.label, cols.lab, y + 3, { bold: true, size: 8.5 });
    text(l.room || '—', cols.room, y + 3, { size: 8.5 });
    text('catégorie 6 · 4 paires · grade 2TV', cols.cable, y + 3, { size: 8, color: mute });
    text(`${_bNum(l.len, 1)} m`, cols.len, y + 3, { size: 8.5, align: 'right', bold: bad, color: bad ? red : ink });
    text(bad ? `> ${VDI_MAX_LINK} m` : l.off ? 'estimée' : 'conforme', cols.ok, y + 3, { size: 8, color: bad ? red : l.off ? mute : green });
  });
  if (!links.length) { layer('TEXTES'); text('Aucune prise RJ45 sur le plan.', rx, top + 20, { size: 10, color: mute }); }
  // Bilan
  layer('TEXTES');
  const yb = UNI.H - 15 - 62 - 22;
  if (k === nF - 1) {
    text(`${vdi.ports} lien${vdi.ports > 1 ? 's' : ''} · ${_bNum(vdi.total)} m de câble catégorie 6 (+ 10 % de chutes au métré) · panneau de brassage ${vdi.panel} ports · lien le plus long ${_bNum(Math.max(0, ...vdi.links.map((l) => l.len)), 1)} m`, 30, yb, { size: 8.5 });
    text('Une prise RJ45 au moins dans le séjour et chaque chambre ; coffret alimenté par deux socles 2P+T, sans prise multiple.', 30, yb + 13, { size: 8, color: mute });
  } else text(`Suite folio ${k + 2} →`, UNI.W - 30, yb, { size: 8, color: mute, align: 'right' });
  ctx.restore();
}
function vdiSVGs(design, meta, components, wires) {
  const vdi = vdiDesign(components, wires), out = [];
  for (let k = 0; k < vdiFolios(vdi); k++) {
    const ctx = new SVGContext();
    drawVDI(ctx, design, meta, vdi, k);
    out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${UNI.W} ${UNI.H}" width="420mm" height="297mm" font-family="sans-serif"><rect width="${UNI.W}" height="${UNI.H}" fill="#fff"/>${ctx.out.join('')}</svg>`);
  }
  return out;
}
function vdiDXF(design, meta, components, wires) {
  const vdi = vdiDesign(components, wires), ctx = new DXFContext(), n = vdiFolios(vdi);
  for (let k = 0; k < n; k++) { ctx.save(); ctx.translate(0, k * (UNI.H + 60)); drawVDI(ctx, design, meta, vdi, k); ctx.restore(); }
  return _dxfWrite(ctx.ents, { minX: 0, minY: 0, maxX: UNI.W, maxY: n * (UNI.H + 60) }, { U: 1 / 0.3528, insunits: 4, layers: [['SCHEMA', 7], ['TEXTES', 2], ['CARTOUCHE', 8]] });
}
