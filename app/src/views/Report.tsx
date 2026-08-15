import { useMemo, useState } from 'react'
import { useData } from '../state/DataProvider'
import { useTheme } from '../hooks/useTheme'
import { fmtEur, summarizeYear, totalOfMonth, yearlyConsumption, yearsWithData } from '../lib/engine'
import { CATEGORIES, CATEGORY_LABEL, type Category } from '../lib/schema'
import { exportExcel } from '../lib/excel'

const MONTH_LABELS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']

/**
 * Druckfertiger Bericht. PDF-Export = Drucken -> "Als PDF speichern":
 * Print-CSS blendet Navigation/Filter aus, der Bericht ist dafuer gesetzt.
 *
 * Konfigurierbar: Zeitraum (einzelnes Jahr -> Monatstabelle, alle Jahre ->
 * Jahrestabelle) und die Kostenpunkte (Kategorien), die in Tabelle und
 * Summen einfliessen. Ø-Zeilen liefern Durchschnittskosten je Monat/Jahr.
 */
export function Report() {
  const { bundle, monthly } = useData()
  useTheme()
  const years = yearsWithData(monthly)
  const currentYear = new Date().getFullYear()
  const [range, setRange] = useState<number | 'alle'>(
    years.includes(currentYear) ? currentYear : years[years.length - 1],
  )
  const [catSel, setCatSel] = useState<Record<Category, boolean>>(
    () => Object.fromEntries(CATEGORIES.map((c) => [c, true])) as Record<Category, boolean>,
  )

  const singleYear = range !== 'alle' ? range : null
  const rangeYears = singleYear !== null ? [singleYear] : years

  const perYear = useMemo(
    () => new Map(years.map((y) => [y, summarizeYear(monthly, y, true)])),
    [monthly, years],
  )
  const summary = singleYear !== null ? perYear.get(singleYear)! : null
  const prev = singleYear !== null ? perYear.get(singleYear - 1) : undefined

  /** Kategorien, die im gewaehlten Zeitraum (oder Vorjahr) Kosten haben */
  const catsWithData = CATEGORIES.filter((c) =>
    [...rangeYears, ...(singleYear !== null ? [singleYear - 1] : [])].some(
      (y) => (perYear.get(y)?.perCategory[c] ?? 0) > 0.005,
    ),
  )
  const activeCats = catsWithData.filter((c) => catSel[c])
  const sumSel = (rec: Partial<Record<Category, number>> | undefined): number =>
    activeCats.reduce((s, c) => s + (rec?.[c] ?? 0), 0)

  // Kennzahlen ueber Zeitraum + Auswahl
  const totalSel = rangeYears.reduce((s, y) => s + sumSel(perYear.get(y)?.perCategory), 0)
  const monthsWithData = rangeYears.reduce((s, y) => s + (perYear.get(y)?.monthsWithData ?? 0), 0)
  const estimatedTotal = rangeYears.reduce((s, y) => s + (perYear.get(y)?.estimatedTotal ?? 0), 0)

  const monthRows =
    singleYear === null
      ? []
      : MONTH_LABELS.map((label, i) => {
          const key = `${singleYear}-${String(i + 1).padStart(2, '0')}`
          const rec = monthly.months.get(key)
          const est = monthly.estimated.get(key)
          const merged = Object.fromEntries(
            CATEGORIES.map((c) => [c, (rec?.[c] ?? 0) + (est?.[c] ?? 0)]),
          ) as Record<Category, number>
          return { label, merged, est, hasEst: est ? totalOfMonth(est) > 0.005 : false, total: sumSel(merged) }
        })

  const consumption = (type: 'strom' | 'wasser') =>
    yearlyConsumption(bundle.readings, type)
      .filter((y) => rangeYears.includes(y.year))
      .reduce((s, y) => s + y.value, 0)
  const strom = consumption('strom')
  const wasser = consumption('wasser')

  const title = singleYear !== null ? `Hauskostenbericht ${singleYear}` : `Hauskostenbericht ${years[0]}–${years[years.length - 1]}`
  const deltaPrev =
    summary && prev && prev.monthsWithData > 0 && summary.monthsWithData > 0
      ? (sumSel(summary.perCategory) / summary.monthsWithData / (sumSel(prev.perCategory) / prev.monthsWithData) - 1) * 100
      : null

  const chipStyle = (active: boolean) =>
    ({
      borderColor: active ? 'var(--accent)' : 'var(--border)',
      background: active ? 'color-mix(in srgb, var(--accent) 10%, var(--surface))' : 'var(--surface)',
      color: active ? 'var(--text-primary)' : 'var(--text-muted)',
    }) as const

  const selStyle = { borderColor: 'var(--baseline)', background: 'var(--surface)', color: 'var(--text-primary)' } as const

  return (
    <div className="space-y-4">
      <div className="no-print card space-y-2.5 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Zeitraum</span>
          <select
            value={String(range)}
            onChange={(e) => setRange(e.target.value === 'alle' ? 'alle' : Number(e.target.value))}
            className="rounded-lg border px-2 py-1.5 text-sm"
            style={selStyle}
            aria-label="Berichtszeitraum"
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y} (Monatskosten)
              </option>
            ))}
            <option value="alle">Alle Jahre (Jahreskosten)</option>
          </select>
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-white"
            style={{ background: 'var(--accent)' }}
          >
            Drucken / Als PDF speichern
          </button>
          <button
            type="button"
            onClick={() => void exportExcel(bundle, monthly)}
            className="rounded-lg border px-3 py-1.5 text-sm font-medium"
            style={{ borderColor: 'var(--baseline)' }}
            title="Mehrere Sheets: Jahresübersicht, Monatskosten (belegt/geschätzt getrennt), alle Belege mit Autofilter, Zählerstände + Jahresverbrauch, Methodik"
          >
            Excel-Export (.xlsx)
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Kostenpunkte</span>
          {catsWithData.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={catSel[c]}
              onClick={() => setCatSel((s) => ({ ...s, [c]: !s[c] }))}
              className="rounded-full border px-3 py-1 text-xs font-medium"
              style={chipStyle(catSel[c])}
            >
              {CATEGORY_LABEL[c]}
            </button>
          ))}
          {activeCats.length < catsWithData.length && (
            <button
              type="button"
              onClick={() => setCatSel(Object.fromEntries(CATEGORIES.map((c) => [c, true])) as Record<Category, boolean>)}
              className="text-xs underline underline-offset-2"
              style={{ color: 'var(--accent)' }}
            >
              alle
            </button>
          )}
        </div>
      </div>

      <div className="card p-6">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
          {bundle.settings.house.name} · {bundle.settings.house.location}
          {bundle.settings.house.heatingSystem ? ` · ${bundle.settings.house.heatingSystem}` : ''}
          {activeCats.length < catsWithData.length
            ? ` · Auswahl: ${activeCats.map((c) => CATEGORY_LABEL[c]).join(', ')}`
            : ''}
        </p>

        <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <ReportStat label="Gesamtkosten" value={fmtEur(totalSel)} />
          <ReportStat
            label="Ø pro Monat"
            value={monthsWithData > 0 ? fmtEur(totalSel / monthsWithData) : '–'}
            hint={`${monthsWithData} Monate mit Daten`}
          />
          {singleYear !== null ? (
            <ReportStat
              label="Vorjahr (Ø/Monat)"
              value={deltaPrev !== null ? `${deltaPrev >= 0 ? '+' : ''}${deltaPrev.toLocaleString('de-DE', { maximumFractionDigits: 1 })} %` : '–'}
            />
          ) : (
            <ReportStat label="Ø pro Jahr" value={monthsWithData > 0 ? fmtEur((totalSel / monthsWithData) * 12) : '–'} hint="hochgerechnet aus belegten Monaten" />
          )}
          <ReportStat
            label="Strom / Wasser"
            value={`${strom > 0 ? Math.round(strom).toLocaleString('de-DE') : '–'} kWh · ${wasser > 0 ? Math.round(wasser).toLocaleString('de-DE') : '–'} m³`}
            hint="aus Zählerständen"
          />
        </div>
      </div>

      <div className="card overflow-x-auto p-6">
        <h2 className="mb-3 text-base font-semibold">
          {singleYear !== null ? 'Monatskosten nach Kategorie (periodisiert)' : 'Jahreskosten nach Kategorie (periodisiert)'}
        </h2>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--baseline)' }}>
              <th className="py-1.5 pr-3 text-left font-medium" style={{ color: 'var(--text-secondary)' }}>
                {singleYear !== null ? 'Monat' : 'Jahr'}
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
            {singleYear !== null ? (
              <>
                {monthRows.map((m) => (
                  <tr key={m.label} style={{ borderBottom: '1px solid var(--grid)' }}>
                    <td className="py-1.5 pr-3">{m.label}</td>
                    {activeCats.map((c) => (
                      <td key={c} className="tabular px-2 py-1.5 text-right" style={{ color: 'var(--text-secondary)' }}>
                        {m.merged[c] > 0.005 ? `${(m.est?.[c] ?? 0) > 0.005 ? '~' : ''}${fmtEur(m.merged[c], 2)}` : '–'}
                      </td>
                    ))}
                    <td className="tabular py-1.5 pl-3 text-right font-medium">
                      {m.total > 0.005 ? `${m.hasEst ? '~' : ''}${fmtEur(m.total, 2)}` : '–'}
                    </td>
                  </tr>
                ))}
                <tr style={{ borderTop: '2px solid var(--baseline)' }}>
                  <td className="py-2 pr-3 font-semibold">Jahr</td>
                  {activeCats.map((c) => (
                    <td key={c} className="tabular px-2 py-2 text-right font-medium">
                      {fmtEur(summary!.perCategory[c], 2)}
                    </td>
                  ))}
                  <td className="tabular py-2 pl-3 text-right font-semibold">{fmtEur(sumSel(summary!.perCategory), 2)}</td>
                </tr>
                <tr>
                  <td className="py-1.5 pr-3" style={{ color: 'var(--text-secondary)' }}>Ø pro Monat</td>
                  {activeCats.map((c) => (
                    <td key={c} className="tabular px-2 py-1.5 text-right" style={{ color: 'var(--text-secondary)' }}>
                      {summary!.monthsWithData > 0 ? fmtEur(summary!.perCategory[c] / summary!.monthsWithData, 2) : '–'}
                    </td>
                  ))}
                  <td className="tabular py-1.5 pl-3 text-right font-medium" style={{ color: 'var(--text-secondary)' }}>
                    {summary!.monthsWithData > 0 ? fmtEur(sumSel(summary!.perCategory) / summary!.monthsWithData, 2) : '–'}
                  </td>
                </tr>
              </>
            ) : (
              <>
                {years.map((y) => {
                  const yc = perYear.get(y)!
                  return (
                    <tr key={y} style={{ borderBottom: '1px solid var(--grid)' }}>
                      <td className="py-1.5 pr-3">
                        {y}
                        {yc.monthsWithData < 12 && (
                          <span className="ml-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                            ({yc.monthsWithData} Mon.)
                          </span>
                        )}
                      </td>
                      {activeCats.map((c) => (
                        <td key={c} className="tabular px-2 py-1.5 text-right" style={{ color: 'var(--text-secondary)' }}>
                          {yc.perCategory[c] > 0.005 ? `${yc.estimatedTotal > 0.5 ? '~' : ''}${fmtEur(yc.perCategory[c], 2)}` : '–'}
                        </td>
                      ))}
                      <td className="tabular py-1.5 pl-3 text-right font-medium">{fmtEur(sumSel(yc.perCategory), 2)}</td>
                    </tr>
                  )
                })}
                <tr style={{ borderTop: '2px solid var(--baseline)' }}>
                  <td className="py-2 pr-3 font-semibold">Gesamt</td>
                  {activeCats.map((c) => (
                    <td key={c} className="tabular px-2 py-2 text-right font-medium">
                      {fmtEur(years.reduce((s2, y) => s2 + (perYear.get(y)?.perCategory[c] ?? 0), 0), 2)}
                    </td>
                  ))}
                  <td className="tabular py-2 pl-3 text-right font-semibold">{fmtEur(totalSel, 2)}</td>
                </tr>
                <tr>
                  <td className="py-1.5 pr-3" style={{ color: 'var(--text-secondary)' }}>Ø pro Monat</td>
                  {activeCats.map((c) => (
                    <td key={c} className="tabular px-2 py-1.5 text-right" style={{ color: 'var(--text-secondary)' }}>
                      {monthsWithData > 0 ? fmtEur(years.reduce((s2, y) => s2 + (perYear.get(y)?.perCategory[c] ?? 0), 0) / monthsWithData, 2) : '–'}
                    </td>
                  ))}
                  <td className="tabular py-1.5 pl-3 text-right font-medium" style={{ color: 'var(--text-secondary)' }}>
                    {monthsWithData > 0 ? fmtEur(totalSel / monthsWithData, 2) : '–'}
                  </td>
                </tr>
              </>
            )}
          </tbody>
        </table>
        <p className="mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>
          Kosten sind dem Verbrauchszeitraum zugeordnet (Abrechnungen verdrängen Abschläge, Wärme
          gradtagzahlgewichtet, Brennholz über {bundle.settings.woodSpreadMonths} Monate verteilt) —
          nicht dem Zahlungsdatum.
          {estimatedTotal > 0.5 &&
            ` Mit ~ markierte Werte enthalten Schätzungen für Beleg-Lücken (${fmtEur(estimatedTotal, 2)} im Zeitraum), abgeleitet aus den angrenzenden belegten Zeiträumen.`}{' '}
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
