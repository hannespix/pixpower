import { useMemo } from 'react'
import { useData } from '../state/DataProvider'
import { useTheme } from '../hooks/useTheme'
import { dataQualityIssues, fmtEur } from '../lib/engine'
import { seriesColor } from '../lib/palette'

/**
 * Datenqualitaets-Seite: die "Wunschliste" — welche Belege fehlen, welche
 * Abrechnungen sind ueberfaellig, welche Zaehlerstaende veraltet. Alles,
 * was hier steht, wird derzeit geschaetzt oder fehlt in der Gesamtsicht.
 */
export function Quality() {
  const { bundle, monthly } = useData()
  const mode = useTheme()
  const issues = useMemo(() => dataQualityIssues(bundle, monthly), [bundle, monthly])
  const warnings = issues.filter((i) => i.severity === 'warning')
  const infos = issues.filter((i) => i.severity === 'info')
  const estTotal = monthly.gaps.reduce((s, g) => s + g.estimatedEur, 0)

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="card p-5">
        <h2 className="text-base font-semibold">Datenlage</h2>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
          {warnings.length === 0
            ? 'Keine Lücken erkannt — die Auswertung steht vollständig auf Belegen.'
            : `${warnings.length} Lücken/offene Punkte. Erkannte Beleg-Lücken werden aus den angrenzenden Zeiträumen geschätzt (~${fmtEur(estTotal)} gesamt) — je mehr echte Belege, desto belastbarer wird vor allem die Investitionsplanung.`}
        </p>
        <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
          Nachreichen: einfach als PDF/Foto in einer Claude-Session abgeben — Schätzungen werden
          automatisch durch die echten Zahlen ersetzt.
        </p>
      </div>

      {warnings.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
            Fehlende Belege &amp; offene Abrechnungen
          </h3>
          {warnings.map((issue, i) => (
            <IssueCard key={i} icon="⚠" iconColor="#fab219" issue={issue} mode={mode} />
          ))}
        </div>
      )}

      {infos.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
            Nice to have
          </h3>
          {infos.map((issue, i) => (
            <IssueCard key={i} icon="ℹ" iconColor="var(--accent)" issue={issue} mode={mode} />
          ))}
        </div>
      )}
    </div>
  )
}

function IssueCard({
  icon,
  iconColor,
  issue,
  mode,
}: {
  icon: string
  iconColor: string
  issue: ReturnType<typeof dataQualityIssues>[number]
  mode: 'light' | 'dark'
}) {
  return (
    <div className="card flex items-start gap-3 px-4 py-3">
      <span aria-hidden className="mt-0.5 text-base leading-none" style={{ color: iconColor }}>
        {icon}
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {issue.category && (
            <span
              aria-hidden
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: seriesColor(issue.category, mode) }}
            />
          )}
          {issue.title}
          {issue.estimatedEur !== undefined && (
            <span className="tabular text-xs font-normal" style={{ color: 'var(--text-muted)' }}>
              geschätzt ~{fmtEur(issue.estimatedEur)}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-sm" style={{ color: 'var(--text-secondary)' }}>
          {issue.detail}
        </p>
      </div>
    </div>
  )
}
