import { useMemo, useState } from 'react'
import { EChart, axisDefaults, baseOption } from '../components/EChart'
import { useData } from '../state/DataProvider'
import { useTheme } from '../hooks/useTheme'
import { fmtEur } from '../lib/engine'
import { computeScenarios, type ScenarioKey, type ScenarioResult } from '../lib/invest'
import type { Tier } from '../lib/schema'
import { chartTokens, deEmphasis, type Mode } from '../lib/palette'

/** feste Szenario-Farben (Farbe folgt dem Szenario, nie der Reihenfolge) */
const SCENARIO_COLOR: Record<ScenarioKey, { light: string; dark: string } | null> = {
  statusQuo: null, // De-Emphasis-Grau — der Status quo ist Kontext, nicht Kandidat
  heatPump: { light: '#2a78d6', dark: '#3987e5' },
  woodNew: { light: '#eb6834', dark: '#d95926' },
  pvHeatPump: { light: '#1baf7a', dark: '#199e70' },
  pv: { light: '#eda100', dark: '#c98500' },
  pellet: { light: '#e87ba4', dark: '#d55181' },
}

const scenarioColor = (key: ScenarioKey, mode: Mode): string =>
  SCENARIO_COLOR[key]?.[mode] ?? deEmphasis(mode)

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
  const [kwp, setKwp] = useState(inv.scenarios.pv.kwp)

  const results = useMemo(() => computeScenarios(inv, tier, kwp), [inv, tier, kwp])
  const statusQuo = results[0]
  const candidates = results.slice(1)
  const best = candidates.reduce((a, b) => (b.horizonSavings > a.horizonSavings ? b : a))
  const startYear = new Date().getFullYear()
  const H = inv.horizonYears

  // --- Chart 1: kumulierte Gesamtkosten mit Break-even-Punkten -------------
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
    grid: { left: 8, right: 16, top: 52, bottom: 4, containLabel: true },
    xAxis: { type: 'category', data: yearsAxis, boundaryGap: false, ...ax.category },
    yAxis: { type: 'value', ...ax.value },
    series: results.map((r) => {
      const color = scenarioColor(r.key, mode)
      const isRef = r.key === 'statusQuo'
      const isBest = r.key === best.key
      return {
        name: r.label,
        type: 'line' as const,
        data: r.cumulative.map((v) => Math.round(v)),
        lineStyle: { width: 2, color, type: isRef ? ('dashed' as const) : ('solid' as const) },
        itemStyle: { color, borderColor: t.surface, borderWidth: 2 },
        symbol: 'circle',
        symbolSize: 8,
        showSymbol: false,
        z: isBest ? 4 : isRef ? 2 : 3,
        endLabel: undefined,
        markPoint:
          r.breakEvenYear !== null
            ? {
                symbol: 'circle',
                symbolSize: 10,
                itemStyle: { color, borderColor: t.surface, borderWidth: 2 },
                label: {
                  show: isBest,
                  formatter: `lohnt sich ab ${startYear + r.breakEvenYear}`,
                  position: 'top' as const,
                  color: t.textPrimary,
                  fontSize: 11,
                },
                data: [{ coord: [r.breakEvenYear, Math.round(r.cumulative[r.breakEvenYear])] }],
              }
            : undefined,
      }
    }),
  }

  // --- Chart 2: aequivalente Jahreskosten, aufgeschluesselt ----------------
  const parts = [
    { key: 'kapital' as const, label: 'Kapitalkosten (Annuität)', color: mode === 'light' ? '#4a3aa7' : '#9085e9' },
    { key: 'energie' as const, label: 'Energie (netto)', color: mode === 'light' ? '#2a78d6' : '#3987e5' },
    { key: 'betrieb' as const, label: 'Wartung & Kaminkehrer', color: mode === 'light' ? '#e34948' : '#e66767' },
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
    grid: { left: 8, right: 56, top: 52, bottom: 4, containLabel: true },
    xAxis: { type: 'value', ...ax.value },
    yAxis: { type: 'category', data: sortedByAnnual.map((r) => r.label), ...ax.category },
    series: [
      ...parts.map((p, pi) => ({
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
                formatter: (prm: { dataIndex: number }) =>
                  fmtEur(sortedByAnnual[prm.dataIndex].equivalentAnnualCost),
              },
            }
          : {}),
      })),
    ],
  }

  const chipStyle = (active: boolean) =>
    ({
      borderColor: active ? 'var(--accent)' : 'var(--border)',
      background: active ? 'color-mix(in srgb, var(--accent) 10%, var(--surface))' : 'var(--surface)',
      color: active ? 'var(--text-primary)' : 'var(--text-muted)',
    }) as const

  return (
    <div className="space-y-4">
      {/* Steuerung: Kostenstruktur + PV-Groesse */}
      <div className="no-print flex flex-wrap items-center gap-2">
        <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          Kostenstruktur:
        </span>
        {(['guenstig', 'typisch', 'premium'] as const).map((k) => (
          <button key={k} type="button" onClick={() => setTier(k)} aria-pressed={tier === k}
            className="rounded-full border px-3 py-1 text-xs font-medium" style={chipStyle(tier === k)}>
            {TIER_LABEL[k]}
          </button>
        ))}
        <div className="mx-2 h-5 w-px" style={{ background: 'var(--baseline)' }} />
        <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          PV-Größe:
        </span>
        {[10, 15, 20].map((k) => (
          <button key={k} type="button" onClick={() => setKwp(k)} aria-pressed={kwp === k}
            className="rounded-full border px-3 py-1 text-xs font-medium" style={chipStyle(kwp === k)}>
            {k} kWp
          </button>
        ))}
      </div>

      {/* Hero: beste Option */}
      <div className="card p-5">
        <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          Beste Option über {H} Jahre ({TIER_LABEL[tier]})
        </div>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3">
          <span className="flex items-center gap-2 text-3xl font-semibold">
            <span aria-hidden className="inline-block h-3.5 w-3.5 rounded-full" style={{ background: scenarioColor(best.key, mode) }} />
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
          dass der {new Date().getFullYear() - 1998} Jahre alte Kessel ohnehin bald ersetzt werden muss —
          der Status quo ist also geschmeichelt.
        </p>
      </div>

      {/* Szenario-Karten */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {candidates.map((r) => (
          <ScenarioCard key={r.key} r={r} mode={mode} startYear={startYear} best={r.key === best.key} />
        ))}
      </div>

      <div className="card p-4">
        <h2 className="mb-2 text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
          Kumulierte Gesamtkosten — der Schnittpunkt mit der grauen Linie ist der Break-even
        </h2>
        <EChart option={cumulativeOption} mode={mode} height={380} ariaLabel="Kumulierte Gesamtkosten der Szenarien über den Planungshorizont" />
      </div>

      <div className="card p-4">
        <h2 className="mb-2 text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
          Äquivalente Jahreskosten (CAPEX als Annuität, {inv.interestRatePct} % Zins) — negative Energie = PV-Erträge übersteigen Zukauf
        </h2>
        <EChart option={annualOption} mode={mode} height={300} ariaLabel="Jahreskosten der Szenarien nach Kostenart" />
      </div>

      {/* Annahmen & Foerderung */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-5 text-sm">
          <h3 className="font-semibold">Datenbasis</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5" style={{ color: 'var(--text-secondary)' }}>
            <li>Strom: {inv.power.consumptionKwh.toLocaleString('de-DE')} kWh/a zu {inv.power.pricePerKwhCt.toLocaleString('de-DE')} ct/kWh — aus Zählerständen und aktuellem Vertrag</li>
            <li>Wärme: {inv.heat.sterPerYear} Ster/a à {fmtEur(inv.heat.eurPerSter)} — aus den Forstbetrieb-Rechnungen 2025/26</li>
            <li>Kessel: {bundle.settings.house.heatingSystem}</li>
            <li>Eigenarbeit: {inv.heat.ownWorkHoursPerYear} h/a à {fmtEur(inv.heat.ownWorkEurPerHour)} — macht „mehr Komfort" vergleichbar</li>
          </ul>
          <p className="mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>
            Für präzisere Zahlen fehlen noch: <strong>Dachdaten</strong> (Ausrichtung/Neigung/Fläche → echter
            PV-Ertrag via PVGIS), <strong>beheizte Wohnfläche</strong> und <strong>Heizkörper vs.
            Fußbodenheizung</strong> (→ JAZ der Wärmepumpe). Alle Annahmen editierbar in{' '}
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

function ScenarioCard({
  r,
  mode,
  startYear,
  best,
}: {
  r: ScenarioResult
  mode: Mode
  startYear: number
  best: boolean
}) {
  return (
    <div className="card p-4" style={best ? { borderColor: 'var(--accent)' } : undefined}>
      <div className="flex items-center gap-2 text-sm font-semibold">
        <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: scenarioColor(r.key, mode) }} />
        {r.label}
        {best && (
          <span className="rounded-full px-2 py-0.5 text-xs font-medium text-white" style={{ background: 'var(--accent)' }}>
            beste Option
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
