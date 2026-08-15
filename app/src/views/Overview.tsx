import { useMemo, useState } from 'react'
import { EChart, axisDefaults, baseOption } from '../components/EChart'
import { StatTile } from '../components/StatTile'
import { useData } from '../state/DataProvider'
import { useTheme } from '../hooks/useTheme'
import { fmtEur, summarizeYear, yearlyConsumption, yearsWithData } from '../lib/engine'
import { CATEGORIES, CATEGORY_LABEL, type Category } from '../lib/schema'
import { chartTokens, deEmphasis, seriesColor } from '../lib/palette'

const MONTH_LABELS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']

export function Overview() {
  const { bundle, monthly } = useData()
  const mode = useTheme()
  const t = chartTokens(mode)
  const years = yearsWithData(monthly)
  const currentYear = new Date().getFullYear()
  const [year, setYear] = useState(
    years.includes(currentYear) ? currentYear : years[years.length - 1],
  )
  const [activeCats, setActiveCats] = useState<Set<Category>>(new Set(CATEGORIES))

  const cats = CATEGORIES.filter((c) => activeCats.has(c))
  const summary = useMemo(() => summarizeYear(monthly, year), [monthly, year])
  const prev = useMemo(() => summarizeYear(monthly, year - 1), [monthly, year])

  const filteredTotal = cats.reduce((s, c) => s + summary.perCategory[c], 0)
  const filteredPrevTotal = cats.reduce((s, c) => s + prev.perCategory[c], 0)
  const avgPerMonth = summary.monthsWithData ? filteredTotal / summary.monthsWithData : 0
  const deltaPct = filteredPrevTotal > 0 ? ((filteredTotal - filteredPrevTotal) / filteredPrevTotal) * 100 : undefined

  // Strom-KPIs aus Abrechnungen (Preis) und Zaehlerstaenden (Verbrauch)
  const stromPrice = useMemo(() => {
    const ab = bundle.invoices.filter(
      (i) => i.category === 'strom' && i.kind === 'abrechnung' && i.quantity && i.periodStart?.startsWith(String(year)),
    )
    if (!ab.length) return undefined
    const eur = ab.reduce((s, i) => s + i.amountEur, 0)
    const kwh = ab.reduce((s, i) => s + (i.quantity ?? 0), 0)
    return kwh > 0 ? (eur / kwh) * 100 : undefined
  }, [bundle, year])

  const stromYear = useMemo(
    () => yearlyConsumption(bundle.readings, 'strom').find((y) => y.year === year),
    [bundle, year],
  )

  // --- Chart 1: gestapelte Monatssaeulen -----------------------------------
  const monthKeys = MONTH_LABELS.map((_, i) => `${year}-${String(i + 1).padStart(2, '0')}`)
  const monthRecs = monthKeys.map((k) => monthly.months.get(k))
  const monthTotals = monthRecs.map((r) => (r ? cats.reduce((s, c) => s + r[c], 0) : 0))
  const maxIdx = monthTotals.indexOf(Math.max(...monthTotals))
  // oberstes sichtbares Segment je Monat -> nur dort abgerundete Datenenden
  const topCat = monthRecs.map((r) => {
    if (!r) return undefined
    for (let i = cats.length - 1; i >= 0; i--) if (r[cats[i]] > 0.005) return cats[i]
    return undefined
  })

  const ax = axisDefaults(mode)
  const stackedOption = {
    ...baseOption(mode),
    tooltip: {
      ...(baseOption(mode).tooltip as object),
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      valueFormatter: (v: unknown) => (typeof v === 'number' && v > 0.005 ? fmtEur(v) : '–'),
    },
    legend: {
      top: 0,
      left: 0,
      icon: 'rect',
      itemWidth: 12,
      itemHeight: 12,
      textStyle: { color: t.textSecondary, fontSize: 12 },
    },
    grid: { left: 8, right: 12, top: 56, bottom: 4, containLabel: true },
    xAxis: { type: 'category', data: MONTH_LABELS, ...ax.category },
    yAxis: { type: 'value', ...ax.value },
    series: cats.map((c) => ({
      name: CATEGORY_LABEL[c],
      type: 'bar',
      stack: 'kosten',
      barMaxWidth: 24,
      itemStyle: { color: seriesColor(c, mode), borderColor: t.surface, borderWidth: 1 },
      emphasis: { itemStyle: { borderColor: t.surface, borderWidth: 1 } },
      data: monthRecs.map((r, mi) => ({
        value: r ? Math.round(r[c] * 100) / 100 : 0,
        itemStyle:
          topCat[mi] === c
            ? { color: seriesColor(c, mode), borderColor: t.surface, borderWidth: 1, borderRadius: [4, 4, 0, 0] }
            : undefined,
        // selektives Label: Gesamtsumme nur auf der Kappe des teuersten Monats
        label:
          topCat[mi] === c && mi === maxIdx
            ? {
                show: true,
                position: 'top' as const,
                color: t.textSecondary,
                fontSize: 11,
                formatter: () => fmtEur(monthTotals[mi]),
              }
            : undefined,
      })),
    })),
  }

  // --- Chart 2: Jahresvergleich (Emphasis: gewaehltes Jahr farbig) ---------
  const yearSeries = years.map((y) => {
    const totals = MONTH_LABELS.map((_, i) => {
      const rec = monthly.months.get(`${y}-${String(i + 1).padStart(2, '0')}`)
      return rec ? Math.round(cats.reduce((s, c) => s + rec[c], 0) * 100) / 100 : null
    })
    const isSel = y === year
    return {
      name: String(y),
      type: 'line' as const,
      data: totals,
      lineStyle: { width: 2, color: isSel ? t.accent : deEmphasis(mode) },
      itemStyle: { color: isSel ? t.accent : deEmphasis(mode), borderColor: t.surface, borderWidth: 2 },
      symbol: 'circle',
      symbolSize: 8,
      showSymbol: false,
      endLabel: {
        show: true,
        color: isSel ? t.textPrimary : t.textMuted,
        fontSize: 11,
        formatter: '{a}',
        distance: 6,
      },
      z: isSel ? 3 : 2,
    }
  })

  const compareOption = {
    ...baseOption(mode),
    tooltip: {
      ...(baseOption(mode).tooltip as object),
      trigger: 'axis',
      valueFormatter: (v: unknown) => (typeof v === 'number' ? fmtEur(v) : '–'),
    },
    legend: {
      top: 0,
      left: 0,
      icon: 'path://M0,6 L24,6 L24,10 L0,10 Z',
      itemWidth: 16,
      itemHeight: 8,
      textStyle: { color: t.textSecondary, fontSize: 12 },
    },
    grid: { left: 8, right: 44, top: 40, bottom: 4, containLabel: true },
    xAxis: { type: 'category', data: MONTH_LABELS, boundaryGap: false, ...ax.category },
    yAxis: { type: 'value', ...ax.value },
    series: yearSeries,
  }

  // --- Chart 3: Kategorien des Jahres (horizontale Balken) -----------------
  const catData = cats
    .map((c) => ({ cat: c, value: Math.round(summary.perCategory[c] * 100) / 100 }))
    .filter((d) => d.value > 0.005)
    .sort((a, b) => a.value - b.value)

  const catOption = {
    ...baseOption(mode),
    tooltip: {
      ...(baseOption(mode).tooltip as object),
      trigger: 'item',
      valueFormatter: (v: unknown) => (typeof v === 'number' ? fmtEur(v) : '–'),
    },
    grid: { left: 8, right: 64, top: 8, bottom: 4, containLabel: true },
    xAxis: { type: 'value', ...ax.value },
    yAxis: { type: 'category', data: catData.map((d) => CATEGORY_LABEL[d.cat]), ...ax.category },
    series: [
      {
        type: 'bar',
        barMaxWidth: 24,
        data: catData.map((d) => ({
          value: d.value,
          itemStyle: { color: seriesColor(d.cat, mode), borderRadius: [0, 4, 4, 0] },
        })),
        label: {
          show: true,
          position: 'right' as const,
          color: t.textSecondary,
          fontSize: 11,
          formatter: (p: { value: number }) => fmtEur(p.value),
        },
      },
    ],
  }

  return (
    <div className="space-y-4">
      {/* Filterzeile: Jahr zuerst, dann Kategorien — scopen alles darunter */}
      <div className="no-print flex flex-wrap items-center gap-2">
        <div className="flex gap-1" role="group" aria-label="Jahr">
          {years.map((y) => (
            <Chip key={y} active={y === year} onClick={() => setYear(y)}>
              {y}
            </Chip>
          ))}
        </div>
        <div className="mx-2 h-5 w-px" style={{ background: 'var(--baseline)' }} />
        <div className="flex flex-wrap gap-1" role="group" aria-label="Kategorien">
          {CATEGORIES.map((c) => (
            <Chip
              key={c}
              active={activeCats.has(c)}
              dot={seriesColor(c, mode)}
              onClick={() =>
                setActiveCats((prev) => {
                  const next = new Set(prev)
                  if (next.has(c)) {
                    if (next.size > 1) next.delete(c)
                  } else next.add(c)
                  return next
                })
              }
            >
              {CATEGORY_LABEL[c]}
            </Chip>
          ))}
        </div>
      </div>

      {/* Hero + KPI-Zeile */}
      <div className="card p-5">
        <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          Ø Hauskosten pro Monat · {year}
          {summary.monthsWithData < 12 ? ` (${summary.monthsWithData} Monate mit Daten)` : ''}
        </div>
        <div className="mt-1 text-5xl font-semibold">{fmtEur(avgPerMonth)}</div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label={`Gesamt ${year}`} value={fmtEur(filteredTotal)} delta={deltaPct} deltaLabel={`vs. ${year - 1}`} />
        <StatTile
          label="Strompreis effektiv"
          value={stromPrice !== undefined ? `${stromPrice.toLocaleString('de-DE', { maximumFractionDigits: 1 })} ct/kWh` : '–'}
          hint={stromPrice === undefined ? 'Jahresabrechnung fehlt noch' : 'aus Jahresabrechnung'}
        />
        <StatTile
          label="Stromverbrauch"
          value={stromYear ? `${Math.round(stromYear.value).toLocaleString('de-DE')} kWh` : '–'}
          hint={stromYear ? (stromYear.complete ? 'aus Zählerständen' : 'laufendes Jahr, bisher') : 'Zählerstände fehlen'}
        />
        <StatTile
          label="Teuerste Kategorie"
          value={catData.length ? CATEGORY_LABEL[catData[catData.length - 1].cat] : '–'}
          hint={catData.length ? fmtEur(catData[catData.length - 1].value) : undefined}
        />
      </div>

      <div className="card p-4">
        <h2 className="mb-2 text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
          Monatskosten {year} — periodisiert, nicht Zahlungsflüsse
        </h2>
        <EChart option={stackedOption} mode={mode} height={340} ariaLabel={`Gestapelte Monatskosten ${year} nach Kategorie`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-4">
          <h2 className="mb-2 text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
            Jahresvergleich (Monatssummen)
          </h2>
          <EChart option={compareOption} mode={mode} height={280} ariaLabel="Monatskosten im Jahresvergleich" />
        </div>
        <div className="card p-4">
          <h2 className="mb-2 text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
            Kategorien {year}
          </h2>
          <EChart option={catOption} mode={mode} height={280} ariaLabel={`Kosten nach Kategorie im Jahr ${year}`} />
        </div>
      </div>
    </div>
  )
}

function Chip({
  active,
  dot,
  onClick,
  children,
}: {
  active: boolean
  dot?: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-opacity"
      style={{
        borderColor: active ? 'var(--accent)' : 'var(--border)',
        background: active ? 'color-mix(in srgb, var(--accent) 10%, var(--surface))' : 'var(--surface)',
        color: active ? 'var(--text-primary)' : 'var(--text-muted)',
      }}
    >
      {dot && (
        <span
          aria-hidden
          className="inline-block h-2.5 w-2.5 rounded-full"
          style={{ background: dot, opacity: active ? 1 : 0.35 }}
        />
      )}
      {children}
    </button>
  )
}
