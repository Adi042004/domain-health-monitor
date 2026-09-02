const dns = require('dns');
const { promisify } = require('util');

// Use the callback-based versions promisified — these are rock solid across all Node versions
const resolve4    = promisify(dns.resolve4);
const resolve6    = promisify(dns.resolve6);
const resolveMx   = promisify(dns.resolveMx);
const resolveNs   = promisify(dns.resolveNs);
const resolveTxt  = promisify(dns.resolveTxt);
const resolveCname= promisify(dns.resolveCname);
const resolveSoa  = promisify(dns.resolveSoa);

const DEFAULT_TTL = 300;
// Per-lookup ceiling so a single hung authoritative server can never stall a
// domain's whole check (previously there was no timeout at all).
const DEFAULT_DNS_TIMEOUT_MS = 4000;

// Resolve `promise` normally, but fall back to `timeoutValue` if it hasn't
// settled within `ms`. The underlying DNS call is left to finish on its own
// (Node reuses the socket); we simply stop waiting on it.
function withTimeout(promise, ms, timeoutValue) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; clearTimeout(t); resolve(v); } };
    const t = setTimeout(() => { if (!done) { done = true; resolve(timeoutValue); } }, ms);
    promise.then(finish, () => finish(timeoutValue));
  });
}

async function safeResolve(fn, hostname, timeoutMs = DEFAULT_DNS_TIMEOUT_MS) {
  const attempt = (async () => {
    try {
      const data = await fn(hostname);
      return { data, error: null };
    } catch (err) {
      return { data: null, error: err.code || 'ERROR' };
    }
  })();
  return withTimeout(attempt, timeoutMs, { data: null, error: 'ETIMEOUT' });
}

async function checkDNS(domain) {
  const now = new Date();

  const [a, aaaa, mx, ns, txt, cname, soa] = await Promise.all([
    safeResolve(resolve4,    domain),
    safeResolve(resolve6,    domain),
    safeResolve(resolveMx,   domain),
    safeResolve(resolveNs,   domain),
    safeResolve(resolveTxt,  domain),
    safeResolve(resolveCname, domain),
    safeResolve(resolveSoa,  domain)
  ]);

  // resolve4/resolve6 return plain strings e.g. ['1.2.3.4']
  const toRecords = (arr) =>
    Array.isArray(arr) ? arr.map(v => ({ value: String(v), ttl: DEFAULT_TTL })) : [];

  // resolveCname returns a single string (the target), not an array
  const cnameRecords = cname.data
    ? [{ value: String(cname.data), ttl: DEFAULT_TTL }]
    : [];

  // resolveSoa returns a structured object
  const soaRecord = soa.data
    ? {
        value: `${soa.data.nsname} ${soa.data.hostmaster} (serial: ${soa.data.serial})`,
        ttl: soa.data.minttl || DEFAULT_TTL
      }
    : undefined;

  return {
    a:    toRecords(a.data),
    aaaa: toRecords(aaaa.data),
    mx:   mx.data ? mx.data.map(r => ({ value: `${r.priority} ${r.exchange}`, ttl: DEFAULT_TTL })) : [],
    ns:   toRecords(ns.data),
    txt:  txt.data ? txt.data.map(parts => ({ value: Array.isArray(parts) ? parts.join('') : String(parts), ttl: DEFAULT_TTL })) : [],
    cname: cnameRecords,
    soa:  soaRecord,
    lastChecked: now,
    error: [a, aaaa, mx, ns, txt].every(r => r.error) ? 'All lookups failed' : undefined
  };
}

// Derive SPF from TXT records already fetched
function checkSPF(txtRecords) {
  const now = new Date();
  if (!txtRecords || txtRecords.length === 0) {
    return { status: 'Missing', rawRecord: null, error: null, lastChecked: now };
  }
  const spfRecord = txtRecords.find(r => r.value.toLowerCase().startsWith('v=spf1'));
  if (!spfRecord) {
    return { status: 'Missing', rawRecord: null, error: null, lastChecked: now };
  }
  return { status: 'Pass', rawRecord: spfRecord.value, error: null, lastChecked: now };
}

async function checkDMARC(domain) {
  const now = new Date();
  const result = await safeResolve(resolveTxt, `_dmarc.${domain}`);

  if (result.error) {
    if (['ENODATA', 'ENOTFOUND', 'NXDOMAIN'].includes(result.error)) {
      return { status: 'Missing', rawRecord: null, error: null, lastChecked: now };
    }
    // Timeout or network error — do NOT mark as Fail
    return { status: 'Unknown', rawRecord: null, error: result.error, lastChecked: now };
  }

  const records = result.data.map(parts => (Array.isArray(parts) ? parts.join('') : String(parts)));
  const dmarcRecord = records.find(r => r.toLowerCase().startsWith('v=dmarc1'));

  if (!dmarcRecord) {
    return { status: 'Missing', rawRecord: null, error: null, lastChecked: now };
  }

  const pMatch = dmarcRecord.match(/p=([\w]+)/i);
  const policy = pMatch ? `p=${pMatch[1]}` : null;

  return { status: 'Pass', rawRecord: dmarcRecord, policy, error: null, lastChecked: now };
}

const COMMON_DKIM_SELECTORS = [
  'default', 'google', 'selector1', 'selector2', 'mail', 's1', 's2',
  'dkim', 'k1', 'key1', 'key2', 'email', 'smtp'
];

async function checkDKIM(domain, extraSelectors = []) {
  const now = new Date();
  const selectors = [...new Set([...COMMON_DKIM_SELECTORS, ...extraSelectors])];

  // Probe all selectors in parallel (was a serial loop — the biggest per-domain
  // bottleneck). Each lookup is independently time-boxed by safeResolve.
  const probes = await Promise.all(selectors.map(async (selector) => {
    const hostname = `${selector}._domainkey.${domain}`;
    const result = await safeResolve(resolveTxt, hostname);
    if (!result.error && result.data && result.data.length > 0) {
      const rawRecord = result.data.map(p => (Array.isArray(p) ? p.join('') : String(p))).join('');
      if (rawRecord.toLowerCase().includes('v=dkim1')) {
        return { selector, hostname, rawRecord };
      }
    }
    return null;
  }));

  // Preserve the old deterministic priority: the first selector (in list order)
  // that matched wins, regardless of which lookup resolved first.
  const hit = probes.find(Boolean);
  if (hit) {
    return { status: 'Pass', selector: hit.selector, hostname: hit.hostname, rawRecord: hit.rawRecord, error: null, lastChecked: now };
  }

  return {
    status: 'NOT_DISCOVERED',
    selector: null,
    hostname: null,
    rawRecord: null,
    error: 'No DKIM record found with common selectors',
    lastChecked: now
  };
}

// Overall health = a rule-based STATUS (kept close to the original, trusted
// logic) plus a numeric SCORE that is a transparent *compliance percentage*.
//
// STATUS (unchanged cases preserved; blacklist + mail-transport added):
//   Unknown  — DNS never checked / no signals
//   Critical — SPF Fail | DMARC Fail | blacklist Listed
//   Warning  — SPF Missing | DMARC Missing | SMTP Error | TLS Not Supported
//   Healthy  — otherwise
//
// SCORE = round(100 × earned / availableWeight) over AVAILABLE signals ONLY.
// A signal that is Unknown / No Data / Unavailable is excluded from BOTH the
// numerator and the denominator, so "not applicable" (e.g. port 25 blocked,
// DNSBL rate-limited, no Postmaster link) never lowers the score. Registrar /
// domain age are informational and are NOT scored. Returns score = null when no
// signal is available. Weights: SPF 20, DMARC 20, DNS-resolvable 15, DKIM 15,
// SMTP 10, TLS 10, Blacklist 10, Postmaster-compliance 10.
function computeHealth(dnsResult, auth, extras = {}) {
  const infra      = extras.infrastructure || {};
  const blacklist  = extras.blacklist || {};
  const postmaster = extras.postmaster || {};

  const spf   = auth?.spf?.status;
  const dmarc = auth?.dmarc?.status;
  const dkim  = auth?.dkim?.status;
  const smtp  = infra.smtpStatus;
  const tls   = infra.tls;
  const bl    = blacklist.status;
  const pmState = postmaster?.deliverability?.state;

  // ----- numeric compliance score (available signals only) -----
  let earned = 0;
  let weight = 0;
  const score1 = (w, ok) => { weight += w; if (ok) earned += w; };

  if (dnsResult && dnsResult.lastChecked) {
    const hasDns = !!((dnsResult.a && dnsResult.a.length) || (dnsResult.mx && dnsResult.mx.length));
    score1(15, hasDns);
  }
  if (spf === 'Pass') score1(20, true); else if (spf === 'Missing' || spf === 'Fail') score1(20, false);
  if (dmarc === 'Pass') score1(20, true); else if (dmarc === 'Missing' || dmarc === 'Fail') score1(20, false);
  if (dkim === 'Pass') score1(15, true); else if (dkim === 'Fail') score1(15, false); // NOT_DISCOVERED/Unknown excluded
  if (smtp === 'Reachable') score1(10, true); else if (smtp === 'Error') score1(10, false);
  if (tls === 'Supported') score1(10, true); else if (tls === 'Not Supported') score1(10, false);
  if (bl === 'Clean') score1(10, true); else if (bl === 'Listed') score1(10, false);
  if (pmState === 'COMPLIANT') score1(10, true); else if (pmState === 'NEEDS_WORK') score1(10, false);

  const score = weight > 0 ? Math.round((100 * earned) / weight) : null;

  // ----- rule-based status -----
  let status;
  if (!dnsResult || !dnsResult.lastChecked) {
    status = 'Unknown';
  } else if (spf === 'Fail' || dmarc === 'Fail' || bl === 'Listed') {
    status = 'Critical';
  } else if (spf === 'Missing' || dmarc === 'Missing' || smtp === 'Error' || tls === 'Not Supported') {
    status = 'Warning';
  } else {
    status = 'Healthy';
  }

  return { status, score };
}

// Back-compat: original string-only signature (extended internally). Existing
// imports that only want the status string keep working unchanged.
function computeHealthStatus(dnsResult, auth, extras) {
  return computeHealth(dnsResult, auth, extras).status;
}

module.exports = { checkDNS, checkSPF, checkDMARC, checkDKIM, computeHealth, computeHealthStatus };
