import type { Category } from './schema'

/**
 * Farb-Tokens der dataviz-Referenzpalette. Die Kategorie->Farbslot-Zuordnung
 * ist FIX — Farbe folgt der Kategorie, nie ihrer Position oder ihrem Rang.
 * Dark ist eine eigene, validierte Abstufung derselben Farbtoene.
 */

export type Mode = 'light' | 'dark'

const SERIES: Record<Category, { light: string; dark: string }> = {
  strom: { light: '#2a78d6', dark: '#3987e5' },
  holz: { light: '#eb6834', dark: '#d95926' },
  wasser: { light: '#1baf7a', dark: '#199e70' },
  abwasser: { light: '#eda100', dark: '#c98500' },
  kaminkehrer: { light: '#e87ba4', dark: '#d55181' },
  wartung: { light: '#008300', dark: '#008300' },
  sonstiges: { light: '#4a3aa7', dark: '#9085e9' },
}

export const seriesColor = (c: Category, mode: Mode): string => SERIES[c][mode]

/** De-Emphasis-Grau fuer Kontext-Serien (Emphasis-Form) */
export const deEmphasis = (mode: Mode): string => (mode === 'light' ? '#c3c2b7' : '#52514e')

export interface ChartTokens {
  surface: string
  textPrimary: string
  textSecondary: string
  textMuted: string
  grid: string
  baseline: string
  accent: string
}

export const chartTokens = (mode: Mode): ChartTokens =>
  mode === 'light'
    ? {
        surface: '#fcfcfb',
        textPrimary: '#0b0b0b',
        textSecondary: '#52514e',
        textMuted: '#898781',
        grid: '#e1e0d9',
        baseline: '#c3c2b7',
        accent: '#2a78d6',
      }
    : {
        surface: '#1a1a19',
        textPrimary: '#ffffff',
        textSecondary: '#c3c2b7',
        textMuted: '#898781',
        grid: '#2c2c2a',
        baseline: '#383835',
        accent: '#3987e5',
      }
