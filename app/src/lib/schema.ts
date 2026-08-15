import { z } from 'zod'

/**
 * Datenmodell des Hauskosten-Dashboards.
 *
 * Die Wahrheit liegt in /data/*.json im Repo — Git ist die Datenbank.
 * Diese Schemas validieren die Daten sowohl in CI (scripts/validate.ts)
 * als auch beim Laden im Browser.
 */

export const CATEGORIES = [
  'strom',
  'holz',
  'wasser',
  'abwasser',
  'kaminkehrer',
  'wartung',
  'sonstiges',
] as const

export type Category = (typeof CATEGORIES)[number]

export const CATEGORY_LABEL: Record<Category, string> = {
  strom: 'Strom',
  holz: 'Brennholz',
  wasser: 'Wasser',
  abwasser: 'Abwasser',
  kaminkehrer: 'Kaminkehrer',
  wartung: 'Wartung & Reparatur',
  sonstiges: 'Sonstiges',
}

/**
 * Belegarten — der Kern des "Zahlung ist nicht Verbrauch"-Problems:
 *
 * - abrechnung: Jahresabrechnung mit Zeitraum. Sie ist die *wahre* Kostenbasis
 *   und verdraengt Abschlaege derselben Kategorie im selben Zeitraum.
 * - abschlag:   monatliche/vierteljaehrliche Zahlungen. Nur Kostenschaetzung,
 *   solange fuer den Zeitraum noch keine Abrechnung vorliegt.
 * - einkauf:    Brennstoffkauf (Holz). Geht ins Lager und wird ueber die
 *   Heizperiode(n) verteilt, nicht dem Kaufmonat zugeschlagen.
 * - einzel:     Einzelbeleg (Kaminkehrer, Wartung) — zaehlt im Belegmonat.
 */
export const KINDS = ['abrechnung', 'abschlag', 'einkauf', 'einzel'] as const
export type Kind = (typeof KINDS)[number]

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum muss YYYY-MM-DD sein')
  .refine((s) => !Number.isNaN(Date.parse(s)), 'Ungueltiges Datum')

export const invoiceSchema = z
  .object({
    id: z.string().min(1),
    category: z.enum(CATEGORIES),
    kind: z.enum(KINDS),
    vendor: z.string().min(1),
    /** Belegdatum (Rechnungs-/Zahlungsdatum) */
    date: isoDate,
    /** Leistungszeitraum — Pflicht bei kind=abrechnung */
    periodStart: isoDate.optional(),
    periodEnd: isoDate.optional(),
    amountEur: z.number().finite(),
    quantity: z.number().positive().optional(),
    unit: z.enum(['kWh', 'm3', 'ster', 'rm', 'srm', 'kg', 'l', 'stk']).optional(),
    note: z.string().optional(),
    /** Dateiname der Originalrechnung (liegt NICHT im Repo) */
    sourceFile: z.string().optional(),
    demo: z.boolean().optional(),
  })
  .refine((v) => v.kind !== 'abrechnung' || (v.periodStart && v.periodEnd), {
    message: 'Eine Abrechnung braucht periodStart und periodEnd',
  })
  .refine(
    (v) => !(v.periodStart && v.periodEnd) || v.periodStart <= v.periodEnd,
    { message: 'periodStart muss vor periodEnd liegen' },
  )

export type Invoice = z.infer<typeof invoiceSchema>

export const readingSchema = z.object({
  id: z.string().min(1),
  /**
   * Frei benennbarer Zaehler (z. B. "strom-alt", "strom-neu"). Bei
   * Zaehlertausch bekommt der neue Zaehler einen neuen Namen — Staende je
   * Zaehler muessen monoton steigen, der Verbrauch wird je Typ summiert.
   */
  meter: z.string().min(1),
  type: z.enum(['strom', 'wasser']),
  date: isoDate,
  value: z.number().nonnegative(),
  unit: z.enum(['kWh', 'm3']),
  demo: z.boolean().optional(),
})

export type Reading = z.infer<typeof readingSchema>

export const settingsSchema = z.object({
  house: z.object({
    name: z.string(),
    location: z.string(),
    heatedAreaM2: z.number().positive().optional(),
    heatingSystem: z.string().optional(),
  }),
  demoData: z.boolean().default(false),
  /** Ueber wie viele Monate ein Holzeinkauf verheizt wird */
  woodSpreadMonths: z.number().int().min(1).max(36).default(12),
  /** Monatsanteile der Jahresheizarbeit (Jan..Dez), Summe ~1 */
  hddProfile: z
    .array(z.number().nonnegative())
    .length(12)
    .refine((p) => Math.abs(p.reduce((a, b) => a + b, 0) - 1) < 0.02, {
      message: 'hddProfile muss sich zu ~1 summieren',
    }),
  hddProfileNote: z.string().optional(),
})

export type Settings = z.infer<typeof settingsSchema>

const tierEur = z.object({
  guenstig: z.number().positive(),
  typisch: z.number().positive(),
  premium: z.number().positive(),
})

export type Tier = 'guenstig' | 'typisch' | 'premium'

/** Parameter der Investitionsplanung — data/investment.json, editierbar per PR */
export const investmentSchema = z.object({
  note: z.string().optional(),
  horizonYears: z.number().int().min(5).max(40).default(20),
  interestRatePct: z.number().min(0).max(15),
  escalationPct: z.object({
    strom: z.number(),
    holz: z.number(),
    pellet: z.number(),
    einspeisung: z.number(),
  }),
  heat: z.object({
    sterPerYear: z.number().positive(),
    eurPerSter: z.number().positive(),
    kwhPerSter: z.number().positive(),
    oldBoilerEfficiency: z.number().min(0.3).max(1),
    ownWorkHoursPerYear: z.number().nonnegative(),
    ownWorkEurPerHour: z.number().nonnegative(),
    maintenanceOldEur: z.number().nonnegative(),
    kaminkehrerEur: z.number().nonnegative(),
    note: z.string().optional(),
  }),
  power: z.object({
    consumptionKwh: z.number().positive(),
    pricePerKwhCt: z.number().positive(),
    note: z.string().optional(),
  }),
  scenarios: z.object({
    woodNew: z.object({
      label: z.string(),
      efficiency: z.number().min(0.5).max(1),
      capexEur: tierEur,
      subsidyPct: z.number().min(0).max(80),
      subsidyCapEur: z.number().nonnegative(),
      subsidyExtraEur: z.number().nonnegative(),
      maintenanceEur: z.number().nonnegative(),
      kaminkehrerEur: z.number().nonnegative(),
      ownWorkFactor: z.number().min(0).max(2),
      note: z.string().optional(),
    }),
    pellet: z.object({
      label: z.string(),
      efficiency: z.number().min(0.5).max(1),
      eurPerTon: z.number().positive(),
      kwhPerKg: z.number().positive(),
      capexEur: tierEur,
      subsidyPct: z.number().min(0).max(80),
      subsidyCapEur: z.number().nonnegative(),
      subsidyExtraEur: z.number().nonnegative(),
      maintenanceEur: z.number().nonnegative(),
      kaminkehrerEur: z.number().nonnegative(),
      ownWorkHoursPerYear: z.number().nonnegative(),
      note: z.string().optional(),
    }),
    heatPump: z.object({
      label: z.string(),
      jaz: z.number().min(1.5).max(6),
      capexEur: tierEur,
      subsidyPct: z.number().min(0).max(80),
      subsidyCapEur: z.number().nonnegative(),
      subsidyExtraEur: z.number().nonnegative(),
      maintenanceEur: z.number().nonnegative(),
      kaminkehrerEur: z.number().nonnegative(),
      note: z.string().optional(),
    }),
    pv: z.object({
      label: z.string(),
      kwp: z.number().positive(),
      specificYieldKwhPerKwp: z.number().positive(),
      capexPerKwp: tierEur,
      selfConsumptionPct: z.number().min(0).max(100),
      feedInCtPerKwh: z.number().nonnegative(),
      omPctOfCapex: z.number().nonnegative(),
      inverterReplaceYear: z.number().int().positive(),
      inverterCostEur: z.number().nonnegative(),
      degradationPctPerYear: z.number().min(0).max(2),
      note: z.string().optional(),
    }),
    pvHeatPump: z.object({
      label: z.string(),
      wpPvCoverPct: z.number().min(0).max(100),
      note: z.string().optional(),
    }),
  }),
  subsidyNote: z.string().optional(),
})

export type InvestmentSettings = z.infer<typeof investmentSchema>

export const bundleSchema = z.object({
  settings: settingsSchema,
  invoices: z.array(invoiceSchema),
  readings: z.array(readingSchema),
  investment: investmentSchema,
  generatedAt: z.string(),
})

export type DataBundle = z.infer<typeof bundleSchema>

/** Format der ausgelieferten public/data.json */
export const payloadSchema = z.discriminatedUnion('encrypted', [
  z.object({ v: z.literal(1), encrypted: z.literal(false), bundle: bundleSchema }),
  z.object({
    v: z.literal(1),
    encrypted: z.literal(true),
    kdf: z.object({
      name: z.literal('PBKDF2'),
      hash: z.literal('SHA-256'),
      iterations: z.number().int().positive(),
      salt: z.string(),
    }),
    cipher: z.object({ name: z.literal('AES-GCM'), iv: z.string() }),
    ct: z.string(),
  }),
])

export type Payload = z.infer<typeof payloadSchema>
