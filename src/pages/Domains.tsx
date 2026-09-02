import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, Badge, BlacklistBadge } from '../components/ui';
import { domainService } from '../services/domainService';
import { DomainHealth } from '../types/domain';
import { Plus, Search, Filter, Trash2, X, Upload, Play, CheckCircle, AlertCircle } from 'lucide-react';
import { format, isToday, isWithinInterval, subDays } from 'date-fns';
import { useAppContext } from '../context/AppContext';
import { usePostmasterAddDomain } from '../hooks/usePostmasterAddDomain';
import clsx from 'clsx';

// ── Types ──────────────────────────────────────────────────────────────────
interface ImportResult {
  inserted: number;
  duplicates: number;
  errors: { row: number; domain?: string; reason: string }[];
}

// ── CSV Import Modal ──────────────────────────────────────────────────────
const ImportModal = ({ onClose, onImported }: { onClose: () => void; onImported: () => void }) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [errMsg, setErrMsg] = useState('');

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) setFile(f);
  };

  const handleImport = async () => {
    if (!file) return;
    setStatus('loading');
    try {
      const res = await domainService.importCSV(file);
      setResult(res);
      setStatus('done');
      if (res.inserted > 0) onImported();
    } catch (err: any) {
      setErrMsg(err.message);
      setStatus('error');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-panel border border-border rounded-xl w-full max-w-lg shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div>
            <h2 className="font-bold text-text-main text-lg">Import Domains from CSV</h2>
            <p className="text-xs text-text-muted mt-0.5">Expected columns: <code className="bg-background px-1 rounded font-mono">domain, email, ip</code></p>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-main p-1 transition-colors"><X size={20} /></button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {/* CSV format reminder */}
          <div className="bg-background border border-border rounded-md p-3">
            <p className="text-xs text-text-muted font-mono whitespace-pre">
{`domain,email,ip
example.com,admin@example.com,1.2.3.4
example2.com,,`}
            </p>
          </div>

          {/* File picker */}
          <div
            className={clsx(
              "border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors",
              file ? "border-primary/50 bg-primary/5" : "border-border hover:border-primary/40"
            )}
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="mx-auto mb-2 text-text-muted" size={28} />
            {file ? (
              <p className="text-sm font-medium text-text-main">{file.name}</p>
            ) : (
              <p className="text-sm text-text-muted">Click to select a CSV file</p>
            )}
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFile} />
          </div>

          {/* Result */}
          {status === 'done' && result && (
            <div className="rounded-lg border border-border divide-y divide-border text-sm overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2.5 bg-status-success/10 text-status-success font-medium">
                <CheckCircle size={16} /> {result.inserted} domain{result.inserted !== 1 ? 's' : ''} imported
              </div>
              {result.duplicates > 0 && (
                <div className="px-4 py-2.5 text-status-warning">
                  {result.duplicates} duplicate{result.duplicates !== 1 ? 's' : ''} skipped
                </div>
              )}
              {result.errors.length > 0 && (
                <div className="px-4 py-2.5 text-status-error max-h-40 overflow-y-auto">
                  <p className="font-medium mb-1">{result.errors.length} row error{result.errors.length !== 1 ? 's' : ''}:</p>
                  {result.errors.map((e, i) => (
                    <p key={i} className="text-xs font-mono">Row {e.row}{e.domain ? ` (${e.domain})` : ''}: {e.reason}</p>
                  ))}
                </div>
              )}
            </div>
          )}

          {status === 'error' && (
            <div className="flex items-center gap-2 px-4 py-3 bg-status-error/10 rounded-lg text-status-error text-sm">
              <AlertCircle size={16} /> {errMsg}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 p-5 border-t border-border">
          <button onClick={onClose} className="px-4 py-2 text-sm text-text-muted hover:text-text-main transition-colors">
            {status === 'done' ? 'Close' : 'Cancel'}
          </button>
          {status !== 'done' && (
            <button
              onClick={handleImport}
              disabled={!file || status === 'loading'}
              className="bg-primary hover:bg-primary-hover text-white px-4 py-2 rounded-md font-medium text-sm disabled:opacity-50 transition-colors flex items-center gap-2"
            >
              {status === 'loading' ? 'Importing...' : 'Import'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// ── Run Check Toast ───────────────────────────────────────────────────────
const RunCheckToast = ({ result, onClose }: { result: { checked: number; results: any[] }; onClose: () => void }) => (
  <div className="fixed bottom-6 right-6 z-50 bg-panel border border-border rounded-xl shadow-2xl p-4 max-w-sm">
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="font-semibold text-text-main text-sm flex items-center gap-2">
          <CheckCircle size={16} className="text-status-success" /> Health Check Complete
        </p>
        <p className="text-xs text-text-muted mt-1">{result.checked} domain{result.checked !== 1 ? 's' : ''} checked</p>
        {result.results.filter(r => r.status === 'error').length > 0 && (
          <p className="text-xs text-status-warning mt-1">
            {result.results.filter(r => r.status === 'error').length} check(s) had errors
          </p>
        )}
      </div>
      <button onClick={onClose} className="text-text-muted hover:text-text-main p-0.5"><X size={16} /></button>
    </div>
  </div>
);

// ── Postmaster verification badge ─────────────────────────────────────────
// Visual language consistent with the SPF/DKIM/DMARC badges. Tooltip via title.
const VERIFICATION_META: Record<string, { cls: string; tip: string }> = {
  'Verified':   { cls: 'bg-status-success/10 text-status-success border-status-success/20', tip: 'Domain is verified in Google Postmaster Tools.' },
  'Unverified': { cls: 'bg-status-warning/10 text-status-warning border-status-warning/20', tip: 'Domain is registered in Postmaster Tools but is not verified.' },
  'No Access':  { cls: 'bg-status-error/10 text-status-error border-status-error/20',        tip: 'The connected Google account does not have access to this domain.' },
  'Not Linked': { cls: 'bg-status-neutral/10 text-status-neutral border-status-neutral/20',  tip: 'Domain is not registered in the connected Postmaster account.' },
  'No Data':    { cls: 'bg-status-neutral/10 text-status-neutral border-status-neutral/20',  tip: 'Postmaster has no usable data for this domain.' },
  'Unknown':    { cls: 'bg-status-neutral/10 text-status-neutral border-status-neutral/20',  tip: 'Postmaster verification could not be determined.' },
};

const PostmasterVerificationBadge = ({ value }: { value: string }) => {
  const meta = VERIFICATION_META[value] || VERIFICATION_META['Unknown'];
  return (
    <span title={meta.tip} className={clsx('px-2 py-0.5 rounded text-xs font-medium border cursor-default', meta.cls)}>
      {value}
    </span>
  );
};

// Prefer the backend-derived verification; fall back for records last checked
// before verification was stored, so the column is always meaningful.
const verificationLabel = (d: DomainHealth): string => {
  const pm = d.reputation.postmaster;
  if (!pm) return 'Not Linked';
  if (pm.verification) return pm.verification;
  if (pm.linked === false) return 'Not Linked';
  if (pm.permission === 'NONE') return 'No Access';
  if (pm.verificationState === 'VERIFIED') return 'Verified';
  if (pm.verificationState === 'UNVERIFIED') return 'Unverified';
  switch (pm.status) {
    case 'NOT_AUTHORIZED': return 'No Access';
    case 'NOT_REGISTERED': return 'Not Linked';
    case 'NO_DATA':        return 'No Data';
    case 'NOT_LINKED':     return 'Not Linked';
    default:               return 'Unknown';
  }
};

// ── Postmaster health (compliance) badge ──────────────────────────────────
// The first column: the Google Postmaster health/compliance result, mapped to
// Good / Bad / No Data. Frontend-only mapping over the EXISTING compliance data
// already returned in reputation.postmaster.compliance — no new API call. This
// is independent of the verification column.
const HEALTH_META: Record<string, { cls: string; tip: string }> = {
  'Good':    { cls: 'bg-status-success/10 text-status-success border-status-success/20', tip: 'Google Postmaster reports no compliance issues.' },
  'Bad':     { cls: 'bg-status-error/10 text-status-error border-status-error/20',        tip: 'Google Postmaster detected compliance issues.' },
  'No Data': { cls: 'bg-status-neutral/10 text-status-neutral border-status-neutral/20',  tip: 'Google Postmaster does not have enough compliance data yet.' },
};

const PostmasterHealthBadge = ({ value }: { value: string }) => {
  const meta = HEALTH_META[value] || HEALTH_META['No Data'];
  return (
    <span title={meta.tip} className={clsx('px-2 py-0.5 rounded text-xs font-medium border cursor-default', meta.cls)}>
      {value}
    </span>
  );
};

// Roll the existing compliance signals up to the three labels, using the same
// COMPLIANT-vs-"needs work" interpretation already used on the Domain Detail page:
//   No issues      -> Good      (compliance present, everything COMPLIANT)
//   Issues detected-> Bad       (compliance present, something not COMPLIANT)
//   Not enough data-> No Data   (no compliance signal available)
const postmasterHealth = (d: DomainHealth): string => {
  const pm = d.reputation.postmaster;
  const requirements: Record<string, string> = (pm && pm.compliance && pm.compliance.requirements) || {};
  const reqValues = Object.values(requirements);
  const delivState = (pm && pm.deliverability && pm.deliverability.state) || null;

  // No compliance signal at all → Google Postmaster "Not enough data".
  if (reqValues.length === 0 && !delivState) return 'No Data';

  const hasIssue =
    reqValues.some(v => v !== 'COMPLIANT') ||
    (!!delivState && delivState !== 'COMPLIANT');

  return hasIssue ? 'Bad' : 'Good';
};

// ── Main Domains Page ─────────────────────────────────────────────────────
const Domains = () => {
  const [domains, setDomains] = useState<DomainHealth[]>([]);
  const [loading, setLoading] = useState(true);
  const [showImport, setShowImport] = useState(false);
  const [runCheckLoading, setRunCheckLoading] = useState(false);
  const [checkResult, setCheckResult] = useState<{ checked: number; results: any[] } | null>(null);
  // Filters, the filter-panel toggle and the "Run Selected" selection live in
  // AppContext so they SURVIVE navigation (opening Domain Details, going back,
  // visiting Settings) and internal health-check polling. They are cleared ONLY by
  // "Clear Filters" or the header "Refresh" — never by unmount / re-render / poll.
  const {
    searchQuery, setSearchQuery, triggerRefresh,
    domainFilters: filters, setDomainFilters: setFilters, clearDomainFilters,
    showDomainFilters: showFilters, setShowDomainFilters: setShowFilters,
    selectedDomainIds: selected, setSelectedDomainIds: setSelected,
  } = useAppContext();

  // "Add Domain" uses the existing Google Postmaster add/verify flow (same modal as
  // Settings). After a domain is verified & synced to the registry, reload the table.
  const { launch: launchAddDomain, launching: addDomainLaunching, modal: addDomainModal } =
    usePostmasterAddDomain({ onDone: () => loadDomains() });

  useEffect(() => { loadDomains(); }, [searchQuery]);

  const loadDomains = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await domainService.getDomains(searchQuery);
      setDomains(data);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  // DNSBL runs in a separate 120/hour lane, so its results arrive after the main
  // check returns. While any domain is still queued/processing, silently refresh so
  // the blacklist badge flips Processing → Clean/Listed/Unknown once the queue writes.
  const hasPendingDnsbl = domains.some(d => d.blacklist?.jobStatus && d.blacklist.jobStatus !== 'DONE');
  useEffect(() => {
    if (!hasPendingDnsbl) return;
    const t = setInterval(() => loadDomains(true), 15000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPendingDnsbl]);

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this domain? It will be removed from monitoring and, if linked, from its Google Postmaster account.')) return;
    try {
      await domainService.deleteDomain(id);
      loadDomains();
    } catch (err: any) {
      // Surface a failed Postmaster (or backend) deletion instead of pretending success.
      alert('Delete failed: ' + err.message);
    }
  };

  const handleRunCheck = async () => {
    setRunCheckLoading(true);
    try {
      // Send ONLY the selected IDs when a selection exists; otherwise run the full
      // set exactly as before (undefined → backend checks all domains).
      const ids = Array.from(selected);
      const result = await domainService.runCheck(ids.length ? ids : undefined);
      setCheckResult(result);
      loadDomains();
      triggerRefresh();
    } catch (err: any) {
      alert('Run check failed: ' + err.message);
    } finally {
      setRunCheckLoading(false);
    }
  };

  // "Clear Filters" resets the persisted filters (selection has its own clear control).
  const clearFilters = clearDomainFilters;

  const filtered = domains.filter(d => {
    if (filters.status !== 'All' && postmasterHealth(d) !== filters.status) return false;
    if (filters.blacklist !== 'All' && d.blacklist.status !== filters.blacklist) return false;
    if (filters.spf  !== 'All' && d.authentication.spf.status  !== filters.spf)  return false;
    if (filters.dkim !== 'All' && d.authentication.dkim.status !== filters.dkim) return false;
    if (filters.dmarc!== 'All' && d.authentication.dmarc.status!== filters.dmarc)return false;

    if (filters.spamRate !== 'All') {
      const rate = d.reputation.spamRate;
      if (filters.spamRate === 'No Data'  && rate !== null)              return false;
      if (filters.spamRate === 'Low'      && (rate === null || rate > 0.1))   return false;
      if (filters.spamRate === 'Medium'   && (rate === null || rate <= 0.1 || rate > 0.5)) return false;
      if (filters.spamRate === 'High'     && (rate === null || rate <= 0.5))  return false;
    }

    if (filters.lastChecked !== 'All') {
      const checkDate = new Date(d.health.lastChecked);
      const now = new Date();
      if (filters.lastChecked === 'Today'         && !isToday(checkDate)) return false;
      if (filters.lastChecked === 'Last 24 Hours' && !isWithinInterval(checkDate, { start: subDays(now, 1), end: now })) return false;
      if (filters.lastChecked === 'Last 7 Days'   && !isWithinInterval(checkDate, { start: subDays(now, 7), end: now })) return false;
    }
    return true;
  });

  // ── Selection derived from the CURRENTLY FILTERED rows ─────────────────────
  const filteredIds = filtered.map(d => d.id);
  const allFilteredSelected = filteredIds.length > 0 && filteredIds.every(id => selected.has(id));
  const someFilteredSelected = filteredIds.some(id => selected.has(id));

  const toggleOne = (id: string) =>
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const toggleAllFiltered = () =>
    setSelected(prev => {
      const next = new Set(prev);
      if (allFilteredSelected) filteredIds.forEach(id => next.delete(id));
      else filteredIds.forEach(id => next.add(id));
      return next;
    });

  const FilterSelect = ({ label, field, options }: { label: string; field: keyof typeof filters; options: string[] }) => (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-text-muted font-medium">{label}</label>
      <select
        value={filters[field]}
        onChange={e => setFilters({ ...filters, [field]: e.target.value })}
        className="bg-background border border-border rounded-md px-2 py-1 text-sm focus:outline-none focus:border-primary text-text-main"
      >
        <option value="All">All</option>
        {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
      </select>
    </div>
  );

  return (
    <div className="space-y-6">
      {checkResult && (
        <RunCheckToast result={checkResult} onClose={() => setCheckResult(null)} />
      )}

      {/* Page header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-main mb-1">Domains</h1>
          <p className="text-text-muted text-sm">Manage and monitor domain health status</p>
        </div>
        <div className="flex items-center gap-3">
          {selected.size > 0 && (
            <span className="text-xs text-text-muted flex items-center gap-1">
              {selected.size} selected
              <button
                onClick={() => setSelected(new Set())}
                title="Clear selection"
                className="hover:text-text-main"
              >
                <X size={14} />
              </button>
            </span>
          )}
          <button
            onClick={handleRunCheck}
            disabled={runCheckLoading}
            className="flex items-center gap-2 px-4 py-2 rounded-md border border-border text-sm font-medium text-text-muted hover:text-text-main hover:border-primary transition-colors disabled:opacity-50"
          >
            <Play size={15} />
            {runCheckLoading
              ? 'Running...'
              : selected.size > 0
                ? `Run Selected Health Checks (${selected.size})`
                : 'Run Health Check'}
          </button>
          <button
            type="button"
            onClick={launchAddDomain}
            disabled={addDomainLaunching}
            className="bg-primary hover:bg-primary-hover text-white px-4 py-2 rounded-md font-medium text-sm flex items-center gap-2 transition-colors disabled:opacity-50"
          >
            <Plus size={16} /> Add Domain
          </button>
        </div>
      </div>

      {/* Table card */}
      <Card className="!p-0 overflow-hidden">
        <div className="p-4 border-b border-border bg-panel/50 flex flex-col gap-4">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="relative flex-1 min-w-48 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={16} />
              <input
                type="text"
                placeholder="Search domain or IP..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full bg-background border border-border rounded-md pl-9 pr-3 py-1.5 text-sm focus:outline-none focus:border-primary text-text-main"
              />
            </div>

            <button
              onClick={() => setShowFilters(!showFilters)}
              className={clsx(
                'flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors border',
                showFilters ? 'bg-primary/10 text-primary border-primary/20' : 'bg-background text-text-muted border-border hover:text-text-main'
              )}
            >
              <Filter size={16} /> Filters
            </button>

            {Object.values(filters).some(v => v !== 'All') && (
              <button onClick={clearFilters} className="text-xs text-status-error hover:text-red-400 flex items-center gap-1 font-medium">
                <X size={14} /> Clear Filters
              </button>
            )}
          </div>

          {showFilters && (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4 pt-4 border-t border-border">
              <FilterSelect label="Health"       field="status"      options={['Good', 'Bad', 'No Data']} />
              <FilterSelect label="Spam Rate"    field="spamRate"    options={['Low', 'Medium', 'High', 'No Data']} />
              <FilterSelect label="Blacklist"    field="blacklist"   options={['Clean', 'Listed', 'Check Failed']} />
              <FilterSelect label="SPF"          field="spf"         options={['Pass', 'Fail', 'Missing']} />
              <FilterSelect label="DKIM"         field="dkim"        options={['Pass', 'No Data', 'Missing']} />
              <FilterSelect label="DMARC"        field="dmarc"       options={['Pass', 'Fail', 'Missing']} />
              <FilterSelect label="Last Checked" field="lastChecked" options={['Today', 'Last 24 Hours', 'Last 7 Days']} />
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-text-muted uppercase bg-background border-b border-border">
              <tr>
                <th className="px-4 py-3 font-medium w-10">
                  <input
                    type="checkbox"
                    aria-label="Select all filtered domains"
                    checked={allFilteredSelected}
                    ref={el => { if (el) el.indeterminate = !allFilteredSelected && someFilteredSelected; }}
                    onChange={toggleAllFiltered}
                    className="accent-primary cursor-pointer align-middle"
                  />
                </th>
                <th className="px-4 py-3 font-medium">Health</th>
                <th className="px-4 py-3 font-medium">Domain</th>
                <th className="px-4 py-3 font-medium">Postmaster</th>
                <th className="px-4 py-3 font-medium">Spam Rate</th>
                <th className="px-4 py-3 font-medium">SPF</th>
                <th className="px-4 py-3 font-medium">DKIM</th>
                <th className="px-4 py-3 font-medium">DMARC</th>
                <th className="px-4 py-3 font-medium">Blacklist</th>
                <th className="px-4 py-3 font-medium">Last Checked</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={11} className="px-6 py-8 text-center text-text-muted">Loading domains...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={11} className="px-6 py-8 text-center text-text-muted">No domains found matching filters.</td></tr>
              ) : (
                filtered.map(domain => (
                  <tr
                    key={domain.id}
                    className={clsx(
                      'border-b border-border/50 transition-colors',
                      selected.has(domain.id) ? 'bg-primary/5' : 'hover:bg-background/50'
                    )}
                  >
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        aria-label={`Select ${domain.domain}`}
                        checked={selected.has(domain.id)}
                        onChange={() => toggleOne(domain.id)}
                        className="accent-primary cursor-pointer align-middle"
                      />
                    </td>
                    <td className="px-4 py-3"><PostmasterHealthBadge value={postmasterHealth(domain)} /></td>
                    <td className="px-4 py-3 font-medium text-text-main">
                      <Link to={`/domains/${domain.id}`} className="hover:text-primary transition-colors">{domain.domain}</Link>
                    </td>
                    <td className="px-4 py-3"><PostmasterVerificationBadge value={verificationLabel(domain)} /></td>
                    <td className="px-4 py-3">
                      {domain.reputation.spamRate !== null
                        ? <span className={domain.reputation.spamRate > 0.1 ? 'text-status-warning font-medium' : ''}>{domain.reputation.spamRate.toFixed(2)}%</span>
                        : <span className="text-text-muted text-xs">No Data</span>}
                    </td>
                    <td className="px-4 py-3"><Badge status={domain.authentication.spf.status} /></td>
                    <td className="px-4 py-3"><Badge status={domain.authentication.dkim.status} /></td>
                    <td className="px-4 py-3"><Badge status={domain.authentication.dmarc.status} /></td>
                    <td className="px-4 py-3"><BlacklistBadge blacklist={domain.blacklist} /></td>
                    <td className="px-4 py-3 text-text-muted text-xs">
                      {format(new Date(domain.health.lastChecked), 'dd MMM yyyy, HH:mm')}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-3 items-center">
                        <Link to={`/domains/${domain.id}`} className="text-primary hover:text-primary-hover text-xs font-medium px-2 py-1 bg-primary/10 rounded">
                          View Details
                        </Link>
                        <button onClick={() => handleDelete(domain.id)} className="text-text-muted hover:text-status-error p-1">
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {addDomainModal}
    </div>
  );
};

export default Domains;
