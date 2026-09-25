/*
 * ÉlectriCAD — application de bureau (Electron).
 *
 * Embarque l'application web (dossier www, copié par tools/copy-web.js) :
 * elle fonctionne entièrement hors ligne. Les liens externes s'ouvrent dans
 * le navigateur ; les exports (JSON, PNG, SVG) passent par la boîte
 * « Enregistrer sous » du système.
 */
const { app, BrowserWindow, Menu, shell, dialog, net } = require('electron');
const path = require('path');

const SITE = 'https://anthonydepollier22-creator.github.io/autocad/';
const REPO = 'https://github.com/anthonydepollier22-creator/autocad';
const LATEST_API = 'https://api.github.com/repos/anthonydepollier22-creator/autocad/releases/latest';
const WWW = path.join(__dirname, 'www');
let win = null;

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

// Exécute une action de l'interface (clic sur un bouton de la barre d'outils)
function click(id) {
  if (win) win.webContents.executeJavaScript(`document.getElementById(${JSON.stringify(id)})?.click()`);
}
// Annuler / rétablir / tout sélectionner : champ de texte actif, sinon l'éditeur
function editAction(kind) {
  if (!win) return;
  win.webContents.executeJavaScript(`(() => {
    const el = document.activeElement, typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
    const ed = window.__editor;
    if (${JSON.stringify(kind)} === 'undo') return typing ? document.execCommand('undo') : ed && ed.undo();
    if (${JSON.stringify(kind)} === 'redo') return typing ? document.execCommand('redo') : ed && ed.redo();
    if (typing) return el.select();
    if (ed) { ed.selection = new Set([...ed.components.map((c) => c.id), ...ed.wires.map((w) => w.id)]); ed.render(); ed._emit(); }
  })()`);
}

// « 1.2.0 » plus récent que « 1.10.0 » ? (comparaison numérique)
function isNewer(a, b) {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0), pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

// Nouvelle version publiée sur GitHub ? Discret au démarrage, explicite depuis le menu.
async function checkForUpdate(manual) {
  const current = app.getVersion();
  try {
    const res = await net.fetch(LATEST_API, { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok && res.status !== 404) throw new Error('HTTP ' + res.status);
    const rel = res.ok ? await res.json() : {}; // 404 : aucune version publiée
    const latest = String(rel.tag_name || '').replace(/^v/, '');
    if (latest && isNewer(latest, current)) {
      const { response } = await dialog.showMessageBox(win, {
        type: 'info', buttons: ['Télécharger', 'Plus tard'], defaultId: 0, cancelId: 1,
        title: 'Mise à jour disponible', message: `ÉlectriCAD ${latest} est disponible`,
        detail: `Vous utilisez la version ${current}. Téléchargez la nouvelle version puis installez-la par-dessus : vos schémas sont conservés.`,
      });
      if (response === 0) shell.openExternal(rel.html_url || REPO + '/releases/latest');
    } else if (manual) {
      dialog.showMessageBox(win, { type: 'info', buttons: ['OK'], title: 'Mise à jour', message: 'ÉlectriCAD est à jour', detail: `Version ${current}.` });
    }
  } catch (e) {
    if (manual) dialog.showMessageBox(win, { type: 'warning', buttons: ['OK'], title: 'Mise à jour', message: 'Impossible de vérifier les mises à jour', detail: 'Vérifiez la connexion à Internet, ou consultez la page des versions.' });
  }
}

function buildMenu() {
  const mac = process.platform === 'darwin';
  const template = [
    ...(mac ? [{ label: 'ÉlectriCAD', submenu: [{ role: 'about', label: 'À propos d’ÉlectriCAD' }, { type: 'separator' }, { role: 'hide', label: 'Masquer' }, { role: 'hideOthers', label: 'Masquer les autres' }, { type: 'separator' }, { role: 'quit', label: 'Quitter' }] }] : []),
    {
      label: 'Fichier',
      submenu: [
        { label: 'Nouveau schéma', accelerator: 'CmdOrCtrl+N', click: () => click('btn-new') },
        { label: 'Nouvelle maison…', accelerator: 'CmdOrCtrl+Shift+N', click: () => click('btn-houses') },
        { label: 'Ouvrir…', accelerator: 'CmdOrCtrl+O', click: () => click('btn-open') },
        { label: 'Enregistrer', accelerator: 'CmdOrCtrl+S', click: () => click('btn-save') },
        { type: 'separator' },
        { label: 'Exporter en PNG', click: () => click('btn-png') },
        { label: 'Exporter en SVG', click: () => click('btn-svg') },
        { label: 'Imprimer / PDF', accelerator: 'CmdOrCtrl+P', click: () => click('btn-print') },
        ...(mac ? [] : [{ type: 'separator' }, { role: 'quit', label: 'Quitter' }]),
      ],
    },
    {
      label: 'Édition',
      submenu: [
        { label: 'Annuler', accelerator: 'CmdOrCtrl+Z', click: () => editAction('undo') },
        { label: 'Rétablir', accelerator: mac ? 'Cmd+Shift+Z' : 'Ctrl+Y', click: () => editAction('redo') },
        { type: 'separator' },
        { role: 'cut', label: 'Couper' },
        { role: 'copy', label: 'Copier' },
        { role: 'paste', label: 'Coller' },
        { label: 'Tout sélectionner', accelerator: 'CmdOrCtrl+A', click: () => editAction('selectAll') },
      ],
    },
    {
      label: 'Affichage',
      submenu: [
        { label: 'Bibliothèque d’exemples', accelerator: 'CmdOrCtrl+E', click: () => click('btn-examples') },
        { label: 'Vue 3D', accelerator: 'F3', click: () => click('btn-3d') },
        { label: 'Thème clair / sombre', click: () => click('btn-theme') },
        { type: 'separator' },
        { role: 'zoomIn', label: 'Agrandir l’interface' },
        { role: 'zoomOut', label: 'Réduire l’interface' },
        { role: 'resetZoom', label: 'Taille normale' },
        { role: 'togglefullscreen', label: 'Plein écran' },
        { type: 'separator' },
        { role: 'reload', label: 'Recharger' },
        { role: 'toggleDevTools', label: 'Outils de développement' },
      ],
    },
    {
      label: 'Aide',
      submenu: [
        { label: 'Site ÉlectriCAD', click: () => shell.openExternal(SITE) },
        { label: 'Rechercher une mise à jour…', click: () => checkForUpdate(true) },
        { label: 'Code source et nouvelles versions', click: () => shell.openExternal(REPO + '/releases') },
        { type: 'separator' },
        {
          label: 'À propos',
          click: () => dialog.showMessageBox(win, {
            type: 'info', title: 'ÉlectriCAD', buttons: ['OK'],
            message: `ÉlectriCAD ${app.getVersion()}`,
            detail: 'Éditeur, simulateur et visualisation 3D de schémas et d’installations électriques.\nFonctionne entièrement hors ligne.\n\nLicence MIT.',
          }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 960, minHeight: 620,
    title: 'ÉlectriCAD', backgroundColor: '#12151c', show: false,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { contextIsolation: true, sandbox: true, spellcheck: false },
  });
  win.once('ready-to-show', () => {
    win.show();
    setTimeout(() => checkForUpdate(false), 5000);
  });
  win.on('closed', () => { win = null; });
  // Liens web → navigateur par défaut ; fenêtres locales (impression) autorisées
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) { shell.openExternal(url); return { action: 'deny' }; }
    return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, backgroundColor: '#ffffff' } };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (/^https?:/i.test(url)) { e.preventDefault(); shell.openExternal(url); }
  });
  win.loadFile(path.join(WWW, 'app.html'));
}

app.setAppUserModelId('fr.electricad.app');
app.whenReady().then(() => {
  buildMenu();
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
