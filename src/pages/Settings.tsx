import React, { useState, useEffect, useRef } from 'react';
import { Card } from '../components/ui';
import { Mail, Plus, RefreshCw, AlertCircle, CheckCircle, ChevronDown, ChevronUp, Download } from 'lucide-react';
import clsx from 'clsx';
import { useAppContext } from '../context/AppContext';
import PostmasterVerifyModal from '../components/PostmasterVerifyModal';
import { domainService } from '../services/domainService';
import { isDesktop, openExternal } from '../services/desktop';

// Postmaster calls go through the single API client (services/domainService).
const fetchPostmaster = (endpoint: string, options?: RequestInit) => domainService.pmRequest(endpoint, options);

// Fingerprint of the connected-account list. The OAuth callback writes the account to
// MongoDB as its final step, so any change here means the round trip completed.
const accountsSignature = (list: any[]) =>
  (list || []).map(a => `${a._id}:${a.status}:${a.lastSyncAt ?? ''}`).sort().join('|');

const Settings = () => {
  const { triggerRefresh } = useAppContext();
  const [accounts, setAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Desktop only: a Google sign-in is running in the user's external browser and we
  // are waiting for the backend to finish storing the account.
  const [connecting, setConnecting] = useState(false);
  const baselineRef = useRef('');

  // Track expanded accounts to show domains
  const [expandedAccounts, setExpandedAccounts] = useState<Record<string, boolean>>({});
  const [accountDomains, setAccountDomains] = useState<Record<string, { loading: boolean, data?: any[], error?: string }>>({});

  const [importingDomains, setImportingDomains] = useState<Record<string, boolean>>({});

  // Add/verify-domain modal: which account, and (optionally) a specific domain to verify.
  const [verifyModal, setVerifyModal] = useState<{ accountId: string; domain?: string; step?: 'input' | 'verify' } | null>(null);

  useEffect(() => {
    loadAccounts();
    // Check if we just came back from OAuth
    if (window.location.search.includes('postmaster=success')) {
      // clean up url
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  // Detect a completed sign-in without inventing a second OAuth flow: the backend's
  // existing callback stores the account, and we watch the existing /accounts endpoint
  // until that shows up. Nothing is polled unless the user actually started a connect.
  useEffect(() => {
    if (!connecting) return;
    const deadline = Date.now() + 5 * 60 * 1000;
    let stopped = false;

    const check = async () => {
      if (stopped) return;
      try {
        const data = await fetchPostmaster('/accounts');
        if (accountsSignature(data) !== baselineRef.current) {
          stopped = true;
          setAccounts(data);
          setError('');
          setConnecting(false);
          triggerRefresh(); // let the rest of the app pick the new account up
          return;
        }
      } catch {
        /* backend momentarily unavailable — keep waiting */
      }
      if (Date.now() > deadline) {
        stopped = true;
        setConnecting(false);
      }
    };

    const timer = window.setInterval(check, 2500);
    // Returning to the app window is the strongest signal the user finished in Google.
    const onFocus = () => { void check(); };
    window.addEventListener('focus', onFocus);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [connecting]);

  const loadAccounts = async () => {
    try {
      setLoading(true);
      const data = await fetchPostmaster('/accounts');
      setAccounts(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleConnect = () => {
    const url = domainService.postmasterOAuthStartUrl();
    if (isDesktop()) {
      // Google blocks OAuth inside embedded application windows, so sign-in runs in
      // the user's normal browser. The backend callback is unchanged; we just watch
      // for its result instead of being redirected back.
      baselineRef.current = accountsSignature(accounts);
      setError('');
      setConnecting(true);
      openExternal(url);
      return;
    }
    window.location.href = url;
  };

  const handleDisconnect = async (id: string) => {
    if (!confirm('Are you sure you want to disconnect this account?')) return;
    try {
      await fetchPostmaster(`/accounts/${id}`, { method: 'DELETE' });
      setAccounts(accounts.filter(a => a._id !== id));
      
      const newExpanded = { ...expandedAccounts };
      delete newExpanded[id];
      setExpandedAccounts(newExpanded);
    } catch (err: any) {
      alert(`Failed to disconnect: ${err.message}`);
    }
  };

  const toggleAccount = async (id: string) => {
    const isExpanding = !expandedAccounts[id];
    setExpandedAccounts({ ...expandedAccounts, [id]: isExpanding });
    
    if (isExpanding && !accountDomains[id]?.data) {
      fetchDomainsForAccount(id);
    }
  };

  const fetchDomainsForAccount = async (id: string) => {
    setAccountDomains(prev => ({ ...prev, [id]: { loading: true } }));
    try {
      const domains = await fetchPostmaster(`/accounts/${id}/domains`);
      setAccountDomains(prev => ({ ...prev, [id]: { loading: false, data: domains } }));
    } catch (err: any) {
      setAccountDomains(prev => ({ ...prev, [id]: { loading: false, error: err.message } }));
    }
  };

  const handleImportDomains = async (accountId: string, domainsToImport: any[]) => {
    setImportingDomains(prev => ({ ...prev, [accountId]: true }));
    let imported = 0;

    try {
      for (const d of domainsToImport) {
        await domainService.postDomainUpsert({
          domain: d.domain,
          provider: 'Google Postmaster',
          _source: 'POSTMASTER',
          postmasterAccountId: accountId,
          // Preserve the Postmaster v2 domains.list verification metadata (Phase 12).
          verificationState: d.verificationState,
          permission: d.permission
        });
        imported++;
      }
      triggerRefresh();
      alert(`Successfully synced ${imported} domain(s) from Postmaster!`);
    } catch (err: any) {
      alert(`Sync failed after ${imported} imports: ${err.message}`);
    } finally {
      setImportingDomains(prev => ({ ...prev, [accountId]: false }));
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-main mb-1">Settings</h1>
        <p className="text-text-muted text-sm">Manage integrations and application preferences</p>
      </div>

      <Card>
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="bg-primary/10 p-2 rounded-lg text-primary">
              <Mail size={24} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-text-main">Google Postmaster Tools</h2>
              <p className="text-text-muted text-sm">Connect accounts to sync domains and view spam rates</p>
            </div>
          </div>
          <button 
            onClick={handleConnect}
            className="bg-primary hover:bg-primary-hover text-white px-4 py-2 rounded-md font-medium text-sm flex items-center gap-2 transition-colors"
          >
            <Plus size={16} /> Connect Account
          </button>
        </div>

        {connecting && (
          <div className="mb-4 p-3 bg-primary/10 border border-primary/20 rounded text-sm text-text-main flex items-center gap-3">
            <RefreshCw size={16} className="animate-spin text-primary shrink-0" />
            <span className="flex-1">
              Finish signing in to Google in your browser. This page updates by itself as soon as the account is connected.
            </span>
            <button
              onClick={() => setConnecting(false)}
              className="text-xs text-text-muted hover:underline shrink-0"
            >
              Stop waiting
            </button>
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 bg-status-error/10 border border-status-error/20 rounded text-sm text-status-error flex items-center gap-2">
            <AlertCircle size={16} /> {error}
          </div>
        )}

        {loading ? (
          <div className="py-8 text-center text-text-muted flex items-center justify-center gap-2 text-sm">
            <RefreshCw size={16} className="animate-spin" /> Loading accounts...
          </div>
        ) : accounts.length === 0 ? (
          <div className="py-8 text-center border border-dashed border-border rounded-lg bg-panel">
            <p className="text-text-muted text-sm">No Google accounts connected yet.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {accounts.map(account => {
              const isExpanded = expandedAccounts[account._id];
              const domainsState = accountDomains[account._id];
              
              return (
                <div key={account._id} className="border border-border rounded-lg overflow-hidden bg-background">
                  {/* Account Header */}
                  <div 
                    className="flex items-center justify-between p-4 cursor-pointer hover:bg-panel transition-colors"
                    onClick={() => toggleAccount(account._id)}
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-8 h-8 rounded-full bg-border flex items-center justify-center text-sm font-bold text-text-main uppercase">
                        {account.googleEmail.charAt(0)}
                      </div>
                      <div>
                        <p className="font-medium text-text-main">{account.googleEmail}</p>
                        <div className="flex items-center gap-2 text-xs mt-0.5">
                          <span className={clsx(
                            "flex items-center gap-1",
                            account.status === 'Connected' ? "text-status-success" : "text-status-error"
                          )}>
                            {account.status === 'Connected' ? <CheckCircle size={12}/> : <AlertCircle size={12}/>}
                            {account.status}
                          </span>
                          <span className="text-text-muted">•</span>
                          <span className="text-text-muted">
                            Added {new Date(account.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleDisconnect(account._id); }}
                        className="text-xs text-status-error hover:underline"
                      >
                        Disconnect
                      </button>
                      <button className="text-text-muted">
                        {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                      </button>
                    </div>
                  </div>

                  {/* Expanded Domains Section */}
                  {isExpanded && (
                    <div className="border-t border-border bg-panel p-4">
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-medium text-text-main">Postmaster Domains</h3>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setVerifyModal({ accountId: account._id, step: 'input' })}
                            className="flex items-center gap-1.5 text-xs border border-border hover:border-primary text-text-main px-3 py-1.5 rounded transition-colors"
                          >
                            <Plus size={12} /> Add Domain
                          </button>
                          {domainsState?.data && domainsState.data.length > 0 && (
                            <button
                              onClick={() => handleImportDomains(account._id, domainsState.data!)}
                              disabled={importingDomains[account._id]}
                              className="flex items-center gap-1.5 text-xs bg-primary hover:bg-primary-hover text-white px-3 py-1.5 rounded transition-colors disabled:opacity-50"
                            >
                              {importingDomains[account._id] ? (
                                <RefreshCw size={12} className="animate-spin" />
                              ) : (
                                <Download size={12} />
                              )}
                              Sync {domainsState.data.length} to Registry
                            </button>
                          )}
                        </div>
                      </div>

                      {domainsState?.loading ? (
                        <div className="py-6 text-center text-xs text-text-muted flex items-center justify-center gap-2">
                          <RefreshCw size={14} className="animate-spin" /> Fetching domains from Google...
                        </div>
                      ) : domainsState?.error ? (
                        <div className="p-3 bg-status-error/10 text-status-error text-xs rounded border border-status-error/20 flex items-center gap-2">
                          <AlertCircle size={14} /> {domainsState.error}
                          {/(401|reconnect|reauth)/i.test(domainsState.error) && (
                             <button onClick={() => handleConnect()} className="underline ml-2">Reconnect Account</button>
                          )}
                        </div>
                      ) : domainsState?.data?.length === 0 ? (
                        <div className="py-6 text-center text-xs text-text-muted">
                          This account has no domains configured in Google Postmaster Tools.
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                          {domainsState?.data?.map((d: any) => (
                            <div key={d.domain} className="bg-background border border-border rounded px-3 py-2 text-sm text-text-main flex items-center justify-between gap-2">
                              <span className="truncate">{d.domain}</span>
                              {d.verificationState === 'VERIFIED' ? (
                                <span title="Verified in Google Postmaster Tools." className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-status-success/10 text-status-success shrink-0">Verified</span>
                              ) : d.verificationState === 'UNVERIFIED' ? (
                                <button
                                  onClick={() => setVerifyModal({ accountId: account._id, domain: d.domain, step: 'verify' })}
                                  title="Registered but not verified — click to verify ownership."
                                  className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-status-warning/10 text-status-warning shrink-0 hover:bg-status-warning/20 transition-colors"
                                >
                                  Verify
                                </button>
                              ) : d.permission === 'NONE' ? (
                                <span title="No access to this domain." className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-status-error/10 text-status-error shrink-0">No Access</span>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {verifyModal && (
        <PostmasterVerifyModal
          accountId={verifyModal.accountId}
          initialDomain={verifyModal.domain}
          initialStep={verifyModal.step}
          onClose={() => setVerifyModal(null)}
          onAdded={() => {
            // Modal already upserted the domain into the local registry; refresh this
            // account's cached list so the newly added domain shows here too.
            fetchDomainsForAccount(verifyModal.accountId);
          }}
          onVerified={() => {
            // Refresh this account's cached domain list so the new state (Verified) shows.
            fetchDomainsForAccount(verifyModal.accountId);
          }}
        />
      )}
    </div>
  );
};

export default Settings;
