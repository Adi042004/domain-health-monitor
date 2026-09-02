import React, { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '../components/ui';
import { domainService } from '../services/domainService';
import { Upload, CheckCircle, AlertCircle } from 'lucide-react';
import clsx from 'clsx';
import { useAppContext } from '../context/AppContext';

interface ImportResult {
  inserted: number;
  duplicates: number;
  errors: { row: number; domain?: string; reason: string }[];
}

const AddDomain = () => {
  const navigate = useNavigate();
  const { triggerRefresh } = useAppContext();
  
  // Tabs: 'single' | 'csv'
  const [activeTab, setActiveTab] = useState<'single' | 'csv'>('single');

  // Single Domain State
  const [formData, setFormData] = useState({ domain: '', email: '', ips: '', provider: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // CSV State
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [csvStatus, setCsvStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [csvResult, setCsvResult] = useState<ImportResult | null>(null);
  const [csvError, setCsvError] = useState('');

  const handleSingleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    
    try {
      await domainService.addDomain({
        domain: formData.domain,
        email: formData.email,
        ips: formData.ips.split(',').map(ip => ip.trim()).filter(Boolean),
        provider: formData.provider,
        createdDate: new Date().toISOString(),
        expiryDate: new Date(Date.now() + 31536000000).toISOString(),
      });
      triggerRefresh();
      navigate('/domains');
    } catch (err: any) {
      setError(err.message || 'Failed to add domain');
      setLoading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      setFile(f);
      setCsvStatus('idle');
      setCsvResult(null);
    }
  };

  const handleCsvSubmit = async () => {
    if (!file) return;
    setCsvStatus('loading');
    setCsvError('');
    try {
      const res = await domainService.importCSV(file);
      setCsvResult(res);
      setCsvStatus('done');
      if (res.inserted > 0) triggerRefresh();
    } catch (err: any) {
      setCsvError(err.message || 'CSV Import failed');
      setCsvStatus('error');
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-main mb-1">Add Domains</h1>
        <p className="text-text-muted text-sm">Add a new domain or bulk import multiple domains via CSV.</p>
      </div>

      <div className="flex border-b border-border mb-4">
        <button
          onClick={() => setActiveTab('single')}
          className={clsx(
            "px-4 py-2 font-medium text-sm transition-colors border-b-2",
            activeTab === 'single' ? "border-primary text-primary" : "border-transparent text-text-muted hover:text-text-main"
          )}
        >
          Single Domain
        </button>
        <button
          onClick={() => setActiveTab('csv')}
          className={clsx(
            "px-4 py-2 font-medium text-sm transition-colors border-b-2",
            activeTab === 'csv' ? "border-primary text-primary" : "border-transparent text-text-muted hover:text-text-main"
          )}
        >
          Bulk Import (CSV)
        </button>
      </div>

      <Card>
        {activeTab === 'single' ? (
          <div>
            {error && (
              <div className="mb-6 p-3 bg-status-error/10 border border-status-error/20 rounded text-sm text-status-error">
                {error}
              </div>
            )}
            <form onSubmit={handleSingleSubmit} className="space-y-5">
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
                  className="px-4 py-2 text-sm font-medium text-text-muted hover:text-text-main transition-colors"
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
          </div>
        ) : (
          <div className="space-y-5">
            <div className="bg-background border border-border rounded-md p-3">
              <p className="text-sm font-medium text-text-main mb-2">CSV Format Expected:</p>
              <p className="text-xs text-text-muted font-mono whitespace-pre bg-panel p-2 rounded border border-border/50">
{`domain,email
example.com,admin@example.com
example2.com,`}
              </p>
            </div>

            <div
              className={clsx(
                "border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors",
                file ? "border-primary/50 bg-primary/5" : "border-border hover:border-primary/40"
              )}
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="mx-auto mb-3 text-text-muted" size={32} />
              {file ? (
                <p className="text-sm font-medium text-text-main">{file.name}</p>
              ) : (
                <p className="text-sm text-text-muted">Click to select a CSV file to upload</p>
              )}
              <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFileChange} />
            </div>

            {csvStatus === 'done' && csvResult && (
              <div className="rounded-lg border border-border divide-y divide-border text-sm overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 bg-status-success/10 text-status-success font-medium">
                  <CheckCircle size={18} /> {csvResult.inserted} domain{csvResult.inserted !== 1 ? 's' : ''} successfully imported
                </div>
                {csvResult.duplicates > 0 && (
                  <div className="px-4 py-2.5 text-status-warning bg-status-warning/5">
                    {csvResult.duplicates} duplicate{csvResult.duplicates !== 1 ? 's' : ''} skipped
                  </div>
                )}
                {csvResult.errors.length > 0 && (
                  <div className="px-4 py-3 text-status-error bg-status-error/5 max-h-48 overflow-y-auto">
                    <p className="font-medium mb-1">{csvResult.errors.length} row error{csvResult.errors.length !== 1 ? 's' : ''}:</p>
                    {csvResult.errors.map((e, i) => (
                      <p key={i} className="text-xs font-mono mt-1">Row {e.row}{e.domain ? ` (${e.domain})` : ''}: {e.reason}</p>
                    ))}
                  </div>
                )}
              </div>
            )}

            {csvStatus === 'error' && (
              <div className="flex items-center gap-2 px-4 py-3 bg-status-error/10 rounded-lg text-status-error text-sm">
                <AlertCircle size={16} /> {csvError}
              </div>
            )}

            <div className="pt-4 flex justify-end gap-3 border-t border-border mt-6">
              <button 
                type="button" 
                onClick={() => navigate('/domains')}
                className="px-4 py-2 text-sm font-medium text-text-muted hover:text-text-main transition-colors"
              >
                {csvStatus === 'done' ? 'Back to Domains' : 'Cancel'}
              </button>
              {csvStatus !== 'done' && (
                <button 
                  onClick={handleCsvSubmit}
                  disabled={!file || csvStatus === 'loading'}
                  className="bg-primary hover:bg-primary-hover text-white px-4 py-2 rounded-md font-medium text-sm transition-colors disabled:opacity-50"
                >
                  {csvStatus === 'loading' ? 'Importing...' : 'Upload & Import'}
                </button>
              )}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
};

export default AddDomain;
