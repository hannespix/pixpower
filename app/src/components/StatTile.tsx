/**
 * Stat-Kachel nach dataviz-Kontrakt: Label (sentence case), Wert (semibold,
 * proportionale Ziffern), optionales Delta (Vorzeichen + Richtung x gut/schlecht).
 * Bei Kosten ist "hoch = schlecht": Anstieg rot, Rueckgang gruen.
 */
export function StatTile({
  label,
  value,
  delta,
  deltaLabel,
  upIsGood = false,
  hint,
}: {
  label: string
  value: string
  delta?: number
  deltaLabel?: string
  upIsGood?: boolean
  hint?: string
}) {
  const deltaColor =
    delta === undefined || Math.abs(delta) < 0.005
      ? 'var(--text-muted)'
      : (delta > 0) === upIsGood
        ? 'var(--good-text)'
        : 'var(--critical)'
  return (
    <div className="card px-4 py-3">
      <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {delta !== undefined && (
        <div className="mt-0.5 text-xs font-medium" style={{ color: deltaColor }}>
          {delta > 0 ? '▲' : delta < 0 ? '▼' : '•'} {delta > 0 ? '+' : ''}
          {delta.toLocaleString('de-DE', { maximumFractionDigits: 1 })} %{' '}
          {deltaLabel && <span style={{ color: 'var(--text-muted)' }}>{deltaLabel}</span>}
        </div>
      )}
      {hint && (
        <div className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
          {hint}
        </div>
      )}
    </div>
  )
}
