'use strict';
/**
 * External configuration loader for the packaged desktop application.
 *
 * WHY: secrets (MONGO_URI, GOOGLE_CLIENT_SECRET, ...) must never be compiled into
 * the React bundle or into the Electron source. They live in a plain `config.env`
 * file on disk that the administrator edits, and are injected into the backend
 * child process environment at launch. The renderer never sees them.
 *
 * LOOKUP ORDER (first file that exists wins):
 *   1. %APPDATA%\Domain Health Monitor\config.env   <- primary, admin-editable
 *   2. <install dir>\resources\config.env           <- optional pre-seeded deployment
 *   3. <project>\server\.env                        <- development only (unchanged)
 *
 * The file format is the same `KEY=VALUE` format the existing server/.env uses, so
 * a working dev .env can simply be copied to location (1) on another machine.
 */
const fs = require('fs');
const path = require('path');

const CONFIG_FILENAME = 'config.env';

/** Keys the backend cannot run without. */
const REQUIRED_KEYS = ['MONGO_URI', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'];

/** Defaults applied only when the key is absent from config.env. */
const DEFAULTS = {
  PORT: '5000',
  GOOGLE_REDIRECT_URI: 'http://localhost:5000/api/postmaster/oauth/callback',
};

/**
 * Minimal KEY=VALUE parser (same subset dotenv supports and the existing
 * server/.env already uses). Deliberately dependency-free: this runs in the
 * Electron main process, which must not require anything from server/node_modules.
 */
function parseEnvFile(text) {
  const out = {};
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // Strip one layer of matching quotes, if present.
    if (value.length >= 2 && ((value[0] === '"' && value.endsWith('"')) || (value[0] === "'" && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

/**
 * Ordered list of places a config file may live.
 * @param {{userDataDir: string, resourcesDir: string, projectRoot: string}} dirs
 */
function candidatePaths(dirs) {
  return [
    path.join(dirs.userDataDir, CONFIG_FILENAME),
    path.join(dirs.resourcesDir, CONFIG_FILENAME),
    path.join(dirs.projectRoot, 'server', '.env'),
  ];
}

/**
 * Copy the shipped template into the user-data directory so the administrator has
 * a documented file to fill in. Never overwrites an existing config.
 * @returns {string|null} the path written, or null if nothing was written.
 */
function seedTemplate(dirs) {
  const target = path.join(dirs.userDataDir, CONFIG_FILENAME);
  if (fs.existsSync(target)) return null;
  const templates = [
    path.join(dirs.resourcesDir, 'config.example.env'),
    path.join(dirs.projectRoot, 'config.example.env'),
  ];
  const source = templates.find((p) => fs.existsSync(p));
  try {
    fs.mkdirSync(dirs.userDataDir, { recursive: true });
    fs.writeFileSync(target, source ? fs.readFileSync(source, 'utf8') : '', 'utf8');
    return target;
  } catch {
    return null;
  }
}

/**
 * Resolve the effective backend configuration.
 *
 * @param {{userDataDir: string, resourcesDir: string, projectRoot: string}} dirs
 * @returns {{
 *   env: Record<string,string>, path: string|null, seeded: string|null,
 *   missing: string[], port: number, apiBase: string,
 *   redirectUri: string, redirectPort: number|null, portMismatch: boolean
 * }}
 */
function loadConfig(dirs) {
  const found = candidatePaths(dirs).find((p) => fs.existsSync(p)) || null;
  const fileEnv = found ? parseEnvFile(fs.readFileSync(found, 'utf8')) : {};
  const seeded = found ? null : seedTemplate(dirs);

  const env = { ...DEFAULTS, ...fileEnv };
  const missing = REQUIRED_KEYS.filter((k) => !env[k] || /^your-/i.test(env[k]));

  const port = Number.parseInt(env.PORT, 10) || 5000;

  // The port Google will redirect the browser back to. It MUST match the port the
  // backend listens on, otherwise the OAuth callback lands on nothing.
  let redirectPort = null;
  try {
    redirectPort = Number.parseInt(new URL(env.GOOGLE_REDIRECT_URI).port, 10) || 80;
  } catch {
    redirectPort = null;
  }

  return {
    env,
    path: found,
    seeded,
    missing,
    port,
    // Renderer talks to the backend over the loopback IP (not the "localhost"
    // hostname) so it can never be affected by IPv6/hosts-file resolution order.
    apiBase: `http://127.0.0.1:${port}/api`,
    redirectUri: env.GOOGLE_REDIRECT_URI,
    redirectPort,
    portMismatch: redirectPort != null && redirectPort !== port,
  };
}

module.exports = { loadConfig, parseEnvFile, CONFIG_FILENAME, REQUIRED_KEYS };
