import { useMemo, useRef, useState } from 'react'
import { CATEGORIES, CATEGORY_LABEL, KINDS, invoiceSchema } from '../lib/schema'
import { API_KEY_STORAGE, extractFromFile, type ExtractOutcome } from '../lib/extract'

const KIND_HELP: Record<string, string> = {
  abrechnung: 'Jahresabrechnung mit Leistungszeitraum — die wahre Kostenbasis. Verdrängt Abschläge im selben Zeitraum.',
  abschlag: 'Monatliche/vierteljährliche Zahlungen. Als Summe mit Zeitraum erfassen (z. B. 12 × 95 € = 1140 € für das Jahr).',
  einkauf: 'Brennstoffkauf (Holz). Wird automatisch heizlastgewichtet über die Heizperiode verteilt.',
  einzel: 'Einzelbeleg (Kaminkehrer, Wartung) — zählt im Belegmonat.',
}

const REPO_EDIT_URL = 'https://github.com/hannespix/pixpower/edit/main/data/invoices.json'
const REPO_EDIT_READINGS_URL = 'https://github.com/hannespix/pixpower/edit/main/data/readings.json'

/**
 * Erfassungshilfe: erzeugt einen validierten JSON-Schnipsel fuer
 * data/invoices.json. Der Weg der Daten bleibt immer der PR — so ist jede
 * Aenderung nachvollziehbar und laeuft durch die CI-Validierung.
 */
export function Entry() {
  const [form, setForm] = useState({
    category: 'strom',
    kind: 'einzel',
    vendor: '',
    date: '',
    periodStart: '',
    periodEnd: '',
    amountEur: '',
    quantity: '',
    unit: '',
    note: '',
    sourceFile: '',
  })
  const [copied, setCopied] = useState(false)

  const { snippet, error } = useMemo(() => {
    const idBase = `${form.date.slice(0, 7) || 'JJJJ-MM'}-${form.category}`
    const candidate: Record<string, unknown> = {
      id: idBase,
      category: form.category,
      kind: form.kind,
      vendor: form.vendor || undefined,
      date: form.date || undefined,
      periodStart: form.periodStart || undefined,
      periodEnd: form.periodEnd || undefined,
      amountEur: form.amountEur ? Number(form.amountEur.replace(',', '.')) : undefined,
      quantity: form.quantity ? Number(form.quantity.replace(',', '.')) : undefined,
      unit: form.unit || undefined,
      note: form.note || undefined,
      sourceFile: form.sourceFile || undefined,
    }
    const clean = Object.fromEntries(Object.entries(candidate).filter(([, v]) => v !== undefined))
    const parsed = invoiceSchema.safeParse(clean)
    return {
      snippet: JSON.stringify(clean, null, 2),
      error: parsed.success ? null : parsed.error.issues.map((i) => i.message).join(' · '),
    }
  }, [form])

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  const inputStyle = {
    borderColor: 'var(--baseline)',
    background: 'var(--surface)',
    color: 'var(--text-primary)',
  } as const

  return (
    <div className="space-y-4">
      <KiCapture inputStyle={inputStyle} />
      <div className="grid gap-4 lg:grid-cols-2">
      <div className="card space-y-3 p-5">
        <h2 className="text-base font-semibold">Beleg von Hand erfassen</h2>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          Formular ausfüllen → JSON kopieren → in <code>data/invoices.json</code> einfügen (per PR).
          Oder: einfach die Rechnung (PDF/Foto) in einer Claude-Session abgeben — sie wird gelesen und
          als PR eingepflegt.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm">
            Kategorie
            <select value={form.category} onChange={set('category')} className="mt-1 w-full rounded-lg border px-2 py-1.5" style={inputStyle}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Art
            <select value={form.kind} onChange={set('kind')} className="mt-1 w-full rounded-lg border px-2 py-1.5" style={inputStyle}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {KIND_HELP[form.kind]}
        </p>

        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm">
            Anbieter
            <input value={form.vendor} onChange={set('vendor')} className="mt-1 w-full rounded-lg border px-2 py-1.5" style={inputStyle} placeholder="Stadtwerke" />
          </label>
          <label className="text-sm">
            Belegdatum
            <input type="date" value={form.date} onChange={set('date')} className="mt-1 w-full rounded-lg border px-2 py-1.5" style={inputStyle} />
          </label>
          <label className="text-sm">
            Zeitraum von
            <input type="date" value={form.periodStart} onChange={set('periodStart')} className="mt-1 w-full rounded-lg border px-2 py-1.5" style={inputStyle} />
          </label>
          <label className="text-sm">
            Zeitraum bis
            <input type="date" value={form.periodEnd} onChange={set('periodEnd')} className="mt-1 w-full rounded-lg border px-2 py-1.5" style={inputStyle} />
          </label>
          <label className="text-sm">
            Betrag (EUR)
            <input inputMode="decimal" value={form.amountEur} onChange={set('amountEur')} className="mt-1 w-full rounded-lg border px-2 py-1.5" style={inputStyle} placeholder="123,45" />
          </label>
          <label className="text-sm">
            Menge + Einheit
            <span className="mt-1 flex gap-2">
              <input inputMode="decimal" value={form.quantity} onChange={set('quantity')} className="w-full rounded-lg border px-2 py-1.5" style={inputStyle} placeholder="3400" />
              <select value={form.unit} onChange={set('unit')} className="rounded-lg border px-2 py-1.5" style={inputStyle}>
                <option value="">–</option>
                {['kWh', 'm3', 'ster', 'rm', 'srm', 'kg', 'l', 'stk'].map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </span>
          </label>
        </div>
        <label className="block text-sm">
          Notiz
          <input value={form.note} onChange={set('note')} className="mt-1 w-full rounded-lg border px-2 py-1.5" style={inputStyle} placeholder="Jahresabrechnung 2025" />
        </label>
        <label className="block text-sm">
          Original-Datei (Referenz, bleibt lokal)
          <input value={form.sourceFile} onChange={set('sourceFile')} className="mt-1 w-full rounded-lg border px-2 py-1.5" style={inputStyle} placeholder="2025-03_stadtwerke_jahresabrechnung.pdf" />
        </label>
      </div>

      <div className="card flex flex-col p-5">
        <h2 className="text-base font-semibold">JSON-Schnipsel</h2>
        {error ? (
          <p className="mt-2 text-sm" style={{ color: 'var(--critical)' }}>
            ⚠ {error}
          </p>
        ) : (
          <p className="mt-2 text-sm" style={{ color: 'var(--good-text)' }}>
            ✓ Valide — bereit zum Einfügen
          </p>
        )}
        <pre
          className="tabular mt-3 flex-1 overflow-x-auto rounded-lg p-3 text-xs leading-relaxed"
          style={{ background: 'var(--page)', border: '1px solid var(--grid)' }}
        >
          {snippet}
        </pre>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={!!error}
            onClick={() => {
              navigator.clipboard.writeText(snippet + ',')
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            }}
            className="rounded-lg px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            style={{ background: 'var(--accent)' }}
          >
            {copied ? 'Kopiert ✓' : 'Kopieren'}
          </button>
          <a
            href={REPO_EDIT_URL}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border px-3 py-2 text-sm font-medium"
            style={{ borderColor: 'var(--baseline)' }}
          >
            invoices.json auf GitHub öffnen ↗
          </a>
        </div>
      </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// KI-Belegerfassung: Datei -> Claude API (browser-direkt) -> validiertes JSON
// ---------------------------------------------------------------------------

interface Job {
  name: string
  status: 'wartet' | 'läuft' | 'fertig' | 'fehler'
  error?: string
  outcome?: ExtractOutcome
}

function KiCapture({ inputStyle }: { inputStyle: React.CSSProperties }) {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(API_KEY_STORAGE) ?? '')
  const [jobs, setJobs] = useState<Job[]>([])
  const [running, setRunning] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const saveKey = (v: string) => {
    setApiKey(v)
    if (v) localStorage.setItem(API_KEY_STORAGE, v)
    else localStorage.removeItem(API_KEY_STORAGE)
  }

  const run = async () => {
    const files = Array.from(fileRef.current?.files ?? [])
    if (!files.length || !apiKey || running) return
    setRunning(true)
    setJobs(files.map((f) => ({ name: f.name, status: 'wartet' })))
    for (let i = 0; i < files.length; i++) {
      setJobs((js) => js.map((j, k) => (k === i ? { ...j, status: 'läuft' } : j)))
      try {
        const outcome = await extractFromFile(apiKey, files[i])
        setJobs((js) => js.map((j, k) => (k === i ? { ...j, status: 'fertig', outcome } : j)))
      } catch (e) {
        setJobs((js) => js.map((j, k) => (k === i ? { ...j, status: 'fehler', error: e instanceof Error ? e.message : String(e) } : j)))
      }
    }
    setRunning(false)
  }

  const allInvoices = jobs.flatMap((j) => j.outcome?.invoices ?? [])
  const allReadings = jobs.flatMap((j) => j.outcome?.readings ?? [])

  return (
    <div className="card space-y-3 p-5">
      <h2 className="text-base font-semibold">🤖 KI-Belegerfassung</h2>
      <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
        Rechnung, Bescheid, Kontoauszug oder Zählerfoto hochladen — Claude liest den Beleg und
        erzeugt fertige, validierte JSON-Einträge. Läuft komplett im Browser mit deinem eigenen{' '}
        <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer" className="underline underline-offset-2">
          Anthropic-API-Key
        </a>
        : Der Key bleibt lokal gespeichert, die Datei geht direkt an die Anthropic-API — nichts
        davon landet im Repo.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          API-Key (bleibt in diesem Browser)
          <input
            type="password"
            value={apiKey}
            onChange={(e) => saveKey(e.target.value.trim())}
            className="mt-1 w-full rounded-lg border px-2 py-1.5"
            style={inputStyle}
            placeholder="sk-ant-…"
            autoComplete="off"
          />
        </label>
        <label className="text-sm">
          Belege (PDF, JPG, PNG — mehrere möglich)
          <input
            ref={fileRef}
            type="file"
            multiple
            accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/*"
            className="mt-1 w-full rounded-lg border px-2 py-1.5 text-sm"
            style={inputStyle}
          />
        </label>
      </div>

      <button
        type="button"
        onClick={run}
        disabled={running || !apiKey}
        className="rounded-lg px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        style={{ background: 'var(--accent)' }}
      >
        {running ? 'Liest Belege …' : 'Belege auslesen'}
      </button>
      {!apiKey && (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Kein API-Key? Belege können weiterhin einfach in einer Claude-Session abgegeben werden —
          sie werden gelesen und als PR eingepflegt.
        </p>
      )}

      {jobs.length > 0 && (
        <ul className="space-y-1 text-sm">
          {jobs.map((j) => (
            <li key={j.name} className="flex flex-wrap items-baseline gap-x-2">
              <span>
                {j.status === 'fertig' ? '✓' : j.status === 'fehler' ? '✗' : j.status === 'läuft' ? '⏳' : '·'}
              </span>
              <span className="font-medium">{j.name}</span>
              <span style={{ color: j.status === 'fehler' ? 'var(--critical)' : 'var(--text-muted)' }}>
                {j.status === 'fertig' && j.outcome
                  ? `${j.outcome.invoices.length} Beleg(e), ${j.outcome.readings.length} Zählerstand/-stände`
                  : j.status === 'fehler'
                    ? j.error
                    : j.status}
              </span>
              {j.outcome?.hinweise.map((h, i) => (
                <span key={i} className="w-full pl-5 text-xs" style={{ color: 'var(--text-muted)' }}>
                  ℹ {h}
                </span>
              ))}
              {j.outcome?.rejected.map((r, i) => (
                <span key={i} className="w-full pl-5 text-xs" style={{ color: 'var(--critical)' }}>
                  ⚠ Eintrag verworfen (Validierung): {r.error}
                </span>
              ))}
            </li>
          ))}
        </ul>
      )}

      {allInvoices.length > 0 && (
        <ResultSnippet
          title={`Belege für data/invoices.json (${allInvoices.length})`}
          items={allInvoices}
          editUrl={REPO_EDIT_URL}
          editLabel="invoices.json auf GitHub öffnen ↗"
        />
      )}
      {allReadings.length > 0 && (
        <ResultSnippet
          title={`Zählerstände für data/readings.json (${allReadings.length})`}
          items={allReadings}
          editUrl={REPO_EDIT_READINGS_URL}
          editLabel="readings.json auf GitHub öffnen ↗"
        />
      )}
    </div>
  )
}

function ResultSnippet({
  title,
  items,
  editUrl,
  editLabel,
}: {
  title: string
  items: unknown[]
  editUrl: string
  editLabel: string
}) {
  const [copied, setCopied] = useState(false)
  const snippet = items.map((i) => JSON.stringify(i, null, 2)).join(',\n')
  return (
    <div>
      <h3 className="text-sm font-semibold">{title}</h3>
      <pre
        className="tabular mt-2 max-h-72 overflow-auto rounded-lg p-3 text-xs leading-relaxed"
        style={{ background: 'var(--page)', border: '1px solid var(--grid)' }}
      >
        {snippet}
      </pre>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(snippet + ',')
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          }}
          className="rounded-lg px-3 py-2 text-sm font-medium text-white"
          style={{ background: 'var(--accent)' }}
        >
          {copied ? 'Kopiert ✓' : 'Kopieren'}
        </button>
        <a href={editUrl} target="_blank" rel="noreferrer" className="rounded-lg border px-3 py-2 text-sm font-medium" style={{ borderColor: 'var(--baseline)' }}>
          {editLabel}
        </a>
      </div>
    </div>
  )
}
