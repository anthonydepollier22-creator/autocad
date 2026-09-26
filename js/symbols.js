/*
 * symbols.js — Bibliothèque de symboles électriques.
 *
 * Chaque symbole est défini dans un repère local centré sur (0,0).
 * L'unité de base U = 20 px (= un pas de grille).
 *
 * Champs :
 *   name      : libellé affiché dans la palette
 *   category  : catégorie pour regrouper la palette
 *   prefix    : préfixe de référence automatique (R1, C1, ...)
 *   terminals : points de connexion [{x,y}, ...] (multiples du pas de grille)
 *   bbox      : boîte englobante {x,y,w,h} pour la sélection / hit-test
 *   draw(ctx) : trace le symbole (le contexte est déjà translaté/pivoté)
 */

const U = 20; // pas de grille en unités "monde"

// Outils de dessin réutilisables -------------------------------------------
function line(ctx, x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}
function circle(ctx, cx, cy, r, fill) {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  if (fill) ctx.fill();
  else ctx.stroke();
}
function poly(ctx, pts, close) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  if (close) ctx.closePath();
  ctx.stroke();
}
// Texte tracé dans le repère local mais redressé (non miroir)
function dot(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r || 3, 0, Math.PI * 2);
  ctx.fill();
}

// Terminaux horizontaux standard (2 broches, ± 2 pas)
const T2 = [{ x: -2 * U, y: 0 }, { x: 2 * U, y: 0 }];

const SYMBOLS = {
  // ----- Passifs ---------------------------------------------------------
  resistor: {
    name: 'Résistance', category: 'Passifs', prefix: 'R',
    terminals: T2, bbox: { x: -40, y: -12, w: 80, h: 24 },
    draw(ctx) {
      line(ctx, -40, 0, -20, 0);
      poly(ctx, [[-20, 0], [-16, -8], [-8, 8], [0, -8], [8, 8], [16, -8], [20, 0]]);
      line(ctx, 20, 0, 40, 0);
    },
  },
  resistor_iec: {
    name: 'Résistance (CEI)', category: 'Passifs', prefix: 'R',
    terminals: T2, bbox: { x: -40, y: -10, w: 80, h: 20 },
    draw(ctx) {
      line(ctx, -40, 0, -20, 0);
      ctx.strokeRect(-20, -8, 40, 16);
      line(ctx, 20, 0, 40, 0);
    },
  },
  potentiometer: {
    name: 'Potentiomètre', category: 'Passifs', prefix: 'RV',
    terminals: [{ x: -2 * U, y: 0 }, { x: 2 * U, y: 0 }, { x: 0, y: -2 * U }],
    bbox: { x: -40, y: -40, w: 80, h: 50 },
    draw(ctx) {
      line(ctx, -40, 0, -20, 0);
      ctx.strokeRect(-20, -8, 40, 16);
      line(ctx, 20, 0, 40, 0);
      line(ctx, 0, -40, 0, -14);
      poly(ctx, [[-6, -20], [0, -12], [6, -20]]); // flèche du curseur
    },
  },
  capacitor: {
    name: 'Condensateur', category: 'Passifs', prefix: 'C',
    terminals: T2, bbox: { x: -40, y: -14, w: 80, h: 28 },
    draw(ctx) {
      line(ctx, -40, 0, -6, 0);
      line(ctx, -6, -14, -6, 14);
      line(ctx, 6, -14, 6, 14);
      line(ctx, 6, 0, 40, 0);
    },
  },
  capacitor_pol: {
    name: 'Condensateur polarisé', category: 'Passifs', prefix: 'C',
    terminals: T2, bbox: { x: -40, y: -14, w: 80, h: 28 },
    draw(ctx) {
      line(ctx, -40, 0, -6, 0);
      line(ctx, -6, -14, -6, 14);
      ctx.beginPath();
      ctx.arc(16, 0, 14, Math.PI * 0.62, -Math.PI * 0.62); // plaque incurvée
      ctx.stroke();
      line(ctx, 6, 0, 40, 0);
      // signe +
      line(ctx, -16, -16, -8, -16);
      line(ctx, -12, -20, -12, -12);
    },
  },
  inductor: {
    name: 'Bobine', category: 'Passifs', prefix: 'L',
    terminals: T2, bbox: { x: -40, y: -10, w: 80, h: 16 },
    draw(ctx) {
      line(ctx, -40, 0, -24, 0);
      ctx.beginPath();
      ctx.moveTo(-24, 0);
      for (const cx of [-18, -6, 6, 18]) ctx.arc(cx, 0, 6, Math.PI, 2 * Math.PI, false);
      ctx.stroke();
      line(ctx, 24, 0, 40, 0);
    },
  },
  fuse: {
    name: 'Fusible', category: 'Passifs', prefix: 'F',
    terminals: T2, bbox: { x: -40, y: -8, w: 80, h: 16 },
    draw(ctx) {
      line(ctx, -40, 0, -20, 0);
      ctx.strokeRect(-20, -7, 40, 14);
      line(ctx, -20, 0, 20, 0);
      line(ctx, 20, 0, 40, 0);
    },
  },

  // ----- Sources ---------------------------------------------------------
  battery: {
    name: 'Pile', category: 'Sources', prefix: 'BT',
    terminals: T2, bbox: { x: -40, y: -16, w: 80, h: 32 },
    draw(ctx) {
      line(ctx, -40, 0, -6, 0);
      line(ctx, -6, -16, -6, 16); // borne +
      line(ctx, 6, -8, 6, 8);     // borne -
      line(ctx, 6, 0, 40, 0);
      line(ctx, -14, -14, -8, -14); // +
      line(ctx, -11, -17, -11, -11);
    },
  },
  battery2: {
    name: 'Batterie', category: 'Sources', prefix: 'BT',
    terminals: T2, bbox: { x: -40, y: -16, w: 80, h: 32 },
    draw(ctx) {
      line(ctx, -40, 0, -18, 0);
      line(ctx, -18, -16, -18, 16);
      line(ctx, -10, -8, -10, 8);
      line(ctx, 2, -16, 2, 16);
      line(ctx, 10, -8, 10, 8);
      line(ctx, 10, 0, 40, 0);
    },
  },
  dc_source: {
    name: 'Source de tension', category: 'Sources', prefix: 'V',
    terminals: T2, bbox: { x: -40, y: -18, w: 80, h: 36 },
    draw(ctx) {
      line(ctx, -40, 0, -16, 0);
      circle(ctx, 0, 0, 16);
      line(ctx, 16, 0, 40, 0);
      // + et -
      line(ctx, -10, -4, -4, -4); line(ctx, -7, -7, -7, -1);
      line(ctx, 4, -4, 10, -4);
    },
  },
  ac_source: {
    name: 'Source AC', category: 'Sources', prefix: 'V',
    terminals: T2, bbox: { x: -40, y: -18, w: 80, h: 36 },
    draw(ctx) {
      line(ctx, -40, 0, -16, 0);
      circle(ctx, 0, 0, 16);
      line(ctx, 16, 0, 40, 0);
      ctx.beginPath();
      ctx.moveTo(-8, 0);
      ctx.quadraticCurveTo(-4, -10, 0, 0);
      ctx.quadraticCurveTo(4, 10, 8, 0);
      ctx.stroke();
    },
  },
  current_source: {
    name: 'Source de courant', category: 'Sources', prefix: 'I',
    terminals: T2, bbox: { x: -40, y: -18, w: 80, h: 36 },
    draw(ctx) {
      line(ctx, -40, 0, -16, 0);
      circle(ctx, 0, 0, 16);
      line(ctx, 16, 0, 40, 0);
      line(ctx, 0, -9, 0, 9);
      poly(ctx, [[-4, 3], [0, 9], [4, 3]]);
    },
  },

  // ----- Semi-conducteurs ------------------------------------------------
  diode: {
    name: 'Diode', category: 'Semi-conducteurs', prefix: 'D',
    terminals: T2, bbox: { x: -40, y: -12, w: 80, h: 24 },
    draw(ctx) {
      line(ctx, -40, 0, -12, 0);
      poly(ctx, [[-12, -11], [-12, 11], [12, 0]], true);
      line(ctx, 12, -11, 12, 11);
      line(ctx, 12, 0, 40, 0);
    },
  },
  led: {
    name: 'LED', category: 'Semi-conducteurs', prefix: 'D',
    terminals: T2, bbox: { x: -40, y: -18, w: 80, h: 30 },
    draw(ctx) {
      line(ctx, -40, 0, -12, 0);
      poly(ctx, [[-12, -11], [-12, 11], [12, 0]], true);
      line(ctx, 12, -11, 12, 11);
      line(ctx, 12, 0, 40, 0);
      // flèches lumineuses
      line(ctx, 4, -14, 12, -22); poly(ctx, [[8, -20], [12, -22], [10, -18]]);
      line(ctx, 10, -10, 18, -18); poly(ctx, [[14, -16], [18, -18], [16, -14]]);
    },
  },
  zener: {
    name: 'Diode Zener', category: 'Semi-conducteurs', prefix: 'D',
    terminals: T2, bbox: { x: -40, y: -12, w: 80, h: 24 },
    draw(ctx) {
      line(ctx, -40, 0, -12, 0);
      poly(ctx, [[-12, -11], [-12, 11], [12, 0]], true);
      poly(ctx, [[6, -15], [12, -11], [12, 11], [18, 15]]);
      line(ctx, 12, 0, 40, 0);
    },
  },
  transistor_npn: {
    name: 'Transistor NPN', category: 'Semi-conducteurs', prefix: 'Q',
    terminals: [{ x: -2 * U, y: 0 }, { x: 0, y: -2 * U }, { x: 0, y: 2 * U }],
    bbox: { x: -40, y: -40, w: 60, h: 80 },
    draw(ctx) {
      line(ctx, -40, 0, -14, 0);
      circle(ctx, 6, 0, 20);
      line(ctx, -14, -12, -14, 12); // base
      line(ctx, -14, -6, 6, -16); line(ctx, 6, -16, 0, -40); // collecteur
      line(ctx, -14, 6, 6, 16); line(ctx, 6, 16, 0, 40);     // émetteur
      poly(ctx, [[0, 9], [6, 16], [-2, 16]]); // flèche émetteur (sortante)
    },
  },
  transistor_pnp: {
    name: 'Transistor PNP', category: 'Semi-conducteurs', prefix: 'Q',
    terminals: [{ x: -2 * U, y: 0 }, { x: 0, y: -2 * U }, { x: 0, y: 2 * U }],
    bbox: { x: -40, y: -40, w: 60, h: 80 },
    draw(ctx) {
      line(ctx, -40, 0, -14, 0);
      circle(ctx, 6, 0, 20);
      line(ctx, -14, -12, -14, 12);
      line(ctx, -14, -6, 6, -16); line(ctx, 6, -16, 0, -40);
      line(ctx, -14, 6, 6, 16); line(ctx, 6, 16, 0, 40);
      poly(ctx, [[-14, 6], [-6, 4], [-8, 12]]); // flèche entrante
    },
  },

  // ----- Sorties / mesures ----------------------------------------------
  lamp: {
    name: 'Lampe', category: 'Sorties', prefix: 'LA',
    terminals: T2, bbox: { x: -40, y: -16, w: 80, h: 32 },
    draw(ctx) {
      line(ctx, -40, 0, -16, 0);
      circle(ctx, 0, 0, 16);
      line(ctx, -11, -11, 11, 11);
      line(ctx, -11, 11, 11, -11);
      line(ctx, 16, 0, 40, 0);
    },
  },
  motor: {
    name: 'Moteur', category: 'Sorties', prefix: 'M',
    terminals: T2, bbox: { x: -40, y: -18, w: 80, h: 36 },
    draw(ctx) {
      line(ctx, -40, 0, -16, 0);
      circle(ctx, 0, 0, 16);
      line(ctx, 16, 0, 40, 0);
      meterLetter(ctx, 'M');
    },
  },
  buzzer: {
    name: 'Buzzer', category: 'Sorties', prefix: 'BZ',
    terminals: T2, bbox: { x: -40, y: -16, w: 80, h: 28 },
    draw(ctx) {
      line(ctx, -40, 0, -16, 0);
      ctx.beginPath();
      ctx.arc(0, 4, 16, Math.PI, 0);
      ctx.lineTo(-16, 4);
      ctx.stroke();
      line(ctx, 16, 0, 40, 0);
    },
  },
  voltmeter: {
    name: 'Voltmètre', category: 'Mesures', prefix: 'V',
    terminals: T2, bbox: { x: -40, y: -18, w: 80, h: 36 },
    draw(ctx) {
      line(ctx, -40, 0, -16, 0); circle(ctx, 0, 0, 16); line(ctx, 16, 0, 40, 0);
      meterLetter(ctx, 'V');
    },
  },
  ammeter: {
    name: 'Ampèremètre', category: 'Mesures', prefix: 'A',
    terminals: T2, bbox: { x: -40, y: -18, w: 80, h: 36 },
    draw(ctx) {
      line(ctx, -40, 0, -16, 0); circle(ctx, 0, 0, 16); line(ctx, 16, 0, 40, 0);
      meterLetter(ctx, 'A');
    },
  },
  ohmmeter: {
    name: 'Ohmmètre', category: 'Mesures', prefix: 'Ω',
    terminals: T2, bbox: { x: -40, y: -18, w: 80, h: 36 },
    draw(ctx) {
      line(ctx, -40, 0, -16, 0); circle(ctx, 0, 0, 16); line(ctx, 16, 0, 40, 0);
      meterLetter(ctx, 'Ω');
    },
  },

  // ----- Commutation -----------------------------------------------------
  switch: {
    name: 'Interrupteur', category: 'Commutation', prefix: 'SW',
    terminals: T2, bbox: { x: -40, y: -18, w: 80, h: 24 },
    draw(ctx, c) {
      line(ctx, -40, 0, -20, 0);
      dot(ctx, -20, 0, 2.5); dot(ctx, 20, 0, 2.5);
      line(ctx, -20, 0, c && c.closed ? 20 : 16, c && c.closed ? 0 : -14);
      line(ctx, 20, 0, 40, 0);
    },
  },
  push_button: {
    name: 'Bouton poussoir', category: 'Commutation', prefix: 'SW',
    terminals: T2, bbox: { x: -40, y: -22, w: 80, h: 26 },
    draw(ctx, c) {
      const y = c && c.closed ? -1 : -6;
      line(ctx, -40, 0, -16, 0);
      line(ctx, 16, 0, 40, 0);
      if (!(c && c.closed)) { line(ctx, -16, 0, -16, -6); line(ctx, 16, 0, 16, -6); }
      line(ctx, -16, y, 16, y);
      line(ctx, 0, y, 0, -18);
      line(ctx, -8, -18, 8, -18);
    },
  },
  relay: {
    name: 'Relais (bobine)', category: 'Commutation', prefix: 'K',
    terminals: T2, bbox: { x: -40, y: -14, w: 80, h: 28 },
    draw(ctx) {
      line(ctx, -40, 0, -20, 0);
      ctx.strokeRect(-20, -12, 40, 24);
      line(ctx, -20, -12, 20, 12);
      line(ctx, 20, 0, 40, 0);
    },
  },

  // ----- Connexions ------------------------------------------------------
  ground: {
    name: 'Masse', category: 'Connexions', prefix: 'GND',
    terminals: [{ x: 0, y: -1 * U }], bbox: { x: -16, y: -20, w: 32, h: 36 },
    draw(ctx) {
      line(ctx, 0, -20, 0, 0);
      line(ctx, -14, 0, 14, 0);
      line(ctx, -9, 6, 9, 6);
      line(ctx, -4, 12, 4, 12);
    },
  },
  vcc: {
    name: 'Alimentation (VCC)', category: 'Connexions', prefix: 'VCC',
    terminals: [{ x: 0, y: 1 * U }], bbox: { x: -14, y: -10, w: 28, h: 30 },
    draw(ctx) {
      line(ctx, 0, 20, 0, -2);
      line(ctx, -12, -2, 12, -2);
    },
  },
  junction: {
    name: 'Nœud', category: 'Connexions', prefix: 'N',
    terminals: [{ x: 0, y: 0 }], bbox: { x: -8, y: -8, w: 16, h: 16 },
    draw(ctx) { dot(ctx, 0, 0, 4); },
  },
  antenna: {
    name: 'Antenne', category: 'Connexions', prefix: 'ANT',
    terminals: [{ x: 0, y: 2 * U }], bbox: { x: -16, y: -20, w: 32, h: 60 },
    draw(ctx) {
      line(ctx, 0, 40, 0, 0);
      line(ctx, 0, 0, -14, -18);
      line(ctx, 0, 0, 14, -18);
    },
  },
  transformer: {
    name: 'Transformateur', category: 'Connexions', prefix: 'T',
    terminals: [
      { x: -2 * U, y: -1 * U }, { x: -2 * U, y: 1 * U },
      { x: 2 * U, y: -1 * U }, { x: 2 * U, y: 1 * U },
    ],
    bbox: { x: -40, y: -28, w: 80, h: 56 },
    draw(ctx) {
      // bobine gauche
      line(ctx, -40, -20, -10, -20);
      line(ctx, -40, 20, -10, 20);
      ctx.beginPath();
      ctx.moveTo(-10, -20);
      for (const cy of [-15, -5, 5, 15]) ctx.arc(-10, cy, 5, -Math.PI / 2, Math.PI / 2, true);
      ctx.stroke();
      // noyau
      line(ctx, -2, -22, -2, 22);
      line(ctx, 2, -22, 2, 22);
      // bobine droite
      line(ctx, 40, -20, 10, -20);
      line(ctx, 40, 20, 10, 20);
      ctx.beginPath();
      ctx.moveTo(10, -20);
      for (const cy of [-15, -5, 5, 15]) ctx.arc(10, cy, 5, -Math.PI / 2, Math.PI / 2, false);
      ctx.stroke();
    },
  },

  // ----- Logique (numérique) ---------------------------------------------
  gate_and: {
    name: 'Porte ET', category: 'Logique', prefix: 'U',
    terminals: [{ x: -2 * U, y: -U }, { x: -2 * U, y: U }, { x: 2 * U, y: 0 }],
    bbox: { x: -40, y: -24, w: 80, h: 48 },
    draw(ctx) { gateLeads2(ctx); andBody(ctx); line(ctx, 20, 0, 40, 0); },
  },
  gate_nand: {
    name: 'Porte NON-ET', category: 'Logique', prefix: 'U',
    terminals: [{ x: -2 * U, y: -U }, { x: -2 * U, y: U }, { x: 2 * U, y: 0 }],
    bbox: { x: -40, y: -24, w: 80, h: 48 },
    draw(ctx) { gateLeads2(ctx); andBody(ctx); circle(ctx, 24, 0, 4); line(ctx, 28, 0, 40, 0); },
  },
  gate_or: {
    name: 'Porte OU', category: 'Logique', prefix: 'U',
    terminals: [{ x: -2 * U, y: -U }, { x: -2 * U, y: U }, { x: 2 * U, y: 0 }],
    bbox: { x: -40, y: -24, w: 80, h: 48 },
    draw(ctx) { gateLeads2(ctx, -18); orBody(ctx); line(ctx, 22, 0, 40, 0); },
  },
  gate_nor: {
    name: 'Porte NON-OU', category: 'Logique', prefix: 'U',
    terminals: [{ x: -2 * U, y: -U }, { x: -2 * U, y: U }, { x: 2 * U, y: 0 }],
    bbox: { x: -40, y: -24, w: 80, h: 48 },
    draw(ctx) { gateLeads2(ctx, -18); orBody(ctx); circle(ctx, 26, 0, 4); line(ctx, 30, 0, 40, 0); },
  },
  gate_xor: {
    name: 'Porte OU-X', category: 'Logique', prefix: 'U',
    terminals: [{ x: -2 * U, y: -U }, { x: -2 * U, y: U }, { x: 2 * U, y: 0 }],
    bbox: { x: -40, y: -24, w: 80, h: 48 },
    draw(ctx) {
      gateLeads2(ctx, -24); orBody(ctx);
      ctx.beginPath(); ctx.moveTo(-26, -20); ctx.quadraticCurveTo(-12, 0, -26, 20); ctx.stroke();
      line(ctx, 22, 0, 40, 0);
    },
  },
  gate_not: {
    name: 'Porte NON (inverseur)', category: 'Logique', prefix: 'U',
    terminals: [{ x: -2 * U, y: 0 }, { x: 2 * U, y: 0 }],
    bbox: { x: -40, y: -18, w: 80, h: 36 },
    draw(ctx) {
      line(ctx, -40, 0, -18, 0);
      poly(ctx, [[-18, -15], [-18, 15], [16, 0]], true);
      circle(ctx, 20, 0, 4);
      line(ctx, 24, 0, 40, 0);
    },
  },
  clock: {
    name: 'Horloge', category: 'Logique', prefix: 'CLK',
    terminals: [{ x: 2 * U, y: 0 }], bbox: { x: -20, y: -18, w: 60, h: 36 },
    draw(ctx) {
      ctx.strokeRect(-20, -16, 40, 32);
      line(ctx, 20, 0, 40, 0);
      ctx.beginPath();
      ctx.moveTo(-14, 6); ctx.lineTo(-14, -6); ctx.lineTo(-4, -6);
      ctx.lineTo(-4, 6); ctx.lineTo(6, 6); ctx.lineTo(6, -6); ctx.lineTo(14, -6);
      ctx.stroke();
    },
  },
  logic_in: {
    name: 'Entrée logique', category: 'Logique', prefix: 'IN',
    terminals: [{ x: 2 * U, y: 0 }], bbox: { x: -20, y: -18, w: 60, h: 36 },
    draw(ctx, c) {
      ctx.strokeRect(-20, -16, 40, 32);
      line(ctx, 20, 0, 40, 0);
      ctx.save();
      ctx.fillStyle = c && c.high ? '#5ce08a' : ctx.strokeStyle;
      ctx.font = '18px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(c && c.high ? '1' : '0', 0, 1);
      ctx.restore();
    },
  },
  logic_out: {
    name: 'Sortie logique', category: 'Logique', prefix: 'OUT',
    terminals: [{ x: -2 * U, y: 0 }], bbox: { x: -40, y: -18, w: 56, h: 36 },
    draw(ctx, c) {
      line(ctx, -40, 0, -16, 0);
      if (c && c.__on) { ctx.save(); ctx.fillStyle = '#5ce08a'; circle(ctx, 0, 0, 15, true); ctx.restore(); }
      circle(ctx, 0, 0, 16);
    },
  },

  seven_seg: {
    name: 'Afficheur 7 segments', category: 'Logique', prefix: 'AFF',
    terminals: [{ x: -2 * U, y: -30 }, { x: -2 * U, y: -10 }, { x: -2 * U, y: 10 }, { x: -2 * U, y: 30 }],
    bbox: { x: -40, y: -40, w: 76, h: 80 },
    draw(ctx, c) {
      ctx.strokeRect(-30, -38, 64, 76);
      for (const y of [-30, -10, 10, 30]) line(ctx, -40, y, -30, y);
      // segments : a b c d e f g
      const seg = {
        a: [-4, -28, 16, -28], b: [18, -26, 18, -2], c: [18, 2, 18, 26],
        d: [-4, 28, 16, 28], e: [-6, 2, -6, 26], f: [-6, -26, -6, -2], g: [-4, 0, 16, 0],
      };
      const lit = c && c.__digit !== undefined ? (SEG7[c.__digit & 15] || '') : '';
      ctx.save();
      for (const k in seg) {
        const s = seg[k];
        if (lit.includes(k)) {
          ctx.save(); ctx.strokeStyle = '#5ce08a'; ctx.lineWidth = 4.5;
          line(ctx, s[0], s[1], s[2], s[3]); ctx.restore();
        } else {
          ctx.save(); ctx.globalAlpha = 0.25; line(ctx, s[0], s[1], s[2], s[3]); ctx.restore();
        }
      }
      ctx.restore();
    },
  },
  dff: {
    name: 'Bascule D', category: 'Logique', prefix: 'U',
    terminals: [{ x: -2 * U, y: -U }, { x: -2 * U, y: U }, { x: 2 * U, y: -U }, { x: 2 * U, y: U }],
    bbox: { x: -40, y: -28, w: 80, h: 56 },
    draw(ctx) {
      ctx.strokeRect(-26, -26, 52, 52);
      line(ctx, -40, -20, -26, -20); // D
      line(ctx, -40, 20, -26, 20);   // CLK
      line(ctx, 26, -20, 40, -20);   // Q
      line(ctx, 26, 20, 40, 20);     // /Q
      poly(ctx, [[-26, 14], [-18, 20], [-26, 26]]); // triangle horloge
      ctx.save();
      ctx.fillStyle = ctx.strokeStyle;
      ctx.font = '11px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText('D', -21, -19);
      ctx.textAlign = 'right';
      ctx.fillText('Q', 21, -19);
      ctx.fillText('Q', 21, 21);
      ctx.restore();
      line(ctx, 13, 14, 21, 14); // barre du /Q
    },
  },

  // ----- Domestique — norme française NF C 15-100 --------------------------
  breaker: {
    name: 'Disjoncteur', category: 'Domestique (NF)', prefix: 'Q',
    terminals: T2, bbox: { x: -40, y: -24, w: 80, h: 30 },
    draw(ctx, c) {
      const closed = !c || c.closed !== false;
      line(ctx, -40, 0, -20, 0);
      dot(ctx, -20, 0, 2.5); dot(ctx, 20, 0, 2.5);
      const ex = closed ? 20 : 14, ey = closed ? -3 : -16;
      line(ctx, -20, 0, ex, ey);
      // croix de coupure au milieu du levier (symbole disjoncteur)
      const mx = (-20 + ex) / 2, my = ey / 2;
      line(ctx, mx - 4, my - 4, mx + 4, my + 4);
      line(ctx, mx - 4, my + 4, mx + 4, my - 4);
      line(ctx, 20, 0, 40, 0);
    },
  },
  rcd: {
    name: 'Interrupteur différentiel', category: 'Domestique (NF)', prefix: 'ID',
    terminals: T2, bbox: { x: -40, y: -24, w: 80, h: 42 },
    draw(ctx, c) {
      const closed = !c || c.closed !== false;
      line(ctx, -40, 0, -20, 0);
      dot(ctx, -20, 0, 2.5); dot(ctx, 20, 0, 2.5);
      line(ctx, -20, 0, closed ? 20 : 14, closed ? -3 : -16);
      // tore de détection différentielle
      circle(ctx, 0, 10, 7);
      ctx.save();
      ctx.fillStyle = ctx.strokeStyle;
      ctx.font = '8px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText('30mA', 0, 19);
      ctx.restore();
      line(ctx, 20, 0, 40, 0);
    },
  },
  agcp: {
    name: 'Disjoncteur de branchement (AGCP 500 mA)', category: 'Domestique (NF)', prefix: 'QG',
    terminals: T2, bbox: { x: -40, y: -24, w: 80, h: 44 },
    draw(ctx, c) {
      const closed = !c || c.closed !== false;
      line(ctx, -40, 0, -20, 0);
      dot(ctx, -20, 0, 2.5); dot(ctx, 20, 0, 2.5);
      const ex = closed ? 20 : 14, ey = closed ? -3 : -16;
      line(ctx, -20, 0, ex, ey);
      const mx = (-20 + ex) / 2, my = ey / 2;
      line(ctx, mx - 4, my - 4, mx + 4, my + 4); line(ctx, mx - 4, my + 4, mx + 4, my - 4);
      line(ctx, 20, 0, 40, 0);
      ctx.beginPath(); ctx.ellipse(28, 0, 4, 8, 0, 0, Math.PI * 2); ctx.stroke(); // tore différentiel
      ctx.save(); ctx.fillStyle = ctx.strokeStyle; ctx.font = '8px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText('500mA', 4, 10); ctx.restore();
    },
  },
  meter_kwh: {
    name: 'Compteur d’énergie (kWh)', category: 'Domestique (NF)', prefix: 'CPT',
    terminals: T2, bbox: { x: -40, y: -16, w: 80, h: 32 },
    draw(ctx) {
      line(ctx, -40, 0, -20, 0); line(ctx, 20, 0, 40, 0);
      ctx.strokeRect(-20, -13, 40, 26);
      ctx.save(); ctx.fillStyle = ctx.strokeStyle; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('kWh', 0, 1); ctx.restore();
    },
  },
  contactor: {
    name: 'Contacteur (heures creuses)', category: 'Domestique (NF)', prefix: 'KM',
    terminals: T2, bbox: { x: -40, y: -34, w: 80, h: 40 },
    draw(ctx, c) {
      const closed = c && c.closed;
      line(ctx, -40, 0, -20, 0); line(ctx, 20, 0, 40, 0);
      ctx.beginPath(); ctx.arc(20, -3, 3, Math.PI / 2, (3 * Math.PI) / 2); ctx.stroke(); // contact de contacteur
      line(ctx, -20, 0, closed ? 20 : 14, closed ? -3 : -16);
      ctx.strokeRect(-7, -32, 14, 10); // bobine
      ctx.save(); ctx.setLineDash([3, 3]); line(ctx, 0, -22, 0, -8); ctx.restore();
    },
  },
  teleruptor: {
    name: 'Télérupteur', category: 'Domestique (NF)', prefix: 'KL',
    terminals: T2, bbox: { x: -40, y: -34, w: 80, h: 40 },
    draw(ctx, c) {
      const closed = c && c.closed;
      line(ctx, -40, 0, -20, 0); line(ctx, 20, 0, 40, 0);
      dot(ctx, -20, 0, 2.5); dot(ctx, 20, 0, 2.5);
      line(ctx, -20, 0, closed ? 20 : 14, closed ? -3 : -16);
      ctx.strokeRect(-7, -32, 14, 10);
      line(ctx, -7, -22, 7, -32); // bobine à impulsion (télérupteur)
      ctx.save(); ctx.setLineDash([3, 3]); line(ctx, 0, -22, 0, -8); ctx.restore();
    },
  },
  surge: {
    name: 'Parafoudre', category: 'Domestique (NF)', prefix: 'PF',
    terminals: T2, bbox: { x: -40, y: -14, w: 80, h: 28 },
    draw(ctx) {
      line(ctx, -40, 0, -16, 0); line(ctx, 16, 0, 40, 0);
      ctx.strokeRect(-16, -9, 32, 18);
      line(ctx, -8, -4, 0, 3); line(ctx, 0, 3, 2, -3); line(ctx, 2, -3, 9, 5); // éclair (varistance)
    },
  },
  ddr: {
    name: 'Disjoncteur différentiel 30 mA', category: 'Domestique (NF)', prefix: 'QD',
    terminals: T2, bbox: { x: -40, y: -24, w: 80, h: 42 },
    draw(ctx, c) {
      const closed = !c || c.closed !== false;
      line(ctx, -40, 0, -20, 0);
      dot(ctx, -20, 0, 2.5); dot(ctx, 20, 0, 2.5);
      const ex = closed ? 20 : 14, ey = closed ? -3 : -16;
      line(ctx, -20, 0, ex, ey);
      const mx = (-20 + ex) / 2, my = ey / 2;
      line(ctx, mx - 4, my - 4, mx + 4, my + 4); line(ctx, mx - 4, my + 4, mx + 4, my - 4); // coupure (disjoncteur)
      circle(ctx, 0, 10, 7); // tore différentiel
      ctx.save(); ctx.fillStyle = ctx.strokeStyle; ctx.font = '8px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText('30mA', 0, 19); ctx.restore();
      line(ctx, 20, 0, 40, 0);
    },
  },
  isolator: {
    name: 'Interrupteur-sectionneur', category: 'Domestique (NF)', prefix: 'QS',
    terminals: T2, bbox: { x: -40, y: -24, w: 80, h: 30 },
    draw(ctx, c) {
      const closed = !c || c.closed !== false;
      line(ctx, -40, 0, -20, 0);
      dot(ctx, -20, 0, 2.5);
      line(ctx, -20, 0, closed ? 20 : 14, closed ? -3 : -16);
      line(ctx, 20, -6, 20, 6); // trait de sectionnement
      line(ctx, 20, 0, 40, 0);
    },
  },
  timer_switch: {
    name: 'Interrupteur horaire', category: 'Domestique (NF)', prefix: 'IH',
    terminals: T2, bbox: { x: -40, y: -34, w: 80, h: 40 },
    draw(ctx, c) {
      const closed = c && c.closed;
      line(ctx, -40, 0, -20, 0); line(ctx, 20, 0, 40, 0);
      dot(ctx, -20, 0, 2.5); dot(ctx, 20, 0, 2.5);
      line(ctx, -20, 0, closed ? 20 : 14, closed ? -3 : -16);
      circle(ctx, 0, -26, 7); line(ctx, 0, -26, 0, -31); line(ctx, 0, -26, 4, -24); // horloge
      ctx.save(); ctx.setLineDash([3, 3]); line(ctx, 0, -19, 0, -8); ctx.restore();
    },
  },
  inverter: {
    name: 'Onduleur photovoltaïque', category: 'Domestique (NF)', prefix: 'OND',
    terminals: T2, bbox: { x: -40, y: -18, w: 80, h: 36 },
    draw(ctx) {
      line(ctx, -40, 0, -16, 0); line(ctx, 16, 0, 40, 0);
      ctx.strokeRect(-16, -16, 32, 32);
      line(ctx, -16, 16, 16, -16);
      line(ctx, -11, -8, -3, -8); line(ctx, -11, -4, -3, -4); // courant continu
      ctx.beginPath(); ctx.moveTo(2, 8); ctx.quadraticCurveTo(5, 3, 7.5, 7.5); ctx.quadraticCurveTo(10, 12, 13, 6); ctx.stroke(); // alternatif
    },
  },
  load_shed: {
    name: 'Délesteur', category: 'Domestique (NF)', prefix: 'DL',
    terminals: T2, bbox: { x: -40, y: -16, w: 80, h: 32 },
    draw(ctx) {
      line(ctx, -40, 0, -18, 0); line(ctx, 18, 0, 40, 0);
      ctx.strokeRect(-18, -13, 36, 26);
      ctx.save(); ctx.fillStyle = ctx.strokeStyle; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('DL', 0, 1); ctx.restore();
    },
  },
  socket: {
    name: 'Prise 2P+T', category: 'Domestique (NF)', prefix: 'PC',
    terminals: T2, bbox: { x: -40, y: -26, w: 80, h: 30 },
    draw(ctx) {
      line(ctx, -40, 0, -14, 0);
      line(ctx, 14, 0, 40, 0);
      ctx.beginPath();
      ctx.arc(0, 0, 14, Math.PI, 2 * Math.PI); // demi-cercle (prise)
      ctx.stroke();
      line(ctx, -14, 0, 14, 0);
      line(ctx, 0, -14, 0, -22);      // broche de terre
      line(ctx, -6, -22, 6, -22);
    },
  },
  sw_vv: {
    name: 'Va-et-vient', category: 'Domestique (NF)', prefix: 'SW',
    terminals: [{ x: -2 * U, y: 0 }, { x: 2 * U, y: -U }, { x: 2 * U, y: U }],
    bbox: { x: -40, y: -26, w: 80, h: 52 },
    draw(ctx, c) {
      line(ctx, -40, 0, -20, 0);
      dot(ctx, -20, 0, 2.5); dot(ctx, 20, -20, 2.5); dot(ctx, 20, 20, 2.5);
      line(ctx, -20, 0, 20, c && c.closed ? 20 : -20);
      line(ctx, 20, -20, 40, -20);
      line(ctx, 20, 20, 40, 20);
    },
  },
  bell: {
    name: 'Sonnerie', category: 'Domestique (NF)', prefix: 'H',
    terminals: T2, bbox: { x: -40, y: -18, w: 80, h: 22 },
    draw(ctx) {
      line(ctx, -40, 0, -16, 0);
      line(ctx, 16, 0, 40, 0);
      ctx.beginPath();
      ctx.arc(0, 0, 16, Math.PI, 2 * Math.PI); // cloche
      ctx.stroke();
      line(ctx, -16, 0, 16, 0);
    },
  },
};

// Tracés communs aux portes -------------------------------------------------
function gateLeads2(ctx, xEnd) {
  const xe = xEnd === undefined ? -20 : xEnd;
  line(ctx, -40, -20, xe, -20);
  line(ctx, -40, 20, xe, 20);
}
function andBody(ctx) {
  ctx.beginPath();
  ctx.moveTo(-20, 20); ctx.lineTo(-20, -20); ctx.lineTo(0, -20);
  ctx.arc(0, 0, 20, -Math.PI / 2, Math.PI / 2, false);
  ctx.lineTo(-20, 20);
  ctx.stroke();
}
function orBody(ctx) {
  ctx.beginPath();
  ctx.moveTo(-20, -20);
  ctx.quadraticCurveTo(-6, 0, -20, 20);
  ctx.quadraticCurveTo(8, 18, 22, 0);
  ctx.quadraticCurveTo(8, -18, -20, -20);
  ctx.stroke();
}

// ----- Plan de maison : architecture, mobilier, implantation électrique ----
// Ces symboles (plan: true) sont ignorés par la simulation et l'ERC.
Object.assign(SYMBOLS, {
  room: {
    name: 'Pièce (nom + surface)', category: 'Architecture', prefix: '', plan: true, noBom: true, ownLabel: true,
    terminals: [], bbox: { x: -50, y: -22, w: 100, h: 44 },
    draw(ctx, c) {
      ctx.save();
      ctx.fillStyle = ctx.strokeStyle;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = '600 15px sans-serif';
      ctx.fillText((c && c.value) || 'Pièce', 0, -8);
      ctx.font = '12px sans-serif';
      ctx.globalAlpha *= 0.75;
      const a = c && c.__area;
      ctx.fillText(a ? a.toFixed(1).replace('.', ',') + ' m²' : c && c.__leak ? 'pièce non fermée' : '— m²', 0, 10);
      ctx.restore();
    },
  },
  door: {
    name: 'Porte', category: 'Architecture', prefix: '', plan: true, noBom: true,
    terminals: [], bbox: { x: -44, y: -76, w: 88, h: 82 },
    draw(ctx) {
      line(ctx, -40, 0, 40, 0);          // seuil
      line(ctx, -40, 0, -40, -72);       // vantail
      ctx.beginPath();
      ctx.arc(-40, 0, 72, -Math.PI / 2, -Math.PI / 13); // débattement
      ctx.stroke();
    },
  },
  // Escalier droit (15 marches de 18,7 cm) : montée vers le côté local -y ;
  // valeur « haut » : l'arrivée à l'étage (trémie, garde-corps)
  stairs: {
    name: 'Escalier droit', category: 'Architecture', prefix: '', plan: true, noBom: true,
    terminals: [], bbox: { x: -52, y: -157, w: 104, h: 314 },
    draw(ctx, c) {
      const top = c && c.value === 'haut';
      ctx.beginPath(); ctx.rect(-50, -155, 100, 310); ctx.stroke();
      ctx.save();
      if (top) ctx.setLineDash([6, 5]);
      for (let i = 1; i < 14; i++) line(ctx, -50, 155 - i * 22, 50, 155 - i * 22);
      ctx.restore();
      // ligne de foulée et flèche de montée
      line(ctx, 0, 140, 0, -135);
      line(ctx, 0, -135, -9, -118); line(ctx, 0, -135, 9, -118);
      ctx.beginPath(); ctx.arc(0, 140, 5, 0, Math.PI * 2); ctx.stroke();
      if (top) { line(ctx, -50, -155, 50, 155); }
    },
  },
  level_title: {
    name: 'Titre de niveau', category: 'Architecture', prefix: '', plan: true, noBom: true, ownLabel: true,
    terminals: [], bbox: { x: -170, y: -24, w: 340, h: 48 },
    draw(ctx, c) {
      ctx.save();
      ctx.fillStyle = ctx.strokeStyle;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = '700 26px sans-serif';
      const t = ((c && c.value) || 'Niveau').toUpperCase();
      ctx.fillText(t, 0, -2);
      const m = ctx.measureText ? ctx.measureText(t) : null;
      const w = Math.min(320, m && m.width ? m.width : 200);
      line(ctx, -w / 2, 18, w / 2, 18);
      ctx.restore();
    },
  },
  garage_door: {
    name: 'Porte de garage (sectionnelle)', category: 'Architecture', prefix: '', plan: true, noBom: true,
    terminals: [], bbox: { x: -124, y: -10, w: 248, h: 20 },
    draw(ctx) {
      line(ctx, -120, -4, 120, -4);
      line(ctx, -120, 4, 120, 4);
      ctx.save();
      ctx.setLineDash([8, 6]);
      line(ctx, -120, 0, 120, 0);
      ctx.restore();
    },
  },
  window_a: {
    name: 'Fenêtre', category: 'Architecture', prefix: '', plan: true, noBom: true,
    terminals: [], bbox: { x: -44, y: -8, w: 88, h: 16 },
    draw(ctx) {
      line(ctx, -40, -6, 40, -6);
      line(ctx, -40, 0, 40, 0);
      line(ctx, -40, 6, 40, 6);
      line(ctx, -40, -6, -40, 6);
      line(ctx, 40, -6, 40, 6);
    },
  },

  bed: {
    name: 'Lit', category: 'Mobilier', prefix: '', plan: true, noBom: true,
    terminals: [], bbox: { x: -60, y: -80, w: 120, h: 160 },
    draw(ctx) {
      ctx.strokeRect(-60, -80, 120, 160);
      ctx.strokeRect(-48, -68, 44, 28);  // oreillers
      ctx.strokeRect(4, -68, 44, 28);
      line(ctx, -60, -28, 60, -28);      // drap
    },
  },
  sofa: {
    name: 'Canapé', category: 'Mobilier', prefix: '', plan: true, noBom: true,
    terminals: [], bbox: { x: -80, y: -40, w: 160, h: 80 },
    draw(ctx) {
      ctx.strokeRect(-80, -40, 160, 80);
      line(ctx, -80, -16, 80, -16);      // dossier
      line(ctx, -56, -16, -56, 40);      // accoudoirs -> coussins
      line(ctx, 0, -16, 0, 40);
      line(ctx, 56, -16, 56, 40);
    },
  },
  table: {
    name: 'Table', category: 'Mobilier', prefix: '', plan: true, noBom: true,
    terminals: [], bbox: { x: -60, y: -40, w: 120, h: 80 },
    draw(ctx) {
      ctx.strokeRect(-60, -40, 120, 80);
      ctx.strokeRect(-50, -30, 100, 60);
    },
  },
  counter: {
    name: 'Plan de travail + évier', category: 'Mobilier', prefix: '', plan: true, noBom: true,
    terminals: [], bbox: { x: -90, y: -30, w: 180, h: 60 },
    draw(ctx) {
      ctx.strokeRect(-90, -30, 180, 60);
      ctx.strokeRect(-70, -18, 40, 36);  // cuve
      circle(ctx, 40, 0, 16);            // plaque / bac rond
      circle(ctx, 40, 0, 8);
      line(ctx, -50, -24, -50, -18);     // robinet
    },
  },
  wardrobe: {
    name: 'Armoire', category: 'Mobilier', prefix: '', plan: true, noBom: true,
    terminals: [], bbox: { x: -60, y: -25, w: 120, h: 50 },
    draw(ctx) {
      ctx.strokeRect(-60, -25, 120, 50);
      line(ctx, -60, -25, 60, 25);
      line(ctx, -60, 25, 60, -25);
    },
  },

  panel_house: {
    name: 'Tableau électrique', category: 'Implantation élec.', prefix: 'TB', plan: true,
    terminals: [{ x: 0, y: 0 }], bbox: { x: -36, y: -26, w: 72, h: 52 },
    draw(ctx) {
      ctx.strokeRect(-36, -26, 72, 52);
      for (let r = 0; r < 2; r++)
        for (let i = 0; i < 4; i++) ctx.strokeRect(-30 + i * 16, -18 + r * 24, 12, 14);
    },
  },
  // Tableau divisionnaire (garage, atelier, annexe) : alimenté depuis le tableau principal
  panel_sub: {
    name: 'Tableau divisionnaire', category: 'Implantation élec.', prefix: 'TD', plan: true,
    terminals: [{ x: 0, y: 0 }], bbox: { x: -28, y: -22, w: 56, h: 44 },
    draw(ctx) {
      ctx.strokeRect(-28, -22, 56, 44);
      for (let i = 0; i < 3; i++) ctx.strokeRect(-22 + i * 16, -16, 12, 12);
      ctx.save(); ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('TD', 0, 16); ctx.restore();
    },
  },
  gtl: {
    name: 'GTL (gaine technique)', category: 'Implantation élec.', prefix: 'GTL', plan: true,
    terminals: [{ x: 0, y: 0 }], bbox: { x: -20, y: -60, w: 40, h: 120 },
    draw(ctx) {
      ctx.strokeRect(-20, -60, 40, 120);
      line(ctx, -20, -30, 20, -50);
      line(ctx, -20, 10, 20, -10);
      line(ctx, -20, 50, 20, 30);
    },
  },
  socket_wall: {
    name: 'Prise murale 2P+T', category: 'Implantation élec.', prefix: 'PC', plan: true,
    terminals: [{ x: 0, y: 0 }], bbox: { x: -12, y: -24, w: 24, h: 34 },
    draw(ctx) {
      circle(ctx, 0, 0, 9);
      line(ctx, 0, -9, 0, -18);
      line(ctx, -7, -18, 7, -18);
    },
  },
  switch_sa: {
    name: 'Interrupteur (SA)', category: 'Implantation élec.', prefix: 'SW', plan: true,
    terminals: [{ x: 0, y: 0 }], bbox: { x: -12, y: -22, w: 26, h: 30 },
    draw(ctx) {
      circle(ctx, 0, 0, 6);
      line(ctx, 4, -4, 13, -13);
      line(ctx, 9, -16, 16, -9);
    },
  },
  switch_vv_wall: {
    name: 'Va-et-vient (mural)', category: 'Implantation élec.', prefix: 'SW', plan: true,
    terminals: [{ x: 0, y: 0 }], bbox: { x: -12, y: -24, w: 28, h: 32 },
    draw(ctx) {
      circle(ctx, 0, 0, 6);
      line(ctx, 4, -4, 15, -15);
      line(ctx, 8, -17, 15, -10);
      line(ctx, 12, -21, 19, -14);
    },
  },
  dcl: {
    name: 'Point lumineux (DCL)', category: 'Implantation élec.', prefix: 'DCL', plan: true,
    terminals: [{ x: 0, y: 0 }], bbox: { x: -14, y: -14, w: 28, h: 28 },
    draw(ctx) {
      circle(ctx, 0, 0, 11);
      line(ctx, -8, -8, 8, 8);
      line(ctx, -8, 8, 8, -8);
    },
  },
  wall_light: {
    name: 'Applique murale', category: 'Implantation élec.', prefix: 'AP', plan: true,
    terminals: [{ x: 0, y: 0 }], bbox: { x: -14, y: -12, w: 28, h: 18 },
    draw(ctx) {
      ctx.beginPath();
      ctx.arc(0, -4, 11, 0, Math.PI); // demi-cercle contre mur
      ctx.stroke();
      line(ctx, -11, -4, 11, -4);
      line(ctx, -5, 1, 5, 11 - 20);
      line(ctx, -5, 11 - 20, 5, 1);
    },
  },
  jbox: {
    name: 'Boîte de dérivation', category: 'Implantation élec.', prefix: 'BD', plan: true,
    terminals: [{ x: 0, y: 0 }], bbox: { x: -10, y: -10, w: 20, h: 20 },
    draw(ctx) {
      circle(ctx, 0, 0, 8);
      dot(ctx, 0, 0, 3);
    },
  },
  smoke_detector: {
    name: 'Détecteur de fumée (DAAF)', category: 'Implantation élec.', prefix: 'DF', plan: true,
    terminals: [], bbox: { x: -13, y: -13, w: 26, h: 26 },
    draw(ctx) {
      circle(ctx, 0, 0, 11);
      circle(ctx, 0, 0, 5);
      dot(ctx, 0, 0, 1.6);
    },
  },
  rj45: {
    name: 'Prise RJ45 (communication)', category: 'Implantation élec.', prefix: 'RJ', plan: true,
    terminals: [], bbox: { x: -12, y: -22, w: 24, h: 32 },
    draw(ctx) {
      ctx.strokeRect(-9, -7, 18, 14);
      poly(ctx, [[-5, 3], [0, -3], [5, 3]], true);
      line(ctx, 0, -7, 0, -18);
    },
  },
});

// ----- Plan de maison : sanitaire, mobilier complémentaire, électroménager --
// Convention de pose : à rot = 0, le dos de l'objet est du côté local -y
// (contre le mur du haut). Les appareils ont une borne : ils sont alimentés.
Object.assign(SYMBOLS, {
  desk: {
    name: 'Bureau + chaise', category: 'Mobilier', prefix: '', plan: true, noBom: true,
    terminals: [], bbox: { x: -60, y: -30, w: 120, h: 96 },
    draw(ctx) {
      ctx.strokeRect(-60, -30, 120, 60);
      ctx.strokeRect(-20, 38, 40, 26);   // assise
      line(ctx, -20, 62, 20, 62);        // dossier
    },
  },
  tv_unit: {
    name: 'Meuble TV', category: 'Mobilier', prefix: '', plan: true, noBom: true,
    terminals: [], bbox: { x: -80, y: -22, w: 160, h: 44 },
    draw(ctx) {
      ctx.strokeRect(-80, -22, 160, 44);
      ctx.strokeRect(-55, -16, 110, 6);  // écran
    },
  },
  plant: {
    name: 'Plante', category: 'Mobilier', prefix: '', plan: true, noBom: true,
    terminals: [], bbox: { x: -24, y: -24, w: 48, h: 48 },
    draw(ctx) {
      circle(ctx, 0, 0, 22);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        line(ctx, 0, 0, Math.cos(a) * 17, Math.sin(a) * 17);
      }
    },
  },
  car: {
    name: 'Voiture', category: 'Mobilier', prefix: '', plan: true, noBom: true,
    terminals: [], bbox: { x: -90, y: -210, w: 180, h: 420 },
    draw(ctx) {
      ctx.beginPath();
      ctx.moveTo(-70, -190); ctx.quadraticCurveTo(0, -222, 70, -190);
      ctx.lineTo(84, 170); ctx.quadraticCurveTo(0, 214, -84, 170);
      ctx.closePath(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-62, -90); ctx.quadraticCurveTo(0, -112, 62, -90); ctx.stroke(); // pare-brise
      ctx.beginPath(); ctx.moveTo(-64, 110); ctx.quadraticCurveTo(0, 124, 64, 110); ctx.stroke();  // lunette
      line(ctx, -62, -90, -64, 110);
      line(ctx, 62, -90, 64, 110);
    },
  },

  shower: {
    name: 'Douche', category: 'Sanitaire', prefix: '', plan: true, noBom: true,
    terminals: [], bbox: { x: -45, y: -45, w: 90, h: 90 },
    draw(ctx) {
      ctx.strokeRect(-45, -45, 90, 90);
      line(ctx, -45, -45, 45, 45);
      line(ctx, -45, 45, 45, -45);
      circle(ctx, 0, 0, 5);
    },
  },
  bathtub: {
    name: 'Baignoire', category: 'Sanitaire', prefix: '', plan: true, noBom: true,
    terminals: [], bbox: { x: -85, y: -38, w: 170, h: 76 },
    draw(ctx) {
      ctx.strokeRect(-85, -38, 170, 76);
      ctx.beginPath();
      ctx.moveTo(-60, -28); ctx.lineTo(60, -28); ctx.quadraticCurveTo(76, 0, 60, 28);
      ctx.lineTo(-60, 28); ctx.quadraticCurveTo(-76, 0, -60, -28); ctx.stroke();
      circle(ctx, 60, 0, 4);
    },
  },
  washbasin: {
    name: 'Lavabo / vasque', category: 'Sanitaire', prefix: '', plan: true, noBom: true,
    terminals: [], bbox: { x: -30, y: -22, w: 60, h: 44 },
    draw(ctx) {
      ctx.strokeRect(-30, -22, 60, 44);
      ctx.beginPath(); ctx.ellipse(0, 4, 20, 13, 0, 0, Math.PI * 2); ctx.stroke();
      line(ctx, 0, -18, 0, -10);          // robinet
    },
  },
  toilet: {
    name: 'WC', category: 'Sanitaire', prefix: '', plan: true, noBom: true,
    terminals: [], bbox: { x: -20, y: -32, w: 40, h: 64 },
    draw(ctx) {
      ctx.strokeRect(-20, -32, 40, 16);   // réservoir
      ctx.beginPath(); ctx.ellipse(0, 8, 17, 22, 0, 0, Math.PI * 2); ctx.stroke();
    },
  },

  fridge: {
    name: 'Réfrigérateur', category: 'Électroménager', prefix: 'RF', plan: true,
    terminals: [{ x: 0, y: 0 }], bbox: { x: -30, y: -32, w: 60, h: 64 },
    draw(ctx) {
      ctx.strokeRect(-30, -32, 60, 64);
      line(ctx, -30, -22, 30, -22);
      line(ctx, 18, 0, 18, 22);           // poignée
    },
  },
  oven: {
    name: 'Four (colonne)', category: 'Électroménager', prefix: 'FO', plan: true,
    terminals: [{ x: 0, y: 0 }], bbox: { x: -30, y: -30, w: 60, h: 60 },
    draw(ctx) {
      ctx.strokeRect(-30, -30, 60, 60);
      ctx.strokeRect(-20, -8, 40, 30);
      for (const x of [-14, 0, 14]) circle(ctx, x, -19, 3);
    },
  },
  cooktop: {
    name: 'Plaque de cuisson (32 A)', category: 'Électroménager', prefix: 'PL', plan: true,
    terminals: [{ x: 0, y: 0 }], bbox: { x: -30, y: -30, w: 60, h: 60 },
    draw(ctx) {
      ctx.strokeRect(-30, -30, 60, 60);
      circle(ctx, -13, -12, 9); circle(ctx, 13, -12, 7);
      circle(ctx, -13, 13, 7); circle(ctx, 13, 13, 9);
    },
  },
  washer: {
    name: 'Lave-linge', category: 'Électroménager', prefix: 'LL', plan: true,
    terminals: [{ x: 0, y: 0 }], bbox: { x: -30, y: -30, w: 60, h: 60 },
    draw(ctx) {
      ctx.strokeRect(-30, -30, 60, 60);
      circle(ctx, 0, 4, 18);
      circle(ctx, 0, 4, 11);
    },
  },
  dishwasher: {
    name: 'Lave-vaisselle', category: 'Électroménager', prefix: 'LV', plan: true,
    terminals: [{ x: 0, y: 0 }], bbox: { x: -30, y: -30, w: 60, h: 60 },
    draw(ctx) {
      ctx.strokeRect(-30, -30, 60, 60);
      line(ctx, -22, -6, 22, -6);
      line(ctx, -22, 10, 22, 10);
      for (const x of [-12, 0, 12]) line(ctx, x, -6, x, 10);
    },
  },
  dryer: {
    name: 'Sèche-linge', category: 'Électroménager', prefix: 'SL', plan: true,
    terminals: [{ x: 0, y: 0 }], bbox: { x: -30, y: -30, w: 60, h: 60 },
    draw(ctx) {
      ctx.strokeRect(-30, -30, 60, 60);
      circle(ctx, 0, 4, 18);
      ctx.beginPath(); ctx.arc(0, 4, 9, 0, Math.PI * 1.5); ctx.stroke();
    },
  },
  water_heater: {
    name: 'Chauffe-eau électrique', category: 'Électroménager', prefix: 'CE', plan: true,
    terminals: [{ x: 0, y: 0 }], bbox: { x: -30, y: -30, w: 60, h: 60 },
    draw(ctx) {
      circle(ctx, 0, 0, 28);
      circle(ctx, 0, 0, 20);
      poly(ctx, [[-6, -10], [4, -1], [-4, 2], [6, 11]]);
    },
  },
  radiator: {
    name: 'Radiateur électrique', category: 'Électroménager', prefix: 'RAD', plan: true,
    terminals: [{ x: 0, y: 0 }], bbox: { x: -40, y: -8, w: 80, h: 16 },
    draw(ctx) {
      ctx.strokeRect(-40, -6, 80, 12);
      for (let x = -30; x <= 30; x += 10) line(ctx, x, -6, x, 6);
    },
  },
  ev_charger: {
    name: 'Borne de recharge (IRVE)', category: 'Électroménager', prefix: 'IRVE', plan: true,
    terminals: [{ x: 0, y: 0 }], bbox: { x: -16, y: -12, w: 32, h: 24 },
    draw(ctx) {
      ctx.strokeRect(-16, -10, 32, 20);
      poly(ctx, [[2, -7], [-5, 1], [1, 1], [-2, 8], [6, -1], [0, -1]], true);
    },
  },
  vmc: {
    name: 'VMC (extraction)', category: 'Électroménager', prefix: 'VMC', plan: true,
    terminals: [{ x: 0, y: 0 }], bbox: { x: -14, y: -14, w: 28, h: 28 },
    draw(ctx) {
      circle(ctx, 0, 0, 12);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * 5, Math.sin(a) * 5, 5, a, a + Math.PI);
        ctx.stroke();
      }
    },
  },
});
SYMBOLS.__order = Object.keys(SYMBOLS).filter((k) => !k.startsWith('__'));

// Segments allumés par chiffre (0-9, A-F) pour l'afficheur 7 segments
const SEG7 = ['abcdef', 'bc', 'abdeg', 'abcdg', 'bcfg', 'acdfg', 'acdefg', 'abc',
  'abcdefg', 'abcdfg', 'abcefg', 'cdefg', 'adef', 'bcdeg', 'adefg', 'aefg'];

// Lettre centrée pour les appareils de mesure (M/V/A/Ω)
function meterLetter(ctx, ch) {
  ctx.save();
  ctx.fillStyle = ctx.strokeStyle;
  ctx.font = '16px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(ch, 0, 1);
  ctx.restore();
}

// Référence automatique : R1, C1, etc. selon le préfixe.
SYMBOLS.__order = Object.keys(SYMBOLS).filter((k) => !k.startsWith('__'));

// Position de l'étiquette (repère + valeur) : au-dessus du symbole, ou à sa
// droite quand il est tourné à la verticale (schéma unifilaire, colonnes).
// Texte affiché près d'un symbole : repère, valeur et hauteur de pose choisie (h110 = axe à 1,10 m)
function labelText(c) { return [c.label, c.value, +c.h > 0 ? 'h' + Math.round(+c.h) : ''].filter(Boolean).join(' '); }
function labelAnchor(c, sym) {
  const a = ((c.rot || 0) * Math.PI) / 180;
  if (Math.abs(Math.sin(a)) > 0.7) return { x: c.x + sym.bbox.h / 2 + 8, y: c.y + 4, align: 'left' };
  return { x: c.x, y: c.y - sym.bbox.h / 2 - 12, align: 'center' };
}
