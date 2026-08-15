import { useMemo, useState } from 'react'
import { EChart, axisDefaults, baseOption } from '../components/EChart'
import { useData } from '../state/DataProvider'
import { useTheme } from '../hooks/useTheme'
import { fmtEur } from '../lib/engine'
import {
  HEAT_LABEL,
  PRESETS,
  STATUS_QUO,
  WW_LABEL,
  attachComparison,
  comboKey,
  computeCombo,
  type Combo,
  type ComboResult,
  type HeatKey,
  type WwKey,
} from '../lib/invest'
import type { Tier } from '../lib/schema'
import { chartTokens, deEmphasis, type Mode } from '../lib/palette'

/** feste Farben je kuratierter Kombination; eigene Kombination = violett */
const PRESET_COLOR: Record<string, { light: string; dark: string }> = {
  'woodNew|0|bestand': { light: '#eb6834', dark: '#d95926' },
  'pellet|0|bestand': { light: '#e87ba4', dark: '#d55181' },
  'heatPump|0|bestand': { light: '#2a78d6', dark: '#3987e5' },
  'bestand|15|bestand': { light: '#eda100', dark: '#c98500' },
  'heatPump|15|bestand': { light: '#1baf7a', dark: '#199e70' },
  'pellet|15|bwwp': { light: '#008300', dark: '#008300' },
}
const CUSTOM_COLOR = { light: '#4a3aa7', dark: '#9085e9' }

const comboColor = (key: string, mode: Mode): string =>
  key === comboKey(STATUS_QUO) ? deEmphasis(mode) : (PRESET_COLOR[key] ?? CUSTOM_COLOR)[mode]

const TIER_LABEL: Record<Tier, string> = {
  guenstig: 'günstiger Anbieter',
  typisch: 'typisches Angebot',
  premium: 'Premium-Anbieter',
}

export function Invest() {
  const { bundle } = useData()
  const mode = useTheme()
  const t = chartTokens(mode)
  const inv = bundle.investment
  const [tier, setTier] = useState<Tier>('typisch')
  const [custom, setCustom] = useState<Combo>({ heat: 'pellet', pvKwp: 20, ww: 'bwwp' })

  const { results, statusQuo, customResult, best } = useMemo(() => {
    const statusQuo = computeCombo(inv, tier, STATUS_QUO)
    const presetResults = PRESETS.map((c) => computeCombo(inv, tier, c))
    const customResult = computeCombo(inv, tier, custom)
    const isDuplicate =
      customResult.key === statusQuo.key || presetResults.some((r) => r.key === customResult.key)
    const results = [statusQuo, ...presetResults, ...(isDuplicate ? [] : [customResult])]
    attachComparison(statusQuo, results)
    const candidates = results.filter((r) => r.key !== statusQuo.key)
    const best = candidates.reduce((a, b) => (b.horizonSavings > a.horizonSavings ? b : a))
    return { results, statusQuo, customResult: isDuplicate ? null : customResult, best }
  }, [inv, tier, custom])

  const startYear = new Date().getFullYear()
  const H = inv.horizonYears
  const ax = axisDefaults(mode)
  const yearsAxis = Array.from({ length: H + 1 }, (_, y) => (y === 0 ? 'heute' : String(startYear + y)))

  const cumulativeOption = {
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
    grid: { left: 8, right: 16, top: 64, bottom: 4, containLabel: true },
    xAxis: { type: 'category', data: yearsAxis, boundaryGap: false, ...ax.category },
    yAxis: { type: 'value', ...ax.value },
    series: results.map((r) => {
      const color = comboColor(r.key, mode)
      const isRef = r.key === statusQuo.key
      const isCustom = customResult !== null && r.key === customResult.key
      const isBest = r.key === best.key
      return {
        name: r.label,
        type: 'line' as const,
        data: r.cumulative.map((v) => Math.round(v)),
        lineStyle: { width: isCustom ? 3 : 2, color, type: isRef ? ('dashed' as const) : ('solid' as const) },
        itemStyle: { color, borderColor: t.surface, borderWidth: 2 },
        symbol: 'circle',
        symbolSize: 8,
        showSymbol: false,
        z: isCustom ? 5 : isBest ? 4 : isRef ? 2 : 3,
        markPoint:
          r.breakEvenYear !== null
            ? {
                symbol: 'circle',
                symbolSize: 10,
                itemStyle: { color, borderColor: t.surface, borderWidth: 2 },
                label: {
                  show: isBest || isCustom,
                  formatter: `${isCustom ? 'deine Kombi: ' : ''}lohnt sich ab ${startYear + r.breakEvenYear}`,
                  position: (isCustom ? 'bottom' : 'top') as 'top' | 'bottom',
                  color: t.textPrimary,
                  fontSize: 11,
                },
                data: [{ coord: [r.breakEvenYear, Math.round(r.cumulative[r.breakEvenYear])] }],
              }
            : undefined,
      }
    }),
  }

  const parts = [
    { key: 'kapital' as const, label: 'Kapitalkosten (Annuität)', color: mode === 'light' ? '#4a3aa7' : '#9085e9' },
    { key: 'energie' as const, label: 'Energie (netto)', color: mode === 'light' ? '#2a78d6' : '#3987e5' },
    { key: 'betrieb' as const, label: 'Wartung, Reparatur & Kaminkehrer', color: mode === 'light' ? '#e34948' : '#e66767' },
    { key: 'eigenarbeit' as const, label: 'Eigenarbeit Holz', color: mode === 'light' ? '#eb6834' : '#d95926' },
  ]
  const sortedByAnnual = [...results].sort((a, b) => b.equivalentAnnualCost - a.equivalentAnnualCost)

  const annualOption = {
    ...baseOption(mode),
    tooltip: {
      ...(baseOption(mode).tooltip as object),
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      valueFormatter: (v: unknown) => (typeof v === 'number' && Math.abs(v) > 0.5 ? fmtEur(v) : '–'),
    },
    legend: {
      top: 0,
      left: 0,
      icon: 'rect',
      itemWidth: 12,
      itemHeight: 12,
      textStyle: { color: t.textSecondary, fontSize: 12 },
    },
    grid: { left: 8, right: 60, top: 52, bottom: 4, containLabel: true },
    xAxis: { type: 'value', ...ax.value },
    yAxis: { type: 'category', data: sortedByAnnual.map((r) => r.label), ...ax.category },
    series: parts.map((p, pi) => ({
      name: p.label,
      type: 'bar' as const,
      stack: 'jahr',
      barMaxWidth: 24,
      itemStyle: { color: p.color, borderColor: t.surface, borderWidth: 1 },
      data: sortedByAnnual.map((r) => Math.round(r.breakdown[p.key])),
      ...(pi === parts.length - 1
        ? {
            label: {
              show: true,
              position: 'right' as const,
              color: t.textSecondary,
              fontSize: 11,
              formatter: (prm: { dataIndex: number }) => fmtEur(sortedByAnnual[prm.dataIndex].equivalentAnnualCost),
            },
          }
        : {}),
    })),
  }

  const chipStyle = (active: boolean) =>
    ({
      borderColor: active ? 'var(--accent)' : 'var(--border)',
      background: active ? 'color-mix(in srgb, var(--accent) 10%, var(--surface))' : 'var(--surface)',
      color: active ? 'var(--text-primary)' : 'var(--text-muted)',
    }) as const

  const Chips = <K extends string>({
    label,
    value,
    options,
    onChange,
  }: {
    label: string
    value: K
    options: [K, string][]
    onChange: (v: K) => void
  }) => (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="w-28 text-sm" style={{ color: 'var(--text-secondary)' }}>
        {label}
      </span>
      {options.map(([k, l]) => (
        <button key={k} type="button" onClick={() => onChange(k)} aria-pressed={value === k}
          className="rounded-full border px-3 py-1 text-xs font-medium" style={chipStyle(value === k)}>
          {l}
        </button>
      ))}
    </div>
  )

  return (
    <div className="space-y-4">
      {/* Baukasten */}
      <div className="card no-print space-y-2.5 p-4">
        <h2 className="text-sm font-semibold">
          Baukasten — kombiniere deine Variante{' '}
          <span className="font-normal" style={{ color: 'var(--text-muted)' }}>
            (violette Linie im Chart)
          </span>
        </h2>
        <Chips<HeatKey>
          label="Wärme"
          value={custom.heat}
          options={(Object.entries(HEAT_LABEL) as [HeatKey, string][])}
          onChange={(heat) => setCustom((c) => ({ ...c, heat }))}
        />
        <Chips<`${number}`>
          label="Photovoltaik"
          value={String(custom.pvKwp) as `${number}`}
          options={[['0', 'keine'], ['10', '10 kWp'], ['15', '15 kWp'], ['20', '20 kWp'], ['25', '25 kWp']]}
          onChange={(v) => setCustom((c) => ({ ...c, pvKwp: Number(v) }))}
        />
        <Chips<WwKey>
          label="Warmwasser"
          value={custom.ww}
          options={(Object.entries(WW_LABEL) as [WwKey, string][])}
          onChange={(ww) => setCustom((c) => ({ ...c, ww }))}
        />
        <Chips<Tier>
          label="Kostenstruktur"
          value={tier}
          options={(Object.entries(TIER_LABEL) as [Tier, string][])}
          onChange={setTier}
        />
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {inv.tierEffects.note}
        </p>
      </div>

      {/* Hero: beste Option */}
      <div className="card p-5">
        <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          Beste Option über {H} Jahre ({TIER_LABEL[tier]})
        </div>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3">
          <span className="flex items-center gap-2 text-3xl font-semibold">
            <span aria-hidden className="inline-block h-3.5 w-3.5 rounded-full" style={{ background: comboColor(best.key, mode) }} />
            {best.label}
          </span>
          <span className="text-xl font-semibold" style={{ color: 'var(--good-text)' }}>
            spart ~{fmtEur(best.horizonSavings)}
          </span>
          {best.breakEvenYear !== null && (
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              lohnt sich ab {startYear + best.breakEvenYear}
            </span>
          )}
        </div>
        <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
          gegenüber „Weiter wie bisher" ({fmtEur(statusQuo.equivalentAnnualCost)}/Jahr inkl.{' '}
          {fmtEur(statusQuo.breakdown.eigenarbeit)} bewerteter Eigenarbeit). Der Vergleich unterschlägt,
          dass der {startYear - 1998} Jahre alte Kessel ohnehin bald ersetzt werden muss — der Status quo
          ist also geschmeichelt.
        </p>
      </div>

      {/* Kombinations-Karten */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {results
          .filter((r) => r.key !== statusQuo.key)
          .map((r) => (
            <ComboCard
              key={r.key}
              r={r}
              mode={mode}
              startYear={startYear}
              best={r.key === best.key}
              custom={customResult !== null && r.key === customResult.key}
            />
          ))}
      </div>

      <div className="card p-4">
        <h2 className="mb-2 text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
          Kumulierte Gesamtkosten — der Schnittpunkt mit der grauen Linie ist der Break-even
        </h2>
        <EChart option={cumulativeOption} mode={mode} height={400} ariaLabel="Kumulierte Gesamtkosten aller Kombinationen über den Planungshorizont" />
      </div>

      <div className="card p-4">
        <h2 className="mb-2 text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
          Äquivalente Jahreskosten (CAPEX als Annuität, {inv.interestRatePct} % Zins) — negative Energie = PV-Erträge übersteigen Zukauf
        </h2>
        <EChart option={annualOption} mode={mode} height={340} ariaLabel="Jahreskosten der Kombinationen nach Kostenart" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-5 text-sm">
          <h3 className="font-semibold">Datenbasis</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5" style={{ color: 'var(--text-secondary)' }}>
            <li>Strom: {inv.power.consumptionKwh.toLocaleString('de-DE')} kWh/a zu {inv.power.pricePerKwhCt.toLocaleString('de-DE')} ct/kWh — aus Zählerständen und aktuellem Vertrag</li>
            <li>Wärme: {inv.heat.sterPerYear} Ster/a à {fmtEur(inv.heat.eurPerSter)} — aus den Forstbetrieb-Rechnungen; entspricht{' '}
              {bundle.settings.house.heatedAreaM2
                ? `${Math.round((inv.heat.sterPerYear * inv.heat.kwhPerSter * inv.heat.oldBoilerEfficiency) / bundle.settings.house.heatedAreaM2)} kWh/m²·a bei ${bundle.settings.house.heatedAreaM2} m²`
                : 'n/a'}{' '}
              — plausibel für teilsanierten Altbau</li>
            <li>Gebäude: Bj. 1889, EG unsaniert (1 m Bruchstein), DG 1998 isoliert → WP mit JAZ {inv.scenarios.heatPump.jaz} (+Struktur-Effekt) konservativ gerechnet</li>
            <li>Eigenarbeit: {inv.heat.ownWorkHoursPerYear} h/a à {fmtEur(inv.heat.ownWorkEurPerHour)} — macht „mehr Komfort" vergleichbar</li>
          </ul>
          <p className="mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>
            Für präzisere Zahlen fehlen noch: <strong>Dachdaten</strong> (→ PVGIS-Ertrag) und{' '}
            <strong>Heizkörper-Vorlauftemperatur</strong> (→ JAZ). Alle Annahmen editierbar in{' '}
            <code>data/investment.json</code>.
          </p>
        </div>
        <div className="card p-5 text-sm">
          <h3 className="font-semibold">Förderung (eingerechnet)</h3>
          <p className="mt-2" style={{ color: 'var(--text-secondary)' }}>
            {inv.subsidyNote}
          </p>
          <p className="mt-3 text-xs" style={{ color: 'var(--critical)' }}>
            ⏳ Der 16-%-Klimageschwindigkeitsbonus sinkt ab Februar 2027 halbjährlich — bei der Heizung
            kostet Warten bares Geld.
          </p>
        </div>
      </div>
    </div>
  )
}

function ComboCard({
  r,
  mode,
  startYear,
  best,
  custom,
}: {
  r: ComboResult
  mode: Mode
  startYear: number
  best: boolean
  custom: boolean
}) {
  return (
    <div className="card p-4" style={best || custom ? { borderColor: comboColor(r.key, mode) } : undefined}>
      <div className="flex items-center gap-2 text-sm font-semibold">
        <span aria-hidden className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: comboColor(r.key, mode) }} />
        <span className="min-w-0 flex-1">{r.label}</span>
        {best && (
          <span className="shrink-0 rounded-full px-2 py-0.5 text-xs font-medium text-white" style={{ background: 'var(--accent)' }}>
            beste
          </span>
        )}
        {custom && (
          <span className="shrink-0 rounded-full px-2 py-0.5 text-xs font-medium text-white" style={{ background: comboColor(r.key, mode) }}>
            deine Kombi
          </span>
        )}
      </div>
      <dl className="tabular mt-3 space-y-1 text-sm">
        <Row label="Investition" value={fmtEur(r.capexGross)} />
        <Row label="Förderung" value={r.subsidy > 0 ? `− ${fmtEur(r.subsidy)}` : '–'} good={r.subsidy > 0} />
        <Row label="Eigenanteil" value={fmtEur(r.capexNet)} strong />
        <Row label="Ø Jahreskosten" value={fmtEur(r.equivalentAnnualCost)} />
        <Row label="Lohnt sich ab" value={r.breakEvenYear !== null ? String(startYear + r.breakEvenYear) : 'im Horizont nie'} />
        <Row
          label="20-Jahres-Bilanz"
          value={`${r.horizonSavings >= 0 ? '+' : ''}${fmtEur(r.horizonSavings)}`}
          good={r.horizonSavings > 0}
          bad={r.horizonSavings < 0}
          strong
        />
      </dl>
    </div>
  )
}

function Row({
  label,
  value,
  strong,
  good,
  bad,
}: {
  label: string
  value: string
  strong?: boolean
  good?: boolean
  bad?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt style={{ color: 'var(--text-secondary)' }}>{label}</dt>
      <dd
        className={strong ? 'font-semibold' : undefined}
        style={good ? { color: 'var(--good-text)' } : bad ? { color: 'var(--critical)' } : undefined}
      >
        {value}
      </dd>
    </div>
  )
}
