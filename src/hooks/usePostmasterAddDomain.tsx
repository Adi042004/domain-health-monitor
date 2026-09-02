import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PostmasterVerifyModal from '../components/PostmasterVerifyModal';
import { useAppContext } from '../context/AppContext';
import { domainService } from '../services/domainService';

interface Options {
  // Optional page-specific refresh (e.g. reload the Domains table) after a domain
  // is added/verified. triggerRefresh() is always called in addition to this.
  onDone?: (domain: string) => void;
}

/**
 * Shared launcher that wires any "Add Domain" button to the EXISTING Google
 * Postmaster add/verify flow (the same `PostmasterVerifyModal` used from Settings).
 *
 * It does NOT introduce a new modal, service, OAuth flow, or Google API call:
 *   - resolves the connected Postmaster account from the existing /postmaster/accounts endpoint
 *   - if none is connected, routes the user to the existing connection flow (Settings)
 *   - renders the existing PostmasterVerifyModal (domains.create -> token -> domains.verify)
 *
 * Auto-sync: the modal itself upserts the domain into the local registry via the
 * EXISTING POST /api/domains mechanism the moment it is created in Postmaster (verified
 * OR not) — so a newly added domain appears in the Domains list automatically, with the
 * correct Unverified/Verified state, and no duplicate Domain records. This hook only has
 * to refresh the UI once the modal reports the add/verify happened.
 *
 * Usage: const { launch, launching, modal } = usePostmasterAddDomain();
 *        <button onClick={launch} disabled={launching}>Add Domain</button>
 *        {modal}
 */
export function usePostmasterAddDomain(options?: Options) {
  const navigate = useNavigate();
  const { triggerRefresh } = useAppContext();
  const [accountId, setAccountId] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);

  const launch = async () => {
    setLaunching(true);
    try {
      const accounts = await domainService.pmRequest('/accounts');
      // Reuse the existing Postmaster account/authentication state — never start a
      // second OAuth flow here. Pick the first Connected account (Settings remains
      // the place to add domains against a specific account when several exist).
      const connected = Array.isArray(accounts)
        ? accounts.find((a: any) => a && a.status === 'Connected') || null
        : null;
      if (!connected) {
        // No connected Postmaster account -> existing connection flow, no Google call.
        navigate('/settings');
        return;
      }
      setAccountId(connected._id);
    } catch {
      // Backend unreachable / accounts couldn't be loaded: send the user to the
      // existing Postmaster connection UI rather than calling any Google API.
      navigate('/settings');
    } finally {
      setLaunching(false);
    }
  };

  // The modal has already synced the domain into the local registry (POST /api/domains);
  // here we simply refresh the app + the calling page so the new domain shows up.
  const refreshAfter = (domain: string) => {
    triggerRefresh();
    options?.onDone?.(domain);
  };

  const modal = accountId ? (
    <PostmasterVerifyModal
      accountId={accountId}
      initialStep="input"
      onClose={() => setAccountId(null)}
      onAdded={refreshAfter}
      onVerified={refreshAfter}
    />
  ) : null;

  return { launch, launching, modal };
}
