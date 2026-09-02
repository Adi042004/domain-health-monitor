import { useState } from 'react';
import { Outlet, NavLink, Link } from 'react-router-dom';
import {
  Search, HelpCircle, Settings, Moon, Sun, RefreshCw, Plus,
  LayoutDashboard, Globe, LogOut, ShieldCheck, PanelLeftClose, PanelLeftOpen,
} from 'lucide-react';
import { useAppContext } from '../../context/AppContext';
import { usePostmasterAddDomain } from '../../hooks/usePostmasterAddDomain';
import clsx from 'clsx';

// Consolidated from the former layout/Sidebar.tsx + layout/Header.tsx + layout/Layout.tsx.
// Sidebar and Header are internal to this module (only Layout was ever imported
// elsewhere). Markup and behavior are unchanged.

const Sidebar = () => {
  const { sidebarCollapsed, toggleSidebar } = useAppContext();

  const navItems = [
    { to: '/', icon: <LayoutDashboard size={20} />, label: 'Dashboard' },
    { to: '/domains', icon: <Globe size={20} />, label: 'Domains' },
  ];

  return (
    <aside className={clsx(
      "bg-panel border-r border-border flex flex-col h-screen fixed left-0 top-0 transition-all duration-300",
      sidebarCollapsed ? "w-16" : "w-64"
    )}>
      <div className={clsx("p-4 flex items-center h-16 border-b border-border", sidebarCollapsed ? "justify-center" : "justify-between")}>
        {!sidebarCollapsed && (
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="w-8 h-8 min-w-[2rem] rounded bg-primary flex items-center justify-center text-white">
              <ShieldCheck size={20} />
            </div>
            <div className="whitespace-nowrap">
              <h1 className="font-bold text-lg leading-tight text-text-main">Domain Health</h1>
              <p className="text-xs text-text-muted">Infrastructure Monitor</p>
            </div>
          </div>
        )}
        {sidebarCollapsed && (
          <div className="w-8 h-8 min-w-[2rem] rounded bg-primary flex items-center justify-center text-white" title="Domain Health">
            <ShieldCheck size={20} />
          </div>
        )}
      </div>

      <div className="flex justify-end p-2 border-b border-border/50">
        <button
          onClick={toggleSidebar}
          className="p-1.5 rounded-md text-text-muted hover:bg-border hover:text-text-main transition-colors mx-auto"
          title={sidebarCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
        >
          {sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        </button>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1 overflow-hidden">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              clsx(
                'flex items-center rounded-md transition-colors font-medium text-sm',
                sidebarCollapsed ? 'justify-center p-2' : 'gap-3 px-3 py-2',
                isActive
                  ? 'bg-primary text-white'
                  : 'text-text-muted hover:bg-border hover:text-text-main'
              )
            }
            title={sidebarCollapsed ? item.label : undefined}
          >
            {item.icon}
            {!sidebarCollapsed && <span className="whitespace-nowrap">{item.label}</span>}
          </NavLink>
        ))}
      </nav>

      <div className="p-3 border-t border-border">
        <button
          className={clsx(
            "flex items-center rounded-md transition-colors font-medium text-sm text-text-muted hover:bg-border hover:text-text-main w-full",
            sidebarCollapsed ? 'justify-center p-2' : 'gap-3 px-3 py-2 text-left'
          )}
          title={sidebarCollapsed ? "Sign Out" : undefined}
        >
          <LogOut size={20} />
          {!sidebarCollapsed && <span className="whitespace-nowrap">Sign Out</span>}
        </button>
      </div>
    </aside>
  );
};

const Header = () => {
  const { theme, toggleTheme, triggerRefresh, searchQuery, setSearchQuery, clearDomainFilters } = useAppContext();
  const [isRefreshing, setIsRefreshing] = useState(false);
  // Reuse the existing Google Postmaster add/verify flow (same modal as Settings).
  const { launch: launchAddDomain, launching: addDomainLaunching, modal: addDomainModal } = usePostmasterAddDomain();

  const handleRefresh = () => {
    setIsRefreshing(true);
    clearDomainFilters();  // "Refresh" intentionally clears the Domains filters (per requirement).
    triggerRefresh();
    setTimeout(() => setIsRefreshing(false), 600); // UI feedback
  };

  return (
    <>
    <header className="h-16 border-b border-border bg-background flex items-center justify-between px-6 sticky top-0 z-10 transition-colors duration-300">
      <div className="flex-1 max-w-xl">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={18} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search domains..."
            className="w-full bg-panel border border-border rounded-full pl-10 pr-4 py-1.5 text-sm focus:outline-none focus:border-primary text-text-main placeholder-text-muted transition-colors"
          />
        </div>
      </div>

      <div className="flex items-center gap-4 text-text-muted">
        <button
          type="button"
          onClick={launchAddDomain}
          disabled={addDomainLaunching}
          className="bg-primary hover:bg-primary-hover text-white transition-colors p-1.5 rounded-md flex items-center gap-2 px-3 text-sm font-medium disabled:opacity-50"
        >
           <Plus size={16} />
           Add Domain
        </button>
        <button
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="hover:text-text-main transition-colors p-1.5 bg-panel rounded-md border border-border flex items-center gap-2 px-3 text-sm disabled:opacity-50"
        >
           <RefreshCw size={14} className={clsx(isRefreshing && "animate-spin")} />
           {isRefreshing ? 'Refreshing...' : 'Refresh'}
        </button>
        <button className="hover:text-text-main transition-colors" title="Help">
          <HelpCircle size={18} />
        </button>
        <Link to="/settings" className="hover:text-text-main transition-colors" title="Settings">
          <Settings size={18} />
        </Link>
        <button
          onClick={toggleTheme}
          className="hover:text-text-main transition-colors bg-panel p-1.5 rounded-full border border-border"
          title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Mode`}
        >
          {theme === 'dark' ? <Moon size={16} /> : <Sun size={16} />}
        </button>
      </div>
    </header>
    {addDomainModal}
    </>
  );
};

const Layout = () => {
  const { sidebarCollapsed } = useAppContext();

  return (
    <div className="min-h-screen bg-background flex transition-colors duration-300">
      <Sidebar />
      <div className={clsx(
        "flex-1 flex flex-col min-h-screen transition-all duration-300",
        sidebarCollapsed ? "ml-16" : "ml-64"
      )}>
        <Header />
        <main className="flex-1 p-6 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default Layout;
