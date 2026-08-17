import type { Category, DataBundle, Invoice, Reading, Settings } from './schema'
import { CATEGORIES, CATEGORY_LABEL } from './schema'

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
  /** Monat -> Kategorie -> periodisierte Kosten in EUR (belegt) */
  months: Map<MonthKey, Record<Category, number>>
  /**
   * Monat -> Kategorie -> geschaetzte Kosten fuer Beleg-Luecken.
   * Nur Luecken INNERHALB der belegten Spanne einer Kategorie werden
   * gefuellt (keine Extrapolation), mit dem Tagessatz der angrenzenden
   * belegten Zeitraeume (linear interpoliert, bei Waerme HDD-gewichtet).
   */
  estimated: Map<MonthKey, Record<Category, number>>
  /** sortierte Liste aller Monate mit Daten (belegt oder geschaetzt) */
  keys: MonthKey[]
  /** erkannte Beleg-Luecken (Basis der Schaetzung und der Daten-Wunschliste) */
  gaps: GapInfo[]
}

export interface GapInfo {
  category: Category
  /** ISO-Daten der Luecke (inklusive) */
  start: string
  end: string
  /** geschaetzte Kosten der Luecke */
  estimatedEur: number
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

const emptyRecord = (): Record<Category, number> =>
  Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>

/** Kategorien mit laufendem Verbrauch — nur dort ist eine Beleg-Luecke ein Datenloch */
const CONTINUOUS_CATEGORIES: readonly Category[] = ['strom', 'wasser', 'abwasser', 'holz']

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

  // Tagesgenaue Zuordnung je Kategorie — Basis fuer Monatswerte UND Luecken-Erkennung.
  // Abdeckung zaehlt auch Tage, deren Abschlag durch eine Abrechnung verdraengt
  // wurde (die Abrechnung deckt sie ja ab).
  const perDay = new Map<Category, Map<number, number>>()
  for (const inv of invoices) {
    const covered = coveredByCategory.get(inv.category) ?? new Set<number>()
    let dayMap = perDay.get(inv.category)
    if (!dayMap) perDay.set(inv.category, (dayMap = new Map()))
    for (const [day, eur] of allocateInvoice(inv, settings, covered)) {
      dayMap.set(day, (dayMap.get(day) ?? 0) + eur)
    }
  }
  for (const [cat, set] of coveredByCategory) {
    const dayMap = perDay.get(cat)!
    for (const d of set) if (!dayMap.has(d)) dayMap.set(d, 0)
  }

  const months = new Map<MonthKey, Record<Category, number>>()
  for (const [cat, dayMap] of perDay) {
    for (const [day, eur] of dayMap) {
      const key = monthKeyOf(dayToDate(day))
      let rec = months.get(key)
      if (!rec) months.set(key, (rec = emptyRecord()))
      rec[cat] += eur
    }
  }

  const { estimated, gaps } = estimateGaps(perDay, settings)

  const keys = [...new Set([...months.keys(), ...estimated.keys()])].sort()
  return { months, estimated, keys, gaps }
}

/**
 * Fuellt Beleg-Luecken innerhalb der belegten Spanne einer Kategorie.
 *
 * Fuer jede zusammenhaengende Luecke wird der Kostensatz (EUR je
 * Gewichtseinheit: Tag bzw. HDD-Tagesgewicht bei Waerme) der angrenzenden
 * belegten Zeitraeume ermittelt (Fenster bis 120 Tage) und ueber die Luecke
 * linear interpoliert — Preisaenderungen vor/nach der Luecke fliessen so ein.
 * Keine Extrapolation vor den ersten oder nach den letzten Beleg.
 */
function estimateGaps(
  perDay: ReadonlyMap<Category, Map<number, number>>,
  settings: Settings,
): { estimated: Map<MonthKey, Record<Category, number>>; gaps: GapInfo[] } {
  const estimated = new Map<MonthKey, Record<Category, number>>()
  const gaps: GapInfo[] = []
  const WINDOW = 120
  const iso = (day: number): string => dayToDate(day).toISOString().slice(0, 10)

  for (const cat of CONTINUOUS_CATEGORIES) {
    const dayMap = perDay.get(cat)
    if (!dayMap || dayMap.size < 2) continue
    const heating = HEATING_CATEGORIES.has(cat)
    const days = [...dayMap.keys()].sort((a, b) => a - b)
    const first = days[0]
    const last = days[days.length - 1]

    const rateAround = (from: number, to: number): number | null => {
      let cost = 0
      let weight = 0
      for (let d = from; d <= to; d++) {
        const eur = dayMap.get(d)
        if (eur === undefined) continue
        cost += eur
        weight += dayWeight(d, heating, settings)
      }
      return weight > 0 ? cost / weight : null
    }

    let gapStart: number | null = null
    for (let d = first; d <= last + 1; d++) {
      const isCovered = d <= last && dayMap.has(d)
      if (!isCovered && d <= last) {
        gapStart ??= d
        continue
      }
      if (gapStart === null) continue
      const a = gapStart
      const b = d - 1
      gapStart = null
      const before = rateAround(a - WINDOW, a - 1)
      const after = rateAround(b + 1, b + WINDOW)
      if (before === null && after === null) continue
      let gapEur = 0
      for (let g = a; g <= b; g++) {
        const t = (g - a + 0.5) / (b - a + 1)
        const rate =
          before !== null && after !== null ? before * (1 - t) + after * t : (before ?? after)!
        const eur = rate * dayWeight(g, heating, settings)
        if (eur <= 0) continue
        gapEur += eur
        const key = monthKeyOf(dayToDate(g))
        let rec = estimated.get(key)
        if (!rec) estimated.set(key, (rec = emptyRecord()))
        rec[cat] += eur
      }
      // Mini-Luecken unter 14 Tagen sind Abrechnungs-Randeffekte, kein Datenloch
      if (b - a + 1 >= 14 || gapEur > 50) {
        gaps.push({ category: cat, start: iso(a), end: iso(b), estimatedEur: gapEur })
      }
    }
  }
  gaps.sort((x, y) => x.start.localeCompare(y.start))
  return { estimated, gaps }
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
  /** darin enthaltener geschaetzter Anteil */
  estimatedTotal: number
  /** Anzahl Monate des Jahres mit zugeordneten Kosten */
  monthsWithData: number
  avgPerMonth: number
}

export function summarizeYear(
  mc: MonthlyCosts,
  year: number,
  includeEstimates = false,
): YearSummary {
  const perCategory = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>
  let total = 0
  let estimatedTotal = 0
  let monthsWithData = 0
  for (const key of mc.keys) {
    if (!key.startsWith(String(year))) continue
    const rec = mc.months.get(key)
    const est = includeEstimates ? mc.estimated.get(key) : undefined
    let monthTotal = 0
    for (const c of CATEGORIES) {
      const v = (rec?.[c] ?? 0) + (est?.[c] ?? 0)
      perCategory[c] += v
      monthTotal += v
      estimatedTotal += est?.[c] ?? 0
    }
    if (monthTotal > 0.005) monthsWithData++
    total += monthTotal
  }
  return {
    year,
    total,
    perCategory,
    estimatedTotal,
    monthsWithData,
    avgPerMonth: monthsWithData ? total / monthsWithData : 0,
  }
}

// ---------------------------------------------------------------------------
// Datenqualitaet: was fehlt, was ist ueberfaellig — die "Wunschliste"
// ---------------------------------------------------------------------------

export interface QualityIssue {
  severity: 'warning' | 'info'
  category?: Category
  title: string
  detail: string
  estimatedEur?: number
}

export function dataQualityIssues(
  bundle: DataBundle,
  mc: MonthlyCosts,
  today: Date = new Date(),
): QualityIssue[] {
  const issues: QualityIssue[] = []
  const todayDay = Math.floor(today.getTime() / DAY_MS)
  const fmtDate = (isoStr: string) => new Date(isoStr).toLocaleDateString('de-DE')

  // 1. Beleg-Luecken (werden geschaetzt, aber echte Belege sind besser)
  for (const gap of mc.gaps) {
    issues.push({
      severity: 'warning',
      category: gap.category,
      title: `${CATEGORY_LABEL[gap.category]}: ${fmtDate(gap.start)} – ${fmtDate(gap.end)} unbelegt`,
      detail:
        `Für diesen Zeitraum liegt kein Beleg vor — er wird aus den angrenzenden ` +
        `Zeiträumen geschätzt. Rechnung/Bescheid nachreichen ersetzt die Schätzung automatisch.`,
      estimatedEur: gap.estimatedEur,
    })
  }

  // 2. Abschlaege, deren Zeitraum laengst vorbei ist, ohne Jahresabrechnung
  for (const inv of bundle.invoices) {
    if (inv.kind !== 'abschlag' || !inv.periodEnd) continue
    if (toDay(inv.periodEnd) + 60 > todayDay) continue
    const covered = bundle.invoices.some(
      (a) =>
        a.kind === 'abrechnung' &&
        a.category === inv.category &&
        a.periodStart &&
        a.periodEnd &&
        a.periodStart <= inv.periodEnd! &&
        a.periodEnd >= inv.periodEnd!,
    )
    if (!covered) {
      issues.push({
        severity: 'warning',
        category: inv.category,
        title: `${CATEGORY_LABEL[inv.category]}: Jahresabrechnung für ${fmtDate(inv.periodStart!)} – ${fmtDate(inv.periodEnd)} fehlt`,
        detail:
          `Bisher sind nur Abschläge (${fmtEur(inv.amountEur)}) erfasst. Die Abrechnung ` +
          `korrigiert auf die echten Kosten und verdrängt die Abschläge automatisch.`,
      })
    }
  }

  // 3. Veraltete Zaehlerstaende
  for (const type of ['strom', 'wasser'] as const) {
    const rs = bundle.readings.filter((r) => r.type === type)
    if (rs.length === 0) {
      issues.push({
        severity: 'info',
        title: `${type === 'strom' ? 'Strom' : 'Wasser'}: keine Zählerstände erfasst`,
        detail: 'Ein aktueller Zählerstand (Foto genügt) macht die Verbrauchs-KPIs möglich.',
      })
      continue
    }
    const lastDate = rs.map((r) => r.date).sort().at(-1)!
    if (toDay(lastDate) + 180 < todayDay) {
      issues.push({
        severity: 'info',
        title: `${type === 'strom' ? 'Stromzähler' : 'Wasserzähler'}: letzter Stand vom ${fmtDate(lastDate)}`,
        detail: 'Ein aktueller Zählerstand verlängert die Verbrauchskurve bis heute (Foto genügt).',
      })
    }
  }

  // 4. Laufende Kategorien ohne aktuelle Belege (Abdeckung endet deutlich vor heute)
  for (const cat of CONTINUOUS_CATEGORIES) {
    const ends = bundle.invoices
      .filter((i) => i.category === cat)
      .map((i) =>
        i.kind === 'einkauf'
          ? addMonths(i.date, bundle.settings.woodSpreadMonths) - 1
          : toDay(i.periodEnd ?? i.date),
      )
    if (ends.length === 0) continue
    const lastCovered = Math.max(...ends)
    if (lastCovered + 90 < todayDay) {
      issues.push({
        severity: 'warning',
        category: cat,
        title: `${CATEGORY_LABEL[cat]}: keine Belege seit ${fmtDate(dayToDate(lastCovered).toISOString().slice(0, 10))}`,
        detail: 'Ab hier fehlen die laufenden Kosten komplett (keine Schätzung über den Datenrand hinaus).',
      })
    }
  }

  // 5. Kategorien ganz ohne Belege
  for (const cat of ['wartung', 'kaminkehrer'] as const) {
    if (!bundle.invoices.some((i) => i.category === cat)) {
      issues.push({
        severity: 'info',
        category: cat,
        title: `${CATEGORY_LABEL[cat]}: noch keine Belege`,
        detail: 'Falls vorhanden, Rechnungen nachreichen — sonst fehlt diese Kategorie in der Gesamtsicht.',
      })
    }
  }

  return issues.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'warning' ? -1 : 1))
}

// ---------------------------------------------------------------------------
// Holz-Lagerbilanz
// ---------------------------------------------------------------------------

export interface WoodBalance {
  /** Stichtag der Bilanz (= Datum der Bestandsangabe) */
  asOf: string
  /** ab wann die Holzbelege dicht genug fuer eine Bilanz sind */
  since: string
  /** belegte Einkaeufe seit `since` in Ster */
  boughtSter: number
  /** laut Verteilmodell bis zum Stichtag verheizt */
  burnedSter: number
  /** Modellbestand = gekauft - verheizt */
  modelStockSter: number
  /** gemeldeter Bestand (eigene Angabe) */
  reportedStockSter: number
  /** aus Kaeufen und Bestandsangabe abgeleiteter Jahresverbrauch */
  impliedSterPerYear: number
  /** Abweichung Modell vs. Angabe in Ster */
  deviationSter: number
}

/**
 * Vergleicht den modellierten Holzbestand mit einer eigenen Bestandsangabe.
 *
 * Das ist der einzige Weg, die Lagerdauer (`woodSpreadMonths`) zu pruefen:
 * Ein Holzeinkauf sagt nichts darueber, WANN er verheizt wird. Weicht der
 * Modellbestand stark von der Angabe ab, verteilt das Modell die Kosten zu
 * traege (oder zu schnell) — dann gehoert `woodSpreadMonths` angepasst.
 *
 * Bilanziert wird erst ab dem Ende der letzten Beleg-Luecke, sonst wuerden
 * fehlende Einkaufsbelege als "nie gekauft" in die Bilanz laufen.
 */
export function woodBalance(bundle: DataBundle): WoodBalance | null {
  const stock = bundle.settings.woodStock
  if (!stock) return null
  const asOfDay = toDay(stock.date)
  const purchases = bundle.invoices
    .filter((i) => i.category === 'holz' && i.kind === 'einkauf' && i.quantity && i.date <= stock.date)
    .sort((a, b) => a.date.localeCompare(b.date))
  if (purchases.length === 0) return null

  // Beginn der dichten Belegstrecke: nach der letzten Holz-Luecke von >90 Tagen
  let since = purchases[0].date
  for (let i = 1; i < purchases.length; i++) {
    if (toDay(purchases[i].date) - toDay(purchases[i - 1].date) > 90) since = purchases[i].date
  }
  const relevant = purchases.filter((p) => p.date >= since)

  let boughtSter = 0
  let burnedSter = 0
  for (const p of relevant) {
    const ster = p.quantity ?? 0
    boughtSter += ster
    const start = toDay(p.date)
    const end = addMonths(p.date, bundle.settings.woodSpreadMonths) - 1
    let wSum = 0
    let wDone = 0
    for (let day = start; day <= end; day++) {
      const w = dayWeight(day, true, bundle.settings)
      wSum += w
      if (day < asOfDay) wDone += w
    }
    burnedSter += wSum > 0 ? ster * (wDone / wSum) : ster
  }

  const spanDays = Math.max(asOfDay - toDay(since), 1)
  const impliedSterPerYear = ((boughtSter - stock.ster) / spanDays) * 365
  const modelStockSter = boughtSter - burnedSter
  return {
    asOf: stock.date,
    since,
    boughtSter,
    burnedSter,
    modelStockSter,
    reportedStockSter: stock.ster,
    impliedSterPerYear,
    deviationSter: modelStockSter - stock.ster,
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
