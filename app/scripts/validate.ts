/**
 * Validiert /data/*.json gegen die Zod-Schemas plus fachliche Invarianten.
 * Laeuft in CI auf jedem PR — kaputte Daten kommen nicht auf main.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { invoiceSchema, investmentSchema, readingSchema, settingsSchema } from '../src/lib/schema'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
let failed = false

function check<T>(file: string, schema: z.ZodType<T>): T | undefined {
  const path = join(root, 'data', file)
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'))
    const result = schema.safeParse(data)
    if (!result.success) {
      failed = true
      console.error(`FEHLER in data/${file}:`)
      for (const issue of result.error.issues) {
        console.error(`  - [${issue.path.join('.') || '(root)'}] ${issue.message}`)
      }
      return undefined
    }
    console.log(`OK  data/${file}`)
    return result.data
  } catch (e) {
    failed = true
    console.error(`FEHLER: data/${file} ist kein gueltiges JSON: ${(e as Error).message}`)
    return undefined
  }
}

check('settings.json', settingsSchema)
check('investment.json', investmentSchema)
const invoices = check('invoices.json', z.array(invoiceSchema))
const readings = check('readings.json', z.array(readingSchema))

// Fachliche Invarianten
if (invoices) {
  const seen = new Set<string>()
  for (const inv of invoices) {
    if (seen.has(inv.id)) {
      failed = true
      console.error(`FEHLER: doppelte Beleg-ID "${inv.id}"`)
    }
    seen.add(inv.id)
  }
}

if (readings) {
  const byMeter = new Map<string, typeof readings>()
  for (const r of readings) {
    const list = byMeter.get(r.meter) ?? []
    list.push(r)
    byMeter.set(r.meter, list)
  }
  for (const [meter, list] of byMeter) {
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date))
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].value < sorted[i - 1].value) {
        failed = true
        console.error(
          `FEHLER: Zaehler "${meter}" laeuft rueckwaerts: ` +
            `${sorted[i - 1].date}=${sorted[i - 1].value} -> ${sorted[i].date}=${sorted[i].value} ` +
            `(Zaehlertausch? Dann neuen Zaehler als eigenes meter fuehren.)`,
        )
      }
    }
  }
}

if (failed) {
  console.error('\nValidierung FEHLGESCHLAGEN.')
  process.exit(1)
}
console.log('\nAlle Daten valide.')
