const path = require('path');
// Config source, in order: the file the desktop shell points us at (packaged app,
// see electron/config.js), else this folder's own .env (development — same values as
// before, just resolved from __dirname so it no longer depends on the cwd).
// dotenv never overwrites variables that are already set, so the desktop shell's
// injected environment always wins.
require('dotenv').config({ path: process.env.DHM_CONFIG_PATH || path.join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const domainRoutes = require('./routes/domains');
const postmasterRoutes = require('./routes/postmaster');

const app = express();
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/domain_health';

app.use(cors());
app.use(express.json());

// Readiness probe. Reached only after Mongo connected (see below), so a 200 here
// means "backend fully usable" — the Electron shell waits for it before showing the UI.
app.get('/api/health', (req, res) => {
  res.json({ ok: mongoose.connection.readyState === 1, uptime: process.uptime() });
});

app.use('/api/domains', domainRoutes);
app.use('/api/postmaster', postmasterRoutes);

mongoose
  .connect(MONGO_URI)
  .then(() => {
    console.log('Connected to MongoDB:', MONGO_URI);
    // Resume the persistent DNSBL queue (max 120/hour) across restarts. Runs
    // independently of HTTP requests; safe no-op when the queue is empty.
    require('./lib/dnsblQueue').startWorker().catch(err =>
      console.error('[dnsbl-queue] failed to start:', err.message));
    const server = app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));

    // Refresh every connected Postmaster account's cached domain list once per launch,
    // reusing the existing service (no second sync implementation). Intentionally NOT
    // awaited: the port is already open above, so the desktop shell's readiness probe
    // answers immediately and the window opens while this runs in the background.
    // Never rejects — a Google/network failure only logs and the app continues.
    require('./lib/postmasterService')
      .syncAllConnectedAccounts()
      .then(({ accounts, synced, failed }) => {
        if (accounts > 0) {
          console.log(`[postmaster-sync] startup: accounts=${accounts} synced=${synced} failed=${failed}`);
        }
      })
      .catch(err => console.warn('[postmaster-sync] startup sync skipped:', err.message));

    // Release the port and the MongoDB connection when the desktop shell (or a
    // terminal Ctrl-C) asks us to stop, so nothing is left holding resources.
    const shutdown = () => {
      server.close(() => {
        mongoose.connection.close(false).finally(() => process.exit(0));
      });
      // Never hang: force exit if a socket refuses to drain.
      setTimeout(() => process.exit(0), 3000).unref();
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  })
  .catch(err => {
    console.error('MongoDB connection error:', err.message);
    process.exit(1);
  });
