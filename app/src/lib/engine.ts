import type { Category, DataBundle, Invoice, Reading, Settings } from './schema'
import { CATEGORIES } from './schema'

/**
 * Periodisierungs-Engine.
 *
 * Grundsatz: Zahlung ist nicht Verbrauch. Kosten werden dem Zeitraum
 * zugeordnet, in dem sie *entstanden* sind — nicht dem Zahlungsdatum:
 *
 * - Abrechnungen werden ueber ihren Leistungszeitraum verteilt und
 *   verdraengen Abschlaege derselben Kategorie in diesem Zeitraum.
 * - Waermekosten (Holz) werden mit Gradtagzahlen gewichtet — ein Winter-
 *   monat traegt ein Vielfaches eines Sommermonats.
 * - Holzeinkaeufe gehen ins Lager und werden ab Kaufdatum ueber
 *   `woodSpreadMonths` Monate heizlastgewichtet aufgeloest.
 */

const DAY_MS = 86_400_000

/** Kategorien, deren Kosten der Heizlast folgen */
const HEATING_CATEGORIES: ReadonlySet<Category> = new Set(['holz'])

export type MonthKey = string // "YYYY-MM"

export interface MonthlyCosts {
  /** Monat -> Kategorie -> periodisierte Kosten in EUR */
  months: Map<MonthKey, Record<Category, number>>
  /** sortierte Liste aller Monate mit Daten */
  keys: MonthKey[]
}

const toDay = (iso: string): number => Date.parse(iso + 'T00:00:00Z') / DAY_MS

const dayToDate = (day: number): Date => new Date(day * DAY_MS)

export const monthKeyOf = (d: Date): MonthKey =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`

const daysInMonth = (year: number, month0: number): number =>
  new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate()

/** Tagesgewicht: gleichverteilt oder heizlastgewichtet (hddProfile) */
function dayWeight(day: number, heating: boolean, settings: Settings): number {
  if (!heating) return 1
  const d = dayToDate(day)
  return settings.hddProfile[d.getUTCMonth()] / daysInMonth(d.getUTCFullYear(), d.getUTCMonth())
}

function addMonths(iso: string, months: number): number {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCMonth(d.getUTCMonth() + months)
  return d.getTime() / DAY_MS
}

/**
 * Verteilt einen Beleg auf Tage und liefert (Tag -> EUR).
 * `covered` sind Tage, die fuer die Kategorie bereits durch eine
 * Abrechnung abgedeckt sind (Abschlaege zaehlen dort nicht).
 */
function allocateInvoice(
  inv: Invoice,
  settings: Settings,
  covered: ReadonlySet<number>,
): Map<number, number> {
  const heating = HEATING_CATEGORIES.has(inv.category)
  let start: number
  let end: number

  if (inv.kind === 'einkauf') {
    start = toDay(inv.date)
    end = addMonths(inv.date, settings.woodSpreadMonths) - 1
  } else if (inv.periodStart && inv.periodEnd) {
    start = toDay(inv.periodStart)
    end = toDay(inv.periodEnd)
  } else {
    start = end = toDay(inv.date)
  }

  const weights = new Map<number, number>()
  let total = 0
  for (let day = start; day <= end; day++) {
    if (inv.kind === 'abschlag' && covered.has(day)) continue
    const w = dayWeight(day, heating || inv.kind === 'einkauf', settings)
    if (w <= 0) continue
    weights.set(day, w)
    total += w
  }
  const out = new Map<number, number>()
  if (total === 0) return out // Abschlag vollstaendig durch Abrechnung verdraengt
  for (const [day, w] of weights) out.set(day, (w / total) * inv.amountEur)
  return out
}

export function computeMonthlyCosts(bundle: DataBundle): MonthlyCosts {
  const { invoices, settings } = bundle

  // Von Abrechnungen abgedeckte Tage je Kategorie
  const coveredByCategory = new Map<Category, Set<number>>()
  for (const inv of invoices) {
    if (inv.kind !== 'abrechnung' || !inv.periodStart || !inv.periodEnd) continue
    let set = coveredByCategory.get(inv.category)
    if (!set) coveredByCategory.set(inv.category, (set = new Set()))
    for (let d = toDay(inv.periodStart); d <= toDay(inv.periodEnd); d++) set.add(d)
  }

  const months = new Map<MonthKey, Record<Category, number>>()
  const emptyRecord = (): Record<Category, number> =>
    Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>

  for (const inv of invoices) {
    const covered = coveredByCategory.get(inv.category) ?? new Set<number>()
    for (const [day, eur] of allocateInvoice(inv, settings, covered)) {
      const key = monthKeyOf(dayToDate(day))
      let rec = months.get(key)
      if (!rec) months.set(key, (rec = emptyRecord()))
      rec[inv.category] += eur
    }
  }

  const keys = [...months.keys()].sort()
  return { months, keys }
}

export const totalOfMonth = (rec: Record<Category, number>): number =>
  CATEGORIES.reduce((s, c) => s + rec[c], 0)

// ---------------------------------------------------------------------------
// Verbrauch aus Zaehlerstaenden (lineare Interpolation zwischen Ablesungen)
// ---------------------------------------------------------------------------

export interface YearlyConsumption {
  year: number
  value: number
  /** true, wenn Jahresanfang und -ende zwischen echten Ablesungen interpoliert wurden */
  complete: boolean
}

/**
 * Jahresverbrauch je Zaehlertyp: pro Zaehler wird zwischen Ablesungen linear
 * interpoliert und der Anteil je Kalenderjahr summiert. Mehrere Zaehler
 * desselben Typs (Zaehlertausch!) werden addiert; `complete` ist ein Jahr
 * erst, wenn die Ablesungen es lueckenlos abdecken.
 */
export function yearlyConsumption(readings: Reading[], type: Reading['type']): YearlyConsumption[] {
  const byMeter = new Map<string, Reading[]>()
  for (const r of readings) {
    if (r.type !== type) continue
    const list = byMeter.get(r.meter) ?? []
    list.push(r)
    byMeter.set(r.meter, list)
  }

  const perYear = new Map<number, { value: number; coveredDays: number }>()
  for (const list of byMeter.values()) {
    const rs = [...list].sort((a, b) => a.date.localeCompare(b.date))
    if (rs.length < 2) continue
    const first = toDay(rs[0].date)
    const last = toDay(rs[rs.length - 1].date)
    const interp = (day: number): number => {
      for (let i = 1; i < rs.length; i++) {
        const a = toDay(rs[i - 1].date)
        const b = toDay(rs[i].date)
        if (day >= a && day <= b) {
          const t = b === a ? 0 : (day - a) / (b - a)
          return rs[i - 1].value + t * (rs[i].value - rs[i - 1].value)
        }
      }
      return rs[rs.length - 1].value
    }
    const firstYear = dayToDate(first).getUTCFullYear()
    const lastYear = dayToDate(last).getUTCFullYear()
    for (let y = firstYear; y <= lastYear; y++) {
      const a = Math.max(first, toDay(`${y}-01-01`))
      const b = Math.min(last, toDay(`${y + 1}-01-01`))
      if (b <= a) continue
      const agg = perYear.get(y) ?? { value: 0, coveredDays: 0 }
      agg.value += interp(b) - interp(a)
      agg.coveredDays += b - a
      perYear.set(y, agg)
    }
  }

  return [...perYear.entries()]
    .sort(([a], [b]) => a - b)
    .map(([year, agg]) => {
      const daysInYear = toDay(`${year + 1}-01-01`) - toDay(`${year}-01-01`)
      return { year, value: agg.value, complete: agg.coveredDays >= daysInYear }
    })
}

// ---------------------------------------------------------------------------
// Auswertungen fuer Dashboard-KPIs
// ---------------------------------------------------------------------------

export interface YearSummary {
  year: number
  total: number
  perCategory: Record<Category, number>
  /** Anzahl Monate des Jahres mit zugeordneten Kosten */
  monthsWithData: number
  avgPerMonth: number
}

export function summarizeYear(mc: MonthlyCosts, year: number): YearSummary {
  const perCategory = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>
  let total = 0
  let monthsWithData = 0
  for (const key of mc.keys) {
    if (!key.startsWith(String(year))) continue
    const rec = mc.months.get(key)!
    const t = totalOfMonth(rec)
    if (t > 0.005) monthsWithData++
    total += t
    for (const c of CATEGORIES) perCategory[c] += rec[c]
  }
  return {
    year,
    total,
    perCategory,
    monthsWithData,
    avgPerMonth: monthsWithData ? total / monthsWithData : 0,
  }
}

export const yearsWithData = (mc: MonthlyCosts): number[] =>
  [...new Set(mc.keys.map((k) => Number(k.slice(0, 4))))].sort()

export const fmtEur = (v: number, digits = 0): string =>
  v.toLocaleString('de-DE', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
