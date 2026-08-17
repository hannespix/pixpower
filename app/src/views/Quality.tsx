import { useMemo } from 'react'
import { useData } from '../state/DataProvider'
import { useTheme } from '../hooks/useTheme'
import { dataQualityIssues, fmtEur, woodBalance } from '../lib/engine'
import { seriesColor } from '../lib/palette'

const fmtSter = (v: number) => `${v.toLocaleString('de-DE', { maximumFractionDigits: 1 })} Ster`

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
  const wood = useMemo(() => woodBalance(bundle), [bundle])

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

      {wood && (
        <div className="card p-5">
          <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold">
            <span aria-hidden className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: seriesColor('holz', mode) }} />
            Brennholz-Lagerbilanz
            <span className="text-xs font-normal" style={{ color: 'var(--text-muted)' }}>
              Stand {new Date(wood.asOf).toLocaleDateString('de-DE')} · eigene Angabe
            </span>
          </h3>
          <dl className="tabular mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            <Line label={`Einkäufe seit ${new Date(wood.since).toLocaleDateString('de-DE')}`} value={fmtSter(wood.boughtSter)} />
            <Line label="dein Restbestand" value={fmtSter(wood.reportedStockSter)} strong />
            <Line label="laut Verteilmodell verheizt" value={fmtSter(wood.burnedSter)} />
            <Line label="Modell-Restbestand" value={fmtSter(wood.modelStockSter)} />
          </dl>
          <p className="mt-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
            Daraus abgeleiteter Jahresverbrauch:{' '}
            <strong style={{ color: 'var(--text-primary)' }}>{fmtSter(wood.impliedSterPerYear)}/Jahr</strong> — die
            Investitionsrechnung arbeitet mit {bundle.investment.heat.sterPerYear} Ster/Jahr
            {Math.abs(wood.impliedSterPerYear - bundle.investment.heat.sterPerYear) <= 3 ? (
              <span style={{ color: 'var(--good-text)' }}> ✓ bestätigt</span>
            ) : (
              <span style={{ color: 'var(--critical)' }}> — Abweichung, Annahme prüfen</span>
            )}
            .
          </p>
          <p className="mt-2 text-xs" style={{ color: Math.abs(wood.deviationSter) > 3 ? 'var(--critical)' : 'var(--text-muted)' }}>
            {Math.abs(wood.deviationSter) > 3
              ? `⚠ Das Modell liegt ${fmtSter(Math.abs(wood.deviationSter))} ${wood.deviationSter > 0 ? 'über' : 'unter'} deiner Angabe — die Lagerdauer von ${bundle.settings.woodSpreadMonths} Monaten verteilt die Kosten zu ${wood.deviationSter > 0 ? 'träge' : 'schnell'}.`
              : `Modell und Angabe passen zusammen (${fmtSter(Math.abs(wood.deviationSter))} Abweichung) — die Lagerdauer von ${bundle.settings.woodSpreadMonths} Monaten ist damit an der Realität kalibriert.`}{' '}
            Ein Holzeinkauf sagt nicht, wann er verheizt wird; erst deine Bestandsangabe macht die zeitliche
            Zuordnung überprüfbar. Neue Angabe? Einfach durchgeben.
          </p>
        </div>
      )}

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

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt style={{ color: 'var(--text-secondary)' }}>{label}</dt>
      <dd className={strong ? 'font-semibold' : undefined}>{value}</dd>
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
