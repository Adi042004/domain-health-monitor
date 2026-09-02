/**
 * Google Postmaster Tools API v2 client.
 *
 * Centralises everything that talks to Google so the routes and the orchestrator
 * stay small. Uses the v2 endpoints only:
 *   - domains.list                GET  v2/domains
 *   - domains.getComplianceStatus GET  v2/domains/{domain}/complianceStatus
 *   - domains.domainStats.query   POST v2/domains/{domain}/domainStats:query
 *
 * Scopes required (already configured in Google Cloud):
 *   https://www.googleapis.com/auth/postmaster.domain           (domains.list / get)
 *   https://www.googleapis.com/auth/postmaster.traffic.readonly (compliance / stats)
 *
 * Security: tokens live only in MongoDB and in memory here. They are NEVER logged
 * and NEVER returned to the frontend.
 */

const PostmasterAccount = require('../models/PostmasterAccount');

const API_BASE = 'https://gmailpostmastertools.googleapis.com/v2';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const EXPIRY_BUFFER_MS = 60 * 1000; // refresh if the token expires within 60s

// Clear, non-overlapping states (Phase 8).
const STATUS = {
  AVAILABLE: 'AVAILABLE',
  NO_DATA: 'NO_DATA',
  NOT_AUTHORIZED: 'NOT_AUTHORIZED',
  NOT_REGISTERED: 'NOT_REGISTERED',
  API_ERROR: 'API_ERROR',
  RATE_LIMIT: 'RATE_LIMIT', // Google throttled us (HTTP 429) — transient, retried next cycle
  NOT_LINKED: 'NOT_LINKED', // no Google account associated with this domain
};

// UI-facing verification labels for the Domains table (Phase 12).
// These describe whether Google Postmaster reports the domain as VERIFIED for the
// connected account. This is deliberately SEPARATE from compliance/spam status.
const VERIFICATION = {
  VERIFIED: 'Verified',
  UNVERIFIED: 'Unverified',
  NO_ACCESS: 'No Access',
  NOT_LINKED: 'Not Linked',
  NO_DATA: 'No Data',
  UNKNOWN: 'Unknown',
};

/**
 * Derive the Domains-table verification label from Postmaster v2 domain metadata.
 * Reuses exactly the values Google already returns from domains.list — no extra call:
 *   verificationState: VERIFIED | UNVERIFIED | VERIFICATION_STATE_UNSPECIFIED
 *   permission:        OWNER | ADMIN | READER | NONE | PERMISSION_UNSPECIFIED
 *
 * "Verified" means Google reports the domain as verified for the connected account;
 * it is intentionally independent of compliance/deliverability/spam-rate status.
 *
 * @param {object}       p
 * @param {boolean}      p.linked            a Google account is attached to this domain
 * @param {boolean}      [p.known]           the domain was found in that account's domains.list
 * @param {string|null}  [p.verificationState]
 * @param {string|null}  [p.permission]
 * @param {string|null}  [p.status]          combined Postmaster STATUS.* (fallback only)
 * @returns {string} one of VERIFICATION.*
 */
function deriveVerification({ linked, known, verificationState, permission, status } = {}) {
  if (!linked) return VERIFICATION.NOT_LINKED;
  if (permission === 'NONE') return VERIFICATION.NO_ACCESS;
  if (verificationState === 'VERIFIED') return VERIFICATION.VERIFIED;
  if (verificationState === 'UNVERIFIED') return VERIFICATION.UNVERIFIED;

  // No conclusive verification metadata (UNSPECIFIED, or domain not in the cached
  // list): fall back to the combined Postmaster access/data status.
  switch (status) {
    case STATUS.NOT_AUTHORIZED: return VERIFICATION.NO_ACCESS;
    case STATUS.NOT_REGISTERED: return VERIFICATION.NOT_LINKED;
    case STATUS.NO_DATA:        return VERIFICATION.NO_DATA;
    case STATUS.API_ERROR:      return VERIFICATION.UNKNOWN;
    default: break;
  }
  // Linked to an account, but the domain isn't present in that account's list.
  if (known === false) return VERIFICATION.NOT_LINKED;
  return VERIFICATION.UNKNOWN;
}

// ── errors ────────────────────────────────────────────────────────────────

/** Raised when we cannot obtain a usable access token (reconnect needed). */
class ReauthRequiredError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReauthRequiredError';
  }
}

// ── logging (concise, never credentials) ────────────────────────────────────

function logPostmaster({ account, domain, operation, result }) {
  const parts = ['Postmaster:'];
  if (account) parts.push(`account=${account}`);
  if (domain) parts.push(`domain=${domain}`);
  if (operation) parts.push(`operation=${operation}`);
  if (result) parts.push(`result=${result}`);
  console.log(parts.join(' '));
}

// ── helpers ─────────────────────────────────────────────────────────────────

/** Normalize Google's "domains/example.com" resource name into "example.com". */
function normalizeDomainName(name) {
  if (!name) return '';
  return String(name).replace(/^domains\//, '');
}

/** Map an HTTP status from Google to one of our Postmaster states (Phase 10). */
function statusToState(httpStatus) {
  if (httpStatus === 403) return STATUS.NOT_AUTHORIZED;
  if (httpStatus === 404) return STATUS.NOT_REGISTERED;
  if (httpStatus === 429) return STATUS.RATE_LIMIT;
  return STATUS.API_ERROR;
}

/** Pull the first defined numeric out of a StatisticValue. */
function readStatValue(value) {
  if (!value || typeof value !== 'object') return null;
  if (typeof value.doubleValue === 'number') return value.doubleValue;
  if (typeof value.floatValue === 'number') return value.floatValue;
  if (value.intValue !== undefined && value.intValue !== null) {
    const n = Number(value.intValue);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

/** Pull the string list out of a StatisticValue (FEEDBACK_LOOP_ID returns one). */
function readStatStringList(value) {
  if (!value || typeof value !== 'object') return [];
  const list = value.stringList && Array.isArray(value.stringList.values) ? value.stringList.values : [];
  return list.filter((v) => typeof v === 'string' && v.length > 0);
}

// Google Postmaster reports in UTC. Build the {year,month,day} in UTC so we never
// shift a day by the server's local timezone (requirement: dates are UTC-consistent).
function toApiDate(d) {
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

// ── token handling (Phase 3) ─────────────────────────────────────────────────

/**
 * Return a valid access token for the account, refreshing via the refresh token
 * when the current one is missing / expired / (force) rejected.
 *
 * On a definitive refresh failure the account is marked "Reauth Required" (never
 * deleted) and a ReauthRequiredError is thrown. Transient failures throw a plain
 * Error so the caller can surface an API_ERROR without forcing a reconnect.
 */
async function getValidAccessToken(account, { force = false } = {}) {
  const notExpired =
    account.tokenExpiry && new Date(account.tokenExpiry).getTime() - EXPIRY_BUFFER_MS > Date.now();

  if (!force && account.accessToken && notExpired) {
    return account.accessToken;
  }

  if (!account.refreshToken) {
    account.status = 'Reauth Required';
    account.lastError = 'No refresh token stored — please reconnect this Google account.';
    await account.save();
    throw new ReauthRequiredError(account.lastError);
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: account.refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    // invalid_grant => refresh token revoked/expired => genuine reconnect needed.
    if (data.error === 'invalid_grant') {
      account.status = 'Reauth Required';
      account.lastError = 'Google refresh token is no longer valid — please reconnect.';
      await account.save();
      throw new ReauthRequiredError(account.lastError);
    }
    // Transient (network / 5xx / rate limit): do not force a reconnect.
    throw new Error(`Token refresh failed: ${data.error_description || data.error || res.status}`);
  }

  account.accessToken = data.access_token;
  if (data.refresh_token) account.refreshToken = data.refresh_token; // Google may rotate it
  account.tokenExpiry = new Date(Date.now() + (data.expires_in || 3600) * 1000);
  account.status = 'Connected';
  account.lastError = undefined;
  await account.save();

  return account.accessToken;
}

/**
 * Authenticated fetch against the Postmaster API. Transparently refreshes the
 * token and retries exactly once on a 401 (Phase 10).
 * Returns { res, body } — body is the parsed JSON (or {}).
 */
async function apiFetch(account, path, { method = 'GET', body } = {}) {
  const doRequest = async (token) => {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const parsed = await res.json().catch(() => ({}));
    return { res, body: parsed };
  };

  let token = await getValidAccessToken(account);
  let out = await doRequest(token);

  if (out.res.status === 401) {
    // Access token rejected before its recorded expiry — force a refresh and retry once.
    token = await getValidAccessToken(account, { force: true });
    out = await doRequest(token);
  }

  return out;
}

// ── domains.list (Phase 4) ────────────────────────────────────────────────────

/**
 * List every Postmaster domain the connected account can access, following
 * pagination. Returns normalized metadata.
 */
async function listPostmasterDomains(account) {
  const collected = [];
  let pageToken;

  do {
    const qs = new URLSearchParams({ pageSize: '100' });
    if (pageToken) qs.set('pageToken', pageToken);

    const { res, body } = await apiFetch(account, `/domains?${qs.toString()}`);

    if (!res.ok) {
      const message = body?.error?.message || `HTTP ${res.status}`;
      logPostmaster({ account: account.googleEmail, operation: 'list', result: `${res.status}` });
      const err = new Error(message);
      err.httpStatus = res.status;
      throw err;
    }

    for (const d of body.domains || []) {
      collected.push({
        domain: normalizeDomainName(d.name),
        permission: d.permission || null,
        verificationState: d.verificationState || null,
        createTime: d.createTime || null,
        lastVerifyTime: d.lastVerifyTime || null,
      });
    }
    pageToken = body.nextPageToken;
  } while (pageToken);

  logPostmaster({
    account: account.googleEmail,
    operation: 'list',
    result: `${collected.length} domains`,
  });
  return collected;
}

// ── startup sync ──────────────────────────────────────────────────────────────

let syncingAll = false;

/**
 * Refresh the cached Postmaster domain list for every connected account, reusing
 * listPostmasterDomains() above — this is NOT a second sync implementation and it
 * issues no Postmaster call this file does not already make.
 *
 * Called once by server/index.js after MongoDB connects, so a freshly opened
 * desktop app already holds the current domain list + verification metadata
 * instead of waiting for someone to open Settings or start a health check.
 *
 * Deliberately does NOT write to the local Domain registry: importing Postmaster
 * domains into it stays the explicit user action it is today ("Sync to Registry"),
 * so opening the app can never silently add domains the user chose not to import.
 *
 * Contract:
 *   - accounts that need a reconnect are skipped — there is nothing to sync
 *     without a usable credential;
 *   - each account is isolated: one failure never stops the remaining accounts;
 *   - never throws, so the caller can fire-and-forget it;
 *   - re-entrant calls are ignored while a sync is still in flight, so an
 *     initialization path that runs twice cannot produce two concurrent syncs.
 */
async function syncAllConnectedAccounts() {
  if (syncingAll) return { skipped: true, accounts: 0, synced: 0, failed: 0 };
  syncingAll = true;

  let accounts = [];
  let synced = 0;
  let failed = 0;

  try {
    // 'Reauth Required' is set by getValidAccessToken() when Google has definitively
    // rejected the refresh token, so those accounts are not authenticated any more.
    accounts = await PostmasterAccount.find({ status: { $ne: 'Reauth Required' } });

    // Sequential on purpose: one domains.list per account, so a machine with several
    // connected accounts never opens a burst of Google calls the moment it launches.
    for (const account of accounts) {
      if (!(account.refreshToken || account.accessToken)) continue;
      try {
        account.domains = await listPostmasterDomains(account);
        account.lastSyncAt = new Date();
        account.status = 'Connected';
        account.lastError = undefined;
        await account.save();
        synced++;
      } catch (err) {
        // Includes ReauthRequiredError — getValidAccessToken() has already persisted
        // that state on the account, so the UI shows it without extra work here.
        failed++;
        console.warn(`[postmaster-sync] ${account.googleEmail}: ${err.message}`);
      }
    }
  } catch (err) {
    console.warn(`[postmaster-sync] could not load accounts: ${err.message}`);
  } finally {
    syncingAll = false;
  }

  return { skipped: false, accounts: accounts.length, synced, failed };
}

// ── compliance (Phase 6) ──────────────────────────────────────────────────────

/** Map a ComplianceStatus / verdict object down to its enum string. */
function complianceStatusOf(obj) {
  return obj?.status?.status || obj?.status || null;
}

/**
 * Fetch the v2 compliance status for one domain.
 * Returns { state, compliance, deliverability } where state is one of STATUS.*.
 * Preserves Google's original values (no invented fields) and keeps the raw payload.
 */
async function getComplianceStatus(account, domain) {
  const { res, body } = await apiFetch(account, `/domains/${encodeURIComponent(domain)}/complianceStatus`);

  if (!res.ok) {
    const state = statusToState(res.status);
    logPostmaster({ account: account.googleEmail, domain, operation: 'compliance', result: state });
    return { state, compliance: null, deliverability: null, error: body?.error?.message || `HTTP ${res.status}` };
  }

  const data = body.subdomainComplianceData || body.complianceData || null;
  if (!data || !Array.isArray(data.rowData) || data.rowData.length === 0) {
    logPostmaster({ account: account.googleEmail, domain, operation: 'compliance', result: STATUS.NO_DATA });
    return { state: STATUS.NO_DATA, compliance: null, deliverability: null };
  }

  // Map each requirement enum -> COMPLIANT / NEEDS_WORK (preserving Google's values).
  const requirements = {};
  for (const row of data.rowData) {
    if (row.requirement) requirements[row.requirement] = complianceStatusOf(row.status);
  }

  const deliverability = data.deliverabilityStatusVerdict
    ? {
        state: complianceStatusOf(data.deliverabilityStatusVerdict),
        reason: data.deliverabilityStatusVerdict.reason || null,
      }
    : null;

  const compliance = {
    domainId: data.domainId || domain,
    requirements, // e.g. { SPF: 'COMPLIANT', DMARC_POLICY: 'NEEDS_WORK', ... }
    oneClickUnsubscribe: data.oneClickUnsubscribeVerdict
      ? {
          status: complianceStatusOf(data.oneClickUnsubscribeVerdict),
          reason: data.oneClickUnsubscribeVerdict.reason || null,
        }
      : null,
    honorUnsubscribe: data.honorUnsubscribeVerdict
      ? {
          status: complianceStatusOf(data.honorUnsubscribeVerdict),
          reason: data.honorUnsubscribeVerdict.reason || null,
        }
      : null,
    raw: data, // keep Google's original payload untouched
  };

  logPostmaster({ account: account.googleEmail, domain, operation: 'compliance', result: STATUS.AVAILABLE });
  return { state: STATUS.AVAILABLE, compliance, deliverability };
}

// ── domain statistics / spam rate (Phase 7) ───────────────────────────────────

/**
 * Query the user-reported SPAM_RATE metric for the last `days` days (DAILY).
 * Returns { state, spamRate, spamRateHistory }.
 *   - spamRate is the most recent value, or null when Google returns none.
 *   - state is AVAILABLE when at least one value exists, NO_DATA when the call
 *     succeeds but is empty, or NOT_AUTHORIZED / NOT_REGISTERED / API_ERROR.
 */
async function queryDomainStats(account, domain, { days = 120 } = {}) {
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);

  const requestBody = {
    parent: `domains/${domain}`,
    metricDefinitions: [{ name: 'spamRate', baseMetric: { standardMetric: 'SPAM_RATE' } }],
    timeQuery: { dateRanges: { dateRanges: [{ start: toApiDate(start), end: toApiDate(end) }] } },
    aggregationGranularity: 'DAILY',
    pageSize: 200,
  };

  const history = [];
  let pageToken;

  do {
    const bodyWithToken = pageToken ? { ...requestBody, pageToken } : requestBody;
    const { res, body } = await apiFetch(account, `/domains/${encodeURIComponent(domain)}/domainStats:query`, {
      method: 'POST',
      body: bodyWithToken,
    });

    if (!res.ok) {
      const state = statusToState(res.status);
      logPostmaster({ account: account.googleEmail, domain, operation: 'stats', result: state });
      return { state, spamRate: null, spamRateHistory: [], error: body?.error?.message || `HTTP ${res.status}` };
    }

    for (const stat of body.domainStats || []) {
      if (stat.metric !== 'spamRate') continue;
      const rate = readStatValue(stat.value);
      if (rate === null) continue;
      const d = stat.date;
      const date = d ? new Date(Date.UTC(d.year, (d.month || 1) - 1, d.day || 1)) : new Date();
      history.push({ date, rate });
    }
    pageToken = body.nextPageToken;
  } while (pageToken);

  if (history.length === 0) {
    logPostmaster({ account: account.googleEmail, domain, operation: 'stats', result: STATUS.NO_DATA });
    return { state: STATUS.NO_DATA, spamRate: null, spamRateHistory: [] };
  }

  history.sort((a, b) => a.date - b.date); // chronological
  const spamRate = history[history.length - 1].rate; // most recent

  logPostmaster({ account: account.googleEmail, domain, operation: 'stats', result: STATUS.AVAILABLE });
  return { state: STATUS.AVAILABLE, spamRate, spamRateHistory: history };
}

// ── all v2 standard metrics in ONE call (with the REQUIRED per-metric filters) ──

/**
 * Every v2 statistic we fetch, each with the filter Google's schema REQUIRES.
 *
 * Google's BaseMetric requires a `filter` on several standardMetrics; sending them
 * without one makes the WHOLE domainStats:query fail with 400 INVALID_ARGUMENT
 * (this was the root cause of the metrics showing "Unavailable"). Verified verbatim
 * against the official v2 discovery document (gmailpostmastertools v2, rev 20260823):
 *   AUTH_SUCCESS_RATE       -> auth_type = "spf" | "dkim" | "dmarc"
 *   TLS_ENCRYPTION_RATE     -> traffic_direction = "inbound" | "outbound"
 *   DELIVERY_ERROR_RATE     -> optional error_type = "reject" | "temp_fail" (empty = aggregate)
 *   FEEDBACK_LOOP_SPAM_RATE -> feedback_loop_id = "<id>" (queried separately, per discovered id)
 *   SPAM_RATE / FEEDBACK_LOOP_ID -> no filter
 *
 * All of these ride ONE domainStats:query (Google accepts an array of
 * metricDefinitions), so the extra series add pagination pages — not round-trips.
 */
const METRIC_QUERIES = [
  { name: 'spamRate',         standardMetric: 'SPAM_RATE' },
  { name: 'authSpf',          standardMetric: 'AUTH_SUCCESS_RATE',   filter: 'auth_type = "spf"' },
  { name: 'authDkim',         standardMetric: 'AUTH_SUCCESS_RATE',   filter: 'auth_type = "dkim"' },
  { name: 'authDmarc',        standardMetric: 'AUTH_SUCCESS_RATE',   filter: 'auth_type = "dmarc"' },
  { name: 'tlsInbound',       standardMetric: 'TLS_ENCRYPTION_RATE', filter: 'traffic_direction = "inbound"' },
  { name: 'tlsOutbound',      standardMetric: 'TLS_ENCRYPTION_RATE', filter: 'traffic_direction = "outbound"' },
  { name: 'deliveryTotal',    standardMetric: 'DELIVERY_ERROR_RATE' },
  { name: 'deliveryReject',   standardMetric: 'DELIVERY_ERROR_RATE', filter: 'error_type = "reject"' },
  { name: 'deliveryTempFail', standardMetric: 'DELIVERY_ERROR_RATE', filter: 'error_type = "temp_fail"' },
  { name: 'fblIds',           standardMetric: 'FEEDBACK_LOOP_ID' },
];

// Backwards-compatible field-name -> standardMetric map (kept for existing importers).
const STANDARD_METRICS = METRIC_QUERIES.reduce((acc, m) => {
  acc[m.name] = m.standardMetric;
  return acc;
}, {});

/** A metric container is AVAILABLE if any of its child series has data, else NO_DATA. */
function containerState(seriesList) {
  return seriesList.some((s) => s.state === STATUS.AVAILABLE) ? STATUS.AVAILABLE : STATUS.NO_DATA;
}

/** Uniform error buckets for every metric container (access denial / rate limit / 5xx). */
function buildErrorMetrics(state) {
  const leaf = () => ({ state, latest: null, history: [] });
  return {
    spam: leaf(),
    auth: { state, spf: leaf(), dkim: leaf(), dmarc: leaf() },
    encryption: { state, inbound: leaf(), outbound: leaf() },
    deliveryErrors: { state, total: leaf(), reject: leaf(), tempFail: leaf() },
    feedbackLoop: { state, ids: [], series: [] },
  };
}

/**
 * Feedback-loop spam rate is only meaningful when the domain is enrolled in one or
 * more feedback-loop campaigns (FEEDBACK_LOOP_ID). For each discovered id we query
 * FEEDBACK_LOOP_SPAM_RATE with the required feedback_loop_id filter. This is the ONLY
 * conditional extra Google call, and only for FBL-enrolled domains (rare).
 *
 * No ids -> NO_DATA (never "Unavailable"). A failure here marks ONLY the feedback-loop
 * container; the other metrics already succeeded in the main call.
 * Returns { state, ids: [...], series: [{ id, latest, history: [{date, value}] }] }.
 */
async function queryFeedbackLoopSpamRates(account, domain, ids, { start, end }) {
  if (!ids || ids.length === 0) {
    return { state: STATUS.NO_DATA, ids: [], series: [] };
  }

  const idByName = {};
  const metricDefinitions = ids.map((id, i) => {
    const name = `fbl_${i}`;
    idByName[name] = id;
    return {
      name,
      baseMetric: { standardMetric: 'FEEDBACK_LOOP_SPAM_RATE' },
      filter: `feedback_loop_id = "${id}"`,
    };
  });

  const requestBody = {
    parent: `domains/${domain}`,
    metricDefinitions,
    timeQuery: { dateRanges: { dateRanges: [{ start: toApiDate(start), end: toApiDate(end) }] } },
    aggregationGranularity: 'DAILY',
    pageSize: 200,
  };

  const points = {};
  for (const name of Object.keys(idByName)) points[name] = [];

  try {
    let pageToken;
    do {
      const bodyWithToken = pageToken ? { ...requestBody, pageToken } : requestBody;
      const { res, body } = await apiFetch(account, `/domains/${encodeURIComponent(domain)}/domainStats:query`, {
        method: 'POST',
        body: bodyWithToken,
      });

      if (!res.ok) {
        const state = statusToState(res.status);
        logPostmaster({ account: account.googleEmail, domain, operation: 'fbl', result: state });
        return { state, ids, series: [] };
      }

      for (const stat of body.domainStats || []) {
        const name = stat.metric;
        if (!Object.prototype.hasOwnProperty.call(points, name)) continue;
        const v = readStatValue(stat.value);
        if (v === null) continue;
        const d = stat.date;
        const date = d ? new Date(Date.UTC(d.year, (d.month || 1) - 1, d.day || 1)) : new Date();
        points[name].push({ date, value: v });
      }
      pageToken = body.nextPageToken;
    } while (pageToken);
  } catch (err) {
    logPostmaster({ account: account.googleEmail, domain, operation: 'fbl', result: STATUS.API_ERROR });
    return { state: STATUS.API_ERROR, ids, series: [] };
  }

  const series = Object.keys(idByName)
    .map((name) => {
      const history = points[name].slice().sort((a, b) => a.date - b.date);
      return {
        id: idByName[name],
        latest: history.length ? history[history.length - 1].value : null,
        history,
      };
    })
    .filter((s) => s.history.length > 0);

  return { state: series.length ? STATUS.AVAILABLE : STATUS.NO_DATA, ids, series };
}

/**
 * Query ALL supported v2 standard metrics for one domain in a SINGLE
 * domainStats:query call (plus a conditional feedback-loop follow-up), then
 * demultiplex the flat domainStats[] response by metric name into multi-series
 * buckets. Preserves Google's raw values, dates and full history.
 *
 * A series Google returns nothing for stays NO_DATA — it is NEVER coerced to 0.
 *
 * Returns { state, metrics: { spam, auth, encryption, deliveryErrors, feedbackLoop } }:
 *   spam           = { state, latest, history }
 *   auth           = { state, spf, dkim, dmarc }        (each a { state, latest, history } series)
 *   encryption     = { state, inbound, outbound }
 *   deliveryErrors = { state, total, reject, tempFail }
 *   feedbackLoop   = { state, ids, series: [{ id, latest, history }] }
 *
 * Resilience: a 403/404/429 short-circuits every bucket to that state (no redundant
 * retry). Any other non-OK (e.g. 5xx) falls back to the proven spam-only
 * queryDomainStats so the pre-existing spam feature can never regress.
 */
async function queryDomainMetrics(account, domain, { days = 120 } = {}) {
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);

  const metricDefinitions = METRIC_QUERIES.map((m) => ({
    name: m.name,
    baseMetric: { standardMetric: m.standardMetric },
    ...(m.filter ? { filter: m.filter } : {}),
  }));

  const requestBody = {
    parent: `domains/${domain}`,
    metricDefinitions,
    timeQuery: { dateRanges: { dateRanges: [{ start: toApiDate(start), end: toApiDate(end) }] } },
    aggregationGranularity: 'DAILY',
    pageSize: 200,
  };

  // Raw (date,value) points collected per metric name; FBL ids from a stringList metric.
  const points = {};
  for (const m of METRIC_QUERIES) points[m.name] = [];
  const fblIdSet = new Set();

  let pageToken;
  let errorState = null;
  let errorMsg;

  do {
    const bodyWithToken = pageToken ? { ...requestBody, pageToken } : requestBody;
    const { res, body } = await apiFetch(account, `/domains/${encodeURIComponent(domain)}/domainStats:query`, {
      method: 'POST',
      body: bodyWithToken,
    });

    if (!res.ok) {
      errorState = statusToState(res.status);
      errorMsg = body?.error?.message || `HTTP ${res.status}`;
      break;
    }

    for (const stat of body.domainStats || []) {
      const label = stat.metric;
      if (!Object.prototype.hasOwnProperty.call(points, label)) continue;
      const d = stat.date;
      const date = d ? new Date(Date.UTC(d.year, (d.month || 1) - 1, d.day || 1)) : new Date();
      if (label === 'fblIds') {
        for (const id of readStatStringList(stat.value)) fblIdSet.add(id);
        continue;
      }
      const v = readStatValue(stat.value);
      if (v === null) continue;
      points[label].push({ date, value: v });
    }
    pageToken = body.nextPageToken;
  } while (pageToken);

  if (errorState) {
    // Definitive access denial / throttle — every bucket reports that state.
    if (
      errorState === STATUS.NOT_AUTHORIZED ||
      errorState === STATUS.NOT_REGISTERED ||
      errorState === STATUS.RATE_LIMIT
    ) {
      logPostmaster({ account: account.googleEmail, domain, operation: 'metrics', result: errorState });
      return { state: errorState, error: errorMsg, metrics: buildErrorMetrics(errorState) };
    }
    // Otherwise (e.g. 5xx): fall back to the proven spam-only query so the working
    // spam feature is preserved; the other buckets report the error state.
    logPostmaster({ account: account.googleEmail, domain, operation: 'metrics', result: `${errorState} (spam-only fallback)` });
    const spam = await queryDomainStats(account, domain, { days });
    const metrics = buildErrorMetrics(errorState);
    metrics.spam = spam.state === STATUS.AVAILABLE
      ? { state: STATUS.AVAILABLE, latest: spam.spamRate, history: spam.spamRateHistory.map((h) => ({ date: h.date, value: h.rate })) }
      : { state: spam.state, latest: null, history: [] };
    return {
      state: spam.state === STATUS.AVAILABLE ? STATUS.AVAILABLE : errorState,
      error: spam.error || errorMsg,
      metrics,
    };
  }

  // Collected points -> leaf series (chronological; latest = most-recent value).
  const series = (name) => {
    const history = points[name].slice().sort((a, b) => a.date - b.date);
    if (history.length === 0) return { state: STATUS.NO_DATA, latest: null, history: [] };
    return { state: STATUS.AVAILABLE, latest: history[history.length - 1].value, history };
  };

  const spam = series('spamRate');

  const spf = series('authSpf');
  const dkim = series('authDkim');
  const dmarc = series('authDmarc');
  const auth = { state: containerState([spf, dkim, dmarc]), spf, dkim, dmarc };

  const inbound = series('tlsInbound');
  const outbound = series('tlsOutbound');
  const encryption = { state: containerState([inbound, outbound]), inbound, outbound };

  const total = series('deliveryTotal');
  const reject = series('deliveryReject');
  const tempFail = series('deliveryTempFail');
  const deliveryErrors = { state: containerState([total, reject, tempFail]), total, reject, tempFail };

  // Feedback loop: discovered ids -> one follow-up query for their spam rates (only
  // when the domain is FBL-enrolled). No ids -> NO_DATA (never "Unavailable").
  const feedbackLoop = await queryFeedbackLoopSpamRates(account, domain, [...fblIdSet], { start, end });

  const anyAvailable = [spam, auth, encryption, deliveryErrors, feedbackLoop]
    .some((m) => m.state === STATUS.AVAILABLE);
  logPostmaster({ account: account.googleEmail, domain, operation: 'metrics', result: anyAvailable ? STATUS.AVAILABLE : STATUS.NO_DATA });

  return {
    state: anyAvailable ? STATUS.AVAILABLE : STATUS.NO_DATA,
    metrics: { spam, auth, encryption, deliveryErrors, feedbackLoop },
  };
}

// ── domain management: add + verify ownership (v2 domains.create/verify) ───────

/**
 * NOTE: create / getVerificationToken / verify use the SAME scope the app already
 * requests — https://www.googleapis.com/auth/postmaster.domain — so NO new OAuth
 * scope is needed (verified against the v2 discovery doc). They are Google
 * "Developer Preview" methods; the read methods used elsewhere are GA.
 */

/** Normalize a Domain resource down to the same shape we cache in account.domains. */
function shapeDomain(d, fallbackDomain) {
  return {
    domain: normalizeDomainName(d?.name) || (fallbackDomain || ''),
    permission: d?.permission || null,
    verificationState: d?.verificationState || null,
    createTime: d?.createTime || null,
    lastVerifyTime: d?.lastVerifyTime || null,
  };
}

/** Only TXT / CNAME are valid DNS verification methods (defaults to TXT). */
function normalizeVerificationMethod(method) {
  return String(method || 'TXT').toUpperCase() === 'CNAME' ? 'CNAME' : 'TXT';
}

/** Build an Error carrying the HTTP status + mapped STATUS for the routes to translate. */
function httpError(res, body) {
  const err = new Error(body?.error?.message || `HTTP ${res.status}`);
  err.httpStatus = res.status;
  err.state = statusToState(res.status);
  return err;
}

/** Retrieve one domain's metadata (domains.get — GA). GET v2/domains/{domain}. */
async function getPostmasterDomain(account, domainInput) {
  const domain = normalizeDomainName(domainInput).toLowerCase();
  const { res, body } = await apiFetch(account, `/domains/${encodeURIComponent(domain)}`);
  if (!res.ok) throw httpError(res, body);
  return shapeDomain(body, domain);
}

/**
 * Add a domain to the connected account in Google Postmaster Tools (domains.create).
 *   POST v2/domains  { domainId }
 * Idempotent: Google returns ALREADY_EXISTS (409) if the user already registered it,
 * which we treat as success and resolve to the current metadata via domains.get — so
 * we never create a duplicate. Returns a shapeDomain(...) + { alreadyExisted }.
 */
async function createPostmasterDomain(account, domainInput) {
  const domain = normalizeDomainName(domainInput).toLowerCase();
  const { res, body } = await apiFetch(account, '/domains', {
    method: 'POST',
    body: { domainId: domain },
  });

  if (res.ok) {
    logPostmaster({ account: account.googleEmail, domain, operation: 'create', result: 'created' });
    return { ...shapeDomain(body, domain), alreadyExisted: false };
  }

  if (res.status === 409) {
    logPostmaster({ account: account.googleEmail, domain, operation: 'create', result: 'already-exists' });
    const existing = await getPostmasterDomain(account, domain);
    return { ...existing, alreadyExisted: true };
  }

  logPostmaster({ account: account.googleEmail, domain, operation: 'create', result: `${res.status}` });
  throw httpError(res, body);
}

/**
 * Get the DNS verification token for a domain (domains.getVerificationToken).
 *   GET v2/domains/{domain}/verificationToken?verificationMethod=TXT|CNAME
 * Google returns ONLY { verificationMethod, token } — a single opaque token string
 * (no separate host/target). We surface EXACTLY that; nothing is invented.
 * This token is a public DNS value, NOT an OAuth token.
 */
async function getDomainVerificationToken(account, domainInput, method = 'TXT') {
  const domain = normalizeDomainName(domainInput).toLowerCase();
  const verificationMethod = normalizeVerificationMethod(method);
  const qs = new URLSearchParams({ verificationMethod });
  const { res, body } = await apiFetch(
    account,
    `/domains/${encodeURIComponent(domain)}/verificationToken?${qs.toString()}`
  );
  if (!res.ok) throw httpError(res, body);
  logPostmaster({ account: account.googleEmail, domain, operation: 'getVerificationToken', result: verificationMethod });
  return {
    verificationMethod: body.verificationMethod || verificationMethod,
    token: body.token || null,
  };
}

/**
 * Verify domain ownership at the DNS level (domains.verify).
 *   POST v2/domains/{domain}:verify  { verificationMethod }
 * VerifyDomainResponse is empty, so on HTTP 200 we re-read domains.get once to obtain
 * the authoritative verificationState/lastVerifyTime (the only metadata refresh).
 *
 * Google remains the source of truth — we never emulate DNS verification ourselves.
 * Returns { verified:true, verificationState, permission, lastVerifyTime } on success,
 * or { verified:false, httpStatus, state, message } when Google could not verify yet
 * (e.g. DNS record not found / not propagated). Reauth errors propagate to the route.
 */
async function verifyPostmasterDomain(account, domainInput, method = 'TXT') {
  const domain = normalizeDomainName(domainInput).toLowerCase();
  const verificationMethod = normalizeVerificationMethod(method);
  const { res, body } = await apiFetch(account, `/domains/${encodeURIComponent(domain)}:verify`, {
    method: 'POST',
    body: { verificationMethod },
  });

  if (res.ok) {
    logPostmaster({ account: account.googleEmail, domain, operation: 'verify', result: 'verified' });
    const meta = await getPostmasterDomain(account, domain).catch(() => null);
    return {
      verified: true,
      verificationState: meta?.verificationState || 'VERIFIED',
      permission: meta?.permission || null,
      lastVerifyTime: meta?.lastVerifyTime || null,
    };
  }

  logPostmaster({ account: account.googleEmail, domain, operation: 'verify', result: `${res.status}` });
  return {
    verified: false,
    httpStatus: res.status,
    state: statusToState(res.status),
    verificationState: 'UNVERIFIED',
    message: body?.error?.message || `HTTP ${res.status}`,
  };
}

// ── domain management: delete (v2 domains.delete) ──────────────────────────────

/**
 * Remove a domain from the connected account in Google Postmaster Tools
 * (domains.delete). DELETE v2/domains/{domain}. Uses the SAME apiFetch — the
 * existing stored OAuth token with automatic refresh — and the SAME
 * postmaster.domain scope already used by create/verify, so there is NO new OAuth
 * flow and tokens never leave the server.
 *
 * Idempotent: HTTP 404 means the domain is already absent from Postmaster, which we
 * report as { removed:false, alreadyAbsent:true } (a graceful success) so deletion
 * is never stuck on an already-gone domain. Any OTHER non-OK response throws an
 * httpError for the route to surface — a real failure must never look like success.
 */
async function deletePostmasterDomain(account, domainInput) {
  const domain = normalizeDomainName(domainInput).toLowerCase();
  const { res, body } = await apiFetch(account, `/domains/${encodeURIComponent(domain)}`, {
    method: 'DELETE',
  });

  if (res.ok) {
    logPostmaster({ account: account.googleEmail, domain, operation: 'delete', result: 'deleted' });
    return { removed: true, alreadyAbsent: false };
  }
  if (res.status === 404) {
    logPostmaster({ account: account.googleEmail, domain, operation: 'delete', result: 'already-absent' });
    return { removed: false, alreadyAbsent: true };
  }
  logPostmaster({ account: account.googleEmail, domain, operation: 'delete', result: `${res.status}` });
  throw httpError(res, body);
}

// ── combined per-domain run (used by the orchestrator) ─────────────────────────

/**
 * Run the full Postmaster pipeline for one domain against one account:
 * compliance first, then stats (skipped when compliance says the domain is not
 * accessible). Never throws for API-level problems — always resolves to a result
 * object with a clear STATUS.*.
 */
async function runPostmasterForDomain(account, domain) {
  const lastChecked = new Date();
  const base = {
    accountId: account._id,
    status: STATUS.NO_DATA,
    available: false,
    compliance: null,
    deliverability: null,
    spamRate: null,
    spamRateHistory: [],
    // Expanded v2 metric categories (raw values preserved; NO_DATA stays no-data).
    spam: null,
    authentication: null,
    encryption: null,
    deliveryErrors: null,
    feedbackLoop: null,
    error: undefined,
    lastChecked,
  };

  try {
    const compliance = await getComplianceStatus(account, domain);

    // Definitive "cannot access this domain" — do not query statistics for it.
    if (compliance.state === STATUS.NOT_AUTHORIZED || compliance.state === STATUS.NOT_REGISTERED) {
      return { ...base, status: compliance.state, error: compliance.error };
    }

    // ONE domainStats:query fetches spam + auth + encryption + delivery-errors +
    // feedback-loop together (see queryDomainMetrics). Same call count as before.
    const stats = await queryDomainMetrics(account, domain, { days: 120 });

    if (stats.state === STATUS.NOT_AUTHORIZED || stats.state === STATUS.NOT_REGISTERED) {
      // Compliance was reachable but stats say otherwise — prefer the access verdict.
      return {
        ...base,
        status: stats.state,
        compliance: compliance.compliance,
        deliverability: compliance.deliverability,
        error: stats.error,
      };
    }

    const m = stats.metrics;
    const spamBucket = m.spam;
    // Keep the legacy spamRate / spamRateHistory shape the existing UI + chart read.
    // NO_DATA must stay null — never coerced to 0 (Phase 7 invariant preserved).
    const spamRate = spamBucket && spamBucket.state === STATUS.AVAILABLE ? spamBucket.latest : null;
    const spamRateHistory = spamBucket && spamBucket.state === STATUS.AVAILABLE
      ? spamBucket.history.map(h => ({ date: h.date, rate: h.value }))
      : [];

    const hasCompliance = compliance.state === STATUS.AVAILABLE;
    const hasStats = stats.state === STATUS.AVAILABLE;
    const available = hasCompliance || hasStats;
    // Distinguish a genuine empty (NO_DATA) from a broken call (API_ERROR) or a
    // throttle (RATE_LIMIT). Never collapse an error/throttle into NO_DATA.
    const states = [compliance.state, stats.state];
    const erroredOut = states.includes(STATUS.API_ERROR);
    const rateLimited = states.includes(STATUS.RATE_LIMIT);

    let status;
    if (available) status = STATUS.AVAILABLE;
    else if (rateLimited) status = STATUS.RATE_LIMIT;
    else if (erroredOut) status = STATUS.API_ERROR;
    else status = STATUS.NO_DATA;

    return {
      ...base,
      status,
      available,
      compliance: compliance.compliance,
      deliverability: compliance.deliverability,
      spamRate,
      spamRateHistory,
      // Raw v2 metric categories for the expanded dashboard.
      spam: spamBucket,
      authentication: m.auth,
      encryption: m.encryption,
      deliveryErrors: m.deliveryErrors,
      feedbackLoop: m.feedbackLoop,
      error: compliance.error || stats.error,
    };
  } catch (err) {
    // ReauthRequired or transient network error — surface as API_ERROR, keep going.
    logPostmaster({ account: account.googleEmail, domain, operation: 'run', result: STATUS.API_ERROR });
    return { ...base, status: STATUS.API_ERROR, error: err.message };
  }
}

module.exports = {
  STATUS,
  VERIFICATION,
  STANDARD_METRICS,
  deriveVerification,
  ReauthRequiredError,
  normalizeDomainName,
  getValidAccessToken,
  listPostmasterDomains,
  syncAllConnectedAccounts,
  getPostmasterDomain,
  createPostmasterDomain,
  getDomainVerificationToken,
  verifyPostmasterDomain,
  deletePostmasterDomain,
  getComplianceStatus,
  queryDomainStats,
  queryDomainMetrics,
  runPostmasterForDomain,
  logPostmaster,
};
