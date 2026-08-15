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
  buildRecommendations,
  comboKey,
  computeCombo,
  householdYear,
  recommendedBatteryKwh,
  type Combo,
  type ComboResult,
  type HeatKey,
  type PriceOverrides,
  type WwKey,
} from '../lib/invest'
import type { Tier } from '../lib/schema'
import { chartTokens, deEmphasis, type Mode } from '../lib/palette'

/** feste Farben je kuratierter Kombination; eigene Kombination = violett */
const PRESET_COLOR: Record<string, { light: string; dark: string }> = {
  'woodNew|0|0|bestand|-|-': { light: '#eb6834', dark: '#d95926' },
  'pellet|0|0|bestand|-|-': { light: '#e87ba4', dark: '#d55181' },
  'heatPump|0|0|bestand|-|-': { light: '#2a78d6', dark: '#3987e5' },
  'bestand|15|0|bestand|-|-': { light: '#eda100', dark: '#c98500' },
  'heatPump|15|10|bestand|-|-': { light: '#1baf7a', dark: '#199e70' },
  'pellet|15|0|bwwp|-|-': { light: '#008300', dark: '#008300' },
}
const CUSTOM_COLOR = { light: '#4a3aa7', dark: '#9085e9' }

const comboColor = (key: string, mode: Mode): string =>
  key === comboKey(STATUS_QUO) ? deEmphasis(mode) : (PRESET_COLOR[key] ?? CUSTOM_COLOR)[mode]

const TIER_LABEL: Record<Tier, string> = {
  guenstig: 'günstiger Anbieter',
  typisch: 'typisches Angebot',
  premium: 'Premium-Anbieter',
}

type OvKey = keyof PriceOverrides

interface SliderCfg {
  key: OvKey
  label: string
  min: number
  max: number
  step: number
  market: number
  /** Formatierung des Werts (Standard: EUR gesamt) */
  perUnit?: string
  totalOf?: (v: number) => number
}

const roundTo = (v: number, step: number) => Math.round(v / step) * step

export function Invest() {
  const { bundle } = useData()
  const mode = useTheme()
  const t = chartTokens(mode)
  const inv = bundle.investment
  const s = inv.scenarios
  const [tier, setTier] = useState<Tier>('typisch')
  const [custom, setCustom] = useState<Combo>({ heat: 'pellet', pvKwp: 20, batteryKwh: 10, ww: 'bwwp', klima: false, smart: true })
  const [overrides, setOverrides] = useState<Partial<Record<OvKey, number>>>({})
  const [tab, setTab] = useState<'verlauf' | 'jahr' | 'karten' | 'familie'>('verlauf')
  const recommendations = useMemo(() => buildRecommendations(inv), [inv])
  const recBattery = recommendedBatteryKwh(custom.pvKwp, inv.power.consumptionKwh)

  const heatSpec =
    custom.heat === 'woodNew' ? s.woodNew : custom.heat === 'pellet' ? s.pellet : custom.heat === 'heatPump' ? s.heatPump : null
  const needsElektro = custom.pvKwp > 0 || custom.heat === 'heatPump' || (custom.pvKwp > 0 && custom.batteryKwh > 0) || custom.klima
  const wwSpec = custom.ww === 'bwwp' ? inv.ww.bwwp : custom.ww === 'heizstab' ? inv.ww.heizstab : null

  /** Regler fuer alle CAPEX-Einzelposten der aktuellen Kombination */
  const sliders: SliderCfg[] = []
  if (heatSpec)
    sliders.push({
      key: 'heatCapexEur',
      label: `${HEAT_LABEL[custom.heat]} komplett inkl. Einbau`,
      min: roundTo(heatSpec.capexEur.guenstig * 0.5, 500),
      max: roundTo(heatSpec.capexEur.premium * 1.4, 500),
      step: 500,
      market: heatSpec.capexEur[tier],
    })
  if (custom.pvKwp > 0)
    sliders.push({
      key: 'pvEurPerKwp',
      label: `Photovoltaik (${custom.pvKwp} kWp)`,
      min: roundTo(s.pv.capexPerKwp.guenstig * 0.6, 25),
      max: roundTo(s.pv.capexPerKwp.premium * 1.5, 25),
      step: 25,
      market: s.pv.capexPerKwp[tier],
      perUnit: '€/kWp',
      totalOf: (v) => v * custom.pvKwp,
    })
  if (custom.pvKwp > 0 && custom.batteryKwh > 0)
    sliders.push({
      key: 'batteryEurPerKwh',
      label: `Stromspeicher (${custom.batteryKwh} kWh)`,
      min: roundTo(s.battery.capexPerKwh.guenstig * 0.6, 25),
      max: roundTo(s.battery.capexPerKwh.premium * 1.5, 25),
      step: 25,
      market: s.battery.capexPerKwh[tier],
      perUnit: '€/kWh',
      totalOf: (v) => v * custom.batteryKwh,
    })
  if (wwSpec)
    sliders.push({
      key: 'wwCapexEur',
      label: WW_LABEL[custom.ww],
      min: Math.max(100, roundTo(wwSpec.capexEur * 0.3, 50)),
      max: roundTo(wwSpec.capexEur * 2.5, 50),
      step: 50,
      market: wwSpec.capexEur,
    })
  if (custom.klima)
    sliders.push({
      key: 'klimaCapexEur',
      label: 'Klimaanlage OG inkl. Einbau',
      min: roundTo(s.klima.capexEur.guenstig * 0.5, 250),
      max: roundTo(s.klima.capexEur.premium * 1.5, 250),
      step: 250,
      market: s.klima.capexEur[tier],
    })
  if (custom.smart)
    sliders.push({
      key: 'smartCapexEur',
      label: 'Smart-Energiemanagement (HEMS + smarte Verzahnung)',
      min: roundTo(s.smart.capexEur.guenstig * 0.5, 100),
      max: roundTo(s.smart.capexEur.premium * 1.6, 100),
      step: 100,
      market: s.smart.capexEur[tier],
    })
  if (needsElektro)
    sliders.push({
      key: 'elektroCapexEur',
      label: 'Elektro & Installation (Zählerschrank, Leitungen, Anmeldung)',
      min: roundTo(s.elektro.capexEur.guenstig * 0.5, 100),
      max: roundTo(s.elektro.capexEur.premium * 1.6, 100),
      step: 100,
      market: s.elektro.capexEur[tier],
    })
  const activeOvCount = sliders.filter((sl) => overrides[sl.key] !== undefined).length

  const { results, statusQuo, customResult, best } = useMemo(() => {
    const statusQuo = computeCombo(inv, tier, STATUS_QUO)
    const presetResults = PRESETS.map((c) => computeCombo(inv, tier, c))
    const ov: PriceOverrides = {}
    for (const sl of sliders) if (overrides[sl.key] !== undefined) ov[sl.key] = overrides[sl.key]
    const hasOv = Object.keys(ov).length > 0
    const customResult = computeCombo(inv, tier, custom, ov)
    if (hasOv) {
      customResult.key += '|A'
      customResult.label += ' · Angebotspreise'
    }
    const isDuplicate =
      customResult.key === statusQuo.key || presetResults.some((r) => r.key === customResult.key)
    const results = [statusQuo, ...presetResults, ...(isDuplicate ? [] : [customResult])]
    attachComparison(statusQuo, results)
    const candidates = results.filter((r) => r.key !== statusQuo.key)
    const best = candidates.reduce((a, b) => (b.horizonSavings > a.horizonSavings ? b : a))
    return { results, statusQuo, customResult: isDuplicate ? null : customResult, best }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inv, tier, custom, overrides])

  const recResults = useMemo(() => {
    const sq = computeCombo(inv, tier, STATUS_QUO)
    return recommendations.map((rec) => {
      const r = computeCombo(inv, tier, rec.combo)
      attachComparison(sq, [sq, r])
      return { rec, r }
    })
  }, [inv, tier, recommendations])

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

  // Familien-Verbrauchskurve ueber den Planungshorizont
  const famYears = Array.from({ length: H + 1 }, (_, y) => householdYear(inv, y))
  const famOption = {
    ...baseOption(mode),
    tooltip: {
      ...(baseOption(mode).tooltip as object),
      trigger: 'axis',
      formatter: (ps: { dataIndex: number }[]) => {
        const f = famYears[ps[0].dataIndex]
        return `<strong>${f.year}</strong><br/>Haushaltsstrom: ${Math.round(f.stromKwh).toLocaleString('de-DE')} kWh<br/>Warmwasser: ${Math.round(f.wwKwh).toLocaleString('de-DE')} kWh th.<br/>${f.kidsAtHome} Kind(er) zu Hause, davon ${f.teens} Teenager`
      },
    },
    legend: { top: 0, left: 0, icon: 'path://M0,6 L24,6 L24,10 L0,10 Z', itemWidth: 16, itemHeight: 8, textStyle: { color: t.textSecondary, fontSize: 12 } },
    grid: { left: 8, right: 16, top: 40, bottom: 4, containLabel: true },
    xAxis: { type: 'category', data: famYears.map((f) => String(f.year)), boundaryGap: false, ...ax.category },
    yAxis: { type: 'value', ...ax.value },
    series: [
      {
        name: 'Haushaltsstrom (kWh/a)',
        type: 'line' as const,
        data: famYears.map((f) => Math.round(f.stromKwh)),
        lineStyle: { width: 2.5, color: mode === 'light' ? '#2a78d6' : '#3987e5' },
        itemStyle: { color: mode === 'light' ? '#2a78d6' : '#3987e5' },
        symbol: 'circle', symbolSize: 7, showSymbol: false,
      },
      {
        name: 'Warmwasser thermisch (kWh/a)',
        type: 'line' as const,
        data: famYears.map((f) => Math.round(f.wwKwh)),
        lineStyle: { width: 2.5, color: mode === 'light' ? '#1baf7a' : '#199e70' },
        itemStyle: { color: mode === 'light' ? '#1baf7a' : '#199e70' },
        symbol: 'circle', symbolSize: 7, showSymbol: false,
      },
    ],
  }
  const peak = famYears.reduce((a, b) => (b.wwKwh > a.wwKwh ? b : a))
  const lastKidOut = famYears.find((f) => f.kidsAtHome === 0)

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

  const tabBtn = (key: typeof tab, label: string) => (
    <button
      key={key}
      type="button"
      onClick={() => setTab(key)}
      aria-pressed={tab === key}
      className="rounded-full px-3 py-1.5 text-sm font-medium"
      style={{
        background: tab === key ? 'var(--accent)' : 'transparent',
        color: tab === key ? '#fff' : 'var(--text-secondary)',
      }}
    >
      {label}
    </button>
  )

  return (
    <div className="space-y-4">
      {/* Empfohlene Gesamtpakete */}
      <details className="card no-print p-0" open>
        <summary className="cursor-pointer select-none p-4 text-sm font-semibold">
          🎯 Sinnvolle Gesamtpakete — erklärt{' '}
          <span className="font-normal" style={{ color: 'var(--text-muted)' }}>
            Strom + Wärme (+ Klima) ganzheitlich gedacht, mit passender Speichergröße; „übernehmen" lädt das Paket in den Baukasten
          </span>
        </summary>
        <div className="grid gap-3 px-4 pb-4 lg:grid-cols-2">
          {recResults.map(({ rec, r }) => {
            const isCurrent = comboKey(rec.combo) === comboKey(custom)
            return (
              <div key={rec.title} className="flex flex-col rounded-lg border p-3" style={{ borderColor: isCurrent ? CUSTOM_COLOR[mode] : 'var(--grid)' }}>
                <div className="text-sm font-semibold">{rec.title}</div>
                <p className="mt-1 flex-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
                  {rec.why}
                </p>
                <div className="tabular mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
                  <span>Eigenanteil <strong style={{ color: 'var(--text-primary)' }}>{fmtEur(r.capexNet)}</strong></span>
                  <span>Ø Jahreskosten <strong style={{ color: 'var(--text-primary)' }}>{fmtEur(r.equivalentAnnualCost)}</strong></span>
                  <span>lohnt sich ab <strong style={{ color: 'var(--text-primary)' }}>{r.breakEvenYear !== null ? startYear + r.breakEvenYear : '–'}</strong></span>
                  <span style={{ color: r.horizonSavings >= 0 ? 'var(--good-text)' : 'var(--critical)' }}>
                    {H} J: {r.horizonSavings >= 0 ? '+' : ''}{fmtEur(r.horizonSavings)}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setCustom(rec.combo)
                    setOverrides({})
                  }}
                  className="mt-2 self-start rounded-lg border px-2.5 py-1 text-xs font-medium"
                  style={isCurrent ? { background: CUSTOM_COLOR[mode], color: '#fff', borderColor: CUSTOM_COLOR[mode] } : { borderColor: 'var(--baseline)' }}
                >
                  {isCurrent ? '✓ im Baukasten' : 'in den Baukasten übernehmen'}
                </button>
              </div>
            )
          })}
        </div>
      </details>

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
        {custom.pvKwp > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <Chips<`${number}`>
              label="Speicher"
              value={String(custom.batteryKwh) as `${number}`}
              options={[['0', 'keiner'], ['5', '5 kWh'], ['10', '10 kWh'], ['15', '15 kWh']]}
              onChange={(v) => setCustom((c) => ({ ...c, batteryKwh: Number(v) }))}
            />
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              sinnvoll zu {custom.pvKwp} kWp: ~{recBattery} kWh (Faustregel 0,8 kWh/kWp, gedeckelt vom Verbrauch)
            </span>
          </div>
        )}
        <Chips<WwKey>
          label="Warmwasser"
          value={custom.ww}
          options={(Object.entries(WW_LABEL) as [WwKey, string][])}
          onChange={(ww) => setCustom((c) => ({ ...c, ww }))}
        />
        <Chips<'ja' | 'nein'>
          label="Klima OG"
          value={custom.klima ? 'ja' : 'nein'}
          options={[['nein', 'ohne'], ['ja', '❄ Klimaanlage Schlafzimmer']]}
          onChange={(v) => setCustom((c) => ({ ...c, klima: v === 'ja' }))}
        />
        <Chips<'ja' | 'nein'>
          label="Smart"
          value={custom.smart ? 'ja' : 'nein'}
          options={[['nein', 'ohne'], ['ja', '🧠 Energiemanagement + Verzahnung']]}
          onChange={(v) => setCustom((c) => ({ ...c, smart: v === 'ja' }))}
        />
        {custom.smart && (
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {s.smart.note}
          </p>
        )}
        <Chips<Tier>
          label="Kostenstruktur"
          value={tier}
          options={(Object.entries(TIER_LABEL) as [Tier, string][])}
          onChange={setTier}
        />
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {inv.tierEffects.note}
        </p>

        {/* Angebotspreise als Akkordeon, damit der Baukasten uebersichtlich bleibt */}
        <details className="rounded-lg border" style={{ borderColor: 'var(--grid)' }}>
          <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium">
            💶 Angebotspreise einstellen
            <span className="ml-2 font-normal" style={{ color: 'var(--text-muted)' }}>
              {activeOvCount > 0
                ? `${activeOvCount} Posten angepasst`
                : 'voreingestellt: Marktwerte der gewählten Kostenstruktur'}
            </span>
          </summary>
          <div className="space-y-3 px-3 pb-3 pt-1">
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Du hast ein echtes Angebot? Stell hier den Preis jedes Einzelpostens ein — gilt für{' '}
              <strong>deine Kombination</strong> (violett); die Vergleichskurven behalten die
              Marktpreise. „Markt“ setzt auf den typischen Wert der Kostenstruktur zurück.
            </p>
            {sliders.map((sl) => {
              const v = overrides[sl.key] ?? sl.market
              const overridden = overrides[sl.key] !== undefined
              return (
                <div key={sl.key} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="w-full text-sm sm:w-72" style={{ color: 'var(--text-secondary)' }}>
                    {sl.label}
                  </span>
                  <input
                    type="range"
                    min={sl.min}
                    max={sl.max}
                    step={sl.step}
                    value={v}
                    onChange={(e) => setOverrides((o) => ({ ...o, [sl.key]: Number(e.target.value) }))}
                    className="h-1.5 min-w-32 flex-1"
                    style={{ accentColor: overridden ? CUSTOM_COLOR[mode] : 'var(--accent)' }}
                    aria-label={`Preis ${sl.label}`}
                  />
                  <span className="tabular w-32 text-right text-sm font-semibold">
                    {sl.perUnit ? `${v.toLocaleString('de-DE')} ${sl.perUnit}` : fmtEur(v)}
                    {sl.totalOf && (
                      <span className="block text-xs font-normal" style={{ color: 'var(--text-muted)' }}>
                        = {fmtEur(sl.totalOf(v))}
                      </span>
                    )}
                  </span>
                  <button
                    type="button"
                    disabled={!overridden}
                    onClick={() => setOverrides((o) => ({ ...o, [sl.key]: undefined }))}
                    className="w-28 text-left text-xs underline-offset-2 disabled:no-underline"
                    style={{ color: overridden ? 'var(--accent)' : 'var(--text-muted)', textDecoration: overridden ? 'underline' : 'none' }}
                  >
                    {overridden ? `Markt: ${sl.perUnit ? `${sl.market.toLocaleString('de-DE')} ${sl.perUnit}` : fmtEur(sl.market)} ↺` : 'Marktwert'}
                  </button>
                </div>
              )
            })}
            {activeOvCount > 0 && (
              <button
                type="button"
                onClick={() => setOverrides({})}
                className="rounded-lg border px-2.5 py-1 text-xs font-medium"
                style={{ borderColor: 'var(--baseline)' }}
              >
                Alle auf Marktwerte zurücksetzen
              </button>
            )}
          </div>
        </details>
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

      {/* Reiter fuer die drei Sichten */}
      <div className="no-print flex gap-1 rounded-full border p-1" style={{ borderColor: 'var(--border)', background: 'var(--surface)', width: 'fit-content' }}>
        {tabBtn('verlauf', 'Kostenverlauf & Break-even')}
        {tabBtn('jahr', 'Jahreskosten')}
        {tabBtn('karten', 'Vergleich im Detail')}
        {tabBtn('familie', 'Familie & Verbrauch')}
      </div>

      {tab === 'verlauf' && (
        <div className="card p-4">
          <h2 className="mb-2 text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
            Kumulierte Gesamtkosten — der Schnittpunkt mit der grauen Linie ist der Break-even
          </h2>
          <EChart option={cumulativeOption} mode={mode} height={400} ariaLabel="Kumulierte Gesamtkosten aller Kombinationen über den Planungshorizont" />
        </div>
      )}

      {tab === 'jahr' && (
        <div className="card p-4">
          <h2 className="mb-2 text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
            Äquivalente Jahreskosten (CAPEX als Annuität, {inv.interestRatePct} % Zins) — negative Energie = PV-Erträge übersteigen Zukauf
          </h2>
          <EChart option={annualOption} mode={mode} height={340} ariaLabel="Jahreskosten der Kombinationen nach Kostenart" />
        </div>
      )}

      {tab === 'karten' && (
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
      )}

      {tab === 'familie' && (
        <div className="card p-4">
          <h2 className="mb-2 text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
            Bedarfsentwicklung der Familie — alle Kombinationen rechnen mit diesen Kurven
          </h2>
          <EChart option={famOption} mode={mode} height={300} ariaLabel="Strom- und Warmwasserbedarf der Familie über den Planungshorizont" />
          <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
            <ul className="list-disc space-y-1 pl-5" style={{ color: 'var(--text-secondary)' }}>
              <li>
                2 Erwachsene + 4 Kinder ({inv.household.kidBirthYears.map((by) => inv.household.referenceYear - by).join(', ')} Jahre) —
                Teenager ab {inv.household.teenFromAge}, Auszug mit ~{inv.household.moveOutAge} angenommen
              </li>
              <li>
                Pro Kopf und Jahr: Strom {inv.household.stromKwhPerChild}/{inv.household.stromKwhPerTeen}/{inv.household.stromKwhPerAdult} kWh,
                Warmwasser {inv.household.wwKwhPerChild}/{inv.household.wwKwhPerTeen}/{inv.household.wwKwhPerAdult} kWh (Kind/Teenager/Erwachsene:r)
              </li>
              <li>Grundlast (Weingut, Sauna, Haus): ~{Math.round(famYears[0].baseKwh).toLocaleString('de-DE')} kWh/a konstant</li>
            </ul>
            <div style={{ color: 'var(--text-secondary)' }}>
              <p>
                <strong>Peak {peak.year}:</strong> {peak.teens} Teenager gleichzeitig — Warmwasser steigt auf ~
                {Math.round(peak.wwKwh).toLocaleString('de-DE')} kWh th. ({Math.round((peak.wwKwh / famYears[0].wwKwh - 1) * 100)} % über heute).
                Genau dann zahlt sich PV-Überschuss-Warmwasser (BWWP + Smart) aus.
              </p>
              {lastKidOut && (
                <p className="mt-2">
                  Ab ~{lastKidOut.year} sind alle Kinder ausgezogen — der Bedarf sinkt deutlich. Deshalb: Speicher nicht
                  überdimensionieren und Systeme wählen, die auch bei kleinerem Haushalt effizient laufen.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Einzelposten deiner Kombination */}
      {customResult !== null && (
        <div className="card p-4 text-sm">
          <h3 className="font-semibold">
            Investition deiner Kombination{' '}
            <span className="font-normal" style={{ color: 'var(--text-muted)' }}>
              — {customResult.label}
            </span>
          </h3>
          <dl className="tabular mt-2 max-w-md space-y-1">
            {customResult.capexItems.map((it) => (
              <div key={it.key} className="flex items-baseline justify-between gap-2">
                <dt style={{ color: 'var(--text-secondary)' }}>
                  {it.label}
                  {it.overridden && (
                    <span className="ml-1.5 rounded-full px-1.5 text-xs font-medium text-white" style={{ background: CUSTOM_COLOR[mode] }}>
                      Angebot
                    </span>
                  )}
                </dt>
                <dd>{fmtEur(it.eur)}</dd>
              </div>
            ))}
            <div className="flex items-baseline justify-between gap-2" style={{ color: 'var(--good-text)' }}>
              <dt>Förderung (KfW 458)</dt>
              <dd>{customResult.subsidy > 0 ? `− ${fmtEur(customResult.subsidy)}` : '–'}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-2 border-t pt-1 font-semibold" style={{ borderColor: 'var(--baseline)' }}>
              <dt>Eigenanteil</dt>
              <dd>{fmtEur(customResult.capexNet)}</dd>
            </div>
          </dl>
        </div>
      )}

      <details className="card no-print p-0">
        <summary className="cursor-pointer select-none p-4 text-sm font-semibold">📊 Datenbasis der Rechnung</summary>
        <div className="px-5 pb-5 text-sm">
          <ul className="list-disc space-y-1 pl-5" style={{ color: 'var(--text-secondary)' }}>
            <li>Strom: {inv.power.consumptionKwh.toLocaleString('de-DE')} kWh/a zu {inv.power.pricePerKwhCt.toLocaleString('de-DE')} ct/kWh — aus Zählerständen und aktuellem Vertrag</li>
            <li>Wärme: {inv.heat.sterPerYear} Ster/a à {fmtEur(inv.heat.eurPerSter)} — aus den Forstbetrieb-Rechnungen; entspricht{' '}
              {bundle.settings.house.heatedAreaM2
                ? `${Math.round((inv.heat.sterPerYear * inv.heat.kwhPerSter * inv.heat.oldBoilerEfficiency) / bundle.settings.house.heatedAreaM2)} kWh/m²·a bei ${bundle.settings.house.heatedAreaM2} m²`
                : 'n/a'}{' '}
              — plausibel für teilsanierten Altbau</li>
            <li>Gebäude: Bj. 1889, EG unsaniert (1 m Bruchstein), DG 1998 isoliert → WP mit JAZ {inv.scenarios.heatPump.jaz} (+Struktur-Effekt) konservativ gerechnet</li>
            <li>Familie: Strom- und Warmwasserbedarf je Planungsjahr aus dem Familienmodell (Reiter „Familie & Verbrauch") — Teenager-Peak und Auszug sind eingerechnet, in allen Kombinationen inkl. Status quo</li>
            <li>Smart: hebt PV-Deckungsgrade nur für tatsächlich gewählte Bausteine (WP +{s.smart.wpPvCoverDeltaPp}, WW +{s.smart.wwPvCoverDeltaPp}, Klima +{s.smart.klimaPvCoverDeltaPp} %-Pkt., EV-Quote +{s.smart.selfConsumptionDeltaPp} %-Pkt.) und spart {s.smart.householdSavingsPct} % Haushaltsstrom</li>
            <li>Speicher: {s.battery.cyclesPerYear} Vollzyklen/a, {Math.round((1 - s.battery.efficiency) * 100)} % Verluste — verschiebt Überschuss in den Eigenverbrauch</li>
            <li>Klimaanlage: reiner Komfortbaustein ({s.klima.kwhPerYear} kWh/a Kühlstrom, {s.klima.pvCoverPct} % PV-gedeckt) — kostet, spart nichts</li>
            <li>Eigenarbeit: {inv.heat.ownWorkHoursPerYear} h/a à {fmtEur(inv.heat.ownWorkEurPerHour)} — macht „mehr Komfort" vergleichbar</li>
          </ul>
          <p className="mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>
            Für präzisere Zahlen fehlen noch: <strong>Dachdaten</strong> (→ PVGIS-Ertrag) und{' '}
            <strong>Heizkörper-Vorlauftemperatur</strong> (→ JAZ). Alle Annahmen editierbar in{' '}
            <code>data/investment.json</code>.
          </p>
        </div>
      </details>

      <details className="card no-print p-0">
        <summary className="cursor-pointer select-none p-4 text-sm font-semibold">🏛 Förderung (eingerechnet)</summary>
        <div className="px-5 pb-5 text-sm">
          <p style={{ color: 'var(--text-secondary)' }}>{inv.subsidyNote}</p>
          <p className="mt-3 text-xs" style={{ color: 'var(--critical)' }}>
            ⏳ Der 16-%-Klimageschwindigkeitsbonus sinkt ab Februar 2027 halbjährlich — bei der Heizung
            kostet Warten bares Geld.
          </p>
        </div>
      </details>
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
