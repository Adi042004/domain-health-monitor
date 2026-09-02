const dns = require('dns');
const net = require('net');
const { promisify } = require('util');

const dnsReverse = promisify(dns.reverse);

// Mail transport probe: reverse-DNS (PTR) for the sending IP, plus a single TCP
// connection to the primary MX host on port 25 to read the SMTP banner and the
// EHLO capability list (which advertises STARTTLS). Built-in dns/net only — no
// dependency, no paid API.
//
// IMPORTANT: many hosting / cloud environments block *outbound* port 25. When we
// cannot connect we report smtpStatus/tls = 'Unknown' (NOT 'Error'), because a
// blocked egress is our limitation, not the domain's fault — and computeHealth
// excludes 'Unknown' from the score entirely. Only a live connection that then
// misbehaves is recorded, and even then we keep it non-penalizing.
const DEFAULT_TIMEOUT_MS = 4000;
const SMTP_PORT = 25;
const EHLO_NAME = 'health-monitor.local';

// Pick the lowest-priority (preferred) MX exchange. DNS MX records here are
// stored as "<priority> <exchange>" strings (see dnsChecker.checkDNS).
function pickMxHost(mxRecords) {
  if (!Array.isArray(mxRecords) || mxRecords.length === 0) return null;
  let best = null;
  for (const rec of mxRecords) {
    const raw = rec && rec.value != null ? String(rec.value).trim() : '';
    if (!raw) continue;
    const parts = raw.split(/\s+/);
    let prio = 0;
    let host = raw;
    if (parts.length >= 2 && /^\d+$/.test(parts[0])) {
      prio = parseInt(parts[0], 10);
      host = parts[1];
    }
    host = host.replace(/\.$/, ''); // strip root-label trailing dot
    if (!host) continue;
    if (!best || prio < best.prio) best = { prio, host };
  }
  return best ? best.host : null;
}

async function reversePtr(ips, timeoutMs) {
  const ip = (ips || []).find(Boolean);
  if (!ip) return null;
  try {
    const names = await Promise.race([
      dnsReverse(ip),
      new Promise((_, reject) => setTimeout(() => reject(new Error('ETIMEOUT')), timeoutMs))
    ]);
    return names && names.length ? names[0] : null;
  } catch (e) {
    return null; // no PTR / timeout — informational only
  }
}

// Connect once, read the 220 banner, send EHLO, and inspect the multiline reply
// for a STARTTLS capability. Resolves to { smtpStatus, tls, error } — never rejects.
function probeSmtp(host, timeoutMs) {
  return new Promise((resolve) => {
    if (!host) return resolve({ smtpStatus: 'Unknown', tls: 'Unknown', error: 'No MX host' });

    let settled = false;
    let stage = 'connect'; // connect → banner → ehlo
    let buf = '';

    const finish = (result) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch (e) { /* ignore */ }
      resolve(result);
    };

    const socket = net.createConnection({ host, port: SMTP_PORT });
    socket.setTimeout(timeoutMs);

    socket.on('connect', () => { stage = 'banner'; });

    socket.on('data', (chunk) => {
      buf += chunk.toString('utf8');

      if (stage === 'banner') {
        if (!buf.includes('\n')) return; // wait for a full line
        if (/^220[ -]/.test(buf)) {
          stage = 'ehlo';
          buf = '';
          try { socket.write(`EHLO ${EHLO_NAME}\r\n`); } catch (e) { /* handled by error/timeout */ }
        } else {
          // Connected, but no usable 220 greeting (e.g. 554). TCP works → Reachable.
          finish({ smtpStatus: 'Reachable', tls: 'Unknown', error: 'No 220 banner' });
        }
        return;
      }

      if (stage === 'ehlo') {
        // EHLO reply is multiline: "250-CAP" lines then a final "250 CAP" line
        // (250 followed by a space). The space marks the end of the reply.
        const complete = buf.split(/\r?\n/).some(line => /^250 /.test(line));
        if (complete) {
          const starttls = /(^|\D)starttls(\W|$)/i.test(buf);
          finish({ smtpStatus: 'Reachable', tls: starttls ? 'Supported' : 'Not Supported', error: null });
        }
      }
    });

    socket.on('timeout', () => {
      if (stage === 'ehlo') {
        // Connected + banner ok, EHLO reply slow — trust STARTTLS if already seen.
        const starttls = /(^|\D)starttls(\W|$)/i.test(buf);
        finish({ smtpStatus: 'Reachable', tls: starttls ? 'Supported' : 'Unknown', error: 'EHLO timeout' });
      } else {
        // Never connected / no banner — almost always blocked egress. Not a failure.
        finish({ smtpStatus: 'Unknown', tls: 'Unknown', error: 'Connect timeout' });
      }
    });

    socket.on('error', (err) => {
      const connected = stage === 'banner' || stage === 'ehlo';
      finish({
        smtpStatus: connected ? 'Reachable' : 'Unknown',
        tls: 'Unknown',
        error: (err && err.code) || 'ERROR'
      });
    });

    socket.on('end', () => {
      if (settled) return;
      const connected = stage === 'banner' || stage === 'ehlo';
      finish({ smtpStatus: connected ? 'Reachable' : 'Unknown', tls: 'Unknown', error: 'Connection closed early' });
    });
  });
}

/**
 * Probe mail transport for a domain. Returns:
 *   { mailServerHostname, ptr, smtpStatus, tls, error, lastChecked }
 * smtpStatus ∈ Reachable | Error | Unknown ; tls ∈ Supported | Not Supported | Unknown.
 * Never throws. PTR + SMTP run concurrently (independent).
 */
async function checkMailInfra(domain, ips, mxRecords, opts = {}) {
  const timeoutMs = opts.timeoutMs != null ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
  const now = new Date();
  const mailHost = pickMxHost(mxRecords);

  const [ptr, smtp] = await Promise.all([
    reversePtr(ips, timeoutMs),
    probeSmtp(mailHost, timeoutMs)
  ]);

  return {
    mailServerHostname: mailHost,
    ptr,
    smtpStatus: smtp.smtpStatus,
    tls: smtp.tls,
    error: smtp.error,
    lastChecked: now
  };
}

module.exports = { checkMailInfra, pickMxHost };
