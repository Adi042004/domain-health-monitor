import React, { useState, useEffect, useCallback } from 'react';
import { X, Copy, Check, RefreshCw, AlertCircle, CheckCircle2, ShieldCheck } from 'lucide-react';
import clsx from 'clsx';
import { domainService } from '../services/domainService';

// All Postmaster + registry calls go through the single API client (services/domainService).
const postmaster = (endpoint: string, options?: RequestInit) => domainService.pmRequest(endpoint, options);

// Same shape the rest of the app validates against.
const DOMAIN_RE = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

type Method = 'TXT' | 'CNAME';
type Step = 'input' | 'verify' | 'done';

interface Props {
  accountId: string;
  initialDomain?: string;
  initialStep?: Step;
  onClose: () => void;
  // Fired after the domain is successfully created in Postmaster (verified OR not).
  onAdded?: (domain: string) => void;
  onVerified?: (domain: string) => void;
}

const PostmasterVerifyModal: React.FC<Props> = ({ accountId, initialDomain, initialStep, onClose, onAdded, onVerified }) => {
  const [step, setStep] = useState<Step>(initialStep || 'input');
  const [domain, setDomain] = useState(initialDomain || '');
  const [method, setMethod] = useState<Method>('TXT');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [token, setToken] = useState<string | null>(null);
  const [tokenLoading, setTokenLoading] = useState(false);
  const [notVerifiedMsg, setNotVerifiedMsg] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

  const domainValid = DOMAIN_RE.test(domain.trim().toLowerCase());

  const encDomain = (d: string) => encodeURIComponent(d.trim().toLowerCase());

  const fetchToken = useCallback(async (d: string, m: Method) => {
    setTokenLoading(true);
    setToken(null);
    setError('');
    try {
      const res = await postmaster(`/accounts/${accountId}/domains/${encDomain(d)}/verification-token?method=${m}`);
      setToken(res.token || null);
    } catch (err: any) {
      setError(err.message || 'Could not load the verification token from Google.');
    } finally {
      setTokenLoading(false);
    }
  }, [accountId]);

  // When opened directly on the verify step for an existing domain, load its token.
  useEffect(() => {
    if (initialStep === 'verify' && initialDomain) {
      fetchToken(initialDomain, method);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync the domain into the local registry using the EXISTING mechanism — the same
  // POST /api/domains upsert the Settings "Sync to Registry" button already uses. It
  // upserts by domain, so it never creates a duplicate Domain record, and it carries
  // the REAL Postmaster verification metadata: an unverified domain is stored as
  // Unverified (never marked Verified) yet still appears in the Domains list. This runs
  // right after the domain exists in Postmaster, so it no longer needs a manual sync,
  // and it survives the user closing the modal without verifying. Best-effort: a failure
  // here never blocks the Postmaster flow (the domain already exists in Google).
  const syncToRegistry = async (dom: string, verificationState?: string | null, permission?: string | null) => {
    const d = dom.trim().toLowerCase();
    try {
      await domainService.postDomainUpsert({
        domain: d,
        provider: 'Google Postmaster',
        _source: 'POSTMASTER',
        postmasterAccountId: accountId,
        verificationState: verificationState ?? null,
        permission: permission ?? null,
      });
    } catch {
      /* registry sync is best-effort; it will reconcile on the next health check */
    }
  };

  const handleAdd = async () => {
    const d = domain.trim().toLowerCase();
    if (!DOMAIN_RE.test(d)) {
      setError('Enter a valid domain, e.g. example.com');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await postmaster(`/accounts/${accountId}/domains`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: d }),
      });
      const resolved = res.domain || d;
      setDomain(resolved);
      // Auto-sync into the local registry immediately (verified OR not) so the domain
      // appears in the Domains list without a manual "Sync to Registry" step, storing
      // the real verification state (never marked Verified when it isn't).
      await syncToRegistry(resolved, res.verificationState, res.permission);
      onAdded?.(resolved);
      if (res.verificationState === 'VERIFIED') {
        // Already verified in Google (idempotent add of an existing verified domain).
        setStep('done');
        onVerified?.(resolved);
      } else {
        setStep('verify');
        fetchToken(resolved, method);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to add the domain to Postmaster Tools.');
    } finally {
      setBusy(false);
    }
  };

  const handleChangeMethod = (m: Method) => {
    if (m === method) return;
    setMethod(m);
    setNotVerifiedMsg('');
    fetchToken(domain, m);
  };

  const handleVerify = async () => {
    setBusy(true);
    setError('');
    setNotVerifiedMsg('');
    try {
      const res = await postmaster(`/accounts/${accountId}/domains/${encDomain(domain)}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method }),
      });
      if (res.verified) {
        // Update the local registry record to the new verified state via the same
        // existing upsert, so Domain Details / Domains reflect "Verified" right away.
        await syncToRegistry(domain.trim().toLowerCase(), res.verificationState || 'VERIFIED', res.permission);
        setStep('done');
        onVerified?.(domain.trim().toLowerCase());
      } else {
        setNotVerifiedMsg(res.error || 'Google could not verify the DNS record yet. Make sure the record is added correctly and DNS has propagated, then try again.');
      }
    } catch (err: any) {
      setError(err.message || 'Verification failed.');
    } finally {
      setBusy(false);
    }
  };

  const copy = (value: string, key: string) => {
    navigator.clipboard?.writeText(value).then(() => {
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    }).catch(() => { /* clipboard blocked — value is still selectable on screen */ });
  };

  const CopyBtn = ({ value, k }: { value: string; k: string }) => (
    <button
      type="button"
      onClick={() => copy(value, k)}
      className="shrink-0 p-1.5 rounded hover:bg-border text-text-muted hover:text-text-main transition-colors"
      title="Copy"
    >
      {copied === k ? <Check size={14} className="text-status-success" /> : <Copy size={14} />}
    </button>
  );

  const DnsRow = ({ label, value, k, hint }: { label: string; value: string; k: string; hint?: string }) => (
    <div className="flex items-start justify-between gap-2 px-3 py-2">
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-wide text-text-muted">{label}</p>
        <p className="text-sm text-text-main font-mono break-all">{value}</p>
        {hint && <p className="text-[11px] text-text-muted mt-0.5">{hint}</p>}
      </div>
      <CopyBtn value={value} k={k} />
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg bg-background border border-border rounded-lg shadow-xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div className="bg-primary/10 p-1.5 rounded-md text-primary">
              <ShieldCheck size={18} />
            </div>
            <h2 className="text-base font-bold text-text-main">
              {step === 'done' ? 'Domain verified' : 'Verify ownership of domain'}
            </h2>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-main p-1 rounded hover:bg-panel transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {error && (
            <div className="p-3 bg-status-error/10 border border-status-error/20 rounded text-sm text-status-error flex items-start gap-2">
              <AlertCircle size={16} className="mt-0.5 shrink-0" /> <span>{error}</span>
            </div>
          )}

          {/* Step 1 — add the domain to Postmaster */}
          {step === 'input' && (
            <>
              <p className="text-sm text-text-muted">
                Add a domain to Google Postmaster Tools. You'll then add a DNS record and verify ownership.
              </p>
              <div>
                <label className="block text-sm font-medium text-text-muted mb-1.5">Domain</label>
                <input
                  autoFocus
                  type="text"
                  placeholder="example.com"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && domainValid && !busy) handleAdd(); }}
                  className="w-full bg-panel border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:border-primary text-text-main"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-text-muted hover:text-text-main transition-colors">
                  Cancel
                </button>
                <button
                  onClick={handleAdd}
                  disabled={!domainValid || busy}
                  className="bg-primary hover:bg-primary-hover text-white px-4 py-2 rounded-md font-medium text-sm flex items-center gap-2 transition-colors disabled:opacity-50"
                >
                  {busy && <RefreshCw size={14} className="animate-spin" />} Add & continue
                </button>
              </div>
            </>
          )}

          {/* Step 2 — show the DNS record + verify */}
          {step === 'verify' && (
            <>
              <p className="text-sm text-text-muted">
                Add the following DNS record for <span className="font-mono text-text-main">{domain}</span>, then click Verify.
                Google performs the verification — this app does not.
              </p>

              {/* Method selector */}
              <div className="flex gap-2">
                {(['TXT', 'CNAME'] as Method[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => handleChangeMethod(m)}
                    disabled={tokenLoading || busy}
                    className={clsx(
                      'px-3 py-1.5 rounded-md text-xs font-medium border transition-colors disabled:opacity-50',
                      method === m
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-text-muted hover:text-text-main'
                    )}
                  >
                    {m} record
                  </button>
                ))}
              </div>

              {/* DNS record card — only values Google actually returned */}
              <div className="border border-border rounded-md divide-y divide-border bg-panel">
                {tokenLoading ? (
                  <div className="py-6 text-center text-xs text-text-muted flex items-center justify-center gap-2">
                    <RefreshCw size={14} className="animate-spin" /> Getting verification token from Google...
                  </div>
                ) : token ? (
                  <>
                    <DnsRow label="Record type" value={method} k="type" />
                    {method === 'TXT' && (
                      <DnsRow label="Host / Name" value="@" k="host" hint="Your domain root (some registrars use the domain name instead of @)." />
                    )}
                    <DnsRow
                      label={method === 'TXT' ? 'Value' : 'Verification token'}
                      value={token}
                      k="token"
                      hint={method === 'CNAME' ? 'Google returns a single token for CNAME. TXT is recommended if your registrar needs a separate host and target.' : undefined}
                    />
                  </>
                ) : (
                  <div className="py-6 text-center text-xs text-text-muted">No token returned by Google.</div>
                )}
              </div>

              {notVerifiedMsg && (
                <div className="p-3 bg-status-warning/10 border border-status-warning/20 rounded text-sm text-status-warning flex items-start gap-2">
                  <AlertCircle size={16} className="mt-0.5 shrink-0" /> <span>{notVerifiedMsg}</span>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-text-muted hover:text-text-main transition-colors">
                  Not now
                </button>
                <button
                  onClick={handleVerify}
                  disabled={busy || tokenLoading || !token}
                  className="bg-primary hover:bg-primary-hover text-white px-4 py-2 rounded-md font-medium text-sm flex items-center gap-2 transition-colors disabled:opacity-50"
                >
                  {busy && <RefreshCw size={14} className="animate-spin" />} Verify
                </button>
              </div>
            </>
          )}

          {/* Step 3 — success */}
          {step === 'done' && (
            <>
              <div className="flex flex-col items-center text-center py-4 gap-3">
                <div className="bg-status-success/10 p-3 rounded-full text-status-success">
                  <CheckCircle2 size={32} />
                </div>
                <div>
                  <p className="text-sm font-medium text-text-main"><span className="font-mono">{domain}</span> is verified</p>
                  <p className="text-xs text-text-muted mt-1">
                    Google Postmaster Tools now reports this domain as verified for this account.
                    It has been added to your Domains list for health &amp; metrics monitoring.
                  </p>
                </div>
              </div>
              <div className="flex justify-end pt-2">
                <button
                  onClick={onClose}
                  className="bg-primary hover:bg-primary-hover text-white px-4 py-2 rounded-md font-medium text-sm transition-colors"
                >
                  Done
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default PostmasterVerifyModal;
