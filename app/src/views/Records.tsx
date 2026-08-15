import { useMemo, useState } from 'react'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from '@tanstack/react-table'
import { useData } from '../state/DataProvider'
import { useTheme } from '../hooks/useTheme'
import { fmtEur } from '../lib/engine'
import { CATEGORIES, CATEGORY_LABEL, type Category, type Invoice } from '../lib/schema'
import { seriesColor } from '../lib/palette'

const KIND_LABEL: Record<Invoice['kind'], string> = {
  abrechnung: 'Abrechnung',
  abschlag: 'Abschlag',
  einkauf: 'Einkauf',
  einzel: 'Einzelbeleg',
}

const col = createColumnHelper<Invoice>()

export function Records() {
  const { bundle } = useData()
  const mode = useTheme()
  const [sorting, setSorting] = useState<SortingState>([{ id: 'date', desc: true }])
  const [globalFilter, setGlobalFilter] = useState('')
  const [category, setCategory] = useState<Category | 'alle'>('alle')
  const [year, setYear] = useState<string>('alle')

  const years = useMemo(
    () => [...new Set(bundle.invoices.map((i) => i.date.slice(0, 4)))].sort().reverse(),
    [bundle],
  )

  const rows = useMemo(
    () =>
      bundle.invoices.filter(
        (i) =>
          (category === 'alle' || i.category === category) &&
          (year === 'alle' || i.date.startsWith(year) || i.periodStart?.startsWith(year)),
      ),
    [bundle, category, year],
  )

  const columns = useMemo(
    () => [
      col.accessor('date', {
        header: 'Datum',
        cell: (c) => new Date(c.getValue()).toLocaleDateString('de-DE'),
      }),
      col.accessor('category', {
        header: 'Kategorie',
        cell: (c) => (
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: seriesColor(c.getValue(), mode) }}
            />
            {CATEGORY_LABEL[c.getValue()]}
          </span>
        ),
      }),
      col.accessor('kind', { header: 'Art', cell: (c) => KIND_LABEL[c.getValue()] }),
      col.accessor('vendor', { header: 'Anbieter' }),
      col.display({
        id: 'period',
        header: 'Zeitraum',
        cell: (c) => {
          const r = c.row.original
          if (!r.periodStart || !r.periodEnd) return <span style={{ color: 'var(--text-muted)' }}>–</span>
          const f = (s: string) => new Date(s).toLocaleDateString('de-DE', { month: '2-digit', year: '2-digit' })
          return `${f(r.periodStart)} – ${f(r.periodEnd)}`
        },
      }),
      col.accessor('quantity', {
        header: () => <span className="block text-right">Menge</span>,
        cell: (c) => {
          const r = c.row.original
          return (
            <span className="tabular block text-right">
              {r.quantity ? `${r.quantity.toLocaleString('de-DE')} ${r.unit ?? ''}` : '–'}
            </span>
          )
        },
      }),
      col.accessor('amountEur', {
        header: () => <span className="block text-right">Betrag</span>,
        cell: (c) => <span className="tabular block text-right font-medium">{fmtEur(c.getValue(), 2)}</span>,
      }),
      col.accessor('note', {
        header: 'Notiz',
        cell: (c) => (
          <span className="block max-w-56 truncate" style={{ color: 'var(--text-secondary)' }} title={c.getValue()}>
            {c.getValue() ?? ''}
          </span>
        ),
      }),
    ],
    [mode],
  )

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  })

  const filteredSum = table.getFilteredRowModel().rows.reduce((s, r) => s + r.original.amountEur, 0)

  const selectStyle = {
    borderColor: 'var(--baseline)',
    background: 'var(--surface)',
    color: 'var(--text-primary)',
  } as const

  return (
    <div className="space-y-3">
      <div className="no-print flex flex-wrap items-center gap-2">
        <select
          value={year}
          onChange={(e) => setYear(e.target.value)}
          className="rounded-lg border px-2 py-1.5 text-sm"
          style={selectStyle}
          aria-label="Jahr"
        >
          <option value="alle">Alle Jahre</option>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as Category | 'alle')}
          className="rounded-lg border px-2 py-1.5 text-sm"
          style={selectStyle}
          aria-label="Kategorie"
        >
          <option value="alle">Alle Kategorien</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c]}
            </option>
          ))}
        </select>
        <input
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          placeholder="Suchen…"
          className="min-w-40 flex-1 rounded-lg border px-3 py-1.5 text-sm"
          style={selectStyle}
          aria-label="Volltextsuche"
        />
        <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          {table.getFilteredRowModel().rows.length} Belege · <strong className="tabular">{fmtEur(filteredSum, 2)}</strong>
        </span>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} style={{ borderBottom: '1px solid var(--grid)' }}>
                {hg.headers.map((h) => (
                  <th
                    key={h.id}
                    className="cursor-pointer select-none px-3 py-2 text-left font-medium"
                    style={{ color: 'var(--text-secondary)' }}
                    onClick={h.column.getToggleSortingHandler()}
                  >
                    {flexRender(h.column.columnDef.header, h.getContext())}
                    {{ asc: ' ↑', desc: ' ↓' }[h.column.getIsSorted() as string] ?? ''}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((r) => (
              <tr key={r.id} style={{ borderBottom: '1px solid var(--grid)' }}>
                {r.getVisibleCells().map((c) => (
                  <td key={c.id} className="px-3 py-2">
                    {flexRender(c.column.columnDef.cell, c.getContext())}
                  </td>
                ))}
              </tr>
            ))}
            {table.getRowModel().rows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-3 py-8 text-center" style={{ color: 'var(--text-muted)' }}>
                  Keine Belege für diese Filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
