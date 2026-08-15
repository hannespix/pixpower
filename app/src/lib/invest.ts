import type { InvestmentSettings, Tier } from './schema'

/**
 * Investitionsrechnung: Szenarienvergleich ueber den Planungshorizont.
 *
 * Zwei Sichten auf dieselben Zahlen:
 * - Kumulierte Gesamtkosten (CAPEX netto in Jahr 0, dann Betriebskosten mit
 *   Preissteigerung) -> Break-even = Jahr, ab dem ein Szenario guenstiger
 *   ist als der Status quo.
 * - Aequivalente Jahreskosten: CAPEX als Annuitaet (Zins, Horizont) plus
 *   mittlere Betriebskosten -> vergleichbare EUR/Jahr-Groesse.
 *
 * Der Status quo bekommt bewusst KEINE fiktive Ersatzinvestition — dass der
 * 28 Jahre alte Kessel real nicht 20 weitere Jahre laeuft, wird als Hinweis
 * ausgewiesen statt still eingerechnet.
 */

export type ScenarioKey = 'statusQuo' | 'woodNew' | 'pellet' | 'heatPump' | 'pv' | 'pvHeatPump'

export interface CostBreakdown {
  kapital: number
  energie: number
  betrieb: number
  eigenarbeit: number
}

export interface ScenarioResult {
  key: ScenarioKey
  label: string
  capexGross: number
  subsidy: number
  capexNet: number
  /** Kosten je Jahr (Index 0 = erstes Betriebsjahr), ohne CAPEX */
  annualCosts: number[]
  /** kumulierte Gesamtkosten inkl. CAPEX netto, Index 0..horizon */
  cumulative: number[]
  /** erstes Jahr (1-basiert), in dem kumulierte Kosten < Status quo; null = nie */
  breakEvenYear: number | null
  /** Ersparnis ueber den Horizont vs. Status quo (positiv = guenstiger) */
  horizonSavings: number
  /** aequivalente Jahreskosten (Annuitaet + Ø Betrieb) */
  equivalentAnnualCost: number
  breakdown: CostBreakdown
}

const esc = (base: number, pctPerYear: number, year: number): number =>
  base * Math.pow(1 + pctPerYear / 100, year)

const annuityFactor = (ratePct: number, years: number): number => {
  const r = ratePct / 100
  if (r === 0) return 1 / years
  return (r * Math.pow(1 + r, years)) / (Math.pow(1 + r, years) - 1)
}

const subsidyOf = (capex: number, pct: number, cap: number, extra: number): number =>
  Math.min(capex, cap) * (pct / 100) + extra

export function computeScenarios(inv: InvestmentSettings, tier: Tier, pvKwp?: number): ScenarioResult[] {
  const H = inv.horizonYears
  const af = annuityFactor(inv.interestRatePct, H)
  const h = inv.heat
  const s = inv.scenarios

  /** heute gelieferte Nutzwaerme (bleibt in allen Szenarien konstant) */
  const usefulHeatKwh = h.sterPerYear * h.kwhPerSter * h.oldBoilerEfficiency
  const stromCt = inv.power.pricePerKwhCt

  interface Spec {
    key: ScenarioKey
    label: string
    capexGross: number
    subsidy: number
    /** Betriebskosten des Jahres y (0-basiert) als Aufschluesselung */
    year: (y: number) => CostBreakdown & { extra?: number }
  }

  const kwp = pvKwp ?? s.pv.kwp
  const pvCapex = kwp * s.pv.capexPerKwp[tier]
  const pvYield = (y: number) =>
    kwp * s.pv.specificYieldKwhPerKwp * Math.pow(1 - s.pv.degradationPctPerYear / 100, y)

  /** PV-Jahresrechnung: negative Betriebskosten = Ertrag */
  const pvEnergy = (y: number, extraSelfKwh = 0): number => {
    const gen = pvYield(y)
    const baseSelf = Math.min(gen * (s.pv.selfConsumptionPct / 100), inv.power.consumptionKwh)
    const self = Math.min(baseSelf + extraSelfKwh, gen)
    const feedIn = Math.max(gen - self, 0)
    const priceCt = esc(stromCt, inv.escalationPct.strom, y)
    const feedCt = esc(s.pv.feedInCtPerKwh, inv.escalationPct.einspeisung, y)
    return -(self * priceCt + feedIn * feedCt) / 100
  }
  const pvOm = (y: number): number =>
    (pvCapex * s.pv.omPctOfCapex) / 100 + (y + 1 === s.pv.inverterReplaceYear ? s.pv.inverterCostEur : 0)

  const holzCost = (ster: number, y: number) => ster * esc(h.eurPerSter, inv.escalationPct.holz, y)
  const eigenarbeit = (hours: number) => hours * h.ownWorkEurPerHour

  const wpStromKwh = usefulHeatKwh / s.heatPump.jaz

  const specs: Spec[] = [
    {
      key: 'statusQuo',
      label: 'Weiter wie bisher',
      capexGross: 0,
      subsidy: 0,
      year: (y) => ({
        kapital: 0,
        energie: holzCost(h.sterPerYear, y),
        betrieb: h.maintenanceOldEur + h.kaminkehrerEur,
        eigenarbeit: eigenarbeit(h.ownWorkHoursPerYear),
      }),
    },
    {
      key: 'woodNew',
      label: s.woodNew.label,
      capexGross: s.woodNew.capexEur[tier],
      subsidy: subsidyOf(s.woodNew.capexEur[tier], s.woodNew.subsidyPct, s.woodNew.subsidyCapEur, s.woodNew.subsidyExtraEur),
      year: (y) => ({
        kapital: 0,
        energie: holzCost(usefulHeatKwh / (h.kwhPerSter * s.woodNew.efficiency), y),
        betrieb: s.woodNew.maintenanceEur + s.woodNew.kaminkehrerEur,
        eigenarbeit: eigenarbeit(h.ownWorkHoursPerYear * s.woodNew.ownWorkFactor),
      }),
    },
    {
      key: 'pellet',
      label: s.pellet.label,
      capexGross: s.pellet.capexEur[tier],
      subsidy: subsidyOf(s.pellet.capexEur[tier], s.pellet.subsidyPct, s.pellet.subsidyCapEur, s.pellet.subsidyExtraEur),
      year: (y) => {
        const tons = usefulHeatKwh / (s.pellet.efficiency * s.pellet.kwhPerKg) / 1000
        return {
          kapital: 0,
          energie: tons * esc(s.pellet.eurPerTon, inv.escalationPct.pellet, y),
          betrieb: s.pellet.maintenanceEur + s.pellet.kaminkehrerEur,
          eigenarbeit: eigenarbeit(s.pellet.ownWorkHoursPerYear),
        }
      },
    },
    {
      key: 'heatPump',
      label: s.heatPump.label,
      capexGross: s.heatPump.capexEur[tier],
      subsidy: subsidyOf(s.heatPump.capexEur[tier], s.heatPump.subsidyPct, s.heatPump.subsidyCapEur, s.heatPump.subsidyExtraEur),
      year: (y) => ({
        kapital: 0,
        energie: (wpStromKwh * esc(stromCt, inv.escalationPct.strom, y)) / 100,
        betrieb: s.heatPump.maintenanceEur + s.heatPump.kaminkehrerEur,
        eigenarbeit: 0,
      }),
    },
    {
      key: 'pv',
      label: `${s.pv.label} ${kwp} kWp`,
      capexGross: pvCapex,
      subsidy: 0,
      year: (y) => ({
        kapital: 0,
        // PV ersetzt keine Heizung: Holzkosten laufen weiter
        energie: holzCost(h.sterPerYear, y) + pvEnergy(y),
        betrieb: h.maintenanceOldEur + h.kaminkehrerEur + pvOm(y),
        eigenarbeit: eigenarbeit(h.ownWorkHoursPerYear),
      }),
    },
    {
      key: 'pvHeatPump',
      label: `PV ${kwp} kWp + ${s.heatPump.label}`,
      capexGross: pvCapex + s.heatPump.capexEur[tier],
      subsidy: subsidyOf(s.heatPump.capexEur[tier], s.heatPump.subsidyPct, s.heatPump.subsidyCapEur, s.heatPump.subsidyExtraEur),
      year: (y) => {
        const wpFromPv = wpStromKwh * (s.pvHeatPump.wpPvCoverPct / 100)
        const wpFromGrid = wpStromKwh - wpFromPv
        return {
          kapital: 0,
          energie: (wpFromGrid * esc(stromCt, inv.escalationPct.strom, y)) / 100 + pvEnergy(y, wpFromPv),
          betrieb: s.heatPump.maintenanceEur + s.heatPump.kaminkehrerEur + pvOm(y),
          eigenarbeit: 0,
        }
      },
    },
  ]

  const results: ScenarioResult[] = specs.map((spec) => {
    const capexNet = spec.capexGross - spec.subsidy
    const annualCosts: number[] = []
    const cumulative: number[] = [capexNet]
    const avg: CostBreakdown = { kapital: capexNet * af, energie: 0, betrieb: 0, eigenarbeit: 0 }
    for (let y = 0; y < H; y++) {
      const c = spec.year(y)
      const total = c.energie + c.betrieb + c.eigenarbeit
      annualCosts.push(total)
      cumulative.push(cumulative[y] + total)
      avg.energie += c.energie / H
      avg.betrieb += c.betrieb / H
      avg.eigenarbeit += c.eigenarbeit / H
    }
    return {
      key: spec.key,
      label: spec.label,
      capexGross: spec.capexGross,
      subsidy: spec.subsidy,
      capexNet,
      annualCosts,
      cumulative,
      breakEvenYear: null,
      horizonSavings: 0,
      equivalentAnnualCost: avg.kapital + avg.energie + avg.betrieb + avg.eigenarbeit,
      breakdown: avg,
    }
  })

  const base = results[0]
  for (const r of results) {
    if (r.key === 'statusQuo') continue
    r.horizonSavings = base.cumulative[H] - r.cumulative[H]
    for (let y = 1; y <= H; y++) {
      if (r.cumulative[y] < base.cumulative[y]) {
        r.breakEvenYear = y
        break
      }
    }
  }
  return results
}
