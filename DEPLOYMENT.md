# Domain Health Monitor — Desktop Deployment Guide

This application is a single Windows desktop program. It does **not** require Node.js,
npm, or Vite on the machine it runs on, and it never opens a terminal window.

---

## 1. Build the installer (developer machine, once)

Requires Node.js + npm on the *build* machine only.

```bash
npm install
```

```bash
npm run electron:build
```

That runs `tsc && vite build` and then `electron-builder --win`.

**Output:**

```
release\DomainHealthMonitor-Setup-1.0.0.exe
```

Also produced: `release\win-unpacked\Domain Health Monitor.exe` (a runnable, un-installed
copy — useful for a quick smoke test without installing).

---

## 2. Install on a target Windows machine

1. Copy `DomainHealthMonitor-Setup-1.0.0.exe` to the machine and run it.
   The installer is per-user (no administrator rights needed) and lets you choose the
   install folder. It creates a Desktop shortcut and a Start-Menu entry named
   **Domain Health Monitor**.
2. Launch it once. Because no configuration exists yet, it shows
   *"Configuration required"*, lists what is missing, and opens the folder where the
   config file belongs. This is expected on a fresh machine.
3. Create the configuration file described in section 3.
4. Launch the app again. It starts normally.

---

## 3. Configuration file (this is where all secrets live)

Create this file:

```
%APPDATA%\Domain Health Monitor\config.env
```

Paste that path directly into the Explorer address bar to reach the folder.
A documented template ships with the app at:

```
<install folder>\resources\config.example.env
```

Copy it to the path above, rename it to `config.env`, and fill in the real values.

### Required keys

| Key | Purpose |
|---|---|
| `MONGO_URI` | MongoDB connection string (local server or Atlas). |
| `GOOGLE_CLIENT_ID` | OAuth 2.0 Web-application client ID. |
| `GOOGLE_CLIENT_SECRET` | OAuth 2.0 client secret. |

### Keys with defaults (override only if you must)

| Key | Default |
|---|---|
| `PORT` | `5000` |
| `GOOGLE_REDIRECT_URI` | `http://localhost:5000/api/postmaster/oauth/callback` |

> **If you change `PORT`, you must change the port in `GOOGLE_REDIRECT_URI` to match,
> and add the new URI to the Google Cloud OAuth client.** The app detects a mismatch
> between the two at startup and warns you, because Google would otherwise send the
> sign-in callback to a port where nothing is listening.

### Optional performance tuning

`HEALTH_CHECK_CONCURRENCY` (20), `POSTMASTER_CONCURRENCY` (6),
`DNSBL_MAX_PER_HOUR` (120), `DNSBL_TICK_MS` (60000), `DNSBL_CONCURRENCY` (50).

### Do not set `FRONTEND_URL`

That variable exists only for browser-based development (`npm run dev`), where the
OAuth callback redirects back to the Vite server. In the desktop app it must stay
unset so the callback shows its own "sign-in complete, you can close this tab" page.

### Migrating from a development machine

The keys in an existing `server\.env` are exactly the keys used here. You can copy
that file to `%APPDATA%\Domain Health Monitor\config.env` and delete the
`FRONTEND_URL` line.

### Where the config is looked for

In priority order — the first file found wins:

1. `%APPDATA%\Domain Health Monitor\config.env`  ← the intended location
2. `<install folder>\resources\config.env`       ← for a locked-down shared image
3. `server\.env`                                 ← development source tree only

---

## 4. Google Cloud

For a **default installation, nothing needs to change in Google Cloud.** The desktop
app reuses the existing OAuth client, the existing scopes, and the existing redirect
URI. Verify that this exact string is listed under
*APIs & Services → Credentials → your OAuth 2.0 Client ID → Authorized redirect URIs*:

```
http://localhost:5000/api/postmaster/oauth/callback
```

Note it is `localhost`, **not** `127.0.0.1` — Google treats these as different URIs.

If the OAuth consent screen is in *Testing* mode, every Google account that will
connect must be listed under **Audience → Test users**.

---

## 5. Signing in to Google

Click **Settings → Connect Account**. Google sign-in opens in the machine's normal
default browser (Chrome/Edge), because Google blocks OAuth inside embedded
application windows. After you press *Allow*, the browser tab shows a confirmation
page, and the Domain Health Monitor window picks up the new account by itself —
no copying codes, no restart.

The browser is used **only** for that sign-in. The application's own interface always
runs in its own desktop window.

---

## 6. Prerequisites on the target machine

- Windows 10 or 11 (64-bit).
- Network access to your MongoDB server and to `googleapis.com`.
- Outbound DNS (UDP/TCP 53) for the SPF/DKIM/DMARC/MX and blacklist checks.
- MongoDB itself must be reachable — the installer does not install MongoDB.
- **Not** required: Node.js, npm, Vite, Chrome (except for the Google sign-in step).

---

## 7. Troubleshooting

The backend has no console window, so its output goes to a log file that is rewritten
on every launch:

```
%APPDATA%\Domain Health Monitor\logs\backend.log
```

| Symptom | Cause / fix |
|---|---|
| "Configuration required" | `config.env` missing or a required key is blank. |
| "Could not start — backend did not become ready" | `MONGO_URI` wrong or MongoDB unreachable; or `PORT` already in use. Check the log. |
| "OAuth redirect port mismatch" warning | `PORT` and the port in `GOOGLE_REDIRECT_URI` disagree. |
| `redirect_uri_mismatch` from Google | The URI in `config.env` is not listed on the Google Cloud OAuth client, character for character. |
| Sign-in never completes | Confirm the account is a Test user on the consent screen; check the log for the callback request. |
