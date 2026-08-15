import { useMemo } from 'react'
import { HashRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { DataProvider, useData } from './state/DataProvider'
import { Overview } from './views/Overview'
import { Records } from './views/Records'
import { Entry } from './views/Entry'
import { Report } from './views/Report'
import { Quality } from './views/Quality'
import { Invest } from './views/Invest'
import { dataQualityIssues } from './lib/engine'

export default function App() {
  return (
    <DataProvider>
      <HashRouter>
        <Shell />
      </HashRouter>
    </DataProvider>
  )
}

function Shell() {
  const { bundle, monthly } = useData()
  const warningCount = useMemo(
    () => dataQualityIssues(bundle, monthly).filter((i) => i.severity === 'warning').length,
    [bundle, monthly],
  )
  return (
    <div className="mx-auto max-w-6xl px-4 py-5">
      <header className="no-print mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">⚡ Hauskosten</h1>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {bundle.settings.house.name} · Stand {new Date(bundle.generatedAt).toLocaleDateString('de-DE')}
          </p>
        </div>
        <nav className="flex gap-1 rounded-full border p-1" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
          {[
            ['/', 'Übersicht'],
            ['/invest', 'Invest'],
            ['/belege', 'Belege'],
            ['/daten', 'Daten'],
            ['/erfassen', 'Erfassen'],
            ['/bericht', 'Bericht'],
          ].map(([to, label]) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium"
              style={({ isActive }) => ({
                background: isActive ? 'var(--accent)' : 'transparent',
                color: isActive ? '#fff' : 'var(--text-secondary)',
              })}
            >
              {label}
              {to === '/daten' && warningCount > 0 && (
                <span
                  className="tabular rounded-full px-1.5 text-xs font-semibold"
                  style={{ background: '#fab219', color: '#0b0b0b' }}
                  aria-label={`${warningCount} offene Datenpunkte`}
                >
                  {warningCount}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
      </header>

      {bundle.settings.demoData && (
        <div
          className="no-print mb-4 rounded-lg border px-3 py-2 text-sm"
          style={{ borderColor: 'var(--baseline)', background: 'var(--surface)', color: 'var(--text-secondary)' }}
        >
          ⚠ <strong>Beispieldaten.</strong> Dieses Dashboard zeigt Demodaten — echte Rechnungen werden
          per PR in <code>data/</code> eingepflegt, dann verschwindet dieser Hinweis
          (<code>demoData: false</code> in settings.json).
        </div>
      )}

      <Routes>
        <Route path="/" element={<Overview />} />
        <Route path="/belege" element={<Records />} />
        <Route path="/invest" element={<Invest />} />
        <Route path="/daten" element={<Quality />} />
        <Route path="/erfassen" element={<Entry />} />
        <Route path="/bericht" element={<Report />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      <footer className="no-print mt-8 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
        Datenhaltung im Git-Repo · Auswertung komplett im Browser · keine Server, keine Cookies
      </footer>
    </div>
  )
}
