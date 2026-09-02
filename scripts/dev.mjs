// Zero-dependency dev orchestrator: starts the Vite frontend and the Express
// backend together with a single `npm run dev`. Uses only Node built-ins so it
// works offline and needs no extra install (concurrently is not a dependency).
// Either process exiting tears down the other, and Ctrl-C stops both cleanly.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const serverDir = resolve(root, 'server');

const targets = [
  { name: 'web', args: ['run', 'dev:web'], cwd: root },
  // Run the backend from its own dir so nodemon resolves server/index.js reliably.
  { name: 'api', args: ['run', 'dev'], cwd: serverDir },
];

const children = [];
let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  process.exit(code);
}

for (const t of targets) {
  // shell: true so Windows resolves npm.cmd; stdio inherited so both logs stream through.
  const child = spawn('npm', t.args, { cwd: t.cwd, stdio: 'inherit', shell: true });
  child.on('exit', (code) => {
    console.log(`[dev] ${t.name} exited (code ${code ?? 0}); stopping both.`);
    shutdown(code ?? 0);
  });
  child.on('error', (err) => {
    console.error(`[dev] failed to start ${t.name}: ${err.message}`);
    shutdown(1);
  });
  children.push(child);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
