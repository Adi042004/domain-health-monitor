export type Status = 'Healthy' | 'Warning' | 'Critical' | 'Unknown';
export type RecordStatus = 'Pass' | 'Fail' | 'Missing' | 'No Data' | 'Unknown';
export type BlacklistStatus = 'Clean' | 'Listed' | 'Check Failed' | 'Unknown';

export interface DNSRecord {
  value: string;
  ttl?: number;
}

export interface DNSRecords {
  a?: DNSRecord[];
  aaaa?: DNSRecord[];
  mx?: DNSRecord[];
  ns?: DNSRecord[];
  txt?: DNSRecord[];
  cname?: DNSRecord[];
  soa?: DNSRecord;
  lastChecked: string;
}

export interface Authentication {
  spf: { status: RecordStatus; record?: string; lastChecked: string };
  dkim: { status: RecordStatus; selector?: string; record?: string; lastChecked: string };
  dmarc: { status: RecordStatus; policy?: string; record?: string; lastChecked: string };
}

export interface Infrastructure {
  ptr?: string;
  smtpStatus: 'Reachable' | 'Error' | 'Unknown';
  tls: 'Supported' | 'Not Supported' | 'Unknown';
  mailServerHostname?: string;
  lastChecked: string;
}

export interface BlacklistItem {
  listName: string;
  status: 'Clean' | 'Listed';
  listedIp?: string;
  dateDetected?: string;
  reason?: string;
  lastChecked: string;
}

export interface Blacklist {
  status: BlacklistStatus;
  countChecked: number;
  countListed: number;
  lastChecked: string;
  lists: BlacklistItem[];
  // DNSBL queue lifecycle (backend lib/dnsblQueue.js), separate from the result
  // `status`: DONE = result valid; PENDING/QUEUED/RUNNING = check still in progress.
  jobStatus?: 'DONE' | 'PENDING' | 'QUEUED' | 'RUNNING';
}

// Registration facts from RDAP (free IANA-bootstrap lookup). `state` distinguishes
// AVAILABLE / NO_DATA / UNAVAILABLE so the UI never shows a fabricated date.
export interface DomainInfo {
  registrar?: string | null;
  createdDate?: string | null;
  expiryDate?: string | null;
  state?: string; // AVAILABLE | NO_DATA | UNAVAILABLE
  lastChecked?: string | null;
}

export interface HistoryPoint {
  date: string;
  status: Status;
  spamRate: number | null;
  blacklist: BlacklistStatus;
  score: number | null;
}

export type PostmasterStatus =
  | 'AVAILABLE' | 'NO_DATA' | 'NOT_AUTHORIZED' | 'NOT_REGISTERED' | 'API_ERROR' | 'RATE_LIMIT' | 'NOT_LINKED';

// Domains-table verification label (from Postmaster v2 domains.list metadata).
export type PostmasterVerification =
  | 'Verified' | 'Unverified' | 'No Access' | 'Not Linked' | 'No Data' | 'Unknown';

// One raw Postmaster v2 metric time-series (a single daily series). `state`
// distinguishes AVAILABLE / NO_DATA / access errors so the UI shows "No Data"
// rather than a misleading 0%.
export interface PostmasterMetric {
  state: string;               // AVAILABLE | NO_DATA | NOT_AUTHORIZED | NOT_REGISTERED | API_ERROR | RATE_LIMIT
  latest: number | null;       // most-recent raw value (null when Google returns none)
  count?: number | null;       // companion volume (unused by the multi-series metrics)
  history?: { date: string; value: number }[];
}

// Multi-series Postmaster containers. Google requires a filter per query, so these
// metrics are stored/displayed as separate real series — never merged into one value.
export interface PostmasterAuth {           // AUTH_SUCCESS_RATE per auth_type
  state: string;
  spf: PostmasterMetric | null;
  dkim: PostmasterMetric | null;
  dmarc: PostmasterMetric | null;
}
export interface PostmasterEncryption {     // TLS_ENCRYPTION_RATE per traffic_direction
  state: string;
  inbound: PostmasterMetric | null;
  outbound: PostmasterMetric | null;
}
export interface PostmasterDelivery {       // DELIVERY_ERROR_RATE aggregate + per error_type
  state: string;
  total: PostmasterMetric | null;
  reject: PostmasterMetric | null;
  tempFail: PostmasterMetric | null;
}
export interface PostmasterFblSeries {      // one feedback-loop id's spam-rate series
  id: string;
  latest: number | null;
  history?: { date: string; value: number }[];
}
export interface PostmasterFeedbackLoop {   // FEEDBACK_LOOP_SPAM_RATE per feedback_loop_id
  state: string;
  ids: string[];
  series: PostmasterFblSeries[];
}

export interface PostmasterInfo {
  status: PostmasterStatus;
  available: boolean;
  compliance: {
    domainId?: string;
    requirements?: Record<string, string>; // e.g. { SPF: 'COMPLIANT', DMARC_POLICY: 'NEEDS_WORK' }
    oneClickUnsubscribe?: { status: string; reason?: string | null } | null;
    honorUnsubscribe?: { status: string; reason?: string | null } | null;
  } | null;
  deliverability: { state?: string; reason?: string | null } | null;
  spamRate: number | null;
  // Expanded v2 metric categories (raw Google values; null / NO_DATA preserved).
  spam?: PostmasterMetric | null;
  authentication?: PostmasterAuth | null;
  encryption?: PostmasterEncryption | null;
  deliveryErrors?: PostmasterDelivery | null;
  feedbackLoop?: PostmasterFeedbackLoop | null;
  // Verification signal (separate from compliance) — powers the Domains-table column.
  linked?: boolean;
  verificationState?: string | null; // VERIFIED | UNVERIFIED | VERIFICATION_STATE_UNSPECIFIED
  permission?: string | null;         // OWNER | ADMIN | READER | NONE | PERMISSION_UNSPECIFIED
  verification?: PostmasterVerification;
  error?: string | null;
  lastChecked?: string | null;
}

export interface Reputation {
  spamRate: number | null;
  spamRateHistory: { date: string; rate: number }[];
  postmasterDataAvailable: boolean;
  lastChecked: string;
  postmaster?: PostmasterInfo | null;
}

export interface DomainHealth {
  id: string;
  domain: string;
  email?: string;
  ips: string[];
  provider: string;
  // Postmaster account this domain is linked to (if any); used to reuse the existing
  // verify modal from Domain Details without a second OAuth/account lookup.
  postmasterAccountId?: string | null;
  createdDate: string;
  expiryDate: string;

  dns: DNSRecords;
  authentication: Authentication;
  infrastructure: Infrastructure;
  blacklist: Blacklist;
  reputation: Reputation;
  // Real registration facts from RDAP (null when never checked).
  domainInfo?: DomainInfo | null;

  health: {
    status: Status;
    score: number | null;
    lastChecked: string;
  };

  history: HistoryPoint[];
}
