/*
 * copy-web.js — Copie l'application web dans le dossier d'une application
 * empaquetée (bureau Electron, Android Capacitor).
 *
 *   node tools/copy-web.js <dossier-cible> [--entry app]
 *
 * --entry app : l'éditeur devient la page d'accueil (index.html) — Capacitor
 * démarre toujours sur index.html ; le site vitrine passe en accueil.html.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const out = path.resolve(process.argv[2] || 'www');
const entryApp = process.argv.includes('--entry') && process.argv[process.argv.indexOf('--entry') + 1] === 'app';
const ITEMS = ['index.html', 'app.html', 'manifest.webmanifest', 'sw.js', 'css', 'js', 'icons', 'fonts', 'img', 'samples'];

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const item of ITEMS) fs.cpSync(path.join(ROOT, item), path.join(out, item), { recursive: true });

if (entryApp) {
  const retarget = (html) => html.replace(/href="index\.html"/g, 'href="accueil.html"');
  const landing = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  const editor = fs.readFileSync(path.join(out, 'app.html'), 'utf8');
  fs.writeFileSync(path.join(out, 'accueil.html'), retarget(landing));
  fs.writeFileSync(path.join(out, 'index.html'), retarget(editor));
  fs.writeFileSync(path.join(out, 'app.html'), retarget(editor));
}
// Hors navigateur, pas de service worker : l'application est déjà locale
fs.rmSync(path.join(out, 'sw.js'), { force: true });
console.log(`Application web copiée dans ${path.relative(process.cwd(), out) || '.'}${entryApp ? ' (éditeur en page d’accueil)' : ''}`);
