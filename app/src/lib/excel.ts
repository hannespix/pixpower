import type { DataBundle } from './schema'
import { CATEGORIES, CATEGORY_LABEL } from './schema'
import { totalOfMonth, yearlyConsumption, yearsWithData, type MonthlyCosts } from './engine'

/**
 * Detaillierter Excel-Export des Berichts (mehrere Sheets):
 *   Jahresuebersicht | Monatskosten | Belege | Zaehlerstaende | Annahmen
 *
 * Zahlen bleiben Zahlen (EUR-Format je Spalte), Schaetzungen stehen in
 * eigenen Spalten statt als "~"-Marker — so laesst sich in Excel sauber
 * filtern und pivotieren. xlsx wird dynamisch importiert, damit die App
 * schlank bleibt.
 */
export async function exportExcel(bundle: DataBundle, monthly: MonthlyCosts): Promise<void> {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()
  const eur = '#,##0.00 "€"'
  const years = yearsWithData(monthly)

  const fmtSheet = (ws: import('xlsx').WorkSheet, widths: number[], eurCols: number[]) => {
    ws['!cols'] = widths.map((wch) => ({ wch }))
    const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1')
    for (let r = range.s.r + 1; r <= range.e.r; r++) {
      for (const c of eurCols) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })]
        if (cell && typeof cell.v === 'number') cell.z = eur
      }
    }
  }

  // --- Jahresuebersicht ----------------------------------------------------
  {
    const head = ['Jahr', 'Monate mit Daten', ...CATEGORIES.map((c) => CATEGORY_LABEL[c]), 'davon geschätzt', 'Gesamt', 'Ø pro Monat']
    const rows: (string | number)[][] = [head]
    for (const y of years) {
      const per = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<string, number>
      let est = 0
      let months = 0
      for (const key of monthly.keys) {
        if (!key.startsWith(String(y))) continue
        months++
        const rec = monthly.months.get(key)
        const e = monthly.estimated.get(key)
        for (const c of CATEGORIES) per[c] += (rec?.[c] ?? 0) + (e?.[c] ?? 0)
        est += e ? totalOfMonth(e) : 0
      }
      const total = CATEGORIES.reduce((s, c) => s + per[c], 0)
      rows.push([y, months, ...CATEGORIES.map((c) => round2(per[c])), round2(est), round2(total), months > 0 ? round2(total / months) : 0])
    }
    const ws = XLSX.utils.aoa_to_sheet(rows)
    fmtSheet(ws, [8, 16, ...CATEGORIES.map(() => 13), 15, 12, 12], [...CATEGORIES.map((_, i) => i + 2), CATEGORIES.length + 2, CATEGORIES.length + 3, CATEGORIES.length + 4])
    XLSX.utils.book_append_sheet(wb, ws, 'Jahresübersicht')
  }

  // --- Monatskosten (belegt und geschaetzt getrennt) -----------------------
  {
    const head = ['Monat', ...CATEGORIES.map((c) => CATEGORY_LABEL[c]), ...CATEGORIES.map((c) => `${CATEGORY_LABEL[c]} (geschätzt)`), 'Gesamt']
    const rows: (string | number)[][] = [head]
    for (const key of monthly.keys) {
      const rec = monthly.months.get(key)
      const est = monthly.estimated.get(key)
      const total = (rec ? totalOfMonth(rec) : 0) + (est ? totalOfMonth(est) : 0)
      rows.push([key, ...CATEGORIES.map((c) => round2(rec?.[c] ?? 0)), ...CATEGORIES.map((c) => round2(est?.[c] ?? 0)), round2(total)])
    }
    const ws = XLSX.utils.aoa_to_sheet(rows)
    const n = CATEGORIES.length
    fmtSheet(ws, [10, ...Array.from({ length: 2 * n }, () => 13), 12], Array.from({ length: 2 * n + 1 }, (_, i) => i + 1))
    ws['!autofilter'] = { ref: ws['!ref'] ?? 'A1' }
    XLSX.utils.book_append_sheet(wb, ws, 'Monatskosten')
  }

  // --- Belege --------------------------------------------------------------
  {
    const head = ['ID', 'Kategorie', 'Art', 'Anbieter', 'Belegdatum', 'Zeitraum von', 'Zeitraum bis', 'Betrag', 'Menge', 'Einheit', 'Notiz', 'Original-Datei']
    const rows: (string | number)[][] = [head]
    for (const inv of [...bundle.invoices].sort((a, b) => a.date.localeCompare(b.date))) {
      rows.push([
        inv.id, CATEGORY_LABEL[inv.category], inv.kind, inv.vendor, inv.date,
        inv.periodStart ?? '', inv.periodEnd ?? '', inv.amountEur, inv.quantity ?? '', inv.unit ?? '', inv.note ?? '', inv.sourceFile ?? '',
      ])
    }
    const ws = XLSX.utils.aoa_to_sheet(rows)
    fmtSheet(ws, [18, 14, 11, 22, 11, 11, 11, 11, 9, 8, 40, 30], [7])
    ws['!autofilter'] = { ref: ws['!ref'] ?? 'A1' }
    XLSX.utils.book_append_sheet(wb, ws, 'Belege')
  }

  // --- Zaehlerstaende + Jahresverbrauch ------------------------------------
  {
    const rows: (string | number)[][] = [['Zähler', 'Typ', 'Datum', 'Stand', 'Einheit']]
    for (const r of [...bundle.readings].sort((a, b) => a.date.localeCompare(b.date))) {
      rows.push([r.meter, r.type, r.date, r.value, r.unit])
    }
    rows.push([])
    rows.push(['Jahresverbrauch (interpoliert)', '', '', '', ''])
    rows.push(['Jahr', 'Strom (kWh)', 'vollständig', 'Wasser (m³)', 'vollständig'])
    const strom = new Map(yearlyConsumption(bundle.readings, 'strom').map((y) => [y.year, y]))
    const wasser = new Map(yearlyConsumption(bundle.readings, 'wasser').map((y) => [y.year, y]))
    for (const y of [...new Set([...strom.keys(), ...wasser.keys()])].sort()) {
      rows.push([y, Math.round(strom.get(y)?.value ?? 0), strom.get(y) ? (strom.get(y)!.complete ? 'ja' : 'teilweise') : '', Math.round(wasser.get(y)?.value ?? 0), wasser.get(y) ? (wasser.get(y)!.complete ? 'ja' : 'teilweise') : ''])
    }
    const ws = XLSX.utils.aoa_to_sheet(rows)
    ws['!cols'] = [{ wch: 16 }, { wch: 12 }, { wch: 11 }, { wch: 12 }, { wch: 11 }]
    XLSX.utils.book_append_sheet(wb, ws, 'Zählerstände')
  }

  // --- Annahmen ------------------------------------------------------------
  {
    const rows: string[][] = [
      ['Hinweise zur Methodik'],
      [''],
      ['Kosten sind dem Verbrauchszeitraum zugeordnet, nicht dem Zahlungsdatum:'],
      ['- Abrechnungen (mit Leistungszeitraum) verdrängen Abschläge derselben Kategorie im selben Zeitraum.'],
      ['- Wärmekosten werden gradtagzahlgewichtet auf die Monate verteilt (Winter schwer, Sommer leicht).'],
      [`- Brennholz-Einkäufe werden als Lager über ${bundle.settings.woodSpreadMonths} Monate Heizperiode verteilt.`],
      ['- Geschätzte Werte füllen Beleg-Lücken innerhalb der belegten Spanne (Tagessatz der Nachbarzeiträume, wärmegewichtet).'],
      ['  Sie stehen in eigenen Spalten ("geschätzt") und sind nie mit belegten Kosten vermischt.'],
      [''],
      [`Haus: ${bundle.settings.house.name}, ${bundle.settings.house.location}`],
      [`Heizung: ${bundle.settings.house.heatingSystem ?? ''}`],
      [`Export erstellt: ${new Date().toLocaleString('de-DE')}`],
    ]
    const ws = XLSX.utils.aoa_to_sheet(rows)
    ws['!cols'] = [{ wch: 110 }]
    XLSX.utils.book_append_sheet(wb, ws, 'Annahmen')
  }

  XLSX.writeFile(wb, `hauskosten-export-${new Date().toISOString().slice(0, 10)}.xlsx`)
}

const round2 = (v: number): number => Math.round(v * 100) / 100
