/*
 * ÉlectriCAD — pont entre la page et l'application de bureau.
 * Expose l'enregistrement direct d'un dossier en PDF (boîte « Enregistrer sous »),
 * sans passer par la fenêtre d'impression du système.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electricadDesktop', {
  savePDF: (html, name, a3) => ipcRenderer.invoke('electricad:save-pdf', { html: String(html), name: String(name || 'ElectriCAD.pdf'), a3: !!a3 }),
});
