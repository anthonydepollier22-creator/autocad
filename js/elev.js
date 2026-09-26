/*
 * elev.js — Élévations des murs, pièce par pièce : chaque face de mur vue de
 * l'intérieur de la pièce, portes et fenêtres, appareillage à sa hauteur de
 * pose (cotée en cm) et à sa distance de l'angle gauche. Folios A3 (SVG, DXF).
 */

const ELEV_H = 250; // cm : hauteur sous plafond dessinée
const ELEV_TYPES = new Set([
  'socket_wall', 'switch_sa', 'switch_vv_wall', 'rj45', 'wall_light', 'radiator', 'water_heater', 'ev_charger',
  'panel_house', 'oven', 'cooktop', 'washer', 'dishwasher', 'dryer',
]);
const ELEV_OPEN = { door: [80, 0, 204], window_a: [80, 95, 215], garage_door: [240, 0, 200] }; // largeur, bas, haut (cm)
const _elevSide = (nx, ny) => { // mur vu depuis la pièce : la normale pointe vers l'intérieur
  const a = Math.atan2(ny, nx);
  const k = Math.round(a / (Math.PI / 2)) & 3;
  return ['ouest', 'nord', 'est', 'sud'][k]; // normale → est : mur ouest ; → sud (y+) : mur nord…
};
const ELEV_ORDER = { nord: 0, est: 1, sud: 2, ouest: 3 };

function elevations(components, wires) {
  if (!wires.some((w) => w.kind === 'wall')) return [];
  const info = computeRooms(components, wires);
  const segs = [];
  for (const w of wires) {
    if (w.kind !== 'wall') continue;
    for (let i = 0; i < w.points.length - 1; i++) {
      const a = w.points[i], b = w.points[i + 1], L = Math.hypot(b.x - a.x, b.y - a.y);
      if (L >= 20) segs.push({ w, a, b, L, ux: (b.x - a.x) / L, uy: (b.y - a.y) / L });
    }
  }
  // Faces : portions de chaque côté de mur qui bordent une même pièce
  const faces = [];
  for (const s of segs) {
    for (const side of [1, -1]) {
      const nx = -s.uy * side, ny = s.ux * side, off = (s.w.ext ? 15 : 5) + 14;
      let run = null;
      for (let t = 5; t <= s.L - 5 + 1e-6; t += 10) {
        const r = roomAt(info, s.a.x + s.ux * t + nx * off, s.a.y + s.uy * t + ny * off);
        const ok = r >= 0 && !info.rooms[r].leaked;
        if (run && (!ok || r !== run.room)) { faces.push(run); run = null; }
        if (ok && !run) run = { seg: s, side, nx, ny, room: r, t0: Math.max(0, t - 5), t1: t + 5 };
        else if (run) run.t1 = Math.min(s.L, t + 5);
      }
      if (run) faces.push(run);
    }
  }
  for (const f of faces) {
    f.t1 = Math.min(f.seg.L, f.t1 + 5); if (f.t0 <= 5) f.t0 = 0; if (f.seg.L - f.t1 <= 5) f.t1 = f.seg.L;
    // sens de lecture : de gauche à droite pour qui regarde le mur depuis la pièce
    const rx = f.ny, ry = -f.nx; // droite du regard (direction du regard = −n)
    f.flip = f.seg.ux * rx + f.seg.uy * ry < 0;
    f.len = f.t1 - f.t0;
    f.x = (t) => (f.flip ? f.t1 - t : t - f.t0);
    f.dir = _elevSide(f.nx, f.ny);
    f.devs = []; f.opens = [];
  }
  const faceOf = (c, maxD) => {
    const nw = nearestWall(wires, c.x, c.y, maxD);
    if (!nw) return null;
    const side = (c.x - (nw.a.x + nw.ux * nw.t)) * -nw.uy + (c.y - (nw.a.y + nw.uy * nw.t)) * nw.ux >= 0 ? 1 : -1;
    return { nw, side, list: faces.filter((f) => f.seg.a === nw.a && f.seg.b === nw.b && nw.t >= f.t0 - 6 && nw.t <= f.t1 + 6) };
  };
  for (const c of components) {
    if (ELEV_TYPES.has(c.type)) {
      const q = faceOf(c, 70);
      const f = q && q.list.find((x) => x.side === q.side);
      if (f) f.devs.push({ c, x: f.x(q.nw.t), h: Math.round(mountH(c) * 100) });
    } else if (c.type === 'counter') { // plan de travail : repère des prises à 1,10 m
      const q = faceOf(c, 60), wd = SYMBOLS.counter.bbox.w;
      if (q) { const f = q.list.find((x) => x.side === q.side); if (f) f.opens.push({ kind: 'counter', x0: f.x(q.nw.t) - wd / 2, x1: f.x(q.nw.t) + wd / 2, y0: 0, y1: 90 }); }
    } else if (ELEV_OPEN[c.type]) {
      const q = faceOf(c, 40), [wd, y0, y1] = ELEV_OPEN[c.type];
      if (q) for (const f of q.list) f.opens.push({ kind: c.type, x0: f.x(q.nw.t) - wd / 2, x1: f.x(q.nw.t) + wd / 2, y0, y1 });
    }
  }
  // Pièces : faces dans l'ordre nord, est, sud, ouest ; seules les pièces équipées
  const rooms = info.rooms.map((r, i) => ({ id: r.id, name: r.name, area: r.area, faces: faces.filter((f) => f.room === i && (f.devs.length || (f.len >= 80 && (f.opens.length || f.len >= 120)))) }))
    .filter((r) => r.faces.some((f) => f.devs.length));
  for (const r of rooms) {
    r.faces.sort((a, b) => ELEV_ORDER[a.dir] - ELEV_ORDER[b.dir] || a.t0 - b.t0);
    const n = {};
    for (const f of r.faces) { n[f.dir] = (n[f.dir] || 0) + 1; }
    const k = {};
    for (const f of r.faces) { k[f.dir] = (k[f.dir] || 0) + 1; f.label = 'Mur ' + f.dir + (n[f.dir] > 1 ? ' ' + k[f.dir] : ''); }
    for (const f of r.faces) f.devs.sort((a, b) => a.x - b.x);
  }
  return rooms;
}

// ---------------------------------------------------------------------------
// Folios A3 : une rangée par pièce, faces côte à côte, échelle 1:50 au plus
// ---------------------------------------------------------------------------
function elevLayout(rooms) {
  const top = 78, bottom = UNI.H - 15 - 62 - 10, W = UNI.W - 60, gap = 22;
  const pages = [[]];
  let y = top;
  for (const r of rooms) {
    const sum = r.faces.reduce((s, f) => s + f.len, 0) / 100;
    // échelle normalisée la plus grande qui fait tenir la pièce sur une rangée (1:50 = 56,7 pt par mètre)
    const fit = (W - gap * (r.faces.length - 1)) / Math.max(sum, 0.1);
    const scale = [50, 75, 100, 125, 150, 200, 250].find((d) => 2835 / d <= fit) || 250;
    const s = 2835 / scale;
    const h = (ELEV_H / 100) * s + 64;
    if (y + h > bottom && pages[pages.length - 1].length) { pages.push([]); y = top; }
    pages[pages.length - 1].push({ r, s, y, scale });
    y += h + 8;
  }
  return pages;
}
function drawElevations(ctx, design, meta, rooms, folio) {
  const pages = elevLayout(rooms), k = folio || 0, nF = pages.length;
  const ink = '#1a2230', mute = '#5b6b82', blue = '#1668c4', red = '#b3261e';
  const layer = (n) => { if ('layer' in ctx) ctx.layer = n; };
  const text = (t, x, y, o) => {
    o = o || {};
    ctx.save(); ctx.fillStyle = o.color || ink; ctx.font = `${o.bold ? 'bold ' : ''}${o.size || 7.5}px sans-serif`;
    ctx.textAlign = o.align || 'left'; ctx.fillText(t, x, y); ctx.restore();
  };
  const ln = (x1, y1, x2, y2, w, color, dash) => {
    ctx.save(); ctx.strokeStyle = color || ink; ctx.lineWidth = w || 1; if (dash) ctx.setLineDash(dash);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.restore();
  };
  ctx.save(); ctx.strokeStyle = ink; ctx.fillStyle = ink; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  layer('CARTOUCHE');
  _uCartouche(ctx, design, meta, 'Élévations des murs — hauteurs de pose', k, nF);
  layer('TEXTES');
  text('Élévations — hauteurs de pose', 30, 46, { bold: true, size: 17 });
  text('Chaque mur vu depuis la pièce · hauteur de l’axe des boîtes en cm au-dessus du sol fini · distance en cm depuis l’angle gauche · échelle 1:50 au plus', 30, 62, { size: 8, color: mute });
  for (const { r, s, y, scale } of pages[k] || []) {
    const H = (ELEV_H / 100) * s, y0 = y + 16, floor = y0 + H;
    layer('TEXTES');
    text(r.name, 30, y + 8, { bold: true, size: 10.5 });
    text(`${_bNum(r.area, 1)} m² · 1:${scale}`, 30 + r.name.length * 6.2 + 14, y + 8, { size: 8, color: mute });
    let x = 30;
    for (const f of r.faces) {
      const w = (f.len / 100) * s, X = (cm) => x + (cm / 100) * s, Y = (cm) => floor - (cm / 100) * s;
      layer('SCHEMA');
      ln(x, y0, x + w, y0, 0.6, mute); ln(x, y0, x, floor, 0.8); ln(x + w, y0, x + w, floor, 0.8);
      ln(x - 4, floor, x + w + 4, floor, 1.8); // sol fini
      for (const o of f.opens) {
        const a = Math.max(0, o.x0), b = Math.min(f.len, o.x1);
        if (b - a < 5) continue;
        if (o.kind === 'counter' && !('layer' in ctx)) { ctx.save(); ctx.fillStyle = '#eef1f5'; ctx.beginPath(); ctx.rect(X(a), Y(o.y1), X(b) - X(a), Y(o.y0) - Y(o.y1)); ctx.fill(); ctx.restore(); }
        ctx.save(); ctx.strokeStyle = mute; ctx.lineWidth = 0.8; ctx.strokeRect(X(a), Y(o.y1), X(b) - X(a), Y(o.y0) - Y(o.y1)); ctx.restore();
        if (o.kind === 'counter') { ln(X(a), Y(o.y1), X(b), Y(o.y1), 2, mute); layer('TEXTES'); text('plan de travail', (X(a) + X(b)) / 2, Y(o.y1) + 10, { size: 6, color: mute, align: 'center' }); layer('SCHEMA'); }
        else if (o.kind === 'window_a') { ln(X(a), Y(o.y0), X(b), Y(o.y1), 0.4, mute); ln(X(a), Y(o.y1), X(b), Y(o.y0), 0.4, mute); }
        else ln(X(a), Y(o.y1), X((a + b) / 2), Y(o.y0), 0.4, mute, [2, 2]);
      }
      let lastX = -1e9, lift = 0, lastB = -1e9, liftB = 0;
      for (const d of f.devs) {
        const px = X(Math.max(0, Math.min(f.len, d.x))), py = Y(d.h), t = d.c.type;
        // étiquettes voisines : décalées en hauteur pour rester lisibles
        lift = px - lastX < 20 ? (lift + 8) % 24 : 0; lastX = px;
        liftB = px - lastB < 14 ? (liftB ? 0 : 7) : 0; lastB = px;
        layer('SCHEMA');
        ln(px, floor, px, py + 5, 0.4, blue, [1.5, 1.5]); // cote de hauteur
        ctx.save(); ctx.lineWidth = 1;
        if (t === 'socket_wall') { ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2); ctx.stroke(); ln(px, py - 4, px, py - 6.5, 1); }
        else if (t === 'switch_sa' || t === 'switch_vv_wall') { ctx.strokeRect(px - 3.5, py - 3.5, 7, 7); ln(px - 3.5, py + 3.5, px + 3.5, py - 3.5, 0.8); if (t === 'switch_vv_wall') ln(px - 3.5, py - 3.5, px + 3.5, py + 3.5, 0.8); }
        else if (t === 'rj45') { ctx.strokeRect(px - 4, py - 3, 8, 6); ln(px - 1.5, py + 3, px - 1.5, py + 1, 0.6); ln(px + 1.5, py + 3, px + 1.5, py + 1, 0.6); }
        else if (t === 'wall_light') { ctx.beginPath(); ctx.arc(px, py, 4.5, 0, Math.PI * 2); ctx.stroke(); ln(px - 3, py - 3, px + 3, py + 3, 0.7); ln(px - 3, py + 3, px + 3, py - 3, 0.7); }
        else if (t === 'radiator') { const hw = Math.max(6, (SYMBOLS.radiator.bbox.w / 200) * s); ctx.strokeRect(px - hw, Y(75), hw * 2, Y(15) - Y(75)); for (let i = 1; i < 5; i++) ln(px - hw + (i * hw) / 2.5, Y(72), px - hw + (i * hw) / 2.5, Y(18), 0.4); }
        else if (t === 'panel_house') { ctx.strokeRect(px - 8, py - 12, 16, 24); ln(px - 6, py - 4, px + 6, py - 4, 0.5); ln(px - 6, py + 4, px + 6, py + 4, 0.5); }
        else { ctx.beginPath(); ctx.moveTo(px - 4, py + 3); ctx.lineTo(px + 4, py + 3); ctx.lineTo(px, py - 4); ctx.closePath(); ctx.stroke(); } // sortie de câble
        ctx.restore();
        layer('TEXTES');
        if (lift) ln(px, py - 7, px, py - 7 - lift, 0.3, mute);
        text(d.c.label || '', px, py - 9 - lift, { size: 6.5, bold: true, align: 'center' });
        text(String(d.h), px + 3, floor - 3 - liftB, { size: 6.5, color: blue });
        text(String(Math.round(Math.max(0, d.x))), px, floor + 9 + liftB, { size: 6, color: mute, align: 'center' });
        if (d.c.h && (d.h < 5 || ((t === 'switch_sa' || t === 'switch_vv_wall') && (d.h < 90 || d.h > 130)))) text('!', px + 7, py + 3, { size: 9, bold: true, color: red });
      }
      layer('TEXTES');
      const cap = `${f.label} · ${_bNum(f.len / 100, 2)} m`;
      if (cap.length * 4.1 < w + 16) text(cap, x + w / 2, floor + 23, { size: 7.5, align: 'center', bold: true });
      else { text(f.label.replace('Mur ', ''), x + w / 2, floor + 23, { size: 7, align: 'center', bold: true }); text(`${_bNum(f.len / 100, 2)} m`, x + w / 2, floor + 32, { size: 6.5, align: 'center', color: mute }); }
      x += w + 22;
    }
  }
  if (!rooms.length) { layer('TEXTES'); text('Aucun appareil mural sur le plan.', 30, 110, { size: 11, color: mute }); }
  ctx.restore();
}
function elevationSVGs(design, meta, components, wires) {
  const rooms = elevations(components, wires), n = elevLayout(rooms).length, out = [];
  for (let k = 0; k < n; k++) {
    const ctx = new SVGContext();
    drawElevations(ctx, design, meta, rooms, k);
    out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${UNI.W} ${UNI.H}" width="420mm" height="297mm" font-family="sans-serif"><rect width="${UNI.W}" height="${UNI.H}" fill="#fff"/>${ctx.out.join('')}</svg>`);
  }
  return out;
}
function elevationDXF(design, meta, components, wires) {
  const rooms = elevations(components, wires), n = elevLayout(rooms).length, ctx = new DXFContext();
  for (let k = 0; k < n; k++) { ctx.save(); ctx.translate(0, k * (UNI.H + 60)); drawElevations(ctx, design, meta, rooms, k); ctx.restore(); }
  return _dxfWrite(ctx.ents, { minX: 0, minY: 0, maxX: UNI.W, maxY: n * (UNI.H + 60) }, { U: 1 / 0.3528, insunits: 4, layers: [['SCHEMA', 7], ['TEXTES', 2], ['CARTOUCHE', 8]] });
}
