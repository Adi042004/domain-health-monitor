const dns = require('dns');
const { promisify } = require('util');
const { createLimiter } = require('./limiter');

const resolve4 = promisify(dns.resolve4);

// Bound DNSBL DNS lookups GLOBALLY across the whole health-check run. A bulk run of
// many domains × several IPs × 3 zones could otherwise open hundreds of simultaneous
// DNSBL queries, which public lists rate-limit. This shared limiter caps the fan-out
// regardless of the domain worker-pool size (default 50; override DNSBL_CONCURRENCY).
// Per-lookup timeouts and the Listed/Clean/Check Failed result states are unchanged.
const dnsblLimiter = createLimiter(process.env.DNSBL_CONCURRENCY || 50);

// DNSBL (DNS blacklist) check via reversed-octet A lookups — the standard,
// free, key-less mechanism. For IP a.b.c.d we resolve d.c.b.a.<zone>:
//   • an A record (127.0.0.x) → the IP is Listed on that zone
//   • NXDOMAIN / ENOTFOUND     → Clean (not listed)
//   • any other error / timeout → Check Failed (recorded as such — NEVER a false Listed)
// Built-in dns only; no dependency, no paid API.
//
// CAVEAT: public DNSBLs enforce fair-use policies and frequently return errors or
// block queries coming from cloud/shared resolvers or at high volume. Those show
// up as "Check Failed", not "Listed", so the checker never fabricates a listing.
// The zone list is intentionally small and editable. Zones that require account
// registration (e.g. Spamhaus data feeds, Barracuda) are deliberately omitted —
// unregistered queries to them return misleading results.
const DEFAULT_ZONES = [
  { zone: 'zen.spamhaus.org', name: 'Spamhaus ZEN' },
  { zone: 'bl.spamcop.net',   name: 'SpamCop' },
  { zone: 'dnsbl.sorbs.net',  name: 'SORBS' }
];

const DEFAULT_TIMEOUT_MS = 4000;

function reverseIpv4(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(ip || '').trim());
  if (!m) return null;
  if (m.slice(1).some(o => Number(o) > 255)) return null;
  return `${m[4]}.${m[3]}.${m[2]}.${m[1]}`;
}

async function queryZone(ip, zone, timeoutMs) {
  const rev = reverseIpv4(ip);
  if (!rev) return { status: 'Check Failed', error: 'Not IPv4' };
  const host = `${rev}.${zone}`;
  try {
    const data = await Promise.race([
      resolve4(host),
      new Promise((_, reject) =>
        setTimeout(() => reject(Object.assign(new Error('ETIMEOUT'), { code: 'ETIMEOUT' })), timeoutMs))
    ]);
    if (Array.isArray(data) && data.length) return { status: 'Listed', codes: data };
    return { status: 'Clean' };
  } catch (err) {
    const code = (err && err.code) || 'ERROR';
    // "Not found" is the definitive not-listed answer.
    if (code === 'ENOTFOUND' || code === 'ENODATA' || code === 'NXDOMAIN') return { status: 'Clean' };
    return { status: 'Check Failed', error: code };
  }
}

/**
 * Check the given IP(s) against the DNSBL zones. Returns:
 *   { status, countChecked, countListed, lists[], lastChecked, error }
 * status ∈ Listed | Clean | Check Failed | Unknown.
 *   Listed       — at least one (ip, zone) pair returned a listing
 *   Clean        — no listings and at least one definitive Clean answer
 *   Check Failed — every lookup errored/timed out (no definitive answer)
 *   Unknown      — no usable IPv4 address to check (not a failure)
 * Never throws. Fan-out is ip×zone in parallel (a small bounded set), each time-boxed.
 */
async function checkBlacklist(ips, opts = {}) {
  const zones = opts.zones || DEFAULT_ZONES;
  const timeoutMs = opts.timeoutMs != null ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
  const now = new Date();

  const validIps = [...new Set((ips || []).filter(ip => reverseIpv4(ip)))];
  if (validIps.length === 0) {
    return { status: 'Unknown', countChecked: 0, countListed: 0, lists: [], lastChecked: now, error: 'No IPv4 address to check' };
  }

  const pairs = [];
  for (const ip of validIps) {
    for (const z of zones) pairs.push({ ip, z });
  }

  const lists = await Promise.all(pairs.map(async ({ ip, z }) => {
    const r = await dnsblLimiter(() => queryZone(ip, z.zone, timeoutMs));
    return {
      listName: z.name,
      status: r.status, // Listed | Clean | Check Failed
      listedIp: r.status === 'Listed' ? ip : undefined,
      reason: r.status === 'Listed'
        ? (Array.isArray(r.codes) ? r.codes.join(', ') : undefined)
        : (r.error || undefined),
      lastChecked: now
    };
  }));

  const countListed = lists.filter(r => r.status === 'Listed').length;
  const anyDefinitive = lists.some(r => r.status === 'Listed' || r.status === 'Clean');

  let status;
  if (countListed > 0) status = 'Listed';
  else if (!anyDefinitive) status = 'Check Failed';
  else status = 'Clean';

  return {
    status,
    countChecked: lists.length,
    countListed,
    lists,
    lastChecked: now,
    error: null
  };
}

module.exports = { checkBlacklist, DEFAULT_ZONES, reverseIpv4 };
