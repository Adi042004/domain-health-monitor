import os
import json

base_dir = r"C:\Users\makar\.gemini\antigravity\scratch\domain-health-monitor"

files = {
    "package.json": json.dumps({
        "name": "domain-health-monitor",
        "private": True,
        "version": "0.0.0",
        "type": "module",
        "scripts": {
            "dev": "vite",
            "build": "tsc && vite build",
            "preview": "vite preview"
        },
        "dependencies": {
            "react": "^18.2.0",
            "react-dom": "^18.2.0",
            "react-router-dom": "^6.22.0",
            "lucide-react": "^0.323.0",
            "recharts": "^2.11.0",
            "clsx": "^2.1.0",
            "tailwind-merge": "^2.2.1",
            "date-fns": "^3.3.1"
        },
        "devDependencies": {
            "@types/react": "^18.2.43",
            "@types/react-dom": "^18.2.17",
            "@vitejs/plugin-react": "^4.2.1",
            "autoprefixer": "^10.4.17",
            "postcss": "^8.4.35",
            "tailwindcss": "^3.4.1",
            "typescript": "^5.2.2",
            "vite": "^5.0.8"
        }
    }, indent=2),
    "vite.config.ts": """import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
""",
    "tsconfig.json": """{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}""",
    "tsconfig.node.json": """{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true,
    "strict": true
  },
  "include": ["vite.config.ts"]
}""",
    "tailwind.config.js": """/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: '#0B1120',
        panel: '#151C2C',
        primary: '#3B82F6',
        'primary-hover': '#2563EB',
        border: '#2A344A',
        text: {
          main: '#F8FAFC',
          muted: '#94A3B8'
        },
        status: {
          success: '#10B981',
          warning: '#F59E0B',
          error: '#EF4444',
          neutral: '#64748B'
        }
      }
    },
  },
  plugins: [],
}
""",
    "postcss.config.js": """export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
""",
    "index.html": """<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Domain Health Monitor</title>
  </head>
  <body class="bg-background text-text-main font-sans antialiased min-h-screen">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
""",
    "src/index.css": """@tailwind base;
@tailwind components;
@tailwind utilities;

body {
  background-color: #0B1120;
  color: #F8FAFC;
}

/* Custom scrollbar for dark theme */
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
::-webkit-scrollbar-track {
  background: #0B1120; 
}
::-webkit-scrollbar-thumb {
  background: #2A344A; 
  border-radius: 4px;
}
::-webkit-scrollbar-thumb:hover {
  background: #3B82F6; 
}
""",
    "src/main.tsx": """import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
""",
    "src/App.tsx": """import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/layout/Layout'
import Dashboard from './pages/Dashboard'
import Domains from './pages/Domains'
import DomainDetail from './pages/DomainDetail'
import AddDomain from './pages/AddDomain'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="dashboard" element={<Navigate to="/" replace />} />
          <Route path="domains" element={<Domains />} />
          <Route path="domains/:domainId" element={<DomainDetail />} />
          <Route path="add-domain" element={<AddDomain />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
""",
    "src/types/domain.ts": """
export type Status = 'Healthy' | 'Warning' | 'Critical' | 'Unknown';
export type RecordStatus = 'Pass' | 'Fail' | 'Missing' | 'Unknown';
export type BlacklistStatus = 'Clean' | 'Listed' | 'Check Failed' | 'Unknown';

export interface DNSRecords {
  a?: string[];
  aaaa?: string[];
  mx?: string[];
  ns?: string[];
  txt?: string[];
  cname?: string;
  soa?: string;
  lastChecked: string;
}

export interface Authentication {
  spf: { status: RecordStatus; record?: string; lastChecked: string };
  dkim: { status: RecordStatus; selector?: string; lastChecked: string };
  dmarc: { status: RecordStatus; policy?: string; lastChecked: string };
}

export interface Infrastructure {
  ptr?: string;
  smtpStatus: 'OK' | 'Error' | 'Unknown';
  tls: boolean;
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
}

export interface HistoryPoint {
  date: string;
  status: Status;
  spamRate: number | null;
  blacklist: BlacklistStatus;
  score: number | null;
}

export interface Reputation {
  spamRate: number | null; // e.g. 0.08 for 0.08%
  spamRateHistory: { date: string; rate: number }[];
  postmasterDataAvailable: boolean;
  lastChecked: string;
}

export interface DomainHealth {
  id: string;
  domain: string;
  email?: string;
  ips: string[];
  provider: string;
  createdDate: string;
  expiryDate: string;

  dns: DNSRecords;
  authentication: Authentication;
  infrastructure: Infrastructure;
  blacklist: Blacklist;
  reputation: Reputation;

  health: {
    status: Status;
    score: number | null;
    lastChecked: string;
  };

  history: HistoryPoint[];
}
""",
    "src/services/mockData.ts": """import { DomainHealth } from '../types/domain';

export const mockDomains: DomainHealth[] = [
  {
    id: '1',
    domain: 'example.com',
    email: 'admin@example.com',
    ips: ['192.168.1.1'],
    provider: 'Cloudflare',
    createdDate: '2020-01-15T00:00:00Z',
    expiryDate: '2027-01-15T00:00:00Z',
    dns: {
      a: ['192.168.1.1'],
      mx: ['mail.example.com'],
      ns: ['ns1.cloudflare.com', 'ns2.cloudflare.com'],
      txt: ['v=spf1 include:_spf.example.com ~all'],
      lastChecked: '2026-08-24T10:35:00Z'
    },
    authentication: {
      spf: { status: 'Pass', record: 'v=spf1 include:_spf.example.com ~all', lastChecked: '2026-08-24T10:35:00Z' },
      dkim: { status: 'Pass', selector: 'default', lastChecked: '2026-08-24T10:35:00Z' },
      dmarc: { status: 'Pass', policy: 'p=reject', lastChecked: '2026-08-24T10:35:00Z' }
    },
    infrastructure: {
      ptr: 'example.com',
      smtpStatus: 'OK',
      tls: true,
      mailServerHostname: 'mail.example.com',
      lastChecked: '2026-08-24T10:35:00Z'
    },
    blacklist: {
      status: 'Clean',
      countChecked: 85,
      countListed: 0,
      lastChecked: '2026-08-24T08:00:00Z',
      lists: [
        { listName: 'Spamhaus', status: 'Clean', lastChecked: '2026-08-24T08:00:00Z' },
        { listName: 'Barracuda', status: 'Clean', lastChecked: '2026-08-24T08:00:00Z' },
        { listName: 'SpamCop', status: 'Clean', lastChecked: '2026-08-24T08:00:00Z' }
      ]
    },
    reputation: {
      spamRate: 0.08,
      spamRateHistory: Array.from({length: 30}, (_, i) => ({
        date: new Date(Date.now() - (29 - i) * 86400000).toISOString(),
        rate: 0.05 + Math.random() * 0.05
      })),
      postmasterDataAvailable: true,
      lastChecked: '2026-08-24T10:35:00Z'
    },
    health: {
      status: 'Healthy',
      score: 98,
      lastChecked: '2026-08-24T10:35:00Z'
    },
    history: Array.from({length: 10}, (_, i) => ({
      date: new Date(Date.now() - i * 86400000).toISOString(),
      status: 'Healthy',
      spamRate: 0.08,
      blacklist: 'Clean',
      score: 98
    }))
  },
  {
    id: '2',
    domain: 'suspicious-sender.net',
    email: 'contact@suspicious-sender.net',
    ips: ['10.0.0.5', '10.0.0.6'],
    provider: 'GoDaddy',
    createdDate: '2025-11-20T00:00:00Z',
    expiryDate: '2026-11-20T00:00:00Z',
    dns: {
      a: ['10.0.0.5', '10.0.0.6'],
      mx: ['mail.suspicious-sender.net'],
      lastChecked: '2026-08-24T09:15:00Z'
    },
    authentication: {
      spf: { status: 'Fail', record: 'v=spf1 ?all', lastChecked: '2026-08-24T09:15:00Z' },
      dkim: { status: 'Missing', lastChecked: '2026-08-24T09:15:00Z' },
      dmarc: { status: 'Missing', lastChecked: '2026-08-24T09:15:00Z' }
    },
    infrastructure: {
      smtpStatus: 'Error',
      tls: false,
      lastChecked: '2026-08-24T09:15:00Z'
    },
    blacklist: {
      status: 'Listed',
      countChecked: 85,
      countListed: 2,
      lastChecked: '2026-08-24T08:00:00Z',
      lists: [
        { listName: 'Spamhaus', status: 'Listed', listedIp: '10.0.0.5', dateDetected: '2026-08-23T14:00:00Z', reason: 'High volume spam', lastChecked: '2026-08-24T08:00:00Z' },
        { listName: 'Barracuda', status: 'Clean', lastChecked: '2026-08-24T08:00:00Z' },
        { listName: 'SpamCop', status: 'Listed', listedIp: '10.0.0.5', dateDetected: '2026-08-22T09:00:00Z', reason: 'User reports', lastChecked: '2026-08-24T08:00:00Z' }
      ]
    },
    reputation: {
      spamRate: 1.25,
      spamRateHistory: Array.from({length: 30}, (_, i) => ({
        date: new Date(Date.now() - (29 - i) * 86400000).toISOString(),
        rate: 0.5 + Math.random() * 1.0
      })),
      postmasterDataAvailable: false,
      lastChecked: '2026-08-24T09:15:00Z'
    },
    health: {
      status: 'Critical',
      score: 35,
      lastChecked: '2026-08-24T09:15:00Z'
    },
    history: Array.from({length: 5}, (_, i) => ({
      date: new Date(Date.now() - i * 86400000).toISOString(),
      status: 'Critical',
      spamRate: 1.25,
      blacklist: 'Listed',
      score: 35
    }))
  },
  {
    id: '3',
    domain: 'warning-domain.org',
    email: 'hello@warning-domain.org',
    ips: ['172.16.0.100'],
    provider: 'Namecheap',
    createdDate: '2018-05-10T00:00:00Z',
    expiryDate: '2026-09-01T00:00:00Z', // expiring soon
    dns: {
      a: ['172.16.0.100'],
      mx: ['mx.warning-domain.org'],
      lastChecked: '2026-08-24T11:00:00Z'
    },
    authentication: {
      spf: { status: 'Pass', record: 'v=spf1 a mx ~all', lastChecked: '2026-08-24T11:00:00Z' },
      dkim: { status: 'Pass', selector: 'k1', lastChecked: '2026-08-24T11:00:00Z' },
      dmarc: { status: 'Fail', policy: 'p=none', lastChecked: '2026-08-24T11:00:00Z' }
    },
    infrastructure: {
      ptr: 'warning-domain.org',
      smtpStatus: 'OK',
      tls: true,
      lastChecked: '2026-08-24T11:00:00Z'
    },
    blacklist: {
      status: 'Clean',
      countChecked: 85,
      countListed: 0,
      lastChecked: '2026-08-24T08:00:00Z',
      lists: [
        { listName: 'Spamhaus', status: 'Clean', lastChecked: '2026-08-24T08:00:00Z' }
      ]
    },
    reputation: {
      spamRate: 0.18,
      spamRateHistory: Array.from({length: 30}, (_, i) => ({
        date: new Date(Date.now() - (29 - i) * 86400000).toISOString(),
        rate: 0.1 + Math.random() * 0.1
      })),
      postmasterDataAvailable: true,
      lastChecked: '2026-08-24T11:00:00Z'
    },
    health: {
      status: 'Warning',
      score: 75,
      lastChecked: '2026-08-24T11:00:00Z'
    },
    history: []
  },
  {
    id: '4',
    domain: 'new-startup.io',
    ips: ['10.1.2.3'],
    provider: 'AWS',
    createdDate: '2026-08-01T00:00:00Z',
    expiryDate: '2027-08-01T00:00:00Z',
    dns: { lastChecked: '2026-08-24T10:00:00Z' },
    authentication: {
      spf: { status: 'Unknown', lastChecked: '2026-08-24T10:00:00Z' },
      dkim: { status: 'Unknown', lastChecked: '2026-08-24T10:00:00Z' },
      dmarc: { status: 'Unknown', lastChecked: '2026-08-24T10:00:00Z' }
    },
    infrastructure: { smtpStatus: 'Unknown', tls: false, lastChecked: '2026-08-24T10:00:00Z' },
    blacklist: { status: 'Unknown', countChecked: 0, countListed: 0, lastChecked: '2026-08-24T10:00:00Z', lists: [] },
    reputation: { spamRate: null, spamRateHistory: [], postmasterDataAvailable: false, lastChecked: '2026-08-24T10:00:00Z' },
    health: { status: 'Unknown', score: null, lastChecked: '2026-08-24T10:00:00Z' },
    history: []
  }
];

class MockDomainService {
  private domains: DomainHealth[] = [...mockDomains];

  async getDomains(): Promise<DomainHealth[]> {
    return new Promise(resolve => setTimeout(() => resolve(this.domains), 400));
  }

  async getDomain(id: string): Promise<DomainHealth | undefined> {
    return new Promise(resolve => setTimeout(() => resolve(this.domains.find(d => d.id === id)), 300));
  }

  async addDomain(domain: Partial<DomainHealth>): Promise<DomainHealth> {
    return new Promise(resolve => {
      setTimeout(() => {
        const newDomain = {
          ...domain,
          id: Date.now().toString(),
          health: { status: 'Unknown', score: null, lastChecked: new Date().toISOString() },
          history: []
        } as DomainHealth;
        this.domains.push(newDomain);
        resolve(newDomain);
      }, 500);
    });
  }

  async deleteDomain(id: string): Promise<void> {
    return new Promise(resolve => {
      setTimeout(() => {
        this.domains = this.domains.filter(d => d.id !== id);
        resolve();
      }, 400);
    });
  }
}

export const domainService = new MockDomainService();
""",
    "src/components/layout/Sidebar.tsx": """import React from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Globe, Settings, LogOut, ShieldCheck } from 'lucide-react';
import clsx from 'clsx';

const Sidebar = () => {
  const navItems = [
    { to: '/', icon: <LayoutDashboard size={20} />, label: 'Dashboard' },
    { to: '/domains', icon: <Globe size={20} />, label: 'Domains' },
  ];

  return (
    <aside className="w-64 bg-panel border-r border-border flex flex-col h-screen fixed left-0 top-0">
      <div className="p-6 flex items-center gap-3">
        <div className="w-8 h-8 rounded bg-primary flex items-center justify-center text-white">
          <ShieldCheck size={20} />
        </div>
        <div>
          <h1 className="font-bold text-lg leading-tight text-white">Domain Health</h1>
          <p className="text-xs text-text-muted">Infrastructure Monitor</p>
        </div>
      </div>

      <nav className="flex-1 px-4 py-4 space-y-1">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-3 px-3 py-2 rounded-md transition-colors font-medium text-sm',
                isActive
                  ? 'bg-primary text-white'
                  : 'text-text-muted hover:bg-border hover:text-text-main'
              )
            }
          >
            {item.icon}
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="p-4 border-t border-border">
        <button className="flex items-center gap-3 px-3 py-2 rounded-md transition-colors font-medium text-sm text-text-muted hover:bg-border hover:text-text-main w-full text-left">
          <LogOut size={20} />
          Sign Out
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
""",
    "src/components/layout/Header.tsx": """import React from 'react';
import { Search, Bell, HelpCircle, Settings, Moon } from 'lucide-react';

const Header = () => {
  return (
    <header className="h-16 border-b border-border bg-background flex items-center justify-between px-6 sticky top-0 z-10">
      <div className="flex-1 max-w-xl">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={18} />
          <input
            type="text"
            placeholder="Search domains, IPs..."
            className="w-full bg-panel border border-border rounded-full pl-10 pr-4 py-1.5 text-sm focus:outline-none focus:border-primary text-text-main placeholder-text-muted transition-colors"
          />
        </div>
      </div>
      
      <div className="flex items-center gap-4 text-text-muted">
        <button className="hover:text-text-main transition-colors p-1 bg-panel rounded-full border border-border flex items-center gap-2 px-3 text-sm">
           Refresh
        </button>
        <button className="hover:text-text-main transition-colors">
          <HelpCircle size={18} />
        </button>
        <button className="hover:text-text-main transition-colors">
          <Settings size={18} />
        </button>
        <button className="hover:text-text-main transition-colors bg-panel p-1.5 rounded-full border border-border">
          <Moon size={16} />
        </button>
      </div>
    </header>
  );
};

export default Header;
""",
    "src/components/layout/Layout.tsx": """import React from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';

const Layout = () => {
  return (
    <div className="min-h-screen bg-background flex">
      <Sidebar />
      <div className="flex-1 ml-64 flex flex-col min-h-screen">
        <Header />
        <main className="flex-1 p-6 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default Layout;
""",
    "src/components/ui/Card.tsx": """import React from 'react';
import clsx from 'clsx';

export const Card = ({ children, className, title }: { children: React.ReactNode; className?: string; title?: React.ReactNode }) => (
  <div className={clsx("bg-panel border border-border rounded-xl p-5", className)}>
    {title && <h3 className="font-semibold text-white mb-4">{title}</h3>}
    {children}
  </div>
);
""",
    "src/components/ui/Badge.tsx": """import React from 'react';
import clsx from 'clsx';
import { Status, RecordStatus, BlacklistStatus } from '../../types/domain';

export const Badge = ({ status, className }: { status: Status | RecordStatus | BlacklistStatus; className?: string }) => {
  const getStyles = () => {
    switch (status) {
      case 'Healthy':
      case 'Pass':
      case 'Clean':
        return 'bg-status-success/10 text-status-success border-status-success/20';
      case 'Warning':
        return 'bg-status-warning/10 text-status-warning border-status-warning/20';
      case 'Critical':
      case 'Fail':
      case 'Listed':
        return 'bg-status-error/10 text-status-error border-status-error/20';
      case 'Unknown':
      case 'Missing':
      case 'Check Failed':
      default:
        return 'bg-status-neutral/10 text-status-neutral border-status-neutral/20';
    }
  };

  return (
    <span className={clsx("px-2 py-0.5 rounded text-xs font-medium border", getStyles(), className)}>
      {status}
    </span>
  );
};
""",
    "src/pages/Dashboard.tsx": """import React, { useEffect, useState } from 'react';
import { Card } from '../components/ui/Card';
import { domainService } from '../services/mockData';
import { DomainHealth } from '../types/domain';
import { ShieldCheck, AlertTriangle, ShieldAlert, Globe, Server, Activity } from 'lucide-react';

const Dashboard = () => {
  const [domains, setDomains] = useState<DomainHealth[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    domainService.getDomains().then(data => {
      setDomains(data);
      setLoading(false);
    });
  }, []);

  if (loading) return <div className="text-text-muted">Loading dashboard...</div>;

  const total = domains.length;
  const healthy = domains.filter(d => d.health.status === 'Healthy').length;
  const warning = domains.filter(d => d.health.status === 'Warning').length;
  const critical = domains.filter(d => d.health.status === 'Critical').length;
  const blacklisted = domains.filter(d => d.blacklist.status === 'Listed').length;
  
  const avgSpamRate = domains.reduce((acc, d) => acc + (d.reputation.spamRate || 0), 0) / (domains.filter(d => d.reputation.spamRate !== null).length || 1);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white mb-1">Overview</h1>
        <p className="text-text-muted text-sm">Analyze and monitor your domain infrastructure health</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatCard title="Total Domains" value={total} icon={<Globe className="text-primary" />} />
        <StatCard title="Healthy" value={healthy} icon={<ShieldCheck className="text-status-success" />} />
        <StatCard title="Warning" value={warning} icon={<AlertTriangle className="text-status-warning" />} />
        <StatCard title="Critical" value={critical} icon={<ShieldAlert className="text-status-error" />} />
        <StatCard title="Blacklisted" value={blacklisted} icon={<Server className="text-status-error" />} />
        <StatCard title="Avg Spam Rate" value={`${avgSpamRate.toFixed(2)}%`} icon={<Activity className="text-primary" />} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
        <Card title="Health Status Distribution" className="min-h-[300px] flex items-center justify-center">
            <div className="text-text-muted">Chart Placeholder: Distribution Bar</div>
        </Card>
        <Card title="Average Spam Rate History" className="min-h-[300px] flex items-center justify-center">
            <div className="text-text-muted">Chart Placeholder: Frequency Line</div>
        </Card>
      </div>
    </div>
  );
};

const StatCard = ({ title, value, icon }: { title: string, value: string | number, icon: React.ReactNode }) => (
  <Card className="flex flex-col gap-2">
    <div className="flex items-center justify-between">
      <span className="text-sm font-medium text-text-muted">{title}</span>
      {icon}
    </div>
    <span className="text-3xl font-bold text-white">{value}</span>
  </Card>
);

export default Dashboard;
""",
    "src/pages/Domains.tsx": """import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { domainService } from '../services/mockData';
import { DomainHealth } from '../types/domain';
import { Plus, Search, Filter, Trash2 } from 'lucide-react';
import { format } from 'date-fns';

const Domains = () => {
  const [domains, setDomains] = useState<DomainHealth[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');

  useEffect(() => {
    loadDomains();
  }, []);

  const loadDomains = async () => {
    setLoading(true);
    const data = await domainService.getDomains();
    setDomains(data);
    setLoading(false);
  };

  const handleDelete = async (id: string) => {
    if (confirm("Are you sure you want to remove this domain from monitoring?")) {
      await domainService.deleteDomain(id);
      loadDomains();
    }
  };

  const filtered = domains.filter(d => {
    if (statusFilter !== 'All' && d.health.status !== statusFilter) return false;
    if (search && !d.domain.toLowerCase().includes(search.toLowerCase()) && !d.ips.some(ip => ip.includes(search))) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white mb-1">Domains</h1>
          <p className="text-text-muted text-sm">Manage and monitor domain health status</p>
        </div>
        <Link to="/add-domain" className="bg-primary hover:bg-primary-hover text-white px-4 py-2 rounded-md font-medium text-sm flex items-center gap-2 transition-colors">
          <Plus size={16} />
          Add Domain
        </Link>
      </div>

      <Card className="!p-0 overflow-hidden">
        <div className="p-4 border-b border-border flex items-center gap-4 bg-panel/50">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={16} />
            <input
              type="text"
              placeholder="Search domains or IP..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-background border border-border rounded-md pl-9 pr-3 py-1.5 text-sm focus:outline-none focus:border-primary text-text-main"
            />
          </div>
          
          <div className="flex items-center gap-2">
            <Filter size={16} className="text-text-muted" />
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="bg-background border border-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:border-primary text-text-main"
            >
              <option value="All">All Status</option>
              <option value="Healthy">Healthy</option>
              <option value="Warning">Warning</option>
              <option value="Critical">Critical</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-text-muted uppercase bg-background border-b border-border">
              <tr>
                <th className="px-6 py-3 font-medium">Status</th>
                <th className="px-6 py-3 font-medium">Domain</th>
                <th className="px-6 py-3 font-medium">IP</th>
                <th className="px-6 py-3 font-medium">Spam Rate</th>
                <th className="px-6 py-3 font-medium">SPF</th>
                <th className="px-6 py-3 font-medium">DKIM</th>
                <th className="px-6 py-3 font-medium">DMARC</th>
                <th className="px-6 py-3 font-medium">Blacklist</th>
                <th className="px-6 py-3 font-medium">Last Checked</th>
                <th className="px-6 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={10} className="px-6 py-8 text-center text-text-muted">Loading domains...</td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-6 py-8 text-center text-text-muted">No domains found matching filters.</td>
                </tr>
              ) : (
                filtered.map(domain => (
                  <tr key={domain.id} className="border-b border-border/50 hover:bg-background/50 transition-colors">
                    <td className="px-6 py-4"><Badge status={domain.health.status} /></td>
                    <td className="px-6 py-4 font-medium text-white">
                      <Link to={`/domains/${domain.id}`} className="hover:text-primary transition-colors">{domain.domain}</Link>
                    </td>
                    <td className="px-6 py-4 text-text-muted">{domain.ips[0] || '-'}</td>
                    <td className="px-6 py-4">
                      {domain.reputation.spamRate !== null ? (
                        <span className={domain.reputation.spamRate > 0.1 ? 'text-status-warning' : ''}>
                          {domain.reputation.spamRate.toFixed(2)}%
                        </span>
                      ) : <span className="text-text-muted text-xs">No Data</span>}
                    </td>
                    <td className="px-6 py-4"><Badge status={domain.authentication.spf.status} /></td>
                    <td className="px-6 py-4"><Badge status={domain.authentication.dkim.status} /></td>
                    <td className="px-6 py-4"><Badge status={domain.authentication.dmarc.status} /></td>
                    <td className="px-6 py-4"><Badge status={domain.blacklist.status} /></td>
                    <td className="px-6 py-4 text-text-muted text-xs">
                      {format(new Date(domain.health.lastChecked), 'dd MMM yyyy, HH:mm')}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-3">
                        <Link to={`/domains/${domain.id}`} className="text-primary hover:text-primary-hover text-xs font-medium">View</Link>
                        <button onClick={() => handleDelete(domain.id)} className="text-status-error hover:text-red-400">
                          <Trash2 size={14} />
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
    </div>
  );
};

export default Domains;
""",
    "src/pages/DomainDetail.tsx": """import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { domainService } from '../services/mockData';
import { DomainHealth } from '../types/domain';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { ArrowLeft, ExternalLink, Calendar, Server, Mail, ShieldAlert } from 'lucide-react';
import { format } from 'date-fns';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const DomainDetail = () => {
  const { domainId } = useParams();
  const [domain, setDomain] = useState<DomainHealth | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (domainId) {
      domainService.getDomain(domainId).then(data => {
        setDomain(data || null);
        setLoading(false);
      });
    }
  }, [domainId]);

  if (loading) return <div className="text-text-muted">Loading domain details...</div>;
  if (!domain) return <div className="text-status-error">Domain not found.</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link to="/domains" className="p-2 bg-panel rounded-md border border-border hover:bg-background transition-colors text-text-muted">
          <ArrowLeft size={16} />
        </Link>
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold text-white leading-none">{domain.domain}</h1>
            <Badge status={domain.health.status} />
          </div>
          <div className="flex items-center gap-4 text-xs text-text-muted">
            <span className="flex items-center gap-1"><Server size={12} /> {domain.ips.join(', ')}</span>
            {domain.email && <span className="flex items-center gap-1"><Mail size={12} /> {domain.email}</span>}
            <span className="flex items-center gap-1"><Calendar size={12} /> Created: {format(new Date(domain.createdDate), 'dd MMM yyyy')}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Spam Rate Section */}
        <Card className="lg:col-span-2" title={<div className="flex justify-between items-center"><span>Spam Rate History</span><span className="text-xs font-normal text-text-muted">Last Updated: {format(new Date(domain.reputation.lastChecked), 'dd MMM yyyy, HH:mm')}</span></div>}>
          <div className="flex gap-8 mb-6">
            <div>
              <div className="text-text-muted text-sm mb-1">Current Spam Rate</div>
              <div className="text-3xl font-bold text-white">
                {domain.reputation.spamRate !== null ? `${domain.reputation.spamRate.toFixed(2)}%` : 'No Data'}
              </div>
            </div>
            <div>
              <div className="text-text-muted text-sm mb-1">Health Score</div>
              <div className="text-3xl font-bold text-white">{domain.health.score || '-'}</div>
            </div>
          </div>
          
          <div className="h-64 w-full">
            {domain.reputation.spamRateHistory.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={domain.reputation.spamRateHistory}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2A344A" vertical={false} />
                  <XAxis dataKey="date" stroke="#94A3B8" fontSize={12} tickFormatter={(val) => format(new Date(val), 'dd MMM')} />
                  <YAxis stroke="#94A3B8" fontSize={12} unit="%" />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#151C2C', borderColor: '#2A344A', color: '#F8FAFC' }}
                    labelFormatter={(val) => format(new Date(val), 'dd MMM yyyy')}
                    formatter={(value: number) => [`${value.toFixed(2)}%`, 'Spam Rate']}
                  />
                  <Line type="monotone" dataKey="rate" stroke="#3B82F6" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center border border-dashed border-border rounded-lg text-text-muted text-sm">
                No Spam Rate Data Available
              </div>
            )}
          </div>
        </Card>

        {/* Auth Section */}
        <Card title={<div className="flex justify-between items-center"><span>Email Authentication</span><span className="text-xs font-normal text-text-muted">{format(new Date(domain.authentication.spf.lastChecked), 'dd MMM yyyy')}</span></div>}>
          <div className="space-y-4">
            <div className="flex items-start justify-between pb-4 border-b border-border/50">
              <div>
                <div className="font-medium text-sm text-white mb-1">SPF</div>
                <div className="text-xs text-text-muted font-mono">{domain.authentication.spf.record || 'No record'}</div>
              </div>
              <Badge status={domain.authentication.spf.status} />
            </div>
            <div className="flex items-start justify-between pb-4 border-b border-border/50">
              <div>
                <div className="font-medium text-sm text-white mb-1">DKIM</div>
                <div className="text-xs text-text-muted">Selector: {domain.authentication.dkim.selector || 'Unknown'}</div>
              </div>
              <Badge status={domain.authentication.dkim.status} />
            </div>
            <div className="flex items-start justify-between">
              <div>
                <div className="font-medium text-sm text-white mb-1">DMARC</div>
                <div className="text-xs text-text-muted font-mono">{domain.authentication.dmarc.policy || 'No policy'}</div>
              </div>
              <Badge status={domain.authentication.dmarc.status} />
            </div>
          </div>
        </Card>

        {/* Blacklist Section */}
        <Card className="lg:col-span-2" title={<div className="flex justify-between items-center"><span>Blacklist Status</span><span className="text-xs font-normal text-text-muted">Last Checked: {format(new Date(domain.blacklist.lastChecked), 'dd MMM, HH:mm')}</span></div>}>
          <div className="flex gap-6 mb-6 pb-6 border-b border-border/50">
            <div>
              <div className="text-text-muted text-sm mb-1">Overall Status</div>
              <Badge status={domain.blacklist.status} className="text-sm px-3 py-1" />
            </div>
            <div>
              <div className="text-text-muted text-sm mb-1">Lists Checked</div>
              <div className="font-medium text-white">{domain.blacklist.countChecked}</div>
            </div>
            <div>
              <div className="text-text-muted text-sm mb-1">Listings</div>
              <div className="font-medium text-status-error">{domain.blacklist.countListed}</div>
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-text-muted uppercase bg-panel border-b border-border">
                <tr>
                  <th className="px-4 py-3 font-medium">Provider</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Details</th>
                  <th className="px-4 py-3 font-medium text-right">Last Checked</th>
                </tr>
              </thead>
              <tbody>
                {domain.blacklist.lists.length > 0 ? (
                  domain.blacklist.lists.map((list, i) => (
                    <tr key={i} className="border-b border-border/50 last:border-0 hover:bg-background/50">
                      <td className="px-4 py-3 font-medium text-white">{list.listName}</td>
                      <td className="px-4 py-3"><Badge status={list.status} /></td>
                      <td className="px-4 py-3 text-xs text-text-muted">
                        {list.status === 'Listed' ? (
                          <>
                            <span className="text-status-error">{list.listedIp}</span> - {list.reason}
                          </>
                        ) : '-'}
                      </td>
                      <td className="px-4 py-3 text-xs text-text-muted text-right">
                        {format(new Date(list.lastChecked), 'dd MMM yyyy')}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-text-muted text-sm">Check Unavailable</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        {/* DNS Section */}
        <Card title={<div className="flex justify-between items-center"><span>DNS & Infrastructure</span><span className="text-xs font-normal text-text-muted">{format(new Date(domain.dns.lastChecked), 'HH:mm')}</span></div>}>
          <div className="space-y-4 text-sm">
            <div>
              <div className="text-text-muted mb-1 text-xs uppercase font-semibold">DNS Records</div>
              <div className="space-y-2 bg-background p-3 rounded border border-border">
                <div className="grid grid-cols-[40px_1fr] gap-2">
                  <span className="text-text-muted font-mono text-xs">A</span>
                  <span className="font-mono text-xs text-white">{domain.dns.a?.join(', ') || '-'}</span>
                </div>
                <div className="grid grid-cols-[40px_1fr] gap-2">
                  <span className="text-text-muted font-mono text-xs">MX</span>
                  <span className="font-mono text-xs text-white">{domain.dns.mx?.join(', ') || '-'}</span>
                </div>
                <div className="grid grid-cols-[40px_1fr] gap-2">
                  <span className="text-text-muted font-mono text-xs">NS</span>
                  <span className="font-mono text-xs text-white truncate" title={domain.dns.ns?.join(', ')}>{domain.dns.ns?.join(', ') || '-'}</span>
                </div>
              </div>
            </div>

            <div>
              <div className="text-text-muted mb-1 text-xs uppercase font-semibold mt-4">Infrastructure</div>
              <div className="space-y-2 bg-background p-3 rounded border border-border">
                <div className="flex justify-between">
                  <span className="text-text-muted">SMTP Status</span>
                  <span className={domain.infrastructure.smtpStatus === 'OK' ? 'text-status-success' : 'text-status-error'}>{domain.infrastructure.smtpStatus}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-muted">TLS Support</span>
                  <span className={domain.infrastructure.tls ? 'text-status-success' : 'text-status-error'}>{domain.infrastructure.tls ? 'Yes' : 'No'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-muted">rDNS (PTR)</span>
                  <span className="text-white truncate max-w-[150px]">{domain.infrastructure.ptr || '-'}</span>
                </div>
              </div>
            </div>
          </div>
        </Card>

      </div>
    </div>
  );
};

export default DomainDetail;
""",
    "src/pages/AddDomain.tsx": """import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { domainService } from '../services/mockData';

const AddDomain = () => {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    domain: '',
    email: '',
    ips: '',
    provider: ''
  });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    
    await domainService.addDomain({
      domain: formData.domain,
      email: formData.email,
      ips: formData.ips.split(',').map(ip => ip.trim()).filter(Boolean),
      provider: formData.provider,
      createdDate: new Date().toISOString(),
      expiryDate: new Date(Date.now() + 31536000000).toISOString(), // +1 year
    });

    navigate('/domains');
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white mb-1">Add Domain</h1>
        <p className="text-text-muted text-sm">Add a new domain to monitor its health and infrastructure.</p>
      </div>

      <Card>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-text-muted mb-1.5">Domain Name <span className="text-status-error">*</span></label>
            <input 
              required
              type="text" 
              placeholder="example.com"
              value={formData.domain}
              onChange={e => setFormData({...formData, domain: e.target.value})}
              className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:border-primary text-text-main"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-muted mb-1.5">Primary IP(s) <span className="text-xs font-normal opacity-70">(comma separated)</span></label>
            <input 
              type="text" 
              placeholder="192.168.1.1, 10.0.0.1"
              value={formData.ips}
              onChange={e => setFormData({...formData, ips: e.target.value})}
              className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:border-primary text-text-main"
            />
          </div>

          <div className="grid grid-cols-2 gap-5">
            <div>
              <label className="block text-sm font-medium text-text-muted mb-1.5">Contact Email</label>
              <input 
                type="email" 
                placeholder="admin@example.com"
                value={formData.email}
                onChange={e => setFormData({...formData, email: e.target.value})}
                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:border-primary text-text-main"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-muted mb-1.5">Provider</label>
              <select
                value={formData.provider}
                onChange={e => setFormData({...formData, provider: e.target.value})}
                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:border-primary text-text-main"
              >
                <option value="">Select Provider...</option>
                <option value="AWS">AWS</option>
                <option value="Cloudflare">Cloudflare</option>
                <option value="GoDaddy">GoDaddy</option>
                <option value="Namecheap">Namecheap</option>
                <option value="Other">Other</option>
              </select>
            </div>
          </div>

          <div className="pt-4 flex justify-end gap-3 border-t border-border mt-6">
            <button 
              type="button" 
              onClick={() => navigate('/domains')}
              className="px-4 py-2 text-sm font-medium text-text-muted hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button 
              type="submit" 
              disabled={loading}
              className="bg-primary hover:bg-primary-hover text-white px-4 py-2 rounded-md font-medium text-sm transition-colors disabled:opacity-50"
            >
              {loading ? 'Adding...' : 'Add Domain'}
            </button>
          </div>
        </form>
      </Card>
    </div>
  );
};

export default AddDomain;
"""
}

def create_files(base_path, files_dict):
    for rel_path, content in files_dict.items():
        full_path = os.path.join(base_path, rel_path)
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        with open(full_path, "w", encoding="utf-8") as f:
            f.write(content)

create_files(base_dir, files)
print("Files created successfully.")
