// DNSBL / blacklist queue — the rate-sensitive part of the health check, decoupled.
//
// WHY THIS EXISTS: DNS/SPF/DKIM/DMARC/MX/RDAP/Postmaster/scoring run at full
// (bounded) concurrency in the orchestrator. DNSBL cannot: public blacklists cap
// query volume, so at most DNSBL_MAX_PER_HOUR (default 120) *domains* may be checked
// per rolling hour. This module is that separate lane — it never blocks or slows the
// normal checks, and overflow simply waits in the queue for the next hour.
//
// PERSISTENCE (no new framework): queue state lives on the Domain document itself
// (`blacklist.jobStatus` + `blacklist.queuedAt`). A restart resumes automatically —
// startWorker() is called on boot and the interval picks up whatever is still QUEUED.
//
// STATE MACHINE (blacklist.jobStatus):
//   DONE     — result (status/countChecked/lists) is valid; show it
//   PENDING  — health check started, DNS not yet ready (UI: "Processing")
//   QUEUED   — DNS ready, waiting for a rate-limit slot   (UI: "Queued")
//   RUNNING  — actively querying DNSBLs now               (UI: "Processing")
const Domain = require('../models/Domain');
const { checkBlacklist } = require('./blacklist');
const { computeHealth } = require('./dnsChecker');

const MAX_PER_HOUR = Math.max(1, parseInt(process.env.DNSBL_MAX_PER_HOUR, 10) || 120);
const WINDOW_MS = 60 * 60 * 1000;
const TICK_MS = Math.max(5000, parseInt(process.env.DNSBL_TICK_MS, 10) || 60000);

let started = false;
let running = false;          // re-entrancy guard: only one tick() body at a time
let timer = null;
const completions = [];       // completion timestamps (ms) inside the rolling hour

function prune(nowMs) {
  const cutoff = nowMs - WINDOW_MS;
  while (completions.length && completions[0] <= cutoff) completions.shift();
}

// Reconstruct the rolling window after a restart from persisted lastChecked times so
// a reboot can never blow past MAX_PER_HOUR. Best-effort — a bad read just starts empty.
async function seedWindow() {
  const since = new Date(Date.now() - WINDOW_MS);
  const recent = await Domain.find(
    { 'blacklist.lastChecked': { $gte: since }, 'blacklist.jobStatus': 'DONE' },
    { 'blacklist.lastChecked': 1 }
  ).lean();
  for (const d of recent) {
    const t = d.blacklist && d.blacklist.lastChecked ? new Date(d.blacklist.lastChecked).getTime() : 0;
    if (t) completions.push(t);
  }
  completions.sort((a, b) => a - b);
  if (completions.length > MAX_PER_HOUR) completions.splice(0, completions.length - MAX_PER_HOUR);
}

function ipsFor(doc) {
  const stored = (doc.ips || []).filter(Boolean);
  const resolved = ((doc.dns && doc.dns.a) || []).map(r => r.value).filter(Boolean);
  return [...new Set([...stored, ...resolved])];
}

// Recompute health from the domain's ALREADY-STORED signals plus the fresh blacklist,
// so a new listing correctly flips status -> Critical and adjusts the score. Mirrors
// the orchestrator's computeHealth inputs; re-queries nothing.
function recomputeHealth(doc, blacklistResult) {
  const dns = doc.dns || {};
  const auth = {
    spf:   { status: doc.authentication && doc.authentication.spf   ? doc.authentication.spf.status   : undefined },
    dmarc: { status: doc.authentication && doc.authentication.dmarc ? doc.authentication.dmarc.status : undefined },
    dkim:  { status: doc.authentication && doc.authentication.dkim  ? doc.authentication.dkim.status  : undefined },
  };
  const extras = {
    infrastructure: doc.infrastructure || {},
    blacklist: blacklistResult,
    postmaster: (doc.reputation && doc.reputation.postmaster) || {},
  };
  return computeHealth({ a: dns.a, mx: dns.mx, lastChecked: dns.lastChecked }, auth, extras);
}

async function processOne(doc) {
  const now = new Date();
  const bl = await checkBlacklist(ipsFor(doc), {});   // never throws; DNS fan-out is bounded internally
  const set = {
    'blacklist.status':       bl.status,
    'blacklist.countChecked': bl.countChecked,
    'blacklist.countListed':  bl.countListed,
    'blacklist.lists':        bl.lists,
    'blacklist.lastChecked':  bl.lastChecked || now,
    'blacklist.jobStatus':    'DONE',
  };
  // Only refresh health when DNS was actually checked (it always is for enqueued
  // domains); never overwrite a good status with an Unknown from missing signals.
  if (doc.dns && doc.dns.lastChecked) {
    const health = recomputeHealth(doc, bl);
    set['health.status']      = health.status;
    set['health.score']       = health.score;
    set['health.lastChecked'] = now;
  }
  await Domain.updateOne({ _id: doc._id }, { $set: set });
  completions.push(Date.now());
}

async function tick() {
  if (running) return;
  running = true;
  try {
    prune(Date.now());
    const available = MAX_PER_HOUR - completions.length;
    if (available <= 0) return;                        // hour is full — wait

    const batch = await Domain.find({ 'blacklist.jobStatus': 'QUEUED' })
      .sort({ 'blacklist.queuedAt': 1 })               // FIFO
      .limit(available);
    if (batch.length === 0) return;

    // Claim the slice so a later tick can't double-pick it.
    await Domain.updateMany(
      { _id: { $in: batch.map(d => d._id) } },
      { $set: { 'blacklist.jobStatus': 'RUNNING' } }
    );

    // checkBlacklist's own limiter bounds the real DNS fan-out, so this can't flood
    // the resolver even with a full 120-domain slice. Each domain is isolated.
    await Promise.all(batch.map(async (doc) => {
      try {
        await processOne(doc);
      } catch (err) {
        // Unexpected (e.g. transient DB error) — requeue instead of leaving it stuck
        // RUNNING. Quota is spent only on genuine completions.
        await Domain.updateOne(
          { _id: doc._id },
          { $set: { 'blacklist.jobStatus': 'QUEUED' } }
        ).catch(() => {});
      }
    }));
  } catch (err) {
    console.error('[dnsbl-queue] tick error:', err.message);
  } finally {
    running = false;
  }
}

function ensureStarted() {
  if (!started) startWorker().catch(() => {});
}

function kick() {
  // Run a tick promptly (right after an enqueue) without waiting for the interval.
  ensureStarted();
  setImmediate(() => { tick().catch(() => {}); });
}

async function startWorker() {
  if (started) return;
  started = true;                                      // set before await so it can't double-start
  try { await seedWindow(); } catch (e) { /* best-effort */ }
  timer = setInterval(() => { tick().catch(() => {}); }, TICK_MS);
  if (timer.unref) timer.unref();
  tick().catch(() => {});                              // resume anything persisted across a restart
  console.log(`[dnsbl-queue] worker started (max=${MAX_PER_HOUR}/hour, tick=${TICK_MS}ms)`);
}

// Mark domains PENDING at the moment a health check starts, so the UI immediately
// shows "Processing" for their blacklist instead of a stale Clean/Listed.
async function markPending(ids) {
  if (!ids || !ids.length) return;
  await Domain.updateMany({ _id: { $in: ids } }, { $set: { 'blacklist.jobStatus': 'PENDING' } });
}

// Enqueue ONE domain for DNSBL once its DNS is fresh (called right after that domain's
// normal checks finish — so DNSBL starts per-domain, never waiting for the whole batch).
async function enqueueOne(id) {
  await Domain.updateOne(
    { _id: id },
    { $set: { 'blacklist.jobStatus': 'QUEUED', 'blacklist.queuedAt': new Date() } }
  );
  kick();
}

module.exports = { startWorker, markPending, enqueueOne, kick };
