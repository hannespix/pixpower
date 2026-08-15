import type { InvestmentSettings, Tier } from './schema'

/**
 * Investitionsrechnung als Baukasten: Waermeerzeuger x PV-Groesse x Speicher x
 * Warmwasser-System x Klimaanlage sind frei kombinierbar; jede Kombination
 * wird ueber den Planungshorizont durchgerechnet.
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
 *
 * PriceOverrides: jeder CAPEX-Einzelposten kann mit dem Preis eines echten
 * Angebots ueberschrieben werden (Regler im UI); ohne Override gilt der
 * Marktwert der gewaehlten Kostenstruktur.
 */

export type HeatKey = 'bestand' | 'woodNew' | 'pellet' | 'heatPump'
export type WwKey = 'bestand' | 'bwwp' | 'heizstab'

export interface Combo {
  heat: HeatKey
  pvKwp: number
  /** nur wirksam mit PV > 0 */
  batteryKwh: number
  ww: WwKey
  /** Multisplit fuer die Schlafzimmer im OG — reiner Komfortbaustein */
  klima: boolean
}

/** Angebotspreise, die die Marktwerte der Kostenstruktur ersetzen */
export interface PriceOverrides {
  heatCapexEur?: number
  pvEurPerKwp?: number
  batteryEurPerKwh?: number
  wwCapexEur?: number
  klimaCapexEur?: number
  elektroCapexEur?: number
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

export const comboKey = (c: Combo): string =>
  `${c.heat}|${c.pvKwp}|${c.pvKwp > 0 ? c.batteryKwh : 0}|${c.ww}|${c.klima ? 'K' : '-'}`

export function comboLabel(c: Combo): string {
  const parts: string[] = [HEAT_LABEL[c.heat]]
  if (c.pvKwp > 0) parts.push(`PV ${c.pvKwp} kWp`)
  if (c.pvKwp > 0 && c.batteryKwh > 0) parts.push(`Speicher ${c.batteryKwh} kWh`)
  if (c.ww !== 'bestand') parts.push(WW_LABEL[c.ww])
  if (c.klima) parts.push('Klima')
  if (c.heat === 'bestand' && c.pvKwp === 0 && c.ww === 'bestand' && !c.klima) return 'Weiter wie bisher'
  return parts.join(' + ')
}

export interface CostBreakdown {
  kapital: number
  energie: number
  betrieb: number
  eigenarbeit: number
}

export interface CapexItem {
  key: keyof PriceOverrides
  label: string
  eur: number
  overridden: boolean
}

export interface ComboResult {
  combo: Combo
  key: string
  label: string
  capexGross: number
  subsidy: number
  capexNet: number
  /** Einzelposten der Investition (fuer die Regler-Anzeige) */
  capexItems: CapexItem[]
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

export function computeCombo(
  inv: InvestmentSettings,
  tier: Tier,
  combo: Combo,
  ov: PriceOverrides = {},
): ComboResult {
  const H = inv.horizonYears
  const af = annuityFactor(inv.interestRatePct, H)
  const h = inv.heat
  const s = inv.scenarios
  const fx = inv.tierEffects
  const mf = fx.maintenanceFactor[tier]
  const stromCt = inv.power.pricePerKwhCt
  const feedCt = s.pv.feedInCtPerKwh
  const battKwh = combo.pvKwp > 0 ? combo.batteryKwh : 0

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

  // --- Klimaanlage (Komfort) ----------------------------------------------
  const klimaKwh = combo.klima ? s.klima.kwhPerYear : 0
  const klimaPvKwh = combo.klima && combo.pvKwp > 0 ? klimaKwh * (s.klima.pvCoverPct / 100) : 0

  // --- PV + Speicher -------------------------------------------------------
  const pvPerKwp = ov.pvEurPerKwp ?? s.pv.capexPerKwp[tier]
  const pvCapex = combo.pvKwp * pvPerKwp
  const battCapex = battKwh * (ov.batteryEurPerKwh ?? s.battery.capexPerKwh[tier])
  /**
   * PV-Jahreswert (negativ = Ertrag): Eigenverbrauch zu Netzpreis,
   * Ueberschuss zu Einspeisung. `divertedKwh` (WW-/Klima-Strom aus
   * Ueberschuss) verlaesst die Einspeisung ohne Gutschrift — seine Kosten
   * sind die entgangene Verguetung und werden beim jeweiligen Baustein
   * angesetzt. Der Speicher verschiebt weiteren Ueberschuss in den
   * Eigenverbrauch (Zyklen- und Verlust-begrenzt).
   */
  const pvEnergy = (y: number, extraSelfKwh: number, divertedKwh: number): number => {
    if (combo.pvKwp === 0) return 0
    const gen = combo.pvKwp * s.pv.specificYieldKwhPerKwp * Math.pow(1 - s.pv.degradationPctPerYear / 100, y)
    const baseSelf = Math.min(gen * (s.pv.selfConsumptionPct / 100), inv.power.consumptionKwh)
    const self = Math.min(baseSelf + extraSelfKwh, gen)
    let surplus = Math.max(gen - self - divertedKwh, 0)
    const remainingGridKwh = Math.max(inv.power.consumptionKwh - baseSelf, 0)
    const battIn = Math.min(
      (battKwh * s.battery.cyclesPerYear) / s.battery.efficiency,
      surplus,
      remainingGridKwh / s.battery.efficiency,
    )
    const battOut = battIn * s.battery.efficiency
    surplus -= battIn
    const priceCt = esc(stromCt, inv.escalationPct.strom, y)
    const fCt = esc(feedCt, inv.escalationPct.einspeisung, y)
    return -((self + battOut) * priceCt + surplus * fCt) / 100
  }
  const pvOm = (y: number): number =>
    combo.pvKwp === 0
      ? 0
      : (pvCapex * s.pv.omPctOfCapex * mf) / 100 +
        (y + 1 === s.pv.inverterReplaceYear ? s.pv.inverterCostEur : 0)

  // --- CAPEX + Foerderung --------------------------------------------------
  const items: CapexItem[] = []
  const addItem = (key: keyof PriceOverrides, label: string, eur: number) => {
    if (eur > 0) items.push({ key, label, eur, overridden: ov[key] !== undefined })
  }
  let subsidy = 0
  const heatSpec =
    combo.heat === 'woodNew' ? s.woodNew : combo.heat === 'pellet' ? s.pellet : combo.heat === 'heatPump' ? s.heatPump : null
  if (heatSpec) {
    const capex = ov.heatCapexEur ?? heatSpec.capexEur[tier]
    addItem('heatCapexEur', heatSpec.label, capex)
    subsidy += Math.min(capex, heatSpec.subsidyCapEur) * (heatSpec.subsidyPct / 100) + heatSpec.subsidyExtraEur
  }
  addItem('pvEurPerKwp', `${s.pv.label} ${combo.pvKwp} kWp`, pvCapex)
  addItem('batteryEurPerKwh', `${s.battery.label} ${battKwh} kWh`, battCapex)
  if (wwSpec) addItem('wwCapexEur', WW_LABEL[combo.ww], ov.wwCapexEur ?? wwSpec.capexEur)
  if (combo.klima) addItem('klimaCapexEur', s.klima.label, ov.klimaCapexEur ?? s.klima.capexEur[tier])
  /** Zaehlerschrank & Co. — einmal, sobald irgendein Elektro-Baustein kommt */
  const needsElektro = combo.pvKwp > 0 || combo.heat === 'heatPump' || battKwh > 0 || combo.klima
  if (needsElektro) addItem('elektroCapexEur', s.elektro.label, ov.elektroCapexEur ?? s.elektro.capexEur[tier])

  const capexGross = items.reduce((sum, i) => sum + i.eur, 0)
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
    if (combo.klima) {
      // PV-gedeckter Kuehlstrom zu Opportunitaetskosten, Rest aus dem Netz
      const fCt = esc(feedCt, inv.escalationPct.einspeisung, y)
      energie += (klimaPvKwh * fCt + (klimaKwh - klimaPvKwh) * priceCt) / 100
      betrieb += s.klima.maintenanceEur * mf
    }
    energie += pvEnergy(y, wpFromPvKwh, (wwSpec && combo.pvKwp > 0 ? wwStromKwh : 0) + klimaPvKwh)
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
    capexItems: items,
    cumulative,
    breakEvenYear: null,
    horizonSavings: 0,
    equivalentAnnualCost: avg.kapital + avg.energie + avg.betrieb + avg.eigenarbeit,
    breakdown: avg,
  }
}

export const STATUS_QUO: Combo = { heat: 'bestand', pvKwp: 0, batteryKwh: 0, ww: 'bestand', klima: false }

/** kuratierte Vergleichs-Kombinationen */
export const PRESETS: Combo[] = [
  { heat: 'woodNew', pvKwp: 0, batteryKwh: 0, ww: 'bestand', klima: false },
  { heat: 'pellet', pvKwp: 0, batteryKwh: 0, ww: 'bestand', klima: false },
  { heat: 'heatPump', pvKwp: 0, batteryKwh: 0, ww: 'bestand', klima: false },
  { heat: 'bestand', pvKwp: 15, batteryKwh: 0, ww: 'bestand', klima: false },
  { heat: 'heatPump', pvKwp: 15, batteryKwh: 10, ww: 'bestand', klima: false },
  { heat: 'pellet', pvKwp: 15, batteryKwh: 0, ww: 'bwwp', klima: false },
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
