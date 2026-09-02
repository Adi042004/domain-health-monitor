'use strict';
/**
 * Electron main process — Domain Health Monitor desktop shell.
 *
 * RESPONSIBILITIES (and nothing else — no business logic lives here):
 *   1. Load the external config.env and inject it into the backend environment.
 *   2. Start the EXISTING Express backend (server/index.js) exactly once, as a
 *      child process, with no console window.
 *   3. Wait until the backend reports ready (GET /api/health) before showing the UI.
 *   4. Load the production React build into a BrowserWindow (never a browser).
 *   5. Send every external URL — Google OAuth above all — to the system browser.
 *   6. Terminate the backend (and any grandchildren) when the app quits.
 *
 * The backend is spawned with ELECTRON_RUN_AS_NODE=1 using Electron's own bundled
 * Node runtime (process.execPath), so the target machine needs NO Node.js and NO npm.
 */
const { app, BrowserWindow, shell, dialog, ipcMain } = require('electron');
const { spawn, execFile } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const { loadConfig, CONFIG_FILENAME } = require('./config.cjs');

const PROJECT_ROOT = path.join(__dirname, '..');
const IS_PACKAGED = app.isPackaged;

// In packaged builds the backend ships as real files under resources/server (see the
// electron-builder "extraResources" entry) — NOT inside app.asar — so its
// node_modules and relative requires behave exactly as they do in development.
const SERVER_DIR = IS_PACKAGED ? path.join(process.resourcesPath, 'server') : path.join(PROJECT_ROOT, 'server');
const SERVER_ENTRY = path.join(SERVER_DIR, 'index.js');
const RESOURCES_DIR = IS_PACKAGED ? process.resourcesPath : PROJECT_ROOT;

// Optional: set VITE_DEV_SERVER_URL (e.g. http://localhost:5173) to point the window at
// an already-running Vite server instead of the built files, for UI iteration only.
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL || '';
const READY_TIMEOUT_MS = Number.parseInt(process.env.DHM_BACKEND_TIMEOUT_MS, 10) || 60000;

/** @type {import('node:child_process').ChildProcess | null} */
let backend = null;
/** @type {BrowserWindow | null} */
let mainWindow = null;
let backendLog = null;
let quitting = false;
let config = null;

// ─────────────────────────────────────────── logging ───────────────────────────
// There is no terminal, so the backend's stdout/stderr goes to a log file the
// administrator can read. Rewritten each launch to stay small.
function openLog() {
  try {
    const dir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'backend.log');
    backendLog = fs.createWriteStream(file, { flags: 'w' });
    return file;
  } catch {
    return null;
  }
}

function logLine(text) {
  if (backendLog && backendLog.writable) backendLog.write(`${text}\n`);
}

// ────────────────────────────────────── backend lifecycle ──────────────────────
/** Resolve once the backend answers /api/health, or reject on timeout / early exit. */
function waitForBackend(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      if (quitting) return reject(new Error('Application is shutting down.'));
      if (backend && backend.exitCode !== null) {
        return reject(new Error(`The backend process stopped before it became ready (exit code ${backend.exitCode}).`));
      }
      const req = http.get(
        { host: '127.0.0.1', port, path: '/api/health', timeout: 2000 },
        (res) => {
          res.resume();
          if (res.statusCode === 200) return resolve();
          retry();
        }
      );
      req.on('error', retry);
      req.on('timeout', () => { req.destroy(); retry(); });
    };
    const retry = () => {
      if (Date.now() >= deadline) {
        return reject(new Error(`The backend did not become ready within ${Math.round(timeoutMs / 1000)}s.`));
      }
      setTimeout(attempt, 400);
    };
    attempt();
  });
}

function startBackend() {
  if (backend) return; // guarantees exactly one backend (and one DNSBL worker)

  const logFile = openLog();
  logLine(`[electron] starting backend: ${SERVER_ENTRY}`);
  logLine(`[electron] config file: ${config.path || '(none found)'}`);
  logLine(`[electron] port: ${config.port}`);

  backend = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      ...config.env,               // MONGO_URI / GOOGLE_* / PORT / tuning knobs
      ELECTRON_RUN_AS_NODE: '1',   // run Electron's bundled Node, not a second Electron
      NODE_ENV: 'production',
      APP_MODE: 'electron',        // tells the OAuth callback to show the desktop return page
      DHM_CONFIG_PATH: config.path || '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,             // no CMD / PowerShell window, ever
  });

  backend.stdout.on('data', (d) => logLine(`[backend] ${String(d).trimEnd()}`));
  backend.stderr.on('data', (d) => logLine(`[backend:err] ${String(d).trimEnd()}`));

  backend.on('exit', (code, signal) => {
    logLine(`[electron] backend exited (code=${code} signal=${signal})`);
    const crashed = !quitting;
    backend = null;
    if (crashed) {
      dialog.showErrorBox(
        'Backend stopped',
        `The Domain Health Monitor backend stopped unexpectedly (exit code ${code}).\n\n` +
          `Details were written to:\n${logFile || '(log unavailable)'}\n\n` +
          'The application will now close. Check MONGO_URI in config.env and restart.'
      );
      quitting = true;
      app.quit();
    }
  });

  backend.on('error', (err) => {
    logLine(`[electron] failed to spawn backend: ${err.message}`);
  });
}

/**
 * Stop the backend and every process it started. On Windows child.kill() cannot
 * reach grandchildren, so `taskkill /T` is used as the authoritative sweep — this
 * is what guarantees no zombie Node processes survive the app.
 */
function stopBackend() {
  const child = backend;
  if (!child || child.exitCode !== null) return;
  const pid = child.pid;
  try { child.kill(); } catch { /* already gone */ }
  if (process.platform === 'win32' && pid) {
    try {
      execFile('taskkill', ['/pid', String(pid), '/T', '/F'], () => {});
    } catch { /* best effort */ }
  }
}

// ──────────────────────────────────────── window ───────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    backgroundColor: '#0f1115',
    title: 'Domain Health Monitor',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // The renderer reads its API base from here, so a custom PORT in config.env
      // works without rebuilding the React bundle.
      additionalArguments: [`--dhm-api-base=${config.apiBase}`],
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  // ── Everything external opens in the system browser, never in this window. ──
  // This is also the safety net for Google OAuth: even if a code path performs a
  // full-page navigation to accounts.google.com, it is redirected out to Chrome/Edge
  // instead of rendering inside Electron (which Google blocks).
  const isInternal = (url) =>
    url.startsWith('file://') || (DEV_SERVER_URL && url.startsWith(DEV_SERVER_URL));

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isInternal(url)) return;
    event.preventDefault();
    if (/^https?:/i.test(url)) shell.openExternal(url);
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  if (DEV_SERVER_URL) return mainWindow.loadURL(DEV_SERVER_URL);

  const indexHtml = path.join(PROJECT_ROOT, 'dist', 'index.html');
  if (!fs.existsSync(indexHtml)) {
    dialog.showErrorBox(
      'Frontend build missing',
      `Could not find the production UI build at:\n${indexHtml}\n\nRun "npm run build" before packaging.`
    );
    return Promise.resolve();
  }
  return mainWindow.loadFile(indexHtml);
}

// ──────────────────────────────────────── IPC ──────────────────────────────────
// The renderer's only privilege: hand a URL to the system browser. Used by the
// "Connect Account" button so Google OAuth runs in the user's normal browser.
ipcMain.handle('dhm:open-external', async (_event, url) => {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return false;
  await shell.openExternal(url);
  return true;
});

// ──────────────────────────────────────── boot ─────────────────────────────────
// One instance only: a second launch focuses the existing window instead of
// starting a second backend / second DNSBL worker / second MongoDB connection.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    config = loadConfig({
      userDataDir: app.getPath('userData'),
      resourcesDir: RESOURCES_DIR,
      projectRoot: PROJECT_ROOT,
    });

    if (config.missing.length) {
      const target = config.path || config.seeded || path.join(app.getPath('userData'), CONFIG_FILENAME);
      dialog.showErrorBox(
        'Configuration required',
        `Domain Health Monitor needs its configuration before it can start.\n\n` +
          `Missing or unset: ${config.missing.join(', ')}\n\n` +
          `Edit this file, then start the application again:\n${target}`
      );
      // Reveal the file so the administrator does not have to hunt for the folder.
      try { shell.showItemInFolder(target); } catch { /* non-fatal */ }
      quitting = true;
      return app.quit();
    }

    if (config.portMismatch) {
      dialog.showMessageBoxSync({
        type: 'warning',
        title: 'OAuth redirect port mismatch',
        message:
          `PORT is ${config.port} but GOOGLE_REDIRECT_URI points at port ${config.redirectPort}.\n\n` +
          `Google will send the sign-in callback to a port nothing is listening on, so ` +
          `connecting a Postmaster account will fail.\n\nFix config.env so both use the same port.`,
      });
    }

    startBackend();

    try {
      await waitForBackend(config.port, READY_TIMEOUT_MS);
    } catch (err) {
      if (quitting) return;
      dialog.showErrorBox(
        'Could not start',
        `${err.message}\n\n` +
          `Most likely causes:\n` +
          `  • MONGO_URI in config.env is wrong or MongoDB is unreachable\n` +
          `  • port ${config.port} is already in use by another program\n\n` +
          `Log file:\n${path.join(app.getPath('userData'), 'logs', 'backend.log')}`
      );
      quitting = true;
      stopBackend();
      return app.quit();
    }

    // UI is loaded only after the backend is confirmed ready.
    await createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    quitting = true;
    app.quit();
  });

  // Closing the window must take the backend down with it.
  app.on('before-quit', () => { quitting = true; stopBackend(); });
  app.on('will-quit', stopBackend);
  process.on('exit', stopBackend);
}
