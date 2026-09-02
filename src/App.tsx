import React from 'react'
import { BrowserRouter, HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/layout'
import Dashboard from './pages/Dashboard'
import Domains from './pages/Domains'
import DomainDetail from './pages/DomainDetail'
import AddDomain from './pages/AddDomain'
import Settings from './pages/Settings'
import { AppProvider } from './context/AppContext'

// The desktop build is loaded from a file:// URL, where path-based routing cannot
// work (there is no server to map /domains back to index.html). Hash routing is used
// there; anything served over http (dev server, browser deployment) keeps the exact
// same BrowserRouter behavior as before. Routes and nesting are identical either way.
const Router = window.location.protocol === 'file:' ? HashRouter : BrowserRouter

function App() {
  return (
    <AppProvider>
      <Router>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="dashboard" element={<Navigate to="/" replace />} />
            {/* Keeping routes for future integration, but hiding from UI */}
            <Route path="domains" element={<Domains />} />
            <Route path="domains/:domainId" element={<DomainDetail />} />
            <Route path="add-domain" element={<AddDomain />} />
            <Route path="settings" element={<Settings />} />
          </Route>
        </Routes>
      </Router>
    </AppProvider>
  )
}

export default App
