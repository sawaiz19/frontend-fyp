'use strict';
/**
 * Electron preload script.
 * Runs in a privileged context before the renderer page loads.
 * contextIsolation is ON, so nothing here leaks into the page's JS scope
 * unless explicitly exposed via contextBridge.
 *
 * The ChemTech frontend communicates with Flask via standard fetch() calls
 * to http://localhost:5000 — no special bridge is needed.
 */
const { contextBridge } = require('electron');

// Expose a tiny flag so the frontend can detect it is running inside Electron
// (e.g. to hide "open in browser" links).  Access via: window.electronAPI.isElectron
contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  platform   : process.platform,   // 'win32' | 'darwin' | 'linux'
});
