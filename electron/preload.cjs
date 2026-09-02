'use strict';
/**
 * Preload bridge. Exposes the minimum the renderer needs to behave like a desktop
 * app. No Node, no filesystem and no secrets are handed to the React code.
 *
 *   window.desktop.isDesktop    — true only inside the Electron shell
 *   window.desktop.apiBase      — backend API base resolved at RUNTIME, so changing
 *                                 PORT in config.env needs no React rebuild
 *   window.desktop.openExternal — open a URL in the user's normal browser
 */
const { contextBridge, ipcRenderer } = require('electron');

// Passed in from the main process via webPreferences.additionalArguments.
const apiBaseArg = process.argv.find((a) => a.startsWith('--dhm-api-base='));
const apiBase = apiBaseArg ? apiBaseArg.slice('--dhm-api-base='.length) : '';

contextBridge.exposeInMainWorld('desktop', {
  isDesktop: true,
  apiBase,
  openExternal: (url) => ipcRenderer.invoke('dhm:open-external', url),
});
