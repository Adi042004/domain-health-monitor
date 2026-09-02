const https = require('https');
const { URL } = require('url');

// Domain Information via RDAP — the modern, free, key-less successor to WHOIS.
// We query the IANA-bootstrap redirector (rdap.org), which 3xx-redirects to the
// authoritative RDAP server for the TLD. No API key, no account, no paid/AI API.
// This is the FIRST/only Domain-Information checker in the codebase (there was
// none before — Domain Information was showing placeholder fallback dates).
const RDAP_BOOTSTRAP     = 'https://rdap.org/domain/';
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_TTL_DAYS   = 7;      // registration facts change rarely — don't re-query every run
const MAX_REDIRECTS      = 5;
const MAX_BODY_BYTES     = 512 * 1024;

// GET JSON over HTTPS, following redirects, with a single overall deadline that
// spans all hops. Rejects (never hangs) on timeout / non-2xx / bad JSON.
function httpsGetJson(startUrl, timeoutMs) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    let redirects = 0;

    const doGet = (urlStr) => {
      let u;
      try { u = new URL(urlStr); } catch (e) { return reject(new Error('BAD_URL')); }
      const remaining = deadline - Date.now();
      if (remaining <= 0) return reject(new Error('ETIMEOUT'));

      const req = https.get({
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        headers: {
          'Accept': 'application/rdap+json, application/json',
          'User-Agent': 'domain-health-monitor/1.0 (+rdap)'
        }
      }, (res) => {
        const code = res.statusCode || 0;

        if (code >= 300 && code < 400 && res.headers.location) {
          res.resume(); // discard body
          if (redirects++ >= MAX_REDIRECTS) return reject(new Error('TOO_MANY_REDIRECTS'));
          let next;
          try { next = new URL(res.headers.location, u).toString(); }
          catch (e) { return reject(new Error('BAD_REDIRECT')); }
          return doGet(next);
        }
        if (code === 404) { res.resume(); return reject(new Error('NOT_FOUND')); }
        if (code < 200 || code >= 300) { res.resume(); return reject(new Error('HTTP_' + code)); }

        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
          if (body.length > MAX_BODY_BYTES) { req.destroy(); reject(new Error('BODY_TOO_LARGE')); }
        });
        res.on('end', () => {
          try { resolve(JSON.parse(body)); }
          catch (e) { reject(new Error('BAD_JSON')); }
        });
      });

      req.setTimeout(remaining, () => req.destroy(new Error('ETIMEOUT')));
      req.on('error', (err) => reject(err));
    };

    doGet(startUrl);
  });
}

// Registrar name lives in an entity with role "registrar"; its display name is the
// vCard "fn" property. vcardArray = ["vcard", [ [name, params, type, value], ... ]].
function extractRegistrar(data) {
  const entities = Array.isArray(data.entities) ? data.entities : [];
  const reg = entities.find(e => Array.isArray(e.roles) && e.roles.includes('registrar'));
  if (!reg || !Array.isArray(reg.vcardArray)) return null;
  const props = reg.vcardArray[1];
  if (!Array.isArray(props)) return null;
  const fn = props.find(p => Array.isArray(p) && p[0] === 'fn');
  return fn && fn[3] ? String(fn[3]) : null;
}

function extractEventDate(data, action) {
  const events = Array.isArray(data.events) ? data.events : [];
  const ev = events.find(e => e && e.eventAction === action && e.eventDate);
  if (!ev) return null;
  const d = new Date(ev.eventDate);
  return isNaN(d.getTime()) ? null : d;
}

// Reuse recently-fetched RDAP data instead of re-querying every run. Only cached
// AVAILABLE results are considered fresh; NO_DATA / UNAVAILABLE are retried.
function isFresh(existing, ttlDays) {
  if (!existing || !existing.lastChecked || existing.state !== 'AVAILABLE') return false;
  const age = Date.now() - new Date(existing.lastChecked).getTime();
  return age >= 0 && age < ttlDays * 24 * 60 * 60 * 1000;
}

/**
 * Fetch registrar / creation / expiry for a domain via RDAP.
 * Never throws — returns a result object with a `state`:
 *   AVAILABLE   — at least one field was parsed
 *   NO_DATA     — RDAP responded but had no registrar/date fields
 *   UNAVAILABLE — unsupported TLD (404), timeout, or transport error
 * Registrar / age are informational and are NOT used in the health score.
 */
async function checkDomainInfo(domain, existing, opts = {}) {
  const ttlDays   = opts.ttlDays   != null ? opts.ttlDays   : DEFAULT_TTL_DAYS;
  const timeoutMs = opts.timeoutMs != null ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
  const now = new Date();

  if (isFresh(existing, ttlDays)) {
    return {
      registrar:   existing.registrar   != null ? existing.registrar   : null,
      createdDate: existing.createdDate  != null ? existing.createdDate : null,
      expiryDate:  existing.expiryDate   != null ? existing.expiryDate  : null,
      state: 'AVAILABLE',
      source: 'RDAP',
      error: null,
      lastChecked: existing.lastChecked,
      fromCache: true
    };
  }

  try {
    const data = await httpsGetJson(RDAP_BOOTSTRAP + encodeURIComponent(domain), timeoutMs);
    const registrar   = extractRegistrar(data);
    const createdDate  = extractEventDate(data, 'registration');
    const expiryDate   = extractEventDate(data, 'expiration');
    const hasAny = !!(registrar || createdDate || expiryDate);
    return {
      registrar, createdDate, expiryDate,
      state: hasAny ? 'AVAILABLE' : 'NO_DATA',
      source: 'RDAP',
      error: hasAny ? null : 'RDAP returned no registrar/date fields',
      lastChecked: now,
      fromCache: false
    };
  } catch (err) {
    // 404 (unsupported TLD) / timeout / transport error → Unavailable, not a
    // failure. Preserve any previously stored values so we don't wipe good data.
    return {
      registrar:   existing && existing.registrar   != null ? existing.registrar   : null,
      createdDate: existing && existing.createdDate  != null ? existing.createdDate : null,
      expiryDate:  existing && existing.expiryDate   != null ? existing.expiryDate  : null,
      state: 'UNAVAILABLE',
      source: 'RDAP',
      error: (err && err.message) || 'ERROR',
      lastChecked: now,
      fromCache: false
    };
  }
}

module.exports = { checkDomainInfo };
