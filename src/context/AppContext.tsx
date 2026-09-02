import React, { createContext, useContext, useEffect, useState } from 'react';

type Theme = 'dark' | 'light';

// Domains-table filter selections. Kept in app context (not page-local state) so a
// user's filters survive navigating to Domain Details and back, to Settings, and
// internal health-check polling — cleared only by "Clear Filters" or "Refresh".
export interface DomainFilters {
  status: string; spamRate: string; blacklist: string;
  spf: string; dkim: string; dmarc: string; lastChecked: string;
}
export const DEFAULT_DOMAIN_FILTERS: DomainFilters = {
  status: 'All', spamRate: 'All', blacklist: 'All',
  spf: 'All', dkim: 'All', dmarc: 'All', lastChecked: 'All',
};

interface AppContextType {
  theme: Theme;
  toggleTheme: () => void;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  lastRefreshed: Date;
  triggerRefresh: () => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  // Persisted Domains-table UI state (survives route changes).
  domainFilters: DomainFilters;
  setDomainFilters: React.Dispatch<React.SetStateAction<DomainFilters>>;
  clearDomainFilters: () => void;
  showDomainFilters: boolean;
  setShowDomainFilters: (v: boolean) => void;
  selectedDomainIds: Set<string>;
  setSelectedDomainIds: React.Dispatch<React.SetStateAction<Set<string>>>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setTheme] = useState<Theme>(() => {
    return (localStorage.getItem('theme') as Theme) || 'dark';
  });

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    return localStorage.getItem('sidebarCollapsed') === 'true';
  });
  
  const [lastRefreshed, setLastRefreshed] = useState(new Date());
  const [searchQuery, setSearchQuery] = useState('');

  // Persisted Domains UI state — lives here (above the router) so it is retained
  // across page unmounts. Reset only via clearDomainFilters (Clear Filters / Refresh).
  const [domainFilters, setDomainFilters] = useState<DomainFilters>(DEFAULT_DOMAIN_FILTERS);
  const [showDomainFilters, setShowDomainFilters] = useState(false);
  const [selectedDomainIds, setSelectedDomainIds] = useState<Set<string>>(new Set());
  const clearDomainFilters = () => setDomainFilters(DEFAULT_DOMAIN_FILTERS);

  useEffect(() => {
    localStorage.setItem('theme', theme);
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('sidebarCollapsed', String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  const toggleTheme = () => setTheme(t => (t === 'dark' ? 'light' : 'dark'));
  const toggleSidebar = () => setSidebarCollapsed(s => !s);
  const triggerRefresh = () => setLastRefreshed(new Date());

  return (
    <AppContext.Provider value={{
      theme, toggleTheme,
      sidebarCollapsed, toggleSidebar,
      lastRefreshed, triggerRefresh,
      searchQuery, setSearchQuery,
      domainFilters, setDomainFilters, clearDomainFilters,
      showDomainFilters, setShowDomainFilters,
      selectedDomainIds, setSelectedDomainIds
    }}>
      {children}
    </AppContext.Provider>
  );
};

export const useAppContext = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error('useAppContext must be used within AppProvider');
  return context;
};
