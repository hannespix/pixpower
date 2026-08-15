import Anthropic from '@anthropic-ai/sdk'
import { invoiceSchema, readingSchema, type Invoice, type Reading } from './schema'

/**
 * KI-Belegerfassung direkt im Browser: Datei (PDF/Foto) -> Claude API ->
 * validierte Eintraege fuer data/invoices.json und data/readings.json.
 *
 * Der API-Key bleibt im Browser (localStorage), die Datei geht direkt an
 * die Anthropic-API — kein eigener Server, nichts landet im Repo.
 * Ergebnisse werden clientseitig mit denselben Zod-Schemas validiert wie
 * in der CI; erst der PR bringt sie in die Daten.
 */

export const API_KEY_STORAGE = 'pixpower.anthropicKey'

const MODEL = 'claude-opus-5'

const MEDIA_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
}

const SYSTEM = `Du bist die Belegerfassung eines Hauskosten-Dashboards (Wohnhaus mit Weingut in Südbaden).
Du bekommst eine Rechnung, einen Bescheid, einen Kontoauszug oder ein Zählerfoto und extrahierst daraus Einträge für zwei JSON-Dateien.

Antworte AUSSCHLIESSLICH mit einem einzigen JSON-Objekt dieser Form (kein Markdown, kein Text davor/danach):
{"belege": [...], "zaehlerstaende": [...], "hinweise": ["..."]}

## belege — ein Objekt je Beleg
{
  "id": "JJJJ-MM-kategorie",            // Belegmonat + Kategorie; bei Kollision Suffix wie "-2" oder "-anbieter"
  "category": "strom" | "holz" | "wasser" | "abwasser" | "kaminkehrer" | "wartung" | "sonstiges",
  "kind": "abrechnung" | "abschlag" | "einkauf" | "einzel",
  "vendor": "Anbietername",              // nur Firmenname, kurz
  "date": "JJJJ-MM-TT",                 // Rechnungs-/Belegdatum
  "periodStart": "JJJJ-MM-TT",          // Leistungszeitraum; PFLICHT bei kind=abrechnung, sonst weglassen falls unbekannt
  "periodEnd": "JJJJ-MM-TT",
  "amountEur": 123.45,                   // Brutto-Endbetrag; Gutschrift/Erstattung negativ
  "quantity": 3400,                      // optional: Menge
  "unit": "kWh" | "m3" | "ster" | "rm" | "srm" | "kg" | "l" | "stk",  // optional, nur mit quantity
  "note": "kurzer Kontext",              // optional
  "sourceFile": "dateiname"              // der übergebene Dateiname
}

Regeln zu kind:
- "abrechnung": Jahres-/Schlussabrechnung mit Leistungszeitraum. periodStart/periodEnd Pflicht. amountEur = Gesamtkosten des Zeitraums (nicht nur Nachzahlung!), falls ausgewiesen; sonst Nachzahlung mit Hinweis.
- "abschlag": Abschlags-/Vorauszahlungen. Wenn ein Plan mehrere Monate abdeckt, EINEN Beleg mit Gesamtsumme und periodStart/periodEnd anlegen.
- "einkauf": Brennstoffkauf (Brennholz etc.), category "holz", quantity + unit (ster/rm/srm) angeben.
- "einzel": Einzelleistung (Kaminkehrer, Reparatur/Wartung) — zählt im Belegmonat.

## zaehlerstaende — nur wenn Zählerstände mit Datum erkennbar sind
{
  "id": "JJJJ-MM-TT-zaehlername",
  "meter": "strom-alt" | "strom-neu" | "wasser-haupt" | ähnlich generisch,
  "type": "strom" | "wasser",
  "date": "JJJJ-MM-TT",
  "value": 41529,
  "unit": "kWh" | "m3"
}
Bei Zählertausch: alter und neuer Zähler bekommen verschiedene meter-Namen.

## Datenschutz (das Repo ist öffentlich!)
NIEMALS in irgendein Feld schreiben: Namen von Personen, Adressen, Kunden-/Vertragsnummern, Zählernummern, IBAN/Bankdaten. Nur Anbietername, Beträge, Mengen, Zeiträume.

## hinweise
Kurze deutsche Hinweise auf Unsicherheiten, fehlende Angaben oder Auffälligkeiten (z. B. "Leistungszeitraum nicht angegeben, aus Kontext geschätzt"). Leer lassen, wenn nichts anzumerken ist.

Extrahiere ALLE Belege im Dokument (ein Kontoauszug kann mehrere enthalten). Zahlen mit Punkt als Dezimaltrenner.`

export interface ExtractOutcome {
  invoices: Invoice[]
  readings: Reading[]
  hinweise: string[]
  /** Eintraege, die die Schema-Validierung nicht bestanden haben */
  rejected: { item: unknown; error: string }[]
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onerror = () => reject(new Error('Datei konnte nicht gelesen werden'))
    r.onload = () => resolve(String(r.result).split(',', 2)[1] ?? '')
    r.readAsDataURL(file)
  })
}

function mediaType(file: File): string | null {
  if (file.type && (file.type === 'application/pdf' || file.type.startsWith('image/'))) return file.type
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  return MEDIA_BY_EXT[ext] ?? null
}

/** tolerant: JSON auch aus einem \`\`\`-Zaun oder umgebendem Text fischen */
function parseJsonObject(text: string): Record<string, unknown> {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('Antwort enthielt kein JSON')
  return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
}

/** null-Werte entfernen, damit optionale Felder wirklich fehlen */
function stripNulls(item: unknown): unknown {
  if (typeof item !== 'object' || item === null) return item
  return Object.fromEntries(Object.entries(item as Record<string, unknown>).filter(([, v]) => v !== null && v !== ''))
}

export async function extractFromFile(apiKey: string, file: File): Promise<ExtractOutcome> {
  const media = mediaType(file)
  if (!media) throw new Error(`Dateityp nicht unterstützt: ${file.name} (PDF, JPG, PNG, WebP)`)
  if (file.size > 30 * 1024 * 1024) throw new Error('Datei größer als 30 MB')

  const data = await fileToBase64(file)
  const fileBlock =
    media === 'application/pdf'
      ? ({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } } as const)
      : ({ type: 'image', source: { type: 'base64', media_type: media as 'image/png', data } } as const)

  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 })
  let res: Anthropic.Message
  try {
    res = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            fileBlock,
            { type: 'text', text: `Dateiname: ${file.name}\nExtrahiere alle Belege und Zählerstände. Antworte nur mit dem JSON-Objekt.` },
          ],
        },
      ],
    })
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new Error('API-Key ungültig — bitte prüfen (beginnt mit "sk-ant-").')
    if (e instanceof Anthropic.RateLimitError) throw new Error('Rate-Limit erreicht — kurz warten und erneut versuchen.')
    if (e instanceof Anthropic.APIError) throw new Error(`API-Fehler ${e.status ?? ''}: ${e.message}`)
    throw e
  }

  if (res.stop_reason === 'refusal') throw new Error('Die Anfrage wurde vom Modell abgelehnt.')
  if (res.stop_reason === 'max_tokens') throw new Error('Antwort abgeschnitten — Dokument ggf. aufteilen.')

  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
  const json = parseJsonObject(text)

  const outcome: ExtractOutcome = {
    invoices: [],
    readings: [],
    hinweise: Array.isArray(json.hinweise) ? json.hinweise.filter((h): h is string => typeof h === 'string') : [],
    rejected: [],
  }
  for (const raw of Array.isArray(json.belege) ? json.belege : []) {
    const parsed = invoiceSchema.safeParse(stripNulls(raw))
    if (parsed.success) outcome.invoices.push(parsed.data)
    else outcome.rejected.push({ item: raw, error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' · ') })
  }
  for (const raw of Array.isArray(json.zaehlerstaende) ? json.zaehlerstaende : []) {
    const parsed = readingSchema.safeParse(stripNulls(raw))
    if (parsed.success) outcome.readings.push(parsed.data)
    else outcome.rejected.push({ item: raw, error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' · ') })
  }
  return outcome
}
