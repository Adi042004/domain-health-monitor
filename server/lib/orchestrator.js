const Domain = require('../models/Domain');
const { checkDNS, checkSPF, checkDMARC, checkDKIM, computeHealth } = require('./dnsChecker');
const { runPostmasterForDomain, STATUS, deriveVerification } = require('./postmasterService');
const { checkDomainInfo } = require('./domainInfo');
const { checkMailInfra } = require('./mailInfra');
const { createLimiter } = require('./limiter');

// Bound Google Postmaster API concurrency INDEPENDENTLY of the domain worker pool.
// Raising HEALTH_CHECK_CONCURRENCY must never translate into the same number of
// simultaneous Google API calls, so every Postmaster request funnels through this
// shared, in-process limiter (default 6; override with POSTMASTER_CONCURRENCY).
// Existing per-call error handling / 429 (RATE_LIMIT) behavior is unchanged.
const pmLimiter = createLimiter(process.env.POSTMASTER_CONCURRENCY || 6);

/**
 * The ONE central orchestrator for all domain health checks.
 * Regardless of source (CSV, POSTMASTER, MANUAL), every domain goes through this pipeline.
 *
 * @param {string} domainId
 * @param {object} [preloadedDoc] - an already-loaded Domain document (bulk path passes
 *        this to avoid a redundant read). When omitted, the domain is loaded here.
 * @returns {{ domain, status, health, healthStatus, doc }} the updated document is
 *        returned so callers don't need to re-read it.
 */
async function runDomainHealthCheck(domainId, preloadedDoc = null) {
  const doc = preloadedDoc || await Domain.findById(domainId);
  if (!doc) throw new Error('Domain not found');

  const domain = doc.domain;
  const now = new Date();

  // Populate the linked Postmaster account (only when one is linked and not
  // already populated) so the Postmaster call can run in parallel with DNS below.
  // Domains with no linked account incur zero extra reads.
  let account = doc.postmasterAccountId || null;
  if (account && typeof doc.populated === 'function' && !doc.populated('postmasterAccountId')) {
    try { await doc.populate('postmasterAccountId'); account = doc.postmasterAccountId; }
    catch (e) { account = doc.postmasterAccountId; }
  }
  const pmLinked = !!(account && (account.refreshToken || account.accessToken));

  // ---- Independent lookups, in parallel, fully isolated ----
  // Each helper already catches its own errors and returns a result object; the
  // allSettled wrapper is belt-and-suspenders so one rejection can never abort the
  // others. This deliberately replaces the previous serial chain that re-threw and
  // discarded all partial results on any single failure.
  //
  // The mail-infra + DNSBL checks depend ONLY on the DNS result (MX host + resolved
  // IPs) — NOT on DMARC/DKIM/RDAP/Postmaster. So instead of a hard Phase-A barrier
  // before Phase B, we chain Phase B directly off checkDNS. That overlaps the
  // ~1-3s RDAP lookup with the ~4s SMTP probe rather than running them back-to-back
  // (measured ~2-3s/domain off the critical path; see the report's timing section).
  // The mail-infra check depends ONLY on the DNS result (MX host + resolved IPs), so
  // we chain it directly off checkDNS to overlap it with the parallel RDAP/DMARC/DKIM
  // work rather than running a hard Phase-A barrier first.
  //
  // DNSBL/blacklist is deliberately NOT run here. It is the rate-sensitive part
  // (max 120 domains/hour against public blacklists) and is handled asynchronously by
  // lib/dnsblQueue.js, enqueued per-domain in routes/domains.js the moment this DNS
  // result lands — so it never blocks or slows the rest of the health check.
  const storedIps = (doc.ips || []).filter(Boolean);
  const dnsP = checkDNS(domain);
  const phaseBP = dnsP.then(
    (dnsResult) => {
      const resolvedA = (dnsResult.a || []).map(r => r.value).filter(Boolean);
      const ptrIps = storedIps.length ? storedIps : resolvedA;          // PTR for the sending IP
      return checkMailInfra(domain, ptrIps, dnsResult.mx, {});
    },
    // DNS itself rejected: still probe with any stored IPs.
    () => checkMailInfra(domain, storedIps, [], {})
  );

  const [dnsS, dmarcS, dkimS, infoS, pmS, phaseBS] = await Promise.allSettled([
    dnsP,
    checkDMARC(domain),
    checkDKIM(domain),
    checkDomainInfo(domain, doc.domainInfo, {}),
    pmLinked ? pmLimiter(() => runPostmasterForDomain(account, domain)) : Promise.resolve(null),
    phaseBP
  ]);

  const dnsResult = dnsS.status === 'fulfilled' ? dnsS.value
    : { a: [], aaaa: [], mx: [], ns: [], txt: [], cname: [], soa: undefined, lastChecked: now, error: 'check failed' };
  const spfResult = checkSPF(dnsResult.txt);           // reuses the TXT already fetched
  const dmarcResult = dmarcS.status === 'fulfilled' ? dmarcS.value
    : { status: 'Unknown', rawRecord: null, error: 'check failed', lastChecked: now };
  const dkimResult = dkimS.status === 'fulfilled' ? dkimS.value
    : { status: 'Unknown', selector: null, hostname: null, rawRecord: null, error: 'check failed', lastChecked: now };
  const domainInfoResult = infoS.status === 'fulfilled' ? infoS.value
    : { registrar: null, createdDate: null, expiryDate: null, state: 'UNAVAILABLE', source: 'RDAP', error: 'check failed', lastChecked: now };

  // phaseBP resolves to the mail-infra result (or rejects → handled here). Blacklist
  // is no longer part of Phase B; its result is written asynchronously by the queue.
  const infraResult = phaseBS.status === 'fulfilled' && phaseBS.value ? phaseBS.value
    : { mailServerHostname: null, ptr: null, smtpStatus: 'Unknown', tls: 'Unknown', error: 'check failed', lastChecked: now };

  // ---- Google Postmaster reputation (from the Phase-A result; semantics unchanged) ----
  // Postmaster runs ONLY for domains linked to a connected Google account. Absence
  // of Postmaster data is never a domain-health failure.
  let reputation = {
    spamRate: (doc.reputation && doc.reputation.spamRate != null) ? doc.reputation.spamRate : null,
    spamRateHistory: (doc.reputation && doc.reputation.spamRateHistory) || [],
    postmasterDataAvailable: false,
    lastChecked: now,
    postmaster: (doc.reputation && doc.reputation.postmaster) || null
  };

  if (pmLinked && pmS.status === 'fulfilled' && pmS.value) {
    const pm = pmS.value;
    // Verification comes from the domains.list metadata already cached on the account
    // (populated at sync time). No extra Google call is made here.
    const meta = (account.domains || []).find(
      d => (d.domain || '').toLowerCase() === domain.toLowerCase()
    );
    // If this domain isn't in the (possibly stale) cache, keep whatever verification
    // was last stored rather than dropping it to null.
    const prevPm = (doc.reputation && doc.reputation.postmaster) || {};
    const verificationState = meta ? (meta.verificationState || null) : (prevPm.verificationState || null);
    const permission        = meta ? (meta.permission        || null) : (prevPm.permission        || null);
    const verification = deriveVerification({
      linked: true, known: !!meta, verificationState, permission, status: pm.status
    });

    reputation = {
      // Keep the spam-rate fields the current UI/charts read. NO_DATA stays null.
      spamRate: pm.spamRate,
      spamRateHistory: pm.status === STATUS.AVAILABLE ? pm.spamRateHistory : reputation.spamRateHistory,
      postmasterDataAvailable: pm.available,
      lastChecked: pm.lastChecked,
      postmaster: {
        accountId: pm.accountId,
        status: pm.status,
        available: pm.available,
        compliance: pm.compliance,
        deliverability: pm.deliverability,
        spamRate: pm.spamRate,
        spam: pm.spam,
        authentication: pm.authentication,
        encryption: pm.encryption,
        deliveryErrors: pm.deliveryErrors,
        feedbackLoop: pm.feedbackLoop,
        linked: true,
        verificationState,
        permission,
        verification,
        error: pm.error,
        lastChecked: pm.lastChecked
      }
    };
  } else if (pmLinked) {
    // Linked but the call did not yield a result this run — keep prior Postmaster
    // data untouched rather than wiping it. (runPostmasterForDomain never throws,
    // so this branch is effectively unreachable; it exists only as a safety net.)
    reputation.postmaster = (doc.reputation && doc.reputation.postmaster) || null;
  } else {
    // No Google account linked to this domain — not a failure, just not applicable.
    reputation.postmaster = {
      accountId: null,
      status: STATUS.NOT_LINKED,
      available: false,
      linked: false,
      verificationState: null,
      permission: null,
      verification: deriveVerification({ linked: false }), // 'Not Linked'
      lastChecked: now
    };
  }

  // ---- Overall health: rule-based status + numeric compliance score ----
  // Blacklist is checked asynchronously (see lib/dnsblQueue.js). Score the INITIAL
  // health from the last-known blacklist state (Unknown → excluded from the score);
  // the queue recomputes health for the domain the moment its fresh DNSBL result lands.
  const health = computeHealth(
    dnsResult,
    { spf: spfResult, dmarc: dmarcResult, dkim: dkimResult },
    { infrastructure: infraResult, blacklist: (doc.blacklist || {}), postmaster: reputation.postmaster }
  );

  // Append one point to the trend history (kept bounded to the last 90).
  const historyPoint = {
    date: now,
    status: health.status,
    spamRate: reputation.spamRate,
    blacklist: (doc.blacklist && doc.blacklist.status) || 'Unknown',
    score: health.score
  };
  const history = [...((doc.history) || []), historyPoint].slice(-90);

  // ---- ONE consolidated write (all subsystems in a single $set) ----
  const set = {
    'dns.a':           dnsResult.a,
    'dns.aaaa':        dnsResult.aaaa,
    'dns.mx':          dnsResult.mx,
    'dns.ns':          dnsResult.ns,
    'dns.txt':         dnsResult.txt,
    'dns.cname':       dnsResult.cname,
    'dns.soa':         dnsResult.soa,
    'dns.lastChecked': dnsResult.lastChecked,
    'dns.error':       dnsResult.error,

    'authentication.spf':   spfResult,
    'authentication.dkim':  dkimResult,
    'authentication.dmarc': dmarcResult,

    'reputation.spamRate':                reputation.spamRate,
    'reputation.spamRateHistory':         reputation.spamRateHistory,
    'reputation.postmasterDataAvailable': reputation.postmasterDataAvailable,
    'reputation.lastChecked':             reputation.lastChecked,
    'reputation.postmaster':              reputation.postmaster,

    infrastructure: {
      mailServerHostname: infraResult.mailServerHostname,
      ptr:                infraResult.ptr,
      smtpStatus:         infraResult.smtpStatus,
      tls:                infraResult.tls,
      error:              infraResult.error,
      lastChecked:        infraResult.lastChecked
    },
    // NOTE: `blacklist` is intentionally NOT written here — lib/dnsblQueue.js owns it
    // (writing this block would clobber the queue's PENDING/QUEUED/RUNNING state).
    domainInfo: {
      registrar:   domainInfoResult.registrar,
      createdDate: domainInfoResult.createdDate,
      expiryDate:  domainInfoResult.expiryDate,
      state:       domainInfoResult.state,
      source:      domainInfoResult.source,
      error:       domainInfoResult.error,
      lastChecked: domainInfoResult.lastChecked
    },

    'health.status':      health.status,
    'health.score':       health.score,
    'health.lastChecked': now,

    history
  };
  // Only mirror real RDAP dates onto the top-level fields — never clobber with null.
  if (domainInfoResult.createdDate) set.createdDate = domainInfoResult.createdDate;
  if (domainInfoResult.expiryDate)  set.expiryDate  = domainInfoResult.expiryDate;

  const updatedDoc = await Domain.findByIdAndUpdate(doc._id, { $set: set }, { new: true });

  return { domain, status: 'ok', health, healthStatus: health.status, doc: updatedDoc };
}

module.exports = { runDomainHealthCheck };
