import { useEffect, useRef } from 'react'
import * as echarts from 'echarts/core'
import { BarChart, LineChart } from 'echarts/charts'
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from 'echarts/components'
import { SVGRenderer } from 'echarts/renderers'
import type { EChartsCoreOption } from 'echarts/core'
import { chartTokens, type Mode } from '../lib/palette'

echarts.use([BarChart, LineChart, GridComponent, LegendComponent, TooltipComponent, SVGRenderer])

/**
 * Schlanker ECharts-Wrapper (SVG-Renderer: scharf im Druck).
 * Gemeinsame Chart-Grundeinstellungen nach dataviz-Spezifikation:
 * Hairline-Grid, recessive Achsen, Text in Text-Tokens statt Serienfarbe.
 */
export function baseOption(mode: Mode): EChartsCoreOption {
  const t = chartTokens(mode)
  return {
    textStyle: { fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif' },
    tooltip: {
      backgroundColor: t.surface,
      borderColor: mode === 'light' ? 'rgba(11,11,11,0.1)' : 'rgba(255,255,255,0.1)',
      borderWidth: 1,
      textStyle: { color: t.textPrimary, fontSize: 12 },
      extraCssText: 'box-shadow: 0 4px 16px rgba(0,0,0,0.12); border-radius: 8px;',
    },
    grid: { left: 8, right: 12, top: 36, bottom: 4, containLabel: true },
  }
}

export function axisDefaults(mode: Mode) {
  const t = chartTokens(mode)
  return {
    category: {
      axisLine: { lineStyle: { color: t.baseline } },
      axisTick: { show: false },
      axisLabel: { color: t.textMuted, fontSize: 11 },
    },
    value: {
      axisLine: { show: false },
      axisLabel: { color: t.textMuted, fontSize: 11 },
      splitLine: { lineStyle: { color: t.grid, width: 1, type: 'solid' as const } },
    },
  }
}

export function EChart({
  option,
  mode,
  height = 320,
  ariaLabel,
}: {
  option: EChartsCoreOption
  mode: Mode
  height?: number
  ariaLabel: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)

  useEffect(() => {
    if (!ref.current) return
    const chart = echarts.init(ref.current, undefined, { renderer: 'svg' })
    chartRef.current = chart
    const ro = new ResizeObserver(() => chart.resize())
    ro.observe(ref.current)
    return () => {
      ro.disconnect()
      chart.dispose()
      chartRef.current = null
    }
  }, [])

  useEffect(() => {
    chartRef.current?.setOption(option, { notMerge: true })
  }, [option, mode])

  return <div ref={ref} style={{ height }} role="img" aria-label={ariaLabel} />
}
