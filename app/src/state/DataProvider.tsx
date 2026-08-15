import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { payloadSchema, type DataBundle, type Payload } from '../lib/schema'
import { decryptBundle } from '../lib/crypto'
import { computeMonthlyCosts, type MonthlyCosts } from '../lib/engine'

interface DataState {
  bundle: DataBundle
  monthly: MonthlyCosts
}

const DataContext = createContext<DataState | null>(null)

export function useData(): DataState {
  const ctx = useContext(DataContext)
  if (!ctx) throw new Error('useData ausserhalb des DataProviders')
  return ctx
}

const PP_KEY = 'pixpower.passphrase'

export function DataProvider({ children }: { children: ReactNode }) {
  const [payload, setPayload] = useState<Payload | null>(null)
  const [bundle, setBundle] = useState<DataBundle | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [wrongPass, setWrongPass] = useState(false)

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((json) => setPayload(payloadSchema.parse(json)))
      .catch((e) => setError(`Daten konnten nicht geladen werden: ${e.message}`))
  }, [])

  const tryDecrypt = useCallback(async (p: Payload, passphrase: string): Promise<boolean> => {
    try {
      const b = await decryptBundle(p, passphrase)
      setBundle(b)
      sessionStorage.setItem(PP_KEY, passphrase)
      setWrongPass(false)
      return true
    } catch {
      sessionStorage.removeItem(PP_KEY)
      setWrongPass(true)
      return false
    }
  }, [])

  useEffect(() => {
    if (!payload) return
    if (!payload.encrypted) {
      decryptBundle(payload, '').then(setBundle)
      return
    }
    const stored = sessionStorage.getItem(PP_KEY)
    if (stored) void tryDecrypt(payload, stored)
  }, [payload, tryDecrypt])

  const monthly = useMemo(() => (bundle ? computeMonthlyCosts(bundle) : null), [bundle])

  if (error) {
    return (
      <Centered>
        <p style={{ color: 'var(--critical)' }}>{error}</p>
      </Centered>
    )
  }
  if (payload?.encrypted && !bundle) {
    return <PassphraseGate wrong={wrongPass} onSubmit={(pp) => tryDecrypt(payload, pp)} />
  }
  if (!bundle || !monthly) {
    return (
      <Centered>
        <p style={{ color: 'var(--text-muted)' }}>Lade Daten…</p>
      </Centered>
    )
  }
  return <DataContext.Provider value={{ bundle, monthly }}>{children}</DataContext.Provider>
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center p-8">{children}</div>
}

function PassphraseGate({
  wrong,
  onSubmit,
}: {
  wrong: boolean
  onSubmit: (pp: string) => void
}) {
  const [pp, setPp] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <Centered>
      <form
        className="card w-full max-w-sm p-6"
        onSubmit={(e) => {
          e.preventDefault()
          setBusy(true)
          Promise.resolve(onSubmit(pp)).finally(() => setBusy(false))
        }}
      >
        <h1 className="text-lg font-semibold">🔒 Hauskosten</h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
          Die Daten sind verschlüsselt. Passphrase eingeben — die Entschlüsselung
          passiert vollständig in deinem Browser.
        </p>
        <input
          type="password"
          autoFocus
          value={pp}
          onChange={(e) => setPp(e.target.value)}
          className="mt-4 w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2"
          style={{ borderColor: 'var(--baseline)', background: 'var(--page)' }}
          placeholder="Passphrase"
          aria-label="Passphrase"
        />
        {wrong && (
          <p className="mt-2 text-sm" style={{ color: 'var(--critical)' }}>
            Falsche Passphrase.
          </p>
        )}
        <button
          type="submit"
          disabled={busy || !pp}
          className="mt-4 w-full rounded-lg px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          style={{ background: 'var(--accent)' }}
        >
          {busy ? 'Entschlüssle…' : 'Öffnen'}
        </button>
      </form>
    </Centered>
  )
}
