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
    draw(ctx) {
      line(ctx, -40, 0, -20, 0);
      dot(ctx, -20, 0, 2.5); dot(ctx, 20, 0, 2.5);
      line(ctx, -20, 0, 16, -14);
      line(ctx, 20, 0, 40, 0);
    },
  },
  push_button: {
    name: 'Bouton poussoir', category: 'Commutation', prefix: 'SW',
    terminals: T2, bbox: { x: -40, y: -22, w: 80, h: 26 },
    draw(ctx) {
      line(ctx, -40, 0, -16, 0);
      line(ctx, 16, 0, 40, 0);
      line(ctx, -16, -6, 16, -6);
      line(ctx, 0, -6, 0, -18);
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
};

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
