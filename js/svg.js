/*
 * svg.js — Export vectoriel SVG.
 *
 * Astuce : on fournit aux fonctions draw() des symboles un faux contexte 2D
 * qui, au lieu de peindre, accumule des chemins SVG. On réutilise ainsi
 * exactement le même code de dessin que le canvas.
 */

class SVGContext {
  constructor() {
    this.M = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    this.stack = [];
    this.out = [];
    this.strokeStyle = '#000'; this.fillStyle = '#000';
    this.lineWidth = 2; this.font = '12px sans-serif';
    this.textAlign = 'start'; this.textBaseline = 'alphabetic';
    this.lineCap = 'round'; this.lineJoin = 'round'; this.globalAlpha = 1;
    this._d = ''; this._lx = 0; this._ly = 0; this._has = false; this._dash = '';
  }
  // --- transformations ---
  save() { this.stack.push({ M: { ...this.M }, s: this.strokeStyle, f: this.fillStyle, lw: this.lineWidth, fo: this.font, da: this._dash }); }
  restore() { const st = this.stack.pop(); if (st) { this.M = st.M; this.strokeStyle = st.s; this.fillStyle = st.f; this.lineWidth = st.lw; this.font = st.fo; this._dash = st.da; } }
  _mul(T) {
    const M = this.M;
    this.M = {
      a: M.a * T.a + M.c * T.b, b: M.b * T.a + M.d * T.b,
      c: M.a * T.c + M.c * T.d, d: M.b * T.c + M.d * T.d,
      e: M.a * T.e + M.c * T.f + M.e, f: M.b * T.e + M.d * T.f + M.f,
    };
  }
  translate(x, y) { this._mul({ a: 1, b: 0, c: 0, d: 1, e: x, f: y }); }
  rotate(r) { this._mul({ a: Math.cos(r), b: Math.sin(r), c: -Math.sin(r), d: Math.cos(r), e: 0, f: 0 }); }
  scale(x, y) { this._mul({ a: x, b: 0, c: 0, d: y, e: 0, f: 0 }); }
  _ap(x, y) { return { x: this.M.a * x + this.M.c * y + this.M.e, y: this.M.b * x + this.M.d * y + this.M.f }; }
  setLineDash(a) { this._dash = a && a.length ? a.map((v) => this._n(v)).join(' ') : ''; }
  // --- chemins ---
  beginPath() { this._d = ''; this._has = false; }
  moveTo(x, y) { const p = this._ap(x, y); this._d += `M${this._n(p.x)} ${this._n(p.y)}`; this._lx = x; this._ly = y; this._has = true; }
  lineTo(x, y) { const p = this._ap(x, y); this._d += `L${this._n(p.x)} ${this._n(p.y)}`; this._lx = x; this._ly = y; }
  arc(cx, cy, r, a0, a1, anti) {
    const steps = 32; let span = a1 - a0;
    if (anti && span > 0) span -= 2 * Math.PI;
    if (!anti && span < 0) span += 2 * Math.PI;
    for (let i = 0; i <= steps; i++) {
      const a = a0 + (span * i) / steps;
      const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
      if (i === 0 && !this._has) this.moveTo(x, y); else this.lineTo(x, y);
    }
  }
  ellipse(cx, cy, rx, ry, rot, a0, a1) {
    const steps = 32, c = Math.cos(rot || 0), s = Math.sin(rot || 0);
    for (let i = 0; i <= steps; i++) {
      const a = a0 + ((a1 - a0) * i) / steps;
      const ex = rx * Math.cos(a), ey = ry * Math.sin(a);
      const x = cx + ex * c - ey * s, y = cy + ex * s + ey * c;
      if (i === 0 && !this._has) this.moveTo(x, y); else this.lineTo(x, y);
    }
  }
  quadraticCurveTo(cpx, cpy, x, y) {
    const x0 = this._lx, y0 = this._ly, steps = 16;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps, mt = 1 - t;
      this.lineTo(mt * mt * x0 + 2 * mt * t * cpx + t * t * x, mt * mt * y0 + 2 * mt * t * cpy + t * t * y);
    }
  }
  closePath() { this._d += 'Z'; }
  rect(x, y, w, h) { this.moveTo(x, y); this.lineTo(x + w, y); this.lineTo(x + w, y + h); this.lineTo(x, y + h); this.closePath(); }
  stroke() { if (this._d) this.out.push(`<path d="${this._d}" fill="none" stroke="${this.strokeStyle}" stroke-width="${this.lineWidth}" stroke-linecap="${this.lineCap}" stroke-linejoin="${this.lineJoin}"${this._dash ? ` stroke-dasharray="${this._dash}"` : ''}/>`); }
  fill() { if (this._d) this.out.push(`<path d="${this._d}" fill="${this.fillStyle}" stroke="none"/>`); }
  strokeRect(x, y, w, h) {
    const p = [this._ap(x, y), this._ap(x + w, y), this._ap(x + w, y + h), this._ap(x, y + h)];
    this.out.push(`<path d="M${this._n(p[0].x)} ${this._n(p[0].y)}L${this._n(p[1].x)} ${this._n(p[1].y)}L${this._n(p[2].x)} ${this._n(p[2].y)}L${this._n(p[3].x)} ${this._n(p[3].y)}Z" fill="none" stroke="${this.strokeStyle}" stroke-width="${this.lineWidth}"/>`);
  }
  fillText(text, x, y) {
    const p = this._ap(x, y);
    // this.font peut commencer par une graisse (« 600 15px sans-serif »)
    const m = /(\d+(?:\.\d+)?)px/.exec(this.font);
    const size = m ? +m[1] : 12;
    const weight = /^\s*(bold|[5-9]00)\b/.exec(this.font) ? ' font-weight="bold"' : '';
    const anchor = this.textAlign === 'center' ? 'middle' : this.textAlign === 'right' ? 'end' : 'start';
    const mid = this.textBaseline === 'middle' ? ` dy="0.35em"` : '';
    // texte tourné (étiquettes verticales) et mis à l'échelle comme le reste
    const ang = Math.atan2(this.M.b, this.M.a), k = Math.hypot(this.M.a, this.M.b);
    const rot = Math.abs(ang) > 1e-4 ? ` transform="rotate(${this._n((ang * 180) / Math.PI)} ${this._n(p.x)} ${this._n(p.y)})"` : '';
    this.out.push(`<text x="${this._n(p.x)}" y="${this._n(p.y)}"${mid}${rot} font-family="sans-serif" font-size="${this._n(size * k)}"${weight} fill="${this.fillStyle}" text-anchor="${anchor}">${_esc(text)}</text>`);
  }
  _n(v) { return Math.round(v * 100) / 100; }
}

function _esc(s) { return String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c])); }

function buildSVG(components, wires, symbols, meta) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const acc = (x, y) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };
  for (const c of components) { const b = symbols[c.type].bbox; acc(c.x + b.x, c.y + b.y); acc(c.x + b.x + b.w, c.y + b.y + b.h); }
  for (const w of wires) for (const p of w.points) acc(p.x, p.y);
  if (!isFinite(minX)) { minX = 0; minY = 0; maxX = 400; maxY = 300; }
  const isPlan = wires.some((w) => w.kind === 'wall') && typeof computeRooms === 'function';
  const pad = isPlan ? 55 : 40; // marge plus large pour les cotations
  // Plan : légende des symboles (et des circuits) à droite
  const legend = isPlan && meta && meta.legend && typeof planLegend === 'function' ? planLegend(components, symbols) : null;
  const tags = meta && meta.tags;
  const LW = 320, planRight = maxX + pad;
  minX -= pad; minY -= pad; maxX += pad; maxY += pad + 60; // marge basse pour le cartouche
  if (legend && legend.length) {
    maxX += LW;
    const need = minY + 40 + legend.length * 34 + (tags ? 30 + tags.list.length * 20 : 0) + 80;
    if (need > maxY) maxY = need;
  }
  const W = maxX - minX, H = maxY - minY;

  const ctx = new SVGContext();
  ctx.strokeStyle = '#111'; ctx.fillStyle = '#111'; ctx.lineWidth = 2;

  // Sols des pièces (plan de maison)
  if (isPlan) {
    const info = computeRooms(components, wires);
    info.rooms.forEach((room, i) => {
      if (room.leaked || room.sharedWith !== null) return;
      const d = roomRuns(info, i).map((r) => `M${r.x} ${r.y}h${r.w}v${r.h}h${-r.w}Z`).join('');
      if (d) ctx.out.push(`<path d="${d}" fill="${room.color}" fill-opacity="0.14" stroke="none"/>`);
    });
  }

  // Fils, murs, goulottes
  const pathOf = (wi) => wi.points.map((p, i) => (i ? 'L' : 'M') + p.x + ' ' + p.y).join('');
  for (const wi of wires) {
    if (wi.kind === 'wall') {
      ctx.out.push(`<path d="${pathOf(wi)}" fill="none" stroke="#1f2733" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>`);
      const mk = typeof wallMarks === 'function' ? wallMarks(wi) : [];
      if (mk.length) ctx.out.push(`<path d="${mk.map(([x1, y1, x2, y2]) => `M${ctx._n(x1)} ${ctx._n(y1)}L${ctx._n(x2)} ${ctx._n(y2)}`).join('')}" fill="none" stroke="#ffffff" stroke-width="1.1" stroke-opacity="0.85"/>`);
    } else if (wi.kind === 'conduit' && wi.riser) {
      // montée d'étage entre les deux plans
      const m = typeof riserLabelAt === 'function' ? riserLabelAt(wi, wires) : wi.points[0];
      ctx.out.push(`<path d="${pathOf(wi)}" fill="none" stroke="#6b7788" stroke-width="2" stroke-dasharray="12 9"/>`);
      if (typeof fmtMeters === 'function') ctx.out.push(`<text x="${ctx._n(m.x)}" y="${ctx._n(m.y - 8)}" font-family="sans-serif" font-size="20" font-weight="600" fill="#6b7788" text-anchor="middle">montée ${_esc(fmtMeters(wi.len || 300))}</text>`);
    } else if (wi.kind === 'conduit') {
      ctx.out.push(`<path d="${pathOf(wi)}" fill="none" stroke="#6b7788" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>`);
      ctx.out.push(`<path d="${pathOf(wi)}" fill="none" stroke="#ffffff" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>`);
    } else {
      ctx.beginPath();
      wi.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
    }
  }
  // Points de jonction
  for (const j of computeJunctions(components, wires, symbols)) {
    ctx.out.push(`<circle cx="${j.x}" cy="${j.y}" r="3.5" fill="#111"/>`);
  }
  // Composants + étiquettes (surface des pièces calculée ici : l'export ne dépend pas de l'écran)
  const areas = {};
  if (isPlan) for (const r of computeRooms(components, wires).rooms) if (!r.leaked && r.sharedWith === null) areas[r.id] = r.area;
  for (const c of components) {
    const sym = symbols[c.type];
    ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(((c.rot || 0) * Math.PI) / 180);
    ctx.strokeStyle = '#111'; ctx.fillStyle = '#111'; ctx.lineWidth = 2;
    sym.draw(ctx, c.type === 'room' ? { ...c, __area: areas[c.id] } : c); ctx.restore();
    const txt = labelText(c);
    if (txt && !sym.ownLabel) {
      const la = labelAnchor(c, sym);
      ctx.fillStyle = '#333'; ctx.font = '11px sans-serif'; ctx.textAlign = la.align; ctx.textBaseline = 'alphabetic';
      ctx.fillText(txt, la.x, la.y);
    }
  }

  // Repères de circuits (plan d'implantation)
  if (tags) for (const c of components) { const t = tags.map[c.id]; if (t) drawCircuitTag(ctx, c, t, 1); }
  // Légende : symboles électriques et quantités, puis circuits
  if (legend && legend.length) {
    const lx = planRight + 20;
    let y = minY + 20;
    // murs du plan : cloisons sèches (montants) et maçonnerie (hachures)
    const mats = typeof wallMaterial === 'function' ? wires.filter((w) => w.kind === 'wall').map((w) => WALL_MATS[wallMaterial(w).mat]) : [];
    const wallKinds = [mats.some((m) => m.hollow) && ['placo', 'Cloison sèche (montants tous les 60 cm)'], mats.some((m) => !m.hollow) && ['parpaing', 'Maçonnerie']].filter(Boolean);
    ctx.out.push(`<rect x="${lx - 10}" y="${y - 12}" width="${LW - 30}" height="${legend.length * 34 + (tags ? 30 + tags.list.length * 20 : 0) + (wallKinds.length ? 30 + wallKinds.length * 22 : 0) + 44}" fill="#fafbfc" stroke="#1a2230" stroke-width="1"/>`);
    ctx.out.push(`<text x="${lx}" y="${y + 8}" font-family="sans-serif" font-size="15" font-weight="bold" fill="#1a2230">Légende</text>`);
    y += 36;
    for (const it of legend) {
      const sym = symbols[it.type], sc = Math.min(0.5, 30 / Math.max(sym.bbox.w, sym.bbox.h));
      ctx.save(); ctx.translate(lx + 18, y - 4); ctx.scale(sc, sc);
      ctx.strokeStyle = '#111'; ctx.fillStyle = '#111'; ctx.lineWidth = 2;
      ctx.translate(-(sym.bbox.x + sym.bbox.w / 2), -(sym.bbox.y + sym.bbox.h / 2));
      sym.draw(ctx, { type: it.type, value: '', closed: true });
      ctx.restore();
      ctx.out.push(`<text x="${lx + 44}" y="${y}" font-family="sans-serif" font-size="11.5" fill="#1a2230">${_esc(it.name)}</text>`);
      ctx.out.push(`<text x="${lx + LW - 50}" y="${y}" font-family="sans-serif" font-size="11.5" font-weight="bold" fill="#1a2230" text-anchor="end">× ${it.count}</text>`);
      y += 34;
    }
    if (wallKinds.length) {
      ctx.out.push(`<text x="${lx}" y="${y + 6}" font-family="sans-serif" font-size="13" font-weight="bold" fill="#1a2230">Murs</text>`);
      y += 26;
      for (const [mat, label] of wallKinds) {
        const w = { kind: 'wall', mat, points: [{ x: lx, y: y - 4 }, { x: lx + 64, y: y - 4 }] };
        ctx.out.push(`<path d="M${lx} ${y - 4}L${lx + 64} ${y - 4}" stroke="#1f2733" stroke-width="9"/>`);
        ctx.out.push(`<path d="${wallMarks(w).map(([x1, y1, x2, y2]) => `M${ctx._n(x1)} ${ctx._n(y1)}L${ctx._n(x2)} ${ctx._n(y2)}`).join('')}" stroke="#ffffff" stroke-width="1.1"/>`);
        ctx.out.push(`<text x="${lx + 76}" y="${y}" font-family="sans-serif" font-size="11" fill="#1a2230">${_esc(label)}</text>`);
        y += 22;
      }
    }
    if (tags) {
      ctx.out.push(`<text x="${lx}" y="${y + 6}" font-family="sans-serif" font-size="13" font-weight="bold" fill="#1a2230">Circuits</text>`);
      y += 26;
      for (const t of tags.list) {
        ctx.out.push(`<rect x="${lx}" y="${y - 10}" width="22" height="12" fill="${t.color}" stroke="#1a2230" stroke-width="0.8"/>`);
        ctx.out.push(`<text x="${lx + 30}" y="${y}" font-family="sans-serif" font-size="11" fill="#1a2230"><tspan font-weight="bold">${_esc(t.id)}</tspan> ${_esc(t.name)} — ${t.In} A</text>`);
        y += 20;
      }
    }
  }

  // Cotations des murs
  if (isPlan) {
    for (const d of wallDimensions(wires)) {
      const deg = Math.round((d.angle * 180) / Math.PI);
      ctx.out.push(`<text x="0" y="0" dy="0.35em" transform="translate(${ctx._n(d.x)} ${ctx._n(d.y)}) rotate(${deg})" font-family="sans-serif" font-size="11" fill="#444" text-anchor="middle">${_esc(d.text)}</text>`);
    }
  }

  // Cartouche
  const title = (meta && meta.title) || 'Schéma électrique';
  const author = (meta && meta.author) || '';
  const date = (meta && meta.date) || '';
  const by = maxY - 50;
  const cartouche =
    `<rect x="${minX + 10}" y="${by}" width="${W - 20}" height="40" fill="none" stroke="#111" stroke-width="1.5"/>` +
    `<text x="${minX + 20}" y="${by + 17}" font-family="sans-serif" font-size="14" font-weight="bold" fill="#111">${_esc(title)}</text>` +
    `<text x="${minX + 20}" y="${by + 33}" font-family="sans-serif" font-size="11" fill="#444">${_esc([author, date].filter(Boolean).join(' — '))}</text>` +
    `<text x="${maxX - 20}" y="${by + 33}" font-family="sans-serif" font-size="10" fill="#888" text-anchor="end">ÉlectriCAD</text>`;

  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${W} ${H}" width="${W}" height="${H}">` +
    `<rect x="${minX}" y="${minY}" width="${W}" height="${H}" fill="#ffffff"/>` +
    ctx.out.join('') + cartouche + `</svg>`;
}
