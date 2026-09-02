const mongoose = require('mongoose');

const DNSRecordSchema = new mongoose.Schema({
  value: String,
  ttl: Number
}, { _id: false });

const CheckResultSchema = new mongoose.Schema({
  status: { type: String, enum: ['Pass', 'Fail', 'Missing', 'No Data', 'Unknown', 'NOT_DISCOVERED', 'Error', 'Timeout'], default: 'Unknown' },
  rawRecord: String,
  error: String,
  lastChecked: Date
}, { _id: false });

const SPFSchema = new mongoose.Schema({
  status: { type: String, default: 'Unknown' },
  rawRecord: String,
  error: String,
  lastChecked: Date
}, { _id: false });

const DKIMSchema = new mongoose.Schema({
  status: { type: String, default: 'Unknown' },
  selector: String,
  hostname: String,
  rawRecord: String,
  error: String,
  lastChecked: Date
}, { _id: false });

const DMARCSchema = new mongoose.Schema({
  status: { type: String, default: 'Unknown' },
  rawRecord: String,
  policy: String,
  error: String,
  lastChecked: Date
}, { _id: false });

// Google Postmaster Tools v2 result for a domain (Phase 6/8/11).
// Stored alongside the existing reputation numbers so the current UI keeps working.

// One reusable shape for every raw Postmaster v2 metric time-series (expansion).
// Stores Google's raw value + date history as-is; `state` distinguishes
// AVAILABLE / NO_DATA / NOT_AUTHORIZED / NOT_REGISTERED / API_ERROR so the UI can
// show "No Data" instead of a misleading 0%. `count` carries a companion volume
// (e.g. TLS-encrypted message count alongside the TLS rate).
const PostmasterMetricSchema = new mongoose.Schema({
  state:   { type: String, default: 'NO_DATA' },
  latest:  { type: Number, default: null },
  count:   { type: Number, default: null },
  history: [{ date: Date, value: Number }]
}, { _id: false });

// Multi-series containers. Several Google v2 metrics are only queryable per required
// filter, so each is stored as separate daily series (never merged into a fake single
// value): AUTH_SUCCESS_RATE per auth_type, TLS_ENCRYPTION_RATE per traffic_direction,
// DELIVERY_ERROR_RATE aggregate + per error_type, FEEDBACK_LOOP_SPAM_RATE per id.
// `state` = AVAILABLE if any child series has data, else NO_DATA / access-error state.
const PostmasterAuthSchema = new mongoose.Schema({
  state: { type: String, default: 'NO_DATA' },
  spf:   { type: PostmasterMetricSchema, default: null }, // auth_type = "spf"
  dkim:  { type: PostmasterMetricSchema, default: null }, // auth_type = "dkim"
  dmarc: { type: PostmasterMetricSchema, default: null }, // auth_type = "dmarc"
}, { _id: false });

const PostmasterEncryptionSchema = new mongoose.Schema({
  state:    { type: String, default: 'NO_DATA' },
  inbound:  { type: PostmasterMetricSchema, default: null }, // traffic_direction = "inbound"
  outbound: { type: PostmasterMetricSchema, default: null }, // traffic_direction = "outbound"
}, { _id: false });

const PostmasterDeliverySchema = new mongoose.Schema({
  state:    { type: String, default: 'NO_DATA' },
  total:    { type: PostmasterMetricSchema, default: null }, // aggregate (no filter)
  reject:   { type: PostmasterMetricSchema, default: null }, // error_type = "reject"
  tempFail: { type: PostmasterMetricSchema, default: null }, // error_type = "temp_fail"
}, { _id: false });

// One feedback-loop id's daily spam-rate series (Google returns a rate per FBL id).
const PostmasterFblSeriesSchema = new mongoose.Schema({
  id:      { type: String },
  latest:  { type: Number, default: null },
  history: [{ date: Date, value: Number }]
}, { _id: false });

const PostmasterFeedbackLoopSchema = new mongoose.Schema({
  state:  { type: String, default: 'NO_DATA' },
  ids:    [String],                        // FEEDBACK_LOOP_ID values Google reported
  series: [PostmasterFblSeriesSchema],     // FEEDBACK_LOOP_SPAM_RATE per id
}, { _id: false });

const PostmasterSchema = new mongoose.Schema({
  accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'PostmasterAccount' },
  // AVAILABLE | NO_DATA | NOT_AUTHORIZED | NOT_REGISTERED | API_ERROR | NOT_LINKED
  status: { type: String, default: 'NOT_LINKED' },
  available: { type: Boolean, default: false },
  // Normalized compliance map + verdicts + Google's raw payload (Mixed: preserve as-is).
  compliance: { type: mongoose.Schema.Types.Mixed, default: null },
  deliverability: {
    state: String,   // COMPLIANT | NEEDS_WORK | STATE_UNSPECIFIED
    reason: String
  },
  spamRate: { type: Number, default: null },
  // Expanded Google Postmaster v2 metric categories (raw values; additive — the
  // legacy spamRate number above is kept for the existing UI/charts). Sourced from
  // the single domainStats:query call; no duplicate/second schema.
  spam:           { type: PostmasterMetricSchema, default: null },     // SPAM_RATE (single daily series)
  authentication: { type: PostmasterAuthSchema, default: null },       // AUTH_SUCCESS_RATE per auth_type (spf/dkim/dmarc)
  encryption:     { type: PostmasterEncryptionSchema, default: null }, // TLS_ENCRYPTION_RATE per traffic_direction (inbound/outbound)
  deliveryErrors: { type: PostmasterDeliverySchema, default: null },   // DELIVERY_ERROR_RATE aggregate + per error_type
  feedbackLoop:   { type: PostmasterFeedbackLoopSchema, default: null },// FEEDBACK_LOOP_SPAM_RATE per feedback_loop_id
  // Verification metadata from Postmaster v2 domains.list (Phase 12). Reuses the
  // permission/verificationState Google already returns; independent of compliance.
  linked: { type: Boolean, default: false },        // a Google account is attached
  verificationState: { type: String, default: null }, // VERIFIED | UNVERIFIED | VERIFICATION_STATE_UNSPECIFIED
  permission: { type: String, default: null },         // OWNER | ADMIN | READER | NONE | PERMISSION_UNSPECIFIED
  verification: { type: String, default: 'Unknown' },  // Verified | Unverified | No Access | Not Linked | No Data | Unknown
  error: String,
  lastChecked: Date
}, { _id: false });

const DNSRecordsSchema = new mongoose.Schema({
  a:    [DNSRecordSchema],
  aaaa: [DNSRecordSchema],
  mx:   [DNSRecordSchema],
  ns:   [DNSRecordSchema],
  txt:  [DNSRecordSchema],
  cname:[DNSRecordSchema],
  soa:  DNSRecordSchema,
  lastChecked: Date,
  error: String
}, { _id: false });

// Mail transport infrastructure result (PTR + SMTP reachability + STARTTLS).
// Produced by lib/mailInfra.js from ONE connection to the primary MX host. All
// values default to 'Unknown' — an unreachable/blocked port 25 (common on cloud
// egress) is NOT a health failure, just Unknown.
const InfrastructureSchema = new mongoose.Schema({
  mailServerHostname: { type: String, default: null },
  ptr:                { type: String, default: null },
  smtpStatus:         { type: String, default: 'Unknown' }, // Reachable | Error | Unknown
  tls:                { type: String, default: 'Unknown' }, // Supported | Not Supported | Unknown
  error:              { type: String, default: null },
  lastChecked: Date
}, { _id: false });

// Registration facts from RDAP (lib/domainInfo.js). Free IANA-bootstrap lookup,
// freshness-gated (not re-queried on every run). `state` distinguishes AVAILABLE
// / NO_DATA / UNAVAILABLE (unsupported TLD or lookup failure) so the UI never
// shows a fabricated date. Registrar / age are informational (not scored).
const DomainInfoSchema = new mongoose.Schema({
  registrar:   { type: String, default: null },
  createdDate: { type: Date, default: null },
  expiryDate:  { type: Date, default: null },
  state:       { type: String, default: 'NO_DATA' }, // AVAILABLE | NO_DATA | UNAVAILABLE
  source:      { type: String, default: 'RDAP' },
  error:       { type: String, default: null },
  lastChecked: Date
}, { _id: false });

const DomainSchema = new mongoose.Schema({
  domain: { type: String, required: true, unique: true, lowercase: true, trim: true },
  email:  { type: String, trim: true },
  ips:    [String],
  provider: String,
  
  sources: [{ type: String, enum: ['CSV', 'POSTMASTER', 'MANUAL'] }],
  postmasterAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'PostmasterAccount' },

  dns: DNSRecordsSchema,

  authentication: {
    spf:   SPFSchema,
    dkim:  DKIMSchema,
    dmarc: DMARCSchema
  },

  // Blacklist / DNSBL result (lib/blacklist.js) — reverse-DNS lookups against
  // free public DNSBL zones for this domain's IP(s).
  blacklist: {
    status: { type: String, default: 'Unknown' },
    countChecked: { type: Number, default: 0 },
    countListed:  { type: Number, default: 0 },
    lastChecked: Date,
    // DNSBL queue lifecycle (lib/dnsblQueue.js), separate from the result `status`
    // above: DONE = result valid; PENDING/QUEUED/RUNNING = check in progress.
    jobStatus: { type: String, default: 'DONE' }, // DONE | PENDING | QUEUED | RUNNING
    queuedAt:  Date,                               // FIFO ordering within the queue
    lists: [{
      listName: String,
      status: String,
      listedIp: String,
      dateDetected: Date,
      reason: String,
      lastChecked: Date
    }]
  },

  // Mail transport infrastructure (PTR / SMTP / STARTTLS).
  infrastructure: { type: InfrastructureSchema, default: null },

  reputation: {
    spamRate: { type: Number, default: null },
    spamRateHistory: [{
      date: Date,
      rate: Number
    }],
    postmasterDataAvailable: { type: Boolean, default: false },
    lastChecked: Date,
    // Detailed Google Postmaster v2 signal (compliance / deliverability / status).
    postmaster: { type: PostmasterSchema, default: null }
  },

  health: {
    status: { type: String, default: 'Unknown' },
    score:  { type: Number, default: null },
    lastChecked: Date
  },

  history: [{
    date: Date,
    status: String,
    spamRate: Number,
    blacklist: String,
    score: Number
  }],

  createdDate: Date,
  expiryDate:  Date,

  // Registration facts from RDAP (registrar / created / expiry). Top-level
  // createdDate/expiryDate above are also populated from this for back-compat.
  domainInfo: { type: DomainInfoSchema, default: null }
}, {
  timestamps: true
});

// The domain list is always sorted newest-first (routes/domains.js GET /).
DomainSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Domain', DomainSchema);
