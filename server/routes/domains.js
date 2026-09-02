const express  = require('express');
const multer   = require('multer');
const { parse } = require('csv-parse/sync');
const Domain   = require('../models/Domain');
const PostmasterAccount = require('../models/PostmasterAccount');
const { checkDNS, checkSPF, checkDMARC, checkDKIM, computeHealthStatus } = require('../lib/dnsChecker');
const { deriveVerification, listPostmasterDomains, deletePostmasterDomain } = require('../lib/postmasterService');

const router  = express.Router();
const upload  = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// ---------- helpers ----------

function isValidDomain(domain) {
  // Simple but solid regex for domain names
  return /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/.test(domain);
}

function isValidIP(ip) {
  // IPv4
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(ip);
}

// Map a Mongoose Domain document to the shape the frontend DomainHealth interface expects
function toFrontendShape(doc) {
  const d = doc.toObject ? doc.toObject() : doc;
  const now = new Date().toISOString();

  // Helper: convert MongoDB DNSRecord array to frontend shape
  const mapDNS = (arr) => (arr || []).map(r => ({ value: r.value, ttl: r.ttl }));

  // Helper: pass a raw Postmaster v2 metric bucket through to the frontend,
  // stringifying history dates. Preserves state (AVAILABLE/NO_DATA/...) and the
  // raw latest value — null stays null so the UI shows "No Data", never 0%.
  const mapMetric = (m) => m ? {
    state:   m.state || 'NO_DATA',
    latest:  m.latest ?? null,
    count:   m.count ?? null,
    history: (m.history || []).map(h => ({ date: h.date?.toISOString?.() || h.date, value: h.value }))
  } : null;

  // Multi-series Postmaster containers → frontend shape (each child is a mapMetric
  // series). state is preserved so the UI can show "No Data" / access errors verbatim.
  const mapAuth = (a) => a ? {
    state: a.state || 'NO_DATA',
    spf:   mapMetric(a.spf),
    dkim:  mapMetric(a.dkim),
    dmarc: mapMetric(a.dmarc),
  } : null;
  const mapEncryption = (e) => e ? {
    state:    e.state || 'NO_DATA',
    inbound:  mapMetric(e.inbound),
    outbound: mapMetric(e.outbound),
  } : null;
  const mapDelivery = (dd) => dd ? {
    state:    dd.state || 'NO_DATA',
    total:    mapMetric(dd.total),
    reject:   mapMetric(dd.reject),
    tempFail: mapMetric(dd.tempFail),
  } : null;
  const mapFbl = (f) => f ? {
    state:  f.state || 'NO_DATA',
    ids:    (f.ids || []).slice(),
    series: (f.series || []).map(s => ({
      id:      s.id,
      latest:  s.latest ?? null,
      history: (s.history || []).map(h => ({ date: h.date?.toISOString?.() || h.date, value: h.value })),
    })),
  } : null;

  // DKIM status mapping: NOT_DISCOVERED -> show 'No Data' as RecordStatus in frontend
  const dkimStatus = d.authentication?.dkim?.status;
  const frontendDkimStatus =
    dkimStatus === 'NOT_DISCOVERED' ? 'No Data' :
    dkimStatus === 'Pass'           ? 'Pass'    :
    dkimStatus === 'Fail'           ? 'Fail'    :
    dkimStatus === 'Missing'        ? 'Missing' : 'Unknown';

  return {
    id: d._id.toString(),
    domain: d.domain,
    email: d.email || '',
    ips: d.ips || [],
    provider: d.provider || '',
    // Which Postmaster account this domain is linked to (if any) — lets Domain Details
    // reuse the SAME account to open the existing verify modal. Prefer the top-level
    // link, fall back to the one stored on the postmaster reputation sub-doc.
    postmasterAccountId: d.postmasterAccountId
      ? d.postmasterAccountId.toString()
      : (d.reputation?.postmaster?.accountId ? d.reputation.postmaster.accountId.toString() : null),
    createdDate: (d.createdDate || d.createdAt || now).toString(),
    expiryDate:  (d.expiryDate  || now).toString(),

    dns: {
      a:    mapDNS(d.dns?.a),
      aaaa: mapDNS(d.dns?.aaaa),
      mx:   mapDNS(d.dns?.mx),
      ns:   mapDNS(d.dns?.ns),
      txt:  mapDNS(d.dns?.txt),
      cname:mapDNS(d.dns?.cname),
      soa:  d.dns?.soa ? { value: d.dns.soa.value, ttl: d.dns.soa.ttl } : undefined,
      lastChecked: (d.dns?.lastChecked || d.createdAt || now).toString()
    },

    authentication: {
      spf: {
        status:     d.authentication?.spf?.status || 'Unknown',
        record:     d.authentication?.spf?.rawRecord || '',
        lastChecked:(d.authentication?.spf?.lastChecked || d.createdAt || now).toString()
      },
      dkim: {
        status:     frontendDkimStatus,
        selector:   d.authentication?.dkim?.selector || '',
        record:     d.authentication?.dkim?.rawRecord || '',
        lastChecked:(d.authentication?.dkim?.lastChecked || d.createdAt || now).toString()
      },
      dmarc: {
        status:     d.authentication?.dmarc?.status || 'Unknown',
        policy:     d.authentication?.dmarc?.policy || '',
        record:     d.authentication?.dmarc?.rawRecord || '',
        lastChecked:(d.authentication?.dmarc?.lastChecked || d.createdAt || now).toString()
      }
    },

    // Real mail-transport result (lib/mailInfra.js). Defaults to Unknown until the
    // first health check runs / when the probe couldn't connect (e.g. blocked :25).
    infrastructure: {
      mailServerHostname: d.infrastructure?.mailServerHostname || undefined,
      ptr:                d.infrastructure?.ptr || undefined,
      smtpStatus:         d.infrastructure?.smtpStatus || 'Unknown',
      tls:                d.infrastructure?.tls || 'Unknown',
      lastChecked:        (d.infrastructure?.lastChecked || now).toString()
    },

    // Real registration facts from RDAP (lib/domainInfo.js). null when never
    // checked; state carries AVAILABLE / NO_DATA / UNAVAILABLE so the UI can avoid
    // showing a fabricated date.
    domainInfo: d.domainInfo ? {
      registrar:   d.domainInfo.registrar || null,
      createdDate: d.domainInfo.createdDate ? (d.domainInfo.createdDate.toISOString?.() || d.domainInfo.createdDate).toString() : null,
      expiryDate:  d.domainInfo.expiryDate  ? (d.domainInfo.expiryDate.toISOString?.()  || d.domainInfo.expiryDate).toString()  : null,
      state:       d.domainInfo.state || 'NO_DATA',
      lastChecked: d.domainInfo.lastChecked ? (d.domainInfo.lastChecked.toISOString?.() || d.domainInfo.lastChecked).toString() : null
    } : null,

    blacklist: {
      status:       d.blacklist?.status || 'Unknown',
      countChecked: d.blacklist?.countChecked || 0,
      countListed:  d.blacklist?.countListed  || 0,
      lastChecked:  (d.blacklist?.lastChecked || now).toString(),
      jobStatus:    d.blacklist?.jobStatus || 'DONE',
      lists:        d.blacklist?.lists || []
    },

    reputation: {
      spamRate:               d.reputation?.spamRate ?? null,
      spamRateHistory:        (d.reputation?.spamRateHistory || []).map(h => ({
        date: h.date?.toISOString?.() || h.date,
        rate: h.rate
      })),
      postmasterDataAvailable: d.reputation?.postmasterDataAvailable || false,
      lastChecked: (d.reputation?.lastChecked || now).toString(),
      postmaster: d.reputation?.postmaster ? {
        status:         d.reputation.postmaster.status || 'NOT_LINKED',
        available:      d.reputation.postmaster.available || false,
        compliance:     d.reputation.postmaster.compliance || null,
        deliverability: d.reputation.postmaster.deliverability || null,
        spamRate:       d.reputation.postmaster.spamRate ?? null,
        // Expanded v2 metric categories (raw multi-series values; NO_DATA preserved, never 0%).
        spam:           mapMetric(d.reputation.postmaster.spam),
        authentication: mapAuth(d.reputation.postmaster.authentication),
        encryption:     mapEncryption(d.reputation.postmaster.encryption),
        deliveryErrors: mapDelivery(d.reputation.postmaster.deliveryErrors),
        feedbackLoop:   mapFbl(d.reputation.postmaster.feedbackLoop),
        // Verification signal for the Domains table (Phase 12).
        linked:            d.reputation.postmaster.linked ?? (d.reputation.postmaster.status !== 'NOT_LINKED'),
        verificationState: d.reputation.postmaster.verificationState ?? null,
        permission:        d.reputation.postmaster.permission ?? null,
        verification:      d.reputation.postmaster.verification || 'Unknown',
        error:          d.reputation.postmaster.error || null,
        lastChecked:    d.reputation.postmaster.lastChecked
                          ? (d.reputation.postmaster.lastChecked.toISOString?.() || d.reputation.postmaster.lastChecked).toString()
                          : null
      } : null
    },

    health: {
      status:     d.health?.status || 'Unknown',
      score:      d.health?.score ?? null,
      lastChecked:(d.health?.lastChecked || d.createdAt || now).toString()
    },

    history: (d.history || []).map(h => ({
      date:      h.date?.toISOString?.() || h.date,
      status:    h.status,
      spamRate:  h.spamRate ?? null,
      blacklist: h.blacklist || 'Unknown',
      score:     h.score ?? null
    }))
  };
}

// ---------- routes ----------

// GET /api/domains
router.get('/', async (req, res) => {
  try {
    const { search } = req.query;
    const filter = search
      ? { $or: [
          { domain: { $regex: search, $options: 'i' } },
          { ips:    { $regex: search, $options: 'i' } }
        ]}
      : {};
    const docs = await Domain.find(filter).sort({ createdAt: -1 });
    res.json(docs.map(toFrontendShape));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/domains/:id
router.get('/:id', async (req, res) => {
  try {
    const doc = await Domain.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Domain not found' });
    res.json(toFrontendShape(doc));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/domains
router.post('/', async (req, res) => {
  try {
    const { domain, email, ips, provider, _source, postmasterAccountId, verificationState, permission } = req.body;
    
    if (!domain) return res.status(400).json({ error: 'Missing domain' });
    if (!isValidDomain(domain)) return res.status(400).json({ error: 'Invalid domain format' });
    
    let ipArray = [];
    if (ips) {
      if (Array.isArray(ips)) ipArray = ips;
      else ipArray = [ips];
    }
    
    if (ipArray.length > 0 && !isValidIP(ipArray[0])) {
      return res.status(400).json({ error: 'Invalid IP format' });
    }

    const cleanDomain = domain.toLowerCase().trim();
    const sourceToAdd = _source || 'MANUAL';

    // Build $set: link the Postmaster account and, when syncing FROM Postmaster,
    // persist the domains.list verification metadata (Phase 12). Only individual
    // leaf paths are set (never the whole reputation.postmaster object) so a later
    // health check's compliance / spam-rate data is never clobbered here.
    const setOps = {};
    if (postmasterAccountId) setOps.postmasterAccountId = postmasterAccountId;
    if (sourceToAdd === 'POSTMASTER' && (verificationState || permission)) {
      if (postmasterAccountId) setOps['reputation.postmaster.accountId'] = postmasterAccountId;
      setOps['reputation.postmaster.linked'] = true;
      setOps['reputation.postmaster.verificationState'] = verificationState || null;
      setOps['reputation.postmaster.permission'] = permission || null;
      setOps['reputation.postmaster.verification'] = deriveVerification({
        linked: true, known: true, verificationState, permission
      });
    }

    // Upsert domain to handle deduplication
    const updatedDomain = await Domain.findOneAndUpdate(
      { domain: cleanDomain },
      {
        $setOnInsert: {
          email: email ? email.trim() : undefined,
          ips: ipArray,
          provider: provider ? provider.trim() : undefined,
          health: { status: 'Unknown', lastChecked: new Date() }
        },
        $addToSet: { sources: sourceToAdd },
        ...(Object.keys(setOps).length && { $set: setOps })
      },
      { upsert: true, new: true }
    );
    
    res.json(toFrontendShape(updatedDomain));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/domains/import  — CSV upload
router.post('/import', upload.single('csv'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No CSV file uploaded' });

  let rawRows;
  try {
    rawRows = parse(req.file.buffer, {
      skip_empty_lines: true,
      trim: true
    });
  } catch (err) {
    return res.status(400).json({ error: 'CSV parse error: ' + err.message });
  }

  if (rawRows.length === 0) return res.status(400).json({ error: 'Empty CSV file' });

  // A very robust way to check if the first row is a header:
  // Does the first cell look like a valid domain? If yes, it's NOT a header.
  const firstCell = (rawRows[0][0] || '').trim();
  const hasHeader = !isValidDomain(firstCell);
  
  let domainIdx = 0;
  let emailIdx = 1;
  let ipIdx = 2;

  if (hasHeader) {
    const header = rawRows[0].map(c => c.toLowerCase().trim());
    const foundDomain = header.findIndex(c => c.includes('domain'));
    const foundEmail = header.findIndex(c => c.includes('email'));
    const foundIp = header.findIndex(c => c.includes('ip'));
    
    // If they provided a header but didn't label the domain column, assume it's column 0
    domainIdx = foundDomain !== -1 ? foundDomain : 0;
    emailIdx = foundEmail !== -1 ? foundEmail : -1;
    ipIdx = foundIp !== -1 ? foundIp : -1;
  }

  const rowsToProcess = hasHeader ? rawRows.slice(1) : rawRows;
  const results = { inserted: 0, duplicates: 0, errors: [] };

  for (const [index, row] of rowsToProcess.entries()) {
    const rowNum = hasHeader ? index + 2 : index + 1;
    
    if (domainIdx === -1 || domainIdx >= row.length) {
      results.errors.push({ row: rowNum, reason: "Row missing domain column data" });
      continue;
    }

    const domain = (row[domainIdx] || '').toLowerCase().trim();
    if (!domain) {
      results.errors.push({ row: rowNum, reason: 'Missing domain' });
      continue;
    }
    if (!isValidDomain(domain)) {
      results.errors.push({ row: rowNum, domain, reason: 'Invalid domain format' });
      continue;
    }

    const email = emailIdx !== -1 && row[emailIdx] ? row[emailIdx].trim() : undefined;
    const ip = ipIdx !== -1 && row[ipIdx] ? row[ipIdx].trim() : undefined;

    if (ip && !isValidIP(ip)) {
      results.errors.push({ row: rowNum, domain, reason: 'Invalid IP format' });
      continue;
    }

    try {
      await Domain.findOneAndUpdate(
        { domain },
        {
          $setOnInsert: {
            email,
            ips: ip ? [ip] : [],
            health: { status: 'Unknown', lastChecked: new Date() }
          },
          $addToSet: { sources: 'CSV' }
        },
        { upsert: true }
      );
      results.inserted++;
    } catch (err) {
      results.errors.push({ row: rowNum, domain, reason: err.message });
    }
  }

  res.json(results);
});

const { runDomainHealthCheck } = require('../lib/orchestrator');
const dnsblQueue = require('../lib/dnsblQueue');

// Refresh each involved Postmaster account's cached domain list ONCE before a
// health-check run, using the existing FREE v2 domains.list call (no paid/AI API,
// no new integration). This keeps the verification metadata (permission +
// verificationState) current so the orchestrator derives the Domains-table
// verification state from live Postmaster data instead of a stale cache — the
// cache is otherwise only refreshed when someone opens the Settings page.
// Best-effort and bounded (one call per account, not per domain): a failure here
// never blocks the health check — DNS/auth/blacklist/etc. still run and
// verification simply falls back to the last stored value.
async function refreshPostmasterDomainCaches(docs) {
  const accountIds = [...new Set(
    docs.map(d => d.postmasterAccountId).filter(Boolean).map(id => id.toString())
  )];
  for (const id of accountIds) {
    try {
      const account = await PostmasterAccount.findById(id);
      if (!account || !(account.refreshToken || account.accessToken)) continue;
      const domains = await listPostmasterDomains(account);
      account.domains = domains;
      account.lastSyncAt = new Date();
      account.status = 'Connected';
      account.lastError = undefined;
      await account.save();
    } catch (err) {
      console.warn(`Postmaster domain refresh skipped for account ${id}: ${err.message}`);
    }
  }
}

// Bounded worker pool: at most `limit` health checks run at any instant, but the
// pool stays saturated (a new domain starts the moment a slot frees up) — unlike
// the previous fixed batches of 5, which idled waiting for the slowest domain in
// each batch. Concurrency is configurable and never unbounded.
const HEALTH_CHECK_CONCURRENCY = Math.max(
  1,
  parseInt(process.env.HEALTH_CHECK_CONCURRENCY || '20', 10) || 20
);

async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runner = async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  };
  const size = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: size }, runner));
  return results;
}

// POST /api/domains/run-check  — run the full pipeline for all or specific domains
router.post('/run-check', async (req, res) => {
  const startedAt = Date.now();
  try {
    const { domainIds } = req.body; // optional array of IDs to limit scope
    const filter = domainIds && domainIds.length ? { _id: { $in: domainIds } } : {};
    const docs = await Domain.find(filter);

    if (docs.length === 0) {
      return res.json({ message: 'No domains to check', checked: 0, durationMs: Date.now() - startedAt });
    }

    // Bring the Postmaster verification metadata up to date before checking
    // (one domains.list call per account — not per domain).
    await refreshPostmasterDomainCaches(docs);

    // DNSBL runs in a SEPARATE rate-limited lane (max 120/hour, lib/dnsblQueue.js).
    // Mark the selected domains' blacklist as PENDING up front so the UI shows
    // "Processing" immediately instead of a stale Clean/Listed. Only these domains.
    await dnsblQueue.markPending(docs.map(d => d._id));

    // Bounded, saturated worker pool. Each domain is isolated: one domain's error
    // is captured and never aborts the others or the batch.
    const results = await runWithConcurrency(docs, HEALTH_CHECK_CONCURRENCY, async (doc) => {
      let out;
      try {
        const r = await runDomainHealthCheck(doc._id, doc); // pass preloaded doc — no second read
        out = { domain: r.domain, status: 'ok', healthStatus: r.healthStatus, score: r.health.score };
      } catch (err) {
        out = { domain: doc.domain, status: 'error', error: err.message };
      }
      // Enqueue DNSBL for THIS domain now that its DNS is fresh — per-domain, so the
      // blacklist lane starts immediately and never waits for the whole batch. The
      // queue worker (≤120/hour) processes it independently and never blocks this pool.
      dnsblQueue.enqueueOne(doc._id).catch(() => {});
      return out;
    });

    const durationMs = Date.now() - startedAt;
    const completed  = results.filter(r => r && r.status === 'ok').length;
    const failed     = results.filter(r => r && r.status === 'error').length;
    // One concise summary line per run (never per-DNS-lookup).
    console.log(
      `[health-check] domains=${docs.length} completed=${completed} failed=${failed} ` +
      `duration=${(durationMs / 1000).toFixed(1)}s avg=${Math.round(durationMs / docs.length)}ms/domain ` +
      `concurrency=${HEALTH_CHECK_CONCURRENCY}`
    );

    res.json({
      checked: docs.length,
      completed,
      failed,
      durationMs,
      concurrency: HEALTH_CHECK_CONCURRENCY,
      results
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/domains/:id/run-check  — run the COMPLETE pipeline for ONE domain
// and return the full, freshly-updated record so the UI can display it at once.
// Reuses the single central orchestrator (runDomainHealthCheck) — no second
// health-check implementation. Google Postmaster remains optional: the
// orchestrator runs DNS/SPF/DKIM/DMARC/etc. first and Postmaster never throws,
// so a Postmaster failure cannot stop the rest of the pipeline.
router.post('/:id/run-check', async (req, res) => {
  try {
    const doc = await Domain.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Domain not found' });

    // Bring this domain's Postmaster verification metadata up to date first.
    await refreshPostmasterDomainCaches([doc]);

    // The orchestrator persists everything in ONE $set and returns the updated
    // document. DNSBL is decoupled: enqueue this one domain (fresh DNS is now stored)
    // for the rate-limited queue, then return the record — its blacklist shows
    // "Queued"/"Processing" until the queue writes the real result.
    await runDomainHealthCheck(doc._id, doc);
    await dnsblQueue.enqueueOne(doc._id);
    const fresh = await Domain.findById(doc._id);
    res.json(toFrontendShape(fresh));
  } catch (err) {
    // The orchestrator only writes after its checks resolve, so a hard failure
    // (e.g. DNS resolution error) leaves the previously stored data intact.
    if (err.name === 'CastError') return res.status(404).json({ error: 'Domain not found' });
    res.status(500).json({ error: err.message || 'Health check failed' });
  }
});

// DELETE /api/domains/:id
// Removes the domain from BOTH Google Postmaster (when linked) and the local
// registry. Order matters: when the domain is linked to a Postmaster account we
// delete it THERE first — only if that succeeds (or it is already absent, HTTP 404)
// do we remove the local record. A genuine Postmaster failure returns an error and
// leaves the local record intact, so we never report a silent success. A local-only
// domain (no linked account) simply deletes locally as before.
router.delete('/:id', async (req, res) => {
  try {
    // Load by exact _id first: everything below targets THIS document only, so one
    // deletion can never affect another domain.
    const doc = await Domain.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Domain not found' });

    let postmaster = 'not-linked';
    const accountId = doc.postmasterAccountId || doc.reputation?.postmaster?.accountId || null;

    if (accountId) {
      const account = await PostmasterAccount.findById(accountId);
      if (account && (account.refreshToken || account.accessToken)) {
        try {
          const r = await deletePostmasterDomain(account, doc.domain); // reuses existing OAuth token
          postmaster = r.alreadyAbsent ? 'already-absent' : 'deleted';
        } catch (err) {
          // Real Postmaster failure (permission / auth / 5xx): do NOT delete locally.
          return res.status(502).json({
            error: `Google Postmaster deletion failed: ${err.message}`,
            postmaster: 'failed',
          });
        }
        // Drop the cached linkage so no orphaned domains[] entry is left behind.
        if (Array.isArray(account.domains) && account.domains.length) {
          const norm = String(doc.domain).toLowerCase();
          account.domains = account.domains.filter(d => String(d.domain || '').toLowerCase() !== norm);
          try { await account.save(); } catch { /* cache cleanup is best-effort */ }
        }
      } else {
        // Linked to an account that no longer exists / has no usable token: Google
        // cannot be called, and the linkage is already orphaned — proceed to remove
        // the local record so the app does not keep a dangling entry.
        postmaster = 'account-unavailable';
      }
    }

    await Domain.findByIdAndDelete(doc._id);
    res.json({ success: true, postmaster });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
