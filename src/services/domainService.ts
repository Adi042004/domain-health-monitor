import { DomainHealth } from '../types/domain';
import { mockDomains } from './mockData';
import { desktopApiBase } from './desktop';

// In the desktop app the base URL is supplied at RUNTIME by the Electron shell, so a
// changed PORT in config.env needs no React rebuild — and the packaged app can never
// fall through to mock data. In a browser this is empty and the build-time env var is
// used exactly as before.
// @ts-ignore
const BASE_URL: string = desktopApiBase() || import.meta.env.VITE_API_BASE_URL || '';
const IS_MOCK = !BASE_URL;
// Postmaster/registry helpers historically fell back to the localhost API when the
// env var is unset (whereas the /domains methods below switch to mock data instead).
// Preserve that exact fallback so runtime behavior is unchanged in both env states.
const PM_BASE = BASE_URL || 'http://localhost:5000/api';

class DomainHealthService {
  private localDomains: DomainHealth[] = [...mockDomains];

  // ── GET all domains ──────────────────────────────────────────────────────
  async getDomains(searchQuery?: string): Promise<DomainHealth[]> {
    if (IS_MOCK) {
      return new Promise(resolve => setTimeout(() => {
        let results = this.localDomains;
        if (searchQuery) {
          const q = searchQuery.toLowerCase();
          results = results.filter(d =>
            d.domain.toLowerCase().includes(q) || d.ips.some(ip => ip.includes(q))
          );
        }
        resolve([...results]);
      }, 300));
    }

    // Real backend ─ GET /api/domains?search=...
    const url = new URL(`${BASE_URL}/domains`);
    if (searchQuery) url.searchParams.set('search', searchQuery);
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`GET /domains failed: ${res.status}`);
    return res.json();
  }

  // ── GET single domain ─────────────────────────────────────────────────────
  async getDomain(id: string): Promise<DomainHealth | undefined> {
    if (IS_MOCK) {
      return new Promise(resolve =>
        setTimeout(() => resolve(this.localDomains.find(d => d.id === id)), 200)
      );
    }

    // Real backend ─ GET /api/domains/:id
    const res = await fetch(`${BASE_URL}/domains/${id}`);
    if (res.status === 404) return undefined;
    if (!res.ok) throw new Error(`GET /domains/${id} failed: ${res.status}`);
    return res.json();
  }

  // ── ADD domain ────────────────────────────────────────────────────────────
  async addDomain(domain: Partial<DomainHealth>): Promise<DomainHealth> {
    if (IS_MOCK) {
      return new Promise(resolve => setTimeout(() => {
        const newDomain = {
          ...domain,
          id: Date.now().toString(),
          health: { status: 'Unknown', score: null, lastChecked: new Date().toISOString() },
          history: []
        } as DomainHealth;
        this.localDomains.push(newDomain);
        resolve(newDomain);
      }, 400));
    }
    
    // Real backend ─ POST /api/domains
    const res = await fetch(`${BASE_URL}/domains`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(domain)
    });
    
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `POST /domains failed: ${res.status}`);
    }
    return res.json();
  }

  // ── DELETE domain ─────────────────────────────────────────────────────────
  async deleteDomain(id: string): Promise<void> {
    if (IS_MOCK) {
      return new Promise(resolve => setTimeout(() => {
        this.localDomains = this.localDomains.filter(d => d.id !== id);
        resolve();
      }, 300));
    }

    // Real backend ─ DELETE /api/domains/:id (also removes the domain from Google
    // Postmaster when it is linked). Surface the backend's error message so a failed
    // Postmaster deletion is reported to the user and never silently swallowed.
    const res = await fetch(`${BASE_URL}/domains/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `DELETE /domains/${id} failed: ${res.status}`);
    }
  }

  // ── CSV import ────────────────────────────────────────────────────────────
  // POST /api/domains/import  (multipart/form-data, field: csv)
  async importCSV(file: File): Promise<{ inserted: number; duplicates: number; errors: { row: number; domain?: string; reason: string }[] }> {
    if (IS_MOCK) {
      return new Promise(resolve =>
        setTimeout(() => resolve({ inserted: 1, duplicates: 0, errors: [] }), 600)
      );
    }

    const form = new FormData();
    form.append('csv', file);
    const res = await fetch(`${BASE_URL}/domains/import`, { method: 'POST', body: form });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Import failed: ${res.status}`);
    }
    return res.json();
  }

  // ── Run health checks ─────────────────────────────────────────────────────
  // POST /api/domains/run-check  { domainIds?: string[] }
  async runCheck(domainIds?: string[]): Promise<{ checked: number; results: { domain: string; status: string; healthStatus?: string }[] }> {
    if (IS_MOCK) {
      return new Promise(resolve =>
        setTimeout(() => resolve({ checked: 0, results: [] }), 400)
      );
    }

    const res = await fetch(`${BASE_URL}/domains/run-check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domainIds })
    });
    if (!res.ok) throw new Error(`run-check failed: ${res.status}`);
    return res.json();
  }

  // ── Run the FULL health check for a SINGLE domain ──────────────────────────
  // POST /api/domains/:id/run-check  → returns the complete updated DomainHealth
  async runCheckForDomain(id: string): Promise<DomainHealth | undefined> {
    if (IS_MOCK) {
      return new Promise(resolve =>
        setTimeout(() => resolve(this.localDomains.find(d => d.id === id)), 500)
      );
    }

    const res = await fetch(`${BASE_URL}/domains/${id}/run-check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Health check failed: ${res.status}`);
    }
    return res.json();
  }

  // ── Google Postmaster Tools — single client for all /postmaster/* calls ─────
  // Centralizes the request/error logic that was previously duplicated inline in
  // Settings.tsx, PostmasterVerifyModal.tsx and usePostmasterAddDomain.tsx.
  // Semantics are preserved: the parsed body is returned on success; on failure an
  // Error is thrown carrying the backend's `error` message plus a `reauthRequired`
  // flag when present.
  async pmRequest(endpoint: string, options?: RequestInit): Promise<any> {
    const res = await fetch(`${PM_BASE}/postmaster${endpoint}`, options);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err: any = new Error(body.error || `Request failed (${res.status})`);
      err.reauthRequired = !!body.reauthRequired;
      throw err;
    }
    return body;
  }

  // OAuth kickoff URL (used as a full-page redirect target).
  postmasterOAuthStartUrl(): string {
    return `${PM_BASE}/postmaster/oauth/start`;
  }

  // POST /api/domains upsert used by the Postmaster add/verify + Settings sync flows.
  // Returns the raw Response with NO ok-check, matching each caller's existing
  // best-effort handling (they intentionally do not inspect res.ok here).
  postDomainUpsert(payload: any): Promise<Response> {
    return fetch(`${PM_BASE}/domains`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }
}

export const domainService = new DomainHealthService();
