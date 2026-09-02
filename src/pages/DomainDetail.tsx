import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { domainService } from '../services/domainService';
import { DomainHealth, HistoryPoint, PostmasterInfo, PostmasterMetric } from '../types/domain';
import { Card, Badge, BlacklistBadge, blacklistDisplayStatus } from '../components/ui';
import { ArrowLeft, Server, Mail, Calendar, RefreshCw, AlertCircle, ShieldCheck } from 'lucide-react';
import { format, differenceInDays } from 'date-fns';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useAppContext } from '../context/AppContext';
import PostmasterVerifyModal from '../components/PostmasterVerifyModal';

const DomainDetail = () => {
  const { domainId } = useParams();
  const [domain, setDomain] = useState<DomainHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [historyRange, setHistoryRange] = useState<7 | 30 | 60 | 90 | 120>(30);
  const [checkState, setCheckState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [checkError, setCheckError] = useState<string | null>(null);
  // Verify-later modal (reuses the EXISTING PostmasterVerifyModal, opened on the verify step).
  const [verifyOpen, setVerifyOpen] = useState(false);

  // Re-fetch the domain from the backend. Used on mount and after a verify so the view
  // reflects the updated (Verified) state without a manual sync. Does not toggle the
  // top-level loading gate, so a post-verify refresh doesn't flash the whole page.
  const loadDomain = async () => {
    if (!domainId) return;
    const data = await domainService.getDomain(domainId);
    setDomain(data || null);
    setLoading(false);
  };

  useEffect(() => {
    loadDomain();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domainId]);

  // DNSBL is processed in a separate 120/hour lane, so its result lands after this
  // domain's main check returns. While its blacklist is still queued/processing,
  // silently re-fetch so it flips to the real Clean/Listed/Unknown result.
  useEffect(() => {
    const pending = domain?.blacklist?.jobStatus && domain.blacklist.jobStatus !== 'DONE';
    if (!pending) return;
    const t = setInterval(() => loadDomain(), 15000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain?.blacklist?.jobStatus]);

  // Run the COMPLETE pipeline (DNS → auth → infra → blacklist → Postmaster) for
  // this one domain via the existing orchestrator, then refresh the view with the
  // full updated record the endpoint returns. On failure we keep the current data.
  const handleRunCheck = async () => {
    if (!domainId || checkState === 'running') return;
    setCheckState('running');
    setCheckError(null);
    try {
      const updated = await domainService.runCheckForDomain(domainId);
      if (updated) setDomain(updated);
      setCheckState('done');
      setTimeout(() => setCheckState('idle'), 4000);
    } catch (err: any) {
      setCheckError(err?.message || 'Health check failed. Please try again.');
      setCheckState('error');
    }
  };

  if (loading) return <div className="text-text-muted p-6">Loading domain details...</div>;
  if (!domain) return <div className="text-status-error p-6">Domain not found.</div>;

  // Prefer real RDAP registration facts. When RDAP has run (domainInfo present) we
  // trust ONLY it — a null date renders as "Unknown" rather than a fabricated
  // placeholder. When it was never run, fall back to the legacy top-level fields.
  const info = domain.domainInfo || null;
  const parseDate = (s?: string | null): Date | null => {
    if (!s) return null;
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  };
  const createdOn = info ? parseDate(info.createdDate) : parseDate(domain.createdDate);
  const expiresOn = info ? parseDate(info.expiryDate)  : parseDate(domain.expiryDate);
  const domainAge = createdOn ? differenceInDays(new Date(), createdOn) : null;
  const daysUntilExpiry = expiresOn ? differenceInDays(expiresOn, new Date()) : null;

  // Verify-later gating: only offer "Verify Domain" when this domain exists in Postmaster
  // and Google still reports it UNVERIFIED. A verified domain shows a status chip and no
  // button. We reuse the domain's own linked account (never a second OAuth / account pick).
  const pm = domain.reputation.postmaster;
  const pmAccountId = domain.postmasterAccountId || null;
  const isPostmasterVerified = !!pm && pm.verificationState === 'VERIFIED';
  const isPostmasterUnverified = !!pm && pm.verificationState === 'UNVERIFIED';
  const canVerify = isPostmasterUnverified && !!pmAccountId;

  return (
    <div className="space-y-6">
      {/* Header section */}
      <div>
        <Link to="/domains" className="inline-flex items-center gap-2 text-sm text-text-muted hover:text-text-main transition-colors mb-4">
          <ArrowLeft size={16} /> Back to Domains
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-3xl font-bold text-text-main leading-none">{domain.domain}</h1>
              <Badge status={domain.health.status} className="text-sm px-2 py-1" />
              {domain.health.score !== null && (
                <span className="text-sm font-medium bg-panel border border-border px-2 py-1 rounded text-text-main">
                  Score: {domain.health.score}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-text-muted">
              <span className="flex items-center gap-1.5"><Server size={14} /> IP: {domain.ips.join(', ')}</span>
              {domain.email && <span className="flex items-center gap-1.5"><Mail size={14} /> Email: {domain.email}</span>}
              <span className="flex items-center gap-1.5"><GlobeIcon size={14} /> Provider: {domain.provider}</span>
              <span className="flex items-center gap-1.5"><Calendar size={14} /> Last Checked: {format(new Date(domain.health.lastChecked), 'dd MMM yyyy, hh:mm a')}</span>
            </div>
          </div>

          {/* Manual single-domain health check */}
          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-2">
              {/* Verify-later: reuses the EXISTING Postmaster verify modal. Shown only for a
                  Postmaster domain Google still reports as UNVERIFIED; hidden once verified. */}
              {canVerify && (
                <button
                  onClick={() => setVerifyOpen(true)}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-md font-medium text-sm text-white bg-status-warning hover:opacity-90 transition-colors"
                >
                  <ShieldCheck size={16} /> Verify Domain
                </button>
              )}
              <button
                onClick={handleRunCheck}
                disabled={checkState === 'running'}
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-md font-medium text-sm text-white transition-colors ${
                  checkState === 'running'
                    ? 'bg-primary/60 cursor-not-allowed'
                    : checkState === 'done'
                    ? 'bg-status-success hover:bg-status-success'
                    : 'bg-primary hover:bg-primary-hover'
                }`}
              >
                <RefreshCw size={16} className={checkState === 'running' ? 'animate-spin' : ''} />
                {checkState === 'running'
                  ? 'Checking...'
                  : checkState === 'done'
                  ? 'Health Check Complete'
                  : 'Run Health Check'}
              </button>
            </div>
            {/* Postmaster verification state — flips to this chip after a successful verify. */}
            {isPostmasterVerified && (
              <span className="flex items-center gap-1 text-xs text-status-success">
                <ShieldCheck size={12} /> Postmaster verified
              </span>
            )}
            {isPostmasterUnverified && !pmAccountId && (
              <span className="text-xs text-status-warning">Postmaster: pending verification</span>
            )}
            {checkState === 'error' && checkError && (
              <span className="flex items-center gap-1 text-xs text-status-error max-w-[16rem] text-right">
                <AlertCircle size={12} className="shrink-0" /> {checkError}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Spam Rate / Reputation Section */}
        <Card className="lg:col-span-2 flex flex-col" title={
          <div className="flex justify-between items-center">
            <span>Reputation</span>
            <span className="text-xs font-normal text-text-muted">Last Checked: {format(new Date(domain.reputation.lastChecked), 'dd MMM yyyy')}</span>
          </div>
        }>
          <div className="flex flex-col sm:flex-row gap-8 mb-6 pb-6 border-b border-border/50">
            <div>
              <div className="text-text-muted text-sm mb-1">Current Spam Rate</div>
              <div className={`text-4xl font-bold ${domain.reputation.spamRate != null ? (domain.reputation.spamRate === 0 ? 'text-status-success' : domain.reputation.spamRate < 0.1 ? 'text-status-warning' : 'text-status-error') : 'text-text-muted'}`}>
                {domain.reputation.spamRate != null ? `${(domain.reputation.spamRate * 100).toFixed(3)}%` : 'No Data'}
              </div>
              {domain.reputation.spamRate != null && (
                <div className="text-xs text-text-muted mt-1">
                  {domain.reputation.spamRate === 0 ? 'Excellent — no spam reported' :
                   domain.reputation.spamRate < 0.001 ? 'Good' :
                   domain.reputation.spamRate < 0.01 ? 'Warning — elevated spam' :
                   'Critical — high spam rate'}
                </div>
              )}
            </div>
          </div>

          {/* Google Postmaster v2 — full data dashboard (compliance + spam + feedback
              loop + authentication + encryption + delivery errors). Reads only from
              the backend (MongoDB); no direct Google calls from the browser. */}
          {domain.reputation.postmaster && (
            <PostmasterDashboard
              postmaster={domain.reputation.postmaster}
              range={historyRange}
              onRangeChange={setHistoryRange}
            />
          )}
        </Card>

        {/* Email Authentication Section */}
        <Card title={
          <div className="flex justify-between items-center">
            <span>Email Authentication</span>
            <span className="text-xs font-normal text-text-muted">Last Checked: {format(new Date(domain.authentication.spf.lastChecked), 'dd MMM yyyy, hh:mm a')}</span>
          </div>
        }>
          <div className="space-y-6">
            <div className="border-b border-border/50 pb-5">
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-text-main text-sm">SPF</span>
                <Badge status={domain.authentication.spf.status} />
              </div>
              <div className="bg-background border border-border p-3 rounded-md overflow-x-auto mt-2">
                <p className="text-xs text-text-muted font-mono whitespace-nowrap">
                  {domain.authentication.spf.record || 'No SPF record found.'}
                </p>
              </div>
            </div>

            <div className="border-b border-border/50 pb-5">
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-text-main text-sm">DKIM</span>
                <Badge status={domain.authentication.dkim.status} />
              </div>
              {domain.authentication.dkim.selector && (
                <div className="text-xs text-text-muted mb-2">
                  Selector: <span className="font-mono text-text-main bg-background px-1 rounded">{domain.authentication.dkim.selector}</span>
                </div>
              )}
              <div className="bg-background border border-border p-3 rounded-md overflow-x-auto">
                <p className="text-xs text-text-muted font-mono whitespace-nowrap">
                  {domain.authentication.dkim.record || 'No DKIM record found.'}
                </p>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-text-main text-sm">DMARC</span>
                <Badge status={domain.authentication.dmarc.status} />
              </div>
              {domain.authentication.dmarc.policy && (
                <div className="text-xs text-text-muted mb-2">
                  Policy: <span className="font-mono text-text-main bg-background px-1 rounded">{domain.authentication.dmarc.policy}</span>
                </div>
              )}
              <div className="bg-background border border-border p-3 rounded-md overflow-x-auto">
                <p className="text-xs text-text-muted font-mono whitespace-nowrap">
                  {domain.authentication.dmarc.record || 'No DMARC record found.'}
                </p>
              </div>
            </div>
          </div>
        </Card>

        {/* DNS Records Section */}
        <Card className="lg:col-span-2" title={
          <div className="flex justify-between items-center">
            <span>DNS Records</span>
            <span className="text-xs font-normal text-text-muted">Last Checked: {format(new Date(domain.dns.lastChecked), 'dd MMM yyyy, hh:mm a')}</span>
          </div>
        }>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
            <DNSRecordGroup title="A" records={domain.dns.a} />
            <DNSRecordGroup title="AAAA" records={domain.dns.aaaa} />
            <DNSRecordGroup title="MX" records={domain.dns.mx} />
            <DNSRecordGroup title="NS" records={domain.dns.ns} />
            <DNSRecordGroup title="CNAME" records={domain.dns.cname} />
            <div className="md:col-span-2">
              <DNSRecordGroup title="TXT" records={domain.dns.txt} />
            </div>
            {domain.dns.soa && (
              <div className="md:col-span-2">
                <DNSRecordGroup title="SOA" records={[domain.dns.soa]} />
              </div>
            )}
          </div>
        </Card>

        {/* Domain Information — real RDAP facts (registrar / created / expiry). */}
        <Card title={
          <div className="flex justify-between items-center">
            <span>Domain Information</span>
            {info?.lastChecked && (
              <span className="text-xs font-normal text-text-muted">
                RDAP · {format(new Date(info.lastChecked), 'dd MMM yyyy')}
              </span>
            )}
          </div>
        }>
          <div className="space-y-4">
            <InfoRow label="Provider / Registrar" value={info?.registrar || domain.provider || 'Unknown'} />
            <InfoRow label="Creation Date" value={createdOn ? format(createdOn, 'dd MMM yyyy') : 'Unknown'} />
            <InfoRow label="Domain Age" value={domainAge != null ? `${domainAge} days` : '—'} />
            <InfoRow label="Expiry Date" value={expiresOn ? format(expiresOn, 'dd MMM yyyy') : 'Unknown'} />
            <InfoRow
              label="Days Until Expiry"
              value={daysUntilExpiry != null ? daysUntilExpiry.toString() : '—'}
              valueClass={daysUntilExpiry != null && daysUntilExpiry < 30 ? 'text-status-error font-bold' : undefined}
            />
            {info?.state === 'UNAVAILABLE' && (
              <p className="text-xs text-text-muted pt-1">
                RDAP lookup unavailable for this TLD — registration details can't be shown.
              </p>
            )}
          </div>
        </Card>

        {/* Blacklist Status */}
        <Card className="lg:col-span-2" title={
          <div className="flex justify-between items-center">
            <span>Blacklist Status</span>
            <span className="text-xs font-normal text-text-muted">Last Checked: {format(new Date(domain.blacklist.lastChecked), 'dd MMM yyyy, hh:mm a')}</span>
          </div>
        }>
          <div className="flex gap-8 mb-6 pb-6 border-b border-border/50">
            <div>
              <div className="text-text-muted text-sm mb-1">Overall Status</div>
              <BlacklistBadge blacklist={domain.blacklist} className="text-sm px-3 py-1" />
            </div>
            <div>
              <div className="text-text-muted text-sm mb-1">Lists Checked</div>
              <div className="font-medium text-text-main text-lg">{domain.blacklist.countChecked}</div>
            </div>
            <div>
              <div className="text-text-muted text-sm mb-1">Listings</div>
              <div className={`font-medium text-lg ${domain.blacklist.countListed > 0 ? 'text-status-error' : 'text-text-main'}`}>
                {domain.blacklist.countListed}
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-text-muted uppercase bg-panel border-b border-border">
                <tr>
                  <th className="px-4 py-3 font-medium">Blacklist</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Details</th>
                  <th className="px-4 py-3 font-medium text-right">Last Checked</th>
                </tr>
              </thead>
              <tbody>
                {domain.blacklist.lists.length > 0 ? (
                  domain.blacklist.lists.map((list, i) => (
                    <tr key={i} className="border-b border-border/50 last:border-0 hover:bg-background/50">
                      <td className="px-4 py-3 font-medium text-text-main">{list.listName}</td>
                      <td className="px-4 py-3"><Badge status={list.status} /></td>
                      <td className="px-4 py-3 text-xs text-text-muted">
                        {list.status === 'Listed' ? (
                          <div className="space-y-1">
                            <div>IP: <span className="text-status-error font-medium">{list.listedIp}</span></div>
                            {list.dateDetected && <div>Detected: {format(new Date(list.dateDetected), 'dd MMM yyyy')}</div>}
                            {list.reason && <div>Reason: {list.reason}</div>}
                          </div>
                        ) : '-'}
                      </td>
                      <td className="px-4 py-3 text-xs text-text-muted text-right">
                        {format(new Date(list.lastChecked), 'dd MMM yyyy')}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-text-muted text-sm">No specific blacklist checks available</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Mail Infrastructure */}
        <Card title={
          <div className="flex justify-between items-center">
            <span>Mail Infrastructure</span>
            <span className="text-xs font-normal text-text-muted">Last Checked: {format(new Date(domain.infrastructure.lastChecked), 'hh:mm a')}</span>
          </div>
        }>
          <div className="space-y-5">
            <div className="bg-background border border-border rounded-md p-4 space-y-3 text-sm">
              <div className="grid grid-cols-[80px_1fr] gap-2 items-start">
                <span className="text-text-muted">MX Server:</span>
                <span className="text-text-main font-mono text-xs">{domain.infrastructure.mailServerHostname || domain.dns.mx?.[0]?.value.split(' ')[1] || 'Unknown'}</span>
              </div>
              <div className="grid grid-cols-[80px_1fr] gap-2 items-start">
                <span className="text-text-muted">PTR:</span>
                <span className="text-text-main font-mono text-xs">
                  {domain.infrastructure.ptr ? (
                    <>{domain.ips[0]} <span className="text-text-muted mx-1">→</span> {domain.infrastructure.ptr}</>
                  ) : 'Missing'}
                </span>
              </div>
              <div className="grid grid-cols-[80px_1fr] gap-2 items-center">
                <span className="text-text-muted">SMTP:</span>
                <span className={domain.infrastructure.smtpStatus === 'Reachable' ? 'text-status-success' : 'text-status-error'}>
                  {domain.infrastructure.smtpStatus}
                </span>
              </div>
              <div className="grid grid-cols-[80px_1fr] gap-2 items-center">
                <span className="text-text-muted">TLS:</span>
                <span className={domain.infrastructure.tls === 'Supported' ? 'text-status-success' : 'text-text-main'}>
                  {domain.infrastructure.tls}
                </span>
              </div>
            </div>
          </div>
        </Card>
        
        {/* Health History */}
        <Card className="lg:col-span-3" title="Health History">
           <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-text-muted uppercase bg-panel border-b border-border">
                <tr>
                  <th className="px-6 py-3 font-medium">Date</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                  <th className="px-6 py-3 font-medium">Spam Rate</th>
                  <th className="px-6 py-3 font-medium">Blacklist</th>
                  <th className="px-6 py-3 font-medium">Score</th>
                </tr>
              </thead>
              <tbody>
                {domain.history.length > 0 ? (
                  domain.history.map((point: HistoryPoint, i) => (
                    <tr key={i} className="border-b border-border/50 last:border-0 hover:bg-background/50">
                      <td className="px-6 py-3 font-medium text-text-main">{format(new Date(point.date), 'MMM dd, yyyy')}</td>
                      <td className="px-6 py-3"><Badge status={point.status} /></td>
                      <td className="px-6 py-3 text-text-muted">{point.spamRate !== null ? `${point.spamRate.toFixed(2)}%` : 'No Data'}</td>
                      <td className="px-6 py-3"><Badge status={point.blacklist} /></td>
                      <td className="px-6 py-3 font-medium text-text-main">{point.score !== null ? point.score : '-'}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-text-muted text-sm">No historical records found.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Health — overall numeric score + per-check summary. Reads ONLY the results
            already stored on the domain (no recompute, no extra request). Final card. */}
        <Card className="lg:col-span-3" title="Health">
          <HealthSummary domain={domain} />
        </Card>

      </div>

      {/* Verify-later modal: the SAME PostmasterVerifyModal, opened on the verify step for
          this domain against its own linked account. On success the modal upserts the local
          record (Verified) via the existing sync, then we re-fetch so the button disappears
          and the "Postmaster verified" chip appears — no manual sync needed. Closing without
          verifying leaves the domain in place (still Unverified) to verify later. */}
      {verifyOpen && pmAccountId && (
        <PostmasterVerifyModal
          accountId={pmAccountId}
          initialDomain={domain.domain}
          initialStep="verify"
          onClose={() => setVerifyOpen(false)}
          onVerified={async () => {
            setVerifyOpen(false);
            await loadDomain();
          }}
        />
      )}
    </div>
  );
};

const DNSRecordGroup = ({ title, records }: { title: string, records?: { value: string, ttl?: number }[] }) => {
  if (!records || records.length === 0) {
    return (
      <div>
        <h4 className="text-sm font-semibold text-text-main mb-2">{title}</h4>
        <div className="bg-background border border-border rounded-md p-3 text-xs text-text-muted italic">
          No records found
        </div>
      </div>
    );
  }

  return (
    <div>
      <h4 className="text-sm font-semibold text-text-main mb-2">{title}</h4>
      <div className="bg-background border border-border rounded-md divide-y divide-border/50">
        {records.map((r, i) => (
          <div key={i} className="p-3 flex justify-between items-start gap-4">
            <span className="font-mono text-xs text-text-main break-all">{r.value}</span>
            {r.ttl && <span className="text-xs text-text-muted whitespace-nowrap">TTL: {r.ttl}</span>}
          </div>
        ))}
      </div>
    </div>
  );
};

const InfoRow = ({ label, value, valueClass }: { label: string, value: string, valueClass?: string }) => (
  <div className="flex justify-between items-center py-2 border-b border-border/50 last:border-0">
    <span className="text-sm text-text-muted">{label}</span>
    <span className={`text-sm text-text-main font-medium ${valueClass || ''}`}>{value}</span>
  </div>
);

// ── Health summary (final card) ──────────────────────────────────────────────
// A compact, honest roll-up of every subsystem. It reads ONLY the results already
// stored on the domain — it does not re-run any check or recompute the score.
type ChipTone = 'good' | 'bad' | 'warn' | 'neutral';
const HEALTH_CHIP_CLS: Record<ChipTone, string> = {
  good:    'bg-status-success/10 text-status-success',
  bad:     'bg-status-error/10 text-status-error',
  warn:    'bg-status-warning/10 text-status-warning',
  neutral: 'bg-border text-text-muted',
};
const healthChipTone = (state: string): ChipTone => {
  switch (state) {
    case 'Pass': case 'Reachable': case 'Supported': case 'Clean': case 'Available': case 'Compliant':
      return 'good';
    case 'Fail': case 'Error': case 'Listed': case 'Not Supported':
      return 'bad';
    case 'Missing': case 'Needs Work':
      return 'warn';
    default: // Unknown, No Data, Unavailable, Not Linked, Check Failed, Rate Limited, …
      return 'neutral';
  }
};
const StateChip = ({ state }: { state: string }) => (
  <span className={`text-xs font-medium px-2 py-0.5 rounded whitespace-nowrap ${HEALTH_CHIP_CLS[healthChipTone(state)]}`}>{state}</span>
);

const PM_STATUS_LABEL: Record<string, string> = {
  AVAILABLE: 'Available', NO_DATA: 'No Data', NOT_AUTHORIZED: 'Not Authorized',
  NOT_REGISTERED: 'Not Registered', API_ERROR: 'Unavailable', RATE_LIMIT: 'Rate Limited',
  NOT_LINKED: 'Not Linked',
};

const whenText = (s?: string | null): string => {
  if (!s) return '—';
  const d = new Date(s);
  return isNaN(d.getTime()) ? '—' : format(d, 'dd MMM, hh:mm a');
};

const HealthSummary = ({ domain }: { domain: DomainHealth }) => {
  const pm = domain.reputation.postmaster;
  const info = domain.domainInfo;

  // DNS-resolvable mirrors the scoring signal: A or MX present ⇒ Pass; any records
  // fetched but no A/MX ⇒ Fail; nothing fetched yet ⇒ Unknown.
  const dnsChecked = !!(domain.dns.a?.length || domain.dns.aaaa?.length || domain.dns.mx?.length ||
    domain.dns.ns?.length || domain.dns.txt?.length || domain.dns.cname?.length || domain.dns.soa);
  const dnsState = dnsChecked ? ((domain.dns.a?.length || domain.dns.mx?.length) ? 'Pass' : 'Fail') : 'Unknown';

  // Postmaster row prefers Google's compliance verdict, else its access status.
  const pmState = pm
    ? (pm.deliverability?.state === 'COMPLIANT' ? 'Compliant'
      : pm.deliverability?.state === 'NEEDS_WORK' ? 'Needs Work'
      : (PM_STATUS_LABEL[pm.status] || 'Not Linked'))
    : 'Not Linked';

  const infoState = info
    ? (info.state === 'AVAILABLE' ? 'Available'
      : info.state === 'UNAVAILABLE' ? 'Unavailable' : 'No Data')
    : 'Unknown';

  const rows: { label: string; state: string; when?: string | null }[] = [
    { label: 'DNS Resolution',             state: dnsState,                            when: domain.dns.lastChecked },
    { label: 'SPF',                        state: domain.authentication.spf.status,    when: domain.authentication.spf.lastChecked },
    { label: 'DKIM',                       state: domain.authentication.dkim.status,   when: domain.authentication.dkim.lastChecked },
    { label: 'DMARC',                      state: domain.authentication.dmarc.status,  when: domain.authentication.dmarc.lastChecked },
    { label: 'Mail Infrastructure (SMTP)', state: domain.infrastructure.smtpStatus,    when: domain.infrastructure.lastChecked },
    { label: 'TLS / SSL',                  state: domain.infrastructure.tls,           when: domain.infrastructure.lastChecked },
    { label: 'Blacklist / DNSBL',          state: blacklistDisplayStatus(domain.blacklist), when: domain.blacklist.lastChecked },
    { label: 'Google Postmaster',          state: pmState,                             when: pm?.lastChecked },
    { label: 'Domain Information',         state: infoState,                           when: info?.lastChecked },
  ];

  const score = domain.health.score;
  const scoreColor = score == null ? 'text-text-muted'
    : score >= 90 ? 'text-status-success'
    : score >= 70 ? 'text-status-warning'
    : 'text-status-error';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-8 pb-5 border-b border-border/50">
        <div>
          <div className="text-text-muted text-sm mb-1">Overall Score</div>
          <div className={`text-4xl font-bold ${scoreColor}`}>
            {score == null ? '—' : score}
            {score != null && <span className="text-lg text-text-muted font-medium"> / 100</span>}
          </div>
          <div className="text-[11px] text-text-muted mt-1">Compliance across available signals</div>
        </div>
        <div>
          <div className="text-text-muted text-sm mb-1">Overall Status</div>
          <Badge status={domain.health.status} className="text-sm px-3 py-1" />
          <div className="text-[11px] text-text-muted mt-1">Last checked: {whenText(domain.health.lastChecked)}</div>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm text-left">
          <thead className="text-xs text-text-muted uppercase bg-panel border-b border-border">
            <tr>
              <th className="px-4 py-3 font-medium">Check</th>
              <th className="px-4 py-3 font-medium">Result</th>
              <th className="px-4 py-3 font-medium text-right">Last Checked</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-b border-border/50 last:border-0 hover:bg-background/50">
                <td className="px-4 py-3 font-medium text-text-main">{r.label}</td>
                <td className="px-4 py-3"><StateChip state={r.state} /></td>
                <td className="px-4 py-3 text-xs text-text-muted text-right whitespace-nowrap">{whenText(r.when)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-text-muted leading-relaxed">
        Score = compliance across <em>available</em> signals only (SPF, DMARC, DNS, DKIM, SMTP, TLS,
        blacklist, Postmaster). A signal that is Unknown / No Data / Unavailable — e.g. a blocked SMTP
        port or an unsupported RDAP TLD — is excluded from the calculation and never counts as a failure.
        Registrar and domain age are informational and are not scored.
      </p>
    </div>
  );
};

// Turn a Google enum like DMARC_POLICY / SPAM_RATE_HIGH into "Dmarc policy" / "Spam rate high".
const formatEnum = (v: string): string => {
  if (!v) return '';
  const s = v.replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

const postmasterStatusExplanation = (status: string): string => {
  switch (status) {
    case 'NO_DATA':        return 'This domain is accessible in Postmaster Tools, but Google is not currently returning data (often due to low sending volume).';
    case 'NOT_AUTHORIZED': return 'The connected Google account is not authorized to view this domain in Postmaster Tools.';
    case 'NOT_REGISTERED': return 'This domain is not registered in the connected account\'s Postmaster Tools.';
    case 'API_ERROR':      return 'A temporary error occurred while contacting Google Postmaster Tools. It will be retried on the next check.';
    case 'RATE_LIMIT':     return 'Google is temporarily rate-limiting requests for this account. Data will refresh on the next check.';
    case 'NOT_LINKED':     return 'No Google Postmaster account is linked to this domain.';
    default:               return 'No Postmaster data available.';
  }
};

const PostmasterStatusBadge = ({ status }: { status: string }) => {
  const map: Record<string, { label: string; cls: string }> = {
    AVAILABLE:      { label: 'Available',      cls: 'bg-status-success/10 text-status-success' },
    NO_DATA:        { label: 'No Data',        cls: 'bg-border text-text-muted' },
    NOT_AUTHORIZED: { label: 'Not Authorized', cls: 'bg-status-warning/10 text-status-warning' },
    NOT_REGISTERED: { label: 'Not Registered', cls: 'bg-status-warning/10 text-status-warning' },
    API_ERROR:      { label: 'API Error',      cls: 'bg-status-error/10 text-status-error' },
    RATE_LIMIT:     { label: 'Rate Limited',   cls: 'bg-status-warning/10 text-status-warning' },
    NOT_LINKED:     { label: 'Not Linked',     cls: 'bg-border text-text-muted' },
  };
  const s = map[status] || map.NOT_LINKED;
  return <span className={`text-xs font-medium px-2 py-1 rounded ${s.cls}`}>{s.label}</span>;
};

// ── Google Postmaster v2 dashboard ───────────────────────────────────────────
// Renders the six Google-Postmaster data categories from the raw values stored on
// the domain. It never fabricates a verdict: compliance shows Google's exact status
// and a metric with no data shows "No Data", never 0%.

// Format a raw 0..1 rate as a percentage (Google returns these as fractions, the
// same convention the existing spam-rate display already assumes). null => no value.
const pctText = (v?: number | null, digits = 2): string | null =>
  v === null || v === undefined ? null : `${(v * 100).toFixed(digits)}%`;

const RATE_COLOR: Record<string, string> = {
  success: 'text-status-success',
  warning: 'text-status-warning',
  error: 'text-status-error',
  neutral: 'text-text-muted',
};

// Non-AVAILABLE metric states shown verbatim (never a number).
const METRIC_STATE_LABEL: Record<string, string> = {
  NO_DATA: 'No Data',
  NOT_AUTHORIZED: 'Not Authorized',
  NOT_REGISTERED: 'Not Available',
  API_ERROR: 'Unavailable',
  RATE_LIMIT: 'Rate Limited',
  NOT_LINKED: 'Not Linked',
};

// Overall compliance / deliverability verdict badge — mirrors Google exactly.
const ComplianceBadge = ({ status }: { status?: string }) => {
  const map: Record<string, { label: string; cls: string }> = {
    COMPLIANT:         { label: 'Compliant',  cls: 'bg-status-success/10 text-status-success border-status-success/20' },
    NEEDS_WORK:        { label: 'Needs Work', cls: 'bg-status-warning/10 text-status-warning border-status-warning/20' },
    STATE_UNSPECIFIED: { label: 'No Data',    cls: 'bg-status-neutral/10 text-status-neutral border-status-neutral/20' },
  };
  const s = map[status || ''] || map.STATE_UNSPECIFIED;
  return <span className={`text-xs font-medium px-2 py-0.5 rounded border ${s.cls}`}>{s.label}</span>;
};

// Per-requirement status text — COMPLIANT / NEEDS_WORK / (anything else = no data).
const CompliancePill = ({ status }: { status?: string }) => {
  const compliant = status === 'COMPLIANT';
  const needsWork = status === 'NEEDS_WORK';
  const cls = compliant ? 'text-status-success' : needsWork ? 'text-status-warning' : 'text-text-muted';
  const label = compliant ? '✓ Compliant' : needsWork ? 'Needs work' : 'No data';
  return <span className={`font-medium whitespace-nowrap ${cls}`}>{label}</span>;
};

const UnsubRow = ({ label, verdict }: { label: string; verdict: { status: string; reason?: string | null } }) => (
  <div className="flex items-center justify-between bg-background border border-border rounded px-2 py-1.5 text-xs gap-2">
    <span className="text-text-muted truncate" title={label}>{label}</span>
    <span className="flex items-center gap-1 whitespace-nowrap">
      <CompliancePill status={verdict.status} />
      {verdict.reason && verdict.reason !== 'REASON_UNSPECIFIED' && (
        <span className="text-text-muted">({formatEnum(verdict.reason)})</span>
      )}
    </span>
  </div>
);

// Distinct colours for the FBL series (one line per feedback-loop id).
const FBL_COLORS = ['#EC4899', '#14B8A6', '#6366F1', '#F43F5E', '#22C55E', '#EAB308', '#0EA5E9', '#A855F7'];

// Access/error states that mean the metric itself could not be retrieved → "Unavailable",
// as opposed to NO_DATA (Google simply returned no statistic for the period → "No Data").
const ACCESS_PROBLEM = new Set(['NOT_AUTHORIZED', 'NOT_REGISTERED', 'API_ERROR', 'RATE_LIMIT']);

// One daily series feeding a MetricChart. `metric` carries Google's raw {state,latest,history};
// a null / non-AVAILABLE series renders as a "No Data" pill and a gapped (never zero-filled) line.
type ChartSeries = { key: string; label: string; color: string; metric?: PostmasterMetric | null };

// Google Postmaster dates are UTC-anchored (backend stores/queries UTC). Format the calendar day
// in UTC so a browser in a negative-offset timezone never shifts a point to the previous day.
const fmtUTC = (value: string | number | Date, pattern: string): string => {
  const d = new Date(value);
  return format(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()), pattern);
};

// Colour a raw 0..1 rate the same way the old tiles did (reused RATE_COLOR buckets).
const rateColorKey = (v: number, higherBetter?: boolean): string =>
  higherBetter ? (v >= 0.95 ? 'success' : v >= 0.8 ? 'warning' : 'error')
               : (v <= 0.001 ? 'success' : v <= 0.01 ? 'warning' : 'error');

// Merge N daily series into unified rows keyed by the UTC calendar day, then keep the most
// recent `range` days. A day a series did not report stays undefined so the line shows a GAP
// (connectNulls={false}) — we never zero-fill or interpolate a value Google did not return.
const buildChartRows = (series: ChartSeries[], range: number): Record<string, number | string>[] => {
  const byDay: Record<string, Record<string, number | string>> = {};
  for (const s of series) {
    for (const p of s.metric?.history || []) {
      const day = new Date(p.date).toISOString().slice(0, 10); // UTC yyyy-mm-dd
      if (!byDay[day]) byDay[day] = { date: p.date };
      byDay[day][s.key] = p.value * 100; // Google fraction (0..1) → percent
    }
  }
  return Object.keys(byDay).sort().map(k => byDay[k]).slice(-range);
};

// A single category chart: one <Line> per real Google series, a % Y-axis, a UTC X-axis, a
// legend, and a per-series latest-value summary. Missing days are gaps; genuine retrieval
// failures show "Unavailable"; an empty-but-accessible metric shows "No Data" — never 0%.
const MetricChart = ({ title, containerState, series, range, higherBetter }: {
  title: string;
  containerState?: string;
  series: ChartSeries[];
  range: number;
  higherBetter?: boolean;
}) => {
  const { theme } = useAppContext();
  const axis = theme === 'dark' ? '#94A3B8' : '#64748B';
  const grid = theme === 'dark' ? '#2A344A' : '#E2E8F0';
  const tooltipBg = theme === 'dark' ? '#151C2C' : '#FFFFFF';

  const rows = buildChartRows(series, range);
  const accessProblem = containerState ? ACCESS_PROBLEM.has(containerState) : false;

  // Latest value per series: the raw % Google returned, or the exact no-data / access label.
  const summary = (s: ChartSeries): { text: string; cls: string } => {
    const m = s.metric;
    if (m && m.state === 'AVAILABLE' && m.latest != null) {
      return { text: pctText(m.latest, 3)!, cls: RATE_COLOR[rateColorKey(m.latest, higherBetter)] };
    }
    return { text: METRIC_STATE_LABEL[m?.state || containerState || 'NO_DATA'] || 'No Data', cls: RATE_COLOR.neutral };
  };

  return (
    <div className="bg-background border border-border rounded-md p-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 mb-3">
        <h6 className="text-xs font-semibold text-text-main">{title}</h6>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
          {series.map(s => {
            const sm = summary(s);
            return (
              <span key={s.key} className="flex items-center gap-1 whitespace-nowrap">
                <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
                <span className="text-text-muted">{s.label}</span>
                <span className={`font-semibold ${sm.cls}`}>{sm.text}</span>
              </span>
            );
          })}
        </div>
      </div>

      {accessProblem ? (
        <div className="h-[220px] flex items-center justify-center border border-dashed border-border rounded text-text-muted text-sm">
          {METRIC_STATE_LABEL[containerState!] || 'Unavailable'}
        </div>
      ) : rows.length > 0 ? (
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: -8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
            <XAxis dataKey="date" stroke={axis} fontSize={11} tickFormatter={(v) => fmtUTC(v, 'MMM dd')} tickLine={false} axisLine={false} minTickGap={24} />
            <YAxis stroke={axis} fontSize={11} unit="%" tickLine={false} axisLine={false} width={48} />
            <Tooltip
              contentStyle={{ backgroundColor: tooltipBg, borderColor: grid, color: 'var(--text-main)', borderRadius: '8px', fontSize: '12px' }}
              labelFormatter={(v) => `${fmtUTC(v, 'dd MMM yyyy')} (UTC)`}
              formatter={(value, name) => [`${Number(value).toFixed(3)}%`, name]}
            />
            <Legend wrapperStyle={{ fontSize: '11px' }} />
            {series.map(s => (
              <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <div className="h-[220px] flex items-center justify-center border border-dashed border-border rounded text-text-muted text-sm">
          No Data
        </div>
      )}
    </div>
  );
};

// Google-style companion table for the Spam Rate chart (mirrors Google's Postmaster
// "Spam rate" table: Date · User-reported spam rate · Under 0.3%). It reuses the EXACT
// same series + range transformation (buildChartRows) the chart itself uses, so the
// table always shows the same daily points — same values, same UTC dates, same order,
// same count — for the selected 7/30/60/90/120 range. No extra Google call, no second
// data source. The "Under 0.3%" column is derived locally from Google's own value and
// is never persisted. Missing days are simply absent (never invented as 0%).
const SpamRateTable = ({ metric, range }: { metric?: PostmasterMetric | null; range: number }) => {
  // Same rows the chart plots: one per UTC day Google reported, `spam` already as a
  // percentage (Google fraction × 100), sorted oldest → newest and sliced to `range`.
  const rows = buildChartRows(
    [{ key: 'spam', label: 'Spam rate', color: 'var(--color-primary)', metric }],
    range,
  );
  // Same three-state handling as the chart: a genuine retrieval failure → "Unavailable";
  // an accessible-but-empty metric → "No Data"; otherwise the real daily rows.
  const accessProblem = metric?.state ? ACCESS_PROBLEM.has(metric.state) : false;

  return (
    <div className="bg-background border border-border rounded-md p-4">
      <h6 className="text-xs font-semibold text-text-main mb-3">Spam Rate — Daily Breakdown (UTC)</h6>

      {accessProblem ? (
        <div className="py-8 text-center text-text-muted text-sm">
          {METRIC_STATE_LABEL[metric!.state] || 'Unavailable'}
        </div>
      ) : rows.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-text-muted uppercase bg-panel border-b border-border">
              <tr>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">User-reported spam rate</th>
                <th className="px-4 py-3 font-medium">Under 0.3%</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                // `spam` is Google's value already ×100 (percent). The 0.3% threshold is a
                // percentage comparison (0.3 = 0.3%), matching Google's own column.
                const pct = Number(row.spam);
                const under = pct < 0.3;
                return (
                  <tr key={i} className="border-b border-border/50 last:border-0 hover:bg-background/50">
                    <td className="px-4 py-3 font-medium text-text-main whitespace-nowrap">{fmtUTC(row.date, 'd MMM yyyy')}</td>
                    <td className="px-4 py-3 text-text-muted">{pct.toFixed(3)}%</td>
                    <td className="px-4 py-3">
                      <span className={`font-medium ${under ? 'text-status-success' : 'text-status-error'}`}>
                        {under ? 'Yes' : 'No'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="py-8 text-center text-text-muted text-sm">No Data</div>
      )}
    </div>
  );
};

// Google-style companion table for a multi-series MetricChart (Authentication, TLS
// Encryption, Delivery Errors, Feedback Loop). Reuses the EXACT same series + range
// transformation (buildChartRows) as its chart, so the table and chart always share the
// same daily rows — same values, UTC dates, order, and count — for the selected
// 7/30/60/90/120 range. Renders a Date column plus one column per real Google series;
// a day a given series did not report shows "No Data" (never 0%). "Unavailable" appears
// only on a genuine retrieval failure (mirrors the chart). No API call; nothing persisted.
const MetricTable = ({ title, containerState, series, range }: {
  title: string;
  containerState?: string;
  series: ChartSeries[];
  range: number;
}) => {
  const rows = buildChartRows(series, range);
  const accessProblem = containerState ? ACCESS_PROBLEM.has(containerState) : false;

  return (
    <div className="bg-background border border-border rounded-md p-4">
      <h6 className="text-xs font-semibold text-text-main mb-3">{title}</h6>

      {accessProblem ? (
        <div className="py-8 text-center text-text-muted text-sm">
          {METRIC_STATE_LABEL[containerState!] || 'Unavailable'}
        </div>
      ) : rows.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-text-muted uppercase bg-panel border-b border-border">
              <tr>
                <th className="px-4 py-3 font-medium whitespace-nowrap">Date</th>
                {series.map(s => (
                  <th key={s.key} className="px-4 py-3 font-medium whitespace-nowrap">{s.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-b border-border/50 last:border-0 hover:bg-background/50">
                  <td className="px-4 py-3 font-medium text-text-main whitespace-nowrap">{fmtUTC(row.date, 'd MMM yyyy')}</td>
                  {series.map(s => {
                    // buildChartRows sets each series key to a number (Google value × 100) only
                    // for days that series reported; an absent day stays undefined → "No Data".
                    const v = row[s.key];
                    return (
                      <td key={s.key} className="px-4 py-3 text-text-muted">
                        {typeof v === 'number' ? `${v.toFixed(3)}%` : 'No Data'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="py-8 text-center text-text-muted text-sm">No Data</div>
      )}
    </div>
  );
};

const PostmasterDashboard = ({ postmaster, range, onRangeChange }: {
  postmaster: PostmasterInfo;
  range: 7 | 30 | 60 | 90 | 120;
  onRangeChange: (r: 7 | 30 | 60 | 90 | 120) => void;
}) => {
  const pm = postmaster;
  const c = pm.compliance;
  const reqEntries = Object.entries(c?.requirements || {});
  const hasCompliance = reqEntries.length > 0 || !!pm.deliverability?.state;

  // Feedback-loop series (one per FBL id) built once and shared by the FBL chart and its
  // table, so both consume the identical transformed series (no divergence, no re-map).
  const fblSeries: ChartSeries[] = (pm.feedbackLoop?.series || []).map((s, i) => ({
    key: `fbl_${i}`,
    label: s.id || `FBL ${i + 1}`,
    color: FBL_COLORS[i % FBL_COLORS.length],
    metric: { state: 'AVAILABLE', latest: s.latest, history: s.history },
  }));

  return (
    <div className="mb-6 pb-6 border-b border-border/50 space-y-5">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-text-main">Google Postmaster Tools</h4>
        <PostmasterStatusBadge status={pm.status} />
      </div>

      {pm.status !== 'AVAILABLE' && (
        <p className="text-xs text-text-muted">{postmasterStatusExplanation(pm.status)}</p>
      )}

      {/* 1. Compliance Status — Google's exact verdicts, never a synthesized "Healthy". */}
      {hasCompliance && (
        <section>
          <div className="flex items-center justify-between mb-2">
            <h5 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Compliance Status</h5>
            {pm.deliverability?.state && <ComplianceBadge status={pm.deliverability.state} />}
          </div>
          {pm.deliverability?.reason && pm.deliverability.reason !== 'REASON_UNSPECIFIED' && (
            <div className="text-xs text-text-muted mb-2">Deliverability: {formatEnum(pm.deliverability.reason)}</div>
          )}
          {reqEntries.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {reqEntries.map(([req, val]) => (
                <div key={req} className="flex items-center justify-between bg-background border border-border rounded px-2 py-1.5 text-xs gap-2">
                  <span className="text-text-muted truncate" title={formatEnum(req)}>{formatEnum(req)}</span>
                  <CompliancePill status={val} />
                </div>
              ))}
            </div>
          )}
          {(c?.oneClickUnsubscribe || c?.honorUnsubscribe) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
              {c?.oneClickUnsubscribe && <UnsubRow label="One-Click Unsubscribe" verdict={c.oneClickUnsubscribe} />}
              {c?.honorUnsubscribe && <UnsubRow label="Honor Unsubscribe" verdict={c.honorUnsubscribe} />}
            </div>
          )}
        </section>
      )}

      {/* 2–6. Historical daily charts from Postmaster v2 domainStats:query — Spam,
          Authentication (SPF/DKIM/DMARC), TLS (inbound/outbound), Delivery Errors
          (all/rejected/temp-fail), Feedback Loop (per id). One shared range selector
          slices the cached 120-day series client-side — no Google call on tab-switch. */}
      <section>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h5 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Traffic Metrics — Daily (UTC)</h5>
          <div className="flex gap-1 bg-background border border-border rounded-md p-1">
            {[7, 30, 60, 90, 120].map(days => (
              <button
                key={days}
                onClick={() => onRangeChange(days as 7 | 30 | 60 | 90 | 120)}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${range === days ? 'bg-panel text-text-main shadow-sm' : 'text-text-muted hover:text-text-main'}`}
              >
                {days}d
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <MetricChart
            title="Spam Rate (user-reported)"
            containerState={pm.spam?.state}
            range={range}
            series={[{ key: 'spam', label: 'Spam rate', color: 'var(--color-primary)', metric: pm.spam }]}
          />
          {/* Google-style Spam Rate table — same SPAM_RATE data as the chart above,
              following the same selected range. Immediately below the chart, before
              the Authentication chart. */}
          <SpamRateTable metric={pm.spam} range={range} />
          <MetricChart
            title="Authentication Success — SPF / DKIM / DMARC"
            containerState={pm.authentication?.state}
            range={range}
            higherBetter
            series={[
              { key: 'spf',   label: 'SPF',   color: '#3B82F6', metric: pm.authentication?.spf },
              { key: 'dkim',  label: 'DKIM',  color: '#8B5CF6', metric: pm.authentication?.dkim },
              { key: 'dmarc', label: 'DMARC', color: '#10B981', metric: pm.authentication?.dmarc },
            ]}
          />
          {/* Google-style Authentication table — same AUTH_SUCCESS_RATE series as the
              chart above (columns in Google's DKIM / SPF / DMARC order), same range. */}
          <MetricTable
            title="Authentication — Daily Breakdown (UTC)"
            containerState={pm.authentication?.state}
            range={range}
            series={[
              { key: 'dkim',  label: 'DKIM success rate',  color: '#8B5CF6', metric: pm.authentication?.dkim },
              { key: 'spf',   label: 'SPF success rate',   color: '#3B82F6', metric: pm.authentication?.spf },
              { key: 'dmarc', label: 'DMARC success rate', color: '#10B981', metric: pm.authentication?.dmarc },
            ]}
          />
          <MetricChart
            title="TLS Encryption — Inbound / Outbound"
            containerState={pm.encryption?.state}
            range={range}
            higherBetter
            series={[
              { key: 'inbound',  label: 'Inbound',  color: '#0EA5E9', metric: pm.encryption?.inbound },
              { key: 'outbound', label: 'Outbound', color: '#F59E0B', metric: pm.encryption?.outbound },
            ]}
          />
          {/* Google-style Encryption/TLS table — same TLS_ENCRYPTION_RATE series
              (inbound / outbound) as the chart above, same range. */}
          <MetricTable
            title="TLS Encryption — Daily Breakdown (UTC)"
            containerState={pm.encryption?.state}
            range={range}
            series={[
              { key: 'inbound',  label: 'Inbound TLS rate',  color: '#0EA5E9', metric: pm.encryption?.inbound },
              { key: 'outbound', label: 'Outbound TLS rate', color: '#F59E0B', metric: pm.encryption?.outbound },
            ]}
          />
          <MetricChart
            title="Delivery Errors — All / Rejected / Temp-fail"
            containerState={pm.deliveryErrors?.state}
            range={range}
            series={[
              { key: 'total',    label: 'All errors', color: '#EF4444', metric: pm.deliveryErrors?.total },
              { key: 'reject',   label: 'Rejected',   color: '#F97316', metric: pm.deliveryErrors?.reject },
              { key: 'tempFail', label: 'Temp-fail',  color: '#EAB308', metric: pm.deliveryErrors?.tempFail },
            ]}
          />
          {/* Google-style Delivery Errors table — same DELIVERY_ERROR_RATE series as the
              chart above (All errors / Rejected / Temp-fail — the fields the API returns). */}
          <MetricTable
            title="Delivery Errors — Daily Breakdown (UTC)"
            containerState={pm.deliveryErrors?.state}
            range={range}
            series={[
              { key: 'total',    label: 'All errors', color: '#EF4444', metric: pm.deliveryErrors?.total },
              { key: 'reject',   label: 'Rejected',   color: '#F97316', metric: pm.deliveryErrors?.reject },
              { key: 'tempFail', label: 'Temp-fail',  color: '#EAB308', metric: pm.deliveryErrors?.tempFail },
            ]}
          />
          <MetricChart
            title="Feedback Loop Spam Rate (per FBL id)"
            containerState={pm.feedbackLoop?.state}
            range={range}
            series={fblSeries}
          />
          {/* Google-style Feedback Loop table — same shared fblSeries as the chart above.
              Empty (no FBL ids) → "No Data"; retrieval failure → "Unavailable" (no invented rows). */}
          <MetricTable
            title="Feedback Loop — Daily Breakdown (UTC)"
            containerState={pm.feedbackLoop?.state}
            range={range}
            series={fblSeries}
          />
        </div>

        <p className="text-[11px] text-text-muted leading-relaxed mt-3">
          Charts show exactly what Google Postmaster Tools returns for each UTC day. SPF / DKIM / DMARC,
          inbound / outbound TLS, and delivery-error types are queried as separate real series — never merged.
          A gap means Google reported no statistic for that day (often low sending volume) and is shown as
          “No Data”, not 0%. “Unavailable” appears only when a metric itself could not be retrieved.
        </p>
      </section>
    </div>
  );
};

const GlobeIcon = ({ size }: { size: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <line x1="2" y1="12" x2="22" y2="12" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
);

export default DomainDetail;
