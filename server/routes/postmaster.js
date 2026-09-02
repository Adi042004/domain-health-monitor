const express = require('express');
const router = express.Router();
const PostmasterAccount = require('../models/PostmasterAccount');
const {
  listPostmasterDomains,
  createPostmasterDomain,
  getDomainVerificationToken,
  verifyPostmasterDomain,
  ReauthRequiredError,
} = require('../lib/postmasterService');

// Same domain shape the rest of the app validates against (server/routes/domains.js).
const DOMAIN_RE = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

/**
 * Upsert one domain's metadata into the account's cached domains[] (same shape as
 * domains.list). Preserves existing fields when the new metadata omits them, so a
 * create (UNVERIFIED) followed by a verify (VERIFIED) never loses createTime etc.
 */
function upsertAccountDomain(account, meta) {
  const list = account.domains || [];
  const key = (meta.domain || '').toLowerCase();
  const idx = list.findIndex((d) => (d.domain || '').toLowerCase() === key);
  const prev = idx >= 0 ? list[idx] : {};
  const entry = {
    domain: meta.domain,
    permission: meta.permission != null ? meta.permission : (prev.permission || null),
    verificationState: meta.verificationState != null ? meta.verificationState : (prev.verificationState || null),
    createTime: meta.createTime != null ? meta.createTime : (prev.createTime || null),
    lastVerifyTime: meta.lastVerifyTime != null ? meta.lastVerifyTime : (prev.lastVerifyTime || null),
  };
  if (idx >= 0) list[idx] = entry; else list.push(entry);
  account.domains = list;
}

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5000/api/postmaster/oauth/callback';

// Desktop (Electron) mode is set by the desktop shell. It changes ONE thing: where
// the OAuth callback sends the user when it is done. In a browser-hosted setup the
// callback redirects back to FRONTEND_URL as before; in the desktop app there is no
// web frontend to return to (and no Vite dev server), so the browser tab shows a
// self-contained "done" page and the running application picks the new account up
// itself by re-reading /accounts. The OAuth flow above this line is unchanged.
const isDesktopMode = () => process.env.APP_MODE === 'electron';

/** Minimal self-contained page shown in the user's browser after OAuth completes. */
function oauthResultPage({ ok, heading, detail }) {
  const accent = ok ? '#16a34a' : '#dc2626';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Domain Health Monitor</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
       background:#0f1115;color:#e6e8eb;font:15px/1.55 "Segoe UI",system-ui,sans-serif}
  .card{max-width:460px;padding:36px 40px;background:#171a21;border:1px solid #262b35;
        border-radius:14px;text-align:center}
  h1{margin:0 0 10px;font-size:19px;color:${accent}}
  p{margin:0 0 8px;color:#9aa3ae}
  strong{color:#e6e8eb}
</style></head>
<body><div class="card">
  <h1>${esc(heading)}</h1>
  <p>${esc(detail)}</p>
  <p>You can close this tab and go back to <strong>Domain Health Monitor</strong>.</p>
</div></body></html>`;
}

// 1. Start OAuth Flow
router.get('/oauth/start', (req, res) => {
  if (!GOOGLE_CLIENT_ID) {
    return res.status(500).json({ error: 'Google OAuth not configured in backend .env' });
  }

  // Postmaster Tools API v2 scopes (must match the Google Cloud OAuth config).
  //   postmaster.domain           -> domains.list / domains.get
  //   postmaster.traffic.readonly -> getComplianceStatus / domainStats.query
  //   userinfo.email              -> identify the connected Google account
  const scopes = [
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/postmaster.domain',
    'https://www.googleapis.com/auth/postmaster.traffic.readonly'
  ];
  
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.append('client_id', GOOGLE_CLIENT_ID);
  authUrl.searchParams.append('redirect_uri', GOOGLE_REDIRECT_URI);
  authUrl.searchParams.append('response_type', 'code');
  authUrl.searchParams.append('scope', scopes.join(' '));
  authUrl.searchParams.append('access_type', 'offline');
  authUrl.searchParams.append('prompt', 'consent'); // Force consent to ensure we get a refresh token

  res.redirect(authUrl.toString());
});

// 2. OAuth Callback
router.get('/oauth/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send('No code provided by Google');

  try {
    // Exchange code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: GOOGLE_REDIRECT_URI,
        grant_type: 'authorization_code'
      })
    });

    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok) {
      throw new Error(`Token exchange failed: ${tokenData.error_description || tokenData.error}`);
    }

    const { access_token, refresh_token, expires_in } = tokenData;

    // Get user email
    const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${access_token}` }
    });
    const userData = await userResponse.json();
    if (!userResponse.ok) throw new Error('Failed to fetch user profile');

    // Save or update account
    const tokenExpiry = new Date(Date.now() + (expires_in * 1000));
    
    await PostmasterAccount.findOneAndUpdate(
      { googleEmail: userData.email },
      {
        accessToken: access_token,
        ...(refresh_token && { refreshToken: refresh_token }), // Only update refresh token if provided
        tokenExpiry,
        status: 'Connected',
        lastSyncAt: new Date()
      },
      { upsert: true, new: true }
    );

    // Desktop app: no web frontend to redirect to. Show the done page in the browser
    // tab; the running Electron app detects the new account by re-reading /accounts.
    if (isDesktopMode()) {
      return res
        .status(200)
        .type('html')
        .send(oauthResultPage({
          ok: true,
          heading: 'Google account connected',
          detail: `${userData.email} is now linked to Google Postmaster Tools.`,
        }));
    }

    // Redirect back to frontend settings page
    // Assuming frontend runs on localhost:5173
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    res.redirect(`${frontendUrl}/settings?postmaster=success`);
  } catch (err) {
    console.error('OAuth Callback Error:', err);
    if (isDesktopMode()) {
      return res
        .status(500)
        .type('html')
        .send(oauthResultPage({
          ok: false,
          heading: 'Could not connect the account',
          detail: err.message,
        }));
    }
    res.status(500).send(`OAuth Error: ${err.message}`);
  }
});

// 3. List Connected Accounts
router.get('/accounts', async (req, res) => {
  try {
    const accounts = await PostmasterAccount.find().select('-accessToken -refreshToken');
    res.json(accounts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Disconnect Account
router.delete('/accounts/:id', async (req, res) => {
  try {
    await PostmasterAccount.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Fetch Postmaster Domains for an Account (v2 domains.list) and cache them.
router.get('/accounts/:id/domains', async (req, res) => {
  try {
    const account = await PostmasterAccount.findById(req.params.id);
    if (!account) return res.status(404).json({ error: 'Account not found' });

    // Token refresh (if needed) + pagination are handled inside the service.
    const domains = await listPostmasterDomains(account);

    // Sync the discovered list + metadata into MongoDB (Phase 4).
    account.domains = domains;
    account.lastSyncAt = new Date();
    account.status = 'Connected';
    account.lastError = undefined;
    await account.save();

    res.json(domains);
  } catch (err) {
    if (err instanceof ReauthRequiredError) {
      // Do not delete the account — just tell the UI a reconnect is required.
      return res.status(401).json({ error: err.message, reauthRequired: true });
    }
    const status = err.httpStatus || 500;
    if (status === 403) {
      return res.status(403).json({ error: 'This Google account is not authorized for the Postmaster Tools API.' });
    }
    res.status(status).json({ error: err.message || 'Failed to fetch domains from Google' });
  }
});

// 6. Add a NEW domain to Google Postmaster Tools for this account (domains.create).
//    Body: { domain }. Persists it (UNVERIFIED) into the account's cached list.
//    Uses the existing postmaster.domain scope — NO new OAuth scope required.
router.post('/accounts/:id/domains', async (req, res) => {
  try {
    const account = await PostmasterAccount.findById(req.params.id);
    if (!account) return res.status(404).json({ error: 'Account not found' });

    const domain = String(req.body?.domain || '').trim().toLowerCase();
    if (!domain || !DOMAIN_RE.test(domain)) {
      return res.status(400).json({ error: 'A valid domain is required (e.g. example.com).' });
    }

    const result = await createPostmasterDomain(account, domain);
    upsertAccountDomain(account, result);
    account.lastSyncAt = new Date();
    account.status = 'Connected';
    account.lastError = undefined;
    await account.save();

    // Only domain + verification metadata leave the backend — never tokens.
    res.json({
      domain: result.domain,
      verificationState: result.verificationState || 'UNVERIFIED',
      permission: result.permission || null,
      alreadyExisted: !!result.alreadyExisted,
    });
  } catch (err) {
    if (err instanceof ReauthRequiredError) {
      return res.status(401).json({ error: err.message, reauthRequired: true });
    }
    const status = err.httpStatus || 500;
    if (status === 403) {
      return res.status(403).json({ error: 'This Google account does not have permission to add domains in Postmaster Tools.' });
    }
    res.status(status).json({ error: err.message || 'Failed to add domain to Postmaster Tools.' });
  }
});

// 7. Get the DNS verification token for a domain (domains.getVerificationToken).
//    Query: ?method=TXT|CNAME. Returns ONLY Google's { verificationMethod, token }.
//    The token is a public DNS value, NOT an OAuth token.
router.get('/accounts/:id/domains/:domain/verification-token', async (req, res) => {
  try {
    const account = await PostmasterAccount.findById(req.params.id);
    if (!account) return res.status(404).json({ error: 'Account not found' });

    const method = String(req.query.method || 'TXT').toUpperCase() === 'CNAME' ? 'CNAME' : 'TXT';
    const token = await getDomainVerificationToken(account, req.params.domain, method);
    res.json(token); // { verificationMethod, token }
  } catch (err) {
    if (err instanceof ReauthRequiredError) {
      return res.status(401).json({ error: err.message, reauthRequired: true });
    }
    const status = err.httpStatus || 500;
    if (status === 403) {
      return res.status(403).json({ error: 'This Google account does not have permission to manage this domain.' });
    }
    res.status(status).json({ error: err.message || 'Failed to get the verification token from Google.' });
  }
});

// 8. Verify domain ownership at the DNS level (domains.verify).
//    Body: { method: TXT|CNAME }. On success caches the VERIFIED metadata. Google
//    remains the source of truth — we never perform DNS verification ourselves.
router.post('/accounts/:id/domains/:domain/verify', async (req, res) => {
  try {
    const account = await PostmasterAccount.findById(req.params.id);
    if (!account) return res.status(404).json({ error: 'Account not found' });

    const method = String(req.body?.method || 'TXT').toUpperCase() === 'CNAME' ? 'CNAME' : 'TXT';
    const domain = String(req.params.domain || '').toLowerCase();
    const result = await verifyPostmasterDomain(account, domain, method);

    if (result.verified) {
      upsertAccountDomain(account, {
        domain,
        verificationState: result.verificationState || 'VERIFIED',
        permission: result.permission,
        lastVerifyTime: result.lastVerifyTime,
      });
      account.lastSyncAt = new Date();
      await account.save();
      return res.json({
        verified: true,
        domain,
        verificationState: result.verificationState || 'VERIFIED',
        permission: result.permission || null,
      });
    }

    // Not verified yet. 403 => the account lacks permission; anything else is treated
    // as "DNS record not found / not propagated yet" — the domain stays UNVERIFIED.
    if (result.httpStatus === 403) {
      return res.status(403).json({
        verified: false,
        error: 'This Google account does not have permission to verify this domain.',
      });
    }
    return res.status(200).json({
      verified: false,
      verificationState: 'UNVERIFIED',
      error: 'Google could not verify the DNS record yet. Make sure the record is added correctly and DNS has propagated, then try again.',
      googleMessage: result.message,
    });
  } catch (err) {
    if (err instanceof ReauthRequiredError) {
      return res.status(401).json({ error: err.message, reauthRequired: true });
    }
    const status = err.httpStatus || 500;
    res.status(status).json({ error: err.message || 'Verification failed.' });
  }
});

module.exports = router;
