import { DomainHealth } from '../types/domain';

export const mockDomains: DomainHealth[] = [
  {
    id: '1',
    domain: 'example.com',
    email: 'admin@example.com',
    ips: ['1.2.3.4'],
    provider: 'Cloudflare',
    createdDate: '2019-08-20T00:00:00Z',
    expiryDate: '2027-08-20T00:00:00Z',
    dns: {
      a: [{ value: '1.2.3.4', ttl: 300 }],
      aaaa: [{ value: '2001:db8::1', ttl: 300 }],
      mx: [{ value: '10 mail.example.com', ttl: 300 }],
      ns: [{ value: 'ns1.example.com', ttl: 86400 }, { value: 'ns2.example.com', ttl: 86400 }],
      txt: [{ value: 'v=spf1 include:example.com ~all', ttl: 300 }],
      cname: [],
      lastChecked: '2026-08-24T10:35:00Z'
    },
    authentication: {
      spf: { status: 'Pass', record: 'v=spf1 include:example.com ~all', lastChecked: '2026-08-20T14:15:00Z' },
      dkim: { status: 'Pass', selector: 'selector1', record: 'v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA', lastChecked: '2026-08-20T14:15:00Z' },
      dmarc: { status: 'Pass', policy: 'p=reject', record: 'v=DMARC1; p=reject; rua=mailto:dmarc@example.com;', lastChecked: '2026-08-20T14:15:00Z' }
    },
    infrastructure: {
      ptr: 'mail.example.com',
      smtpStatus: 'Reachable',
      tls: 'Supported',
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
      spamRateHistory: Array.from({length: 90}, (_, i) => ({
        date: new Date(Date.now() - (89 - i) * 86400000).toISOString(),
        rate: Math.max(0, 0.05 + Math.random() * 0.05)
      })),
      postmasterDataAvailable: true,
      lastChecked: '2026-08-23T00:00:00Z'
    },
    health: {
      status: 'Healthy',
      score: 94,
      lastChecked: '2026-08-24T10:35:00Z'
    },
    history: Array.from({length: 10}, (_, i) => ({
      date: new Date(Date.now() - i * 86400000).toISOString(),
      status: 'Healthy',
      spamRate: 0.08,
      blacklist: 'Clean',
      score: 94
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
      a: [{ value: '10.0.0.5', ttl: 300 }, { value: '10.0.0.6', ttl: 300 }],
      mx: [{ value: '10 mail.suspicious-sender.net', ttl: 300 }],
      lastChecked: '2026-08-24T09:15:00Z'
    },
    authentication: {
      spf: { status: 'Fail', record: 'v=spf1 ?all', lastChecked: '2026-08-24T09:15:00Z' },
      dkim: { status: 'Missing', lastChecked: '2026-08-24T09:15:00Z' },
      dmarc: { status: 'Missing', lastChecked: '2026-08-24T09:15:00Z' }
    },
    infrastructure: {
      smtpStatus: 'Error',
      tls: 'Not Supported',
      lastChecked: '2026-08-24T09:15:00Z'
    },
    blacklist: {
      status: 'Listed',
      countChecked: 85,
      countListed: 2,
      lastChecked: '2026-08-24T08:00:00Z',
      lists: [
        { listName: 'Spamhaus', status: 'Listed', listedIp: '10.0.0.5', dateDetected: '2026-08-23T14:00:00Z', reason: 'High volume spam detected', lastChecked: '2026-08-24T08:00:00Z' },
        { listName: 'Barracuda', status: 'Clean', lastChecked: '2026-08-24T08:00:00Z' },
        { listName: 'SpamCop', status: 'Listed', listedIp: '10.0.0.5', dateDetected: '2026-08-22T09:00:00Z', reason: 'User reports', lastChecked: '2026-08-24T08:00:00Z' }
      ]
    },
    reputation: {
      spamRate: 1.25,
      spamRateHistory: Array.from({length: 90}, (_, i) => ({
        date: new Date(Date.now() - (89 - i) * 86400000).toISOString(),
        rate: Math.min(2.0, 0.5 + Math.random() * 1.0)
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
    expiryDate: '2026-09-01T00:00:00Z',
    dns: {
      a: [{ value: '172.16.0.100', ttl: 300 }],
      mx: [{ value: '10 mx.warning-domain.org', ttl: 300 }],
      lastChecked: '2026-08-24T11:00:00Z'
    },
    authentication: {
      spf: { status: 'Pass', record: 'v=spf1 a mx ~all', lastChecked: '2026-08-24T11:00:00Z' },
      dkim: { status: 'Pass', selector: 'k1', record: 'v=DKIM1; k=rsa; p=...', lastChecked: '2026-08-24T11:00:00Z' },
      dmarc: { status: 'Fail', policy: 'p=none', record: 'v=DMARC1; p=none;', lastChecked: '2026-08-24T11:00:00Z' }
    },
    infrastructure: {
      ptr: 'warning-domain.org',
      smtpStatus: 'Reachable',
      tls: 'Supported',
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
      spamRateHistory: Array.from({length: 90}, (_, i) => ({
        date: new Date(Date.now() - (89 - i) * 86400000).toISOString(),
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
    infrastructure: { smtpStatus: 'Unknown', tls: 'Unknown', lastChecked: '2026-08-24T10:00:00Z' },
    blacklist: { status: 'Unknown', countChecked: 0, countListed: 0, lastChecked: '2026-08-24T10:00:00Z', lists: [] },
    reputation: { spamRate: null, spamRateHistory: [], postmasterDataAvailable: false, lastChecked: '2026-08-24T10:00:00Z' },
    health: { status: 'Unknown', score: null, lastChecked: '2026-08-24T10:00:00Z' },
    history: []
  },
  ...Array.from({length: 6}, (_, i) => ({
    id: `mock-${i + 5}`,
    domain: `mock-domain-${i + 5}.com`,
    ips: [`192.168.10.${i + 5}`],
    provider: 'Google Domains',
    createdDate: '2022-01-01T00:00:00Z',
    expiryDate: '2028-01-01T00:00:00Z',
    dns: {
      a: [{ value: `192.168.10.${i + 5}`, ttl: 300 }],
      mx: [{ value: `10 mx.mock-domain-${i + 5}.com`, ttl: 300 }],
      lastChecked: '2026-08-24T12:00:00Z'
    },
    authentication: {
      spf: { status: 'Pass' as const, record: 'v=spf1 mx ~all', lastChecked: '2026-08-24T12:00:00Z' },
      dkim: { status: 'Pass' as const, selector: 'mail', record: 'v=DKIM1; k=rsa; p=...', lastChecked: '2026-08-24T12:00:00Z' },
      dmarc: { status: 'Pass' as const, policy: 'p=quarantine', record: 'v=DMARC1; p=quarantine;', lastChecked: '2026-08-24T12:00:00Z' }
    },
    infrastructure: {
      ptr: `mx.mock-domain-${i + 5}.com`,
      smtpStatus: 'Reachable' as const,
      tls: 'Supported' as const,
      lastChecked: '2026-08-24T12:00:00Z'
    },
    blacklist: {
      status: 'Clean' as const,
      countChecked: 85,
      countListed: 0,
      lastChecked: '2026-08-24T08:00:00Z',
      lists: []
    },
    reputation: {
      spamRate: 0.02,
      spamRateHistory: Array.from({length: 30}, (_, j) => ({
        date: new Date(Date.now() - (29 - j) * 86400000).toISOString(),
        rate: 0.01 + Math.random() * 0.02
      })),
      postmasterDataAvailable: true,
      lastChecked: '2026-08-24T12:00:00Z'
    },
    health: {
      status: 'Healthy' as const,
      score: 99,
      lastChecked: '2026-08-24T12:00:00Z'
    },
    history: []
  }))
];
