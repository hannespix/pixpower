import { useMemo, useState } from 'react'
import { useData } from '../state/DataProvider'
import { useTheme } from '../hooks/useTheme'
import { fmtEur, summarizeYear, totalOfMonth, yearlyConsumption, yearsWithData } from '../lib/engine'
import { CATEGORIES, CATEGORY_LABEL } from '../lib/schema'

const MONTH_LABELS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']

/**
 * Druckfertiger Jahresbericht. PDF-Export = Drucken -> "Als PDF speichern":
 * Print-CSS blendet Navigation/Filter aus, der Bericht ist dafuer gesetzt.
 */
export function Report() {
  const { bundle, monthly } = useData()
  useTheme()
  const years = yearsWithData(monthly)
  const currentYear = new Date().getFullYear()
  const [year, setYear] = useState(
    years.includes(currentYear) ? currentYear : years[years.length - 1],
  )
  const summary = useMemo(() => summarizeYear(monthly, year, true), [monthly, year])
  const prev = useMemo(() => summarizeYear(monthly, year - 1, true), [monthly, year])

  const monthRows = MONTH_LABELS.map((label, i) => {
    const key = `${year}-${String(i + 1).padStart(2, '0')}`
    const rec = monthly.months.get(key)
    const est = monthly.estimated.get(key)
    return {
      label,
      rec,
      est,
      total: (rec ? totalOfMonth(rec) : 0) + (est ? totalOfMonth(est) : 0),
    }
  })

  const activeCats = CATEGORIES.filter((c) => summary.perCategory[c] > 0.005 || prev.perCategory[c] > 0.005)
  const strom = yearlyConsumption(bundle.readings, 'strom').find((y) => y.year === year)
  const wasser = yearlyConsumption(bundle.readings, 'wasser').find((y) => y.year === year)

  return (
    <div className="space-y-4">
      <div className="no-print flex items-center gap-2">
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="rounded-lg border px-2 py-1.5 text-sm"
          style={{ borderColor: 'var(--baseline)', background: 'var(--surface)', color: 'var(--text-primary)' }}
          aria-label="Berichtsjahr"
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-lg px-3 py-1.5 text-sm font-medium text-white"
          style={{ background: 'var(--accent)' }}
        >
          Drucken / Als PDF speichern
        </button>
      </div>

      <div className="card p-6">
        <h1 className="text-2xl font-semibold">Hauskostenbericht {year}</h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
          {bundle.settings.house.name} · {bundle.settings.house.location}
          {bundle.settings.house.heatingSystem ? ` · ${bundle.settings.house.heatingSystem}` : ''}
        </p>

        <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <ReportStat label="Gesamtkosten" value={fmtEur(summary.total)} />
          <ReportStat
            label="Ø pro Monat"
            value={fmtEur(summary.avgPerMonth)}
            hint={summary.monthsWithData < 12 ? `${summary.monthsWithData} Monate mit Daten` : undefined}
          />
          <ReportStat
            label="Veränderung zum Vorjahr"
            value={prev.total > 0 ? `${(((summary.total - prev.total) / prev.total) * 100).toLocaleString('de-DE', { maximumFractionDigits: 1 })} %` : '–'}
          />
          <ReportStat
            label="Strom / Wasser"
            value={`${strom ? Math.round(strom.value).toLocaleString('de-DE') : '–'} kWh · ${wasser ? Math.round(wasser.value).toLocaleString('de-DE') : '–'} m³`}
            hint="aus Zählerständen"
          />
        </div>
      </div>

      <div className="card overflow-x-auto p-6">
        <h2 className="mb-3 text-base font-semibold">Monatskosten nach Kategorie (periodisiert)</h2>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--baseline)' }}>
              <th className="py-1.5 pr-3 text-left font-medium" style={{ color: 'var(--text-secondary)' }}>
                Monat
              </th>
              {activeCats.map((c) => (
                <th key={c} className="px-2 py-1.5 text-right font-medium" style={{ color: 'var(--text-secondary)' }}>
                  {CATEGORY_LABEL[c]}
                </th>
              ))}
              <th className="py-1.5 pl-3 text-right font-semibold">Gesamt</th>
            </tr>
          </thead>
          <tbody>
            {monthRows.map((m) => (
              <tr key={m.label} style={{ borderBottom: '1px solid var(--grid)' }}>
                <td className="py-1.5 pr-3">{m.label}</td>
                {activeCats.map((c) => {
                  const v = (m.rec?.[c] ?? 0) + (m.est?.[c] ?? 0)
                  const hasEst = (m.est?.[c] ?? 0) > 0.005
                  return (
                    <td key={c} className="tabular px-2 py-1.5 text-right" style={{ color: 'var(--text-secondary)' }}>
                      {v > 0.005 ? `${hasEst ? '~' : ''}${fmtEur(v, 2)}` : '–'}
                    </td>
                  )
                })}
                <td className="tabular py-1.5 pl-3 text-right font-medium">
                  {m.total > 0.005 ? `${m.est && totalOfMonth(m.est) > 0.005 ? '~' : ''}${fmtEur(m.total, 2)}` : '–'}
                </td>
              </tr>
            ))}
            <tr style={{ borderTop: '2px solid var(--baseline)' }}>
              <td className="py-2 pr-3 font-semibold">Jahr</td>
              {activeCats.map((c) => (
                <td key={c} className="tabular px-2 py-2 text-right font-medium">
                  {fmtEur(summary.perCategory[c], 2)}
                </td>
              ))}
              <td className="tabular py-2 pl-3 text-right font-semibold">{fmtEur(summary.total, 2)}</td>
            </tr>
          </tbody>
        </table>
        <p className="mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>
          Kosten sind dem Verbrauchszeitraum zugeordnet (Abrechnungen verdrängen Abschläge, Wärme
          gradtagzahlgewichtet, Brennholz über {bundle.settings.woodSpreadMonths} Monate verteilt) —
          nicht dem Zahlungsdatum.
          {summary.estimatedTotal > 0.5 &&
            ` Mit ~ markierte Werte enthalten Schätzungen für Beleg-Lücken (${fmtEur(summary.estimatedTotal, 2)} im Jahr ${year}), abgeleitet aus den angrenzenden belegten Zeiträumen.`}{' '}
          Erstellt am {new Date().toLocaleDateString('de-DE')}.
        </p>
      </div>
    </div>
  )
}

function ReportStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
        {label}
      </div>
      <div className="mt-0.5 text-xl font-semibold">{value}</div>
      {hint && (
        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {hint}
        </div>
      )}
    </div>
  )
}
