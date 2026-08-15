import type { InvestmentSettings, Tier } from './schema'

/**
 * Investitionsrechnung als Baukasten: Waermeerzeuger x PV-Groesse x
 * Warmwasser-System sind frei kombinierbar; jede Kombination wird ueber
 * den Planungshorizont durchgerechnet.
 *
 * Sichten:
 * - Kumulierte Gesamtkosten (CAPEX netto in Jahr 0, dann Betriebskosten
 *   mit Preissteigerung) -> Break-even vs. Status quo.
 * - Aequivalente Jahreskosten (CAPEX als Annuitaet + Ø Betrieb).
 *
 * Qualitaet der Kostenstruktur (tierEffects): guenstige Angebote sparen
 * an Planung/Einbau -> hoehere Wartungs-/Reparaturkosten und bei der WP
 * schlechtere JAZ; Premium umgekehrt. Der Status quo bekommt bewusst
 * KEINE fiktive Ersatzinvestition (wird als Hinweis ausgewiesen).
 */

export type HeatKey = 'bestand' | 'woodNew' | 'pellet' | 'heatPump'
export type WwKey = 'bestand' | 'bwwp' | 'heizstab'

export interface Combo {
  heat: HeatKey
  pvKwp: number
  ww: WwKey
}

export const HEAT_LABEL: Record<HeatKey, string> = {
  bestand: 'Kessel bleibt',
  woodNew: 'Scheitholz neu',
  pellet: 'Pellet',
  heatPump: 'Wärmepumpe',
}

export const WW_LABEL: Record<WwKey, string> = {
  bestand: 'WW wie bisher',
  bwwp: 'Brauchwasser-WP',
  heizstab: 'Heizstab',
}

export const comboKey = (c: Combo): string => `${c.heat}|${c.pvKwp}|${c.ww}`

export function comboLabel(c: Combo): string {
  const parts: string[] = [HEAT_LABEL[c.heat]]
  if (c.pvKwp > 0) parts.push(`PV ${c.pvKwp} kWp`)
  if (c.ww !== 'bestand') parts.push(WW_LABEL[c.ww])
  if (c.heat === 'bestand' && c.pvKwp === 0 && c.ww === 'bestand') return 'Weiter wie bisher'
  return parts.join(' + ')
}

export interface CostBreakdown {
  kapital: number
  energie: number
  betrieb: number
  eigenarbeit: number
}

export interface ComboResult {
  combo: Combo
  key: string
  label: string
  capexGross: number
  subsidy: number
  capexNet: number
  cumulative: number[]
  breakEvenYear: number | null
  horizonSavings: number
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

export function computeCombo(inv: InvestmentSettings, tier: Tier, combo: Combo): ComboResult {
  const H = inv.horizonYears
  const af = annuityFactor(inv.interestRatePct, H)
  const h = inv.heat
  const s = inv.scenarios
  const fx = inv.tierEffects
  const mf = fx.maintenanceFactor[tier]
  const stromCt = inv.power.pricePerKwhCt
  const feedCt = s.pv.feedInCtPerKwh

  const usefulHeatKwh = h.sterPerYear * h.kwhPerSter * h.oldBoilerEfficiency

  // --- Warmwasser-Baustein -------------------------------------------------
  const wwSpec = combo.ww === 'bwwp' ? inv.ww.bwwp : combo.ww === 'heizstab' ? inv.ww.heizstab : null
  const wwCoveredKwh = wwSpec
    ? inv.ww.kwhPerYear * (combo.pvKwp > 0 ? inv.ww.pvCoverPct / 100 : 1)
    : 0
  const wwStromKwh = wwSpec ? wwCoveredKwh / wwSpec.cop : 0
  /** vom Waermeerzeuger noch zu liefernde Waerme */
  const heatNeedKwh = usefulHeatKwh - wwCoveredKwh

  // --- Waermepumpe ---------------------------------------------------------
  const jaz = Math.max(1.5, s.heatPump.jaz + fx.jazDelta[tier])
  const wpStromKwh = combo.heat === 'heatPump' ? heatNeedKwh / jaz : 0
  const wpFromPvKwh =
    combo.heat === 'heatPump' && combo.pvKwp > 0 ? wpStromKwh * (s.pvHeatPump.wpPvCoverPct / 100) : 0

  // --- PV ------------------------------------------------------------------
  const pvCapex = combo.pvKwp * s.pv.capexPerKwp[tier]
  /**
   * PV-Jahreswert (negativ = Ertrag): Eigenverbrauch zu Netzpreis,
   * Ueberschuss zu Einspeisung. `divertedKwh` (WW-Strom aus Ueberschuss)
   * verlaesst die Einspeisung ohne Gutschrift — seine Kosten sind die
   * entgangene Verguetung und werden beim WW-Baustein angesetzt.
   */
  const pvEnergy = (y: number, extraSelfKwh: number, divertedKwh: number): number => {
    if (combo.pvKwp === 0) return 0
    const gen = combo.pvKwp * s.pv.specificYieldKwhPerKwp * Math.pow(1 - s.pv.degradationPctPerYear / 100, y)
    const baseSelf = Math.min(gen * (s.pv.selfConsumptionPct / 100), inv.power.consumptionKwh)
    const self = Math.min(baseSelf + extraSelfKwh, gen)
    const feedIn = Math.max(gen - self - divertedKwh, 0)
    const priceCt = esc(stromCt, inv.escalationPct.strom, y)
    const fCt = esc(feedCt, inv.escalationPct.einspeisung, y)
    return -(self * priceCt + feedIn * fCt) / 100
  }
  const pvOm = (y: number): number =>
    combo.pvKwp === 0
      ? 0
      : (pvCapex * s.pv.omPctOfCapex * mf) / 100 +
        (y + 1 === s.pv.inverterReplaceYear ? s.pv.inverterCostEur : 0)

  // --- CAPEX + Foerderung --------------------------------------------------
  let capexGross = pvCapex + (wwSpec?.capexEur ?? 0)
  let subsidy = 0
  const addHeatCapex = (capex: number, pct: number, cap: number, extra: number) => {
    capexGross += capex
    subsidy += Math.min(capex, cap) * (pct / 100) + extra
  }
  if (combo.heat === 'woodNew')
    addHeatCapex(s.woodNew.capexEur[tier], s.woodNew.subsidyPct, s.woodNew.subsidyCapEur, s.woodNew.subsidyExtraEur)
  if (combo.heat === 'pellet')
    addHeatCapex(s.pellet.capexEur[tier], s.pellet.subsidyPct, s.pellet.subsidyCapEur, s.pellet.subsidyExtraEur)
  if (combo.heat === 'heatPump')
    addHeatCapex(s.heatPump.capexEur[tier], s.heatPump.subsidyPct, s.heatPump.subsidyCapEur, s.heatPump.subsidyExtraEur)
  const capexNet = capexGross - subsidy

  // --- Jahreskosten --------------------------------------------------------
  const yearCosts = (y: number): CostBreakdown => {
    const priceCt = esc(stromCt, inv.escalationPct.strom, y)
    let energie = 0
    let betrieb = 0
    let eigenarbeit = 0

    switch (combo.heat) {
      case 'bestand':
        energie += (heatNeedKwh / (h.kwhPerSter * h.oldBoilerEfficiency)) * esc(h.eurPerSter, inv.escalationPct.holz, y)
        betrieb += h.maintenanceOldEur + h.kaminkehrerEur
        eigenarbeit += h.ownWorkHoursPerYear * h.ownWorkEurPerHour
        break
      case 'woodNew':
        energie += (heatNeedKwh / (h.kwhPerSter * s.woodNew.efficiency)) * esc(h.eurPerSter, inv.escalationPct.holz, y)
        betrieb += s.woodNew.maintenanceEur * mf + s.woodNew.kaminkehrerEur
        eigenarbeit += h.ownWorkHoursPerYear * s.woodNew.ownWorkFactor * h.ownWorkEurPerHour
        break
      case 'pellet':
        energie += (heatNeedKwh / (s.pellet.efficiency * s.pellet.kwhPerKg) / 1000) * esc(s.pellet.eurPerTon, inv.escalationPct.pellet, y)
        betrieb += s.pellet.maintenanceEur * mf + s.pellet.kaminkehrerEur
        eigenarbeit += s.pellet.ownWorkHoursPerYear * h.ownWorkEurPerHour
        break
      case 'heatPump':
        energie += ((wpStromKwh - wpFromPvKwh) * priceCt) / 100
        betrieb += s.heatPump.maintenanceEur * mf + s.heatPump.kaminkehrerEur
        break
    }

    if (wwSpec) {
      // WW-Strom: aus PV-Ueberschuss zu Opportunitaetskosten, sonst Netz
      const ct = combo.pvKwp > 0 ? esc(feedCt, inv.escalationPct.einspeisung, y) : priceCt
      energie += (wwStromKwh * ct) / 100
    }
    energie += pvEnergy(y, wpFromPvKwh, wwSpec && combo.pvKwp > 0 ? wwStromKwh : 0)
    betrieb += pvOm(y)

    return { kapital: 0, energie, betrieb, eigenarbeit }
  }

  const cumulative: number[] = [capexNet]
  const avg: CostBreakdown = { kapital: capexNet * af, energie: 0, betrieb: 0, eigenarbeit: 0 }
  for (let y = 0; y < H; y++) {
    const c = yearCosts(y)
    cumulative.push(cumulative[y] + c.energie + c.betrieb + c.eigenarbeit)
    avg.energie += c.energie / H
    avg.betrieb += c.betrieb / H
    avg.eigenarbeit += c.eigenarbeit / H
  }

  return {
    combo,
    key: comboKey(combo),
    label: comboLabel(combo),
    capexGross,
    subsidy,
    capexNet,
    cumulative,
    breakEvenYear: null,
    horizonSavings: 0,
    equivalentAnnualCost: avg.kapital + avg.energie + avg.betrieb + avg.eigenarbeit,
    breakdown: avg,
  }
}

export const STATUS_QUO: Combo = { heat: 'bestand', pvKwp: 0, ww: 'bestand' }

/** kuratierte Vergleichs-Kombinationen */
export const PRESETS: Combo[] = [
  { heat: 'woodNew', pvKwp: 0, ww: 'bestand' },
  { heat: 'pellet', pvKwp: 0, ww: 'bestand' },
  { heat: 'heatPump', pvKwp: 0, ww: 'bestand' },
  { heat: 'bestand', pvKwp: 15, ww: 'bestand' },
  { heat: 'heatPump', pvKwp: 15, ww: 'bestand' },
  { heat: 'pellet', pvKwp: 15, ww: 'bwwp' },
]

/** Break-even und Horizont-Ersparnis relativ zum Status quo setzen */
export function attachComparison(base: ComboResult, results: ComboResult[]): void {
  const H = base.cumulative.length - 1
  for (const r of results) {
    if (r.key === base.key) continue
    r.horizonSavings = base.cumulative[H] - r.cumulative[H]
    r.breakEvenYear = null
    for (let y = 1; y <= H; y++) {
      if (r.cumulative[y] < base.cumulative[y]) {
        r.breakEvenYear = y
        break
      }
    }
  }
}
