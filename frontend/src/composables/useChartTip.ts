import { ref } from "vue"

export interface TipRow {
  label: string
  value: string
  color?: string
}

export interface Tip {
  x: number
  y: number
  title: string
  rows: TipRow[]
}

// One floating tooltip per chart, positioned at the pointer. Fixed
// positioning (see ChartTip.vue) keeps it from being clipped by a
// panel's overflow, which the scrolling flow diagram would otherwise do.
export function useChartTip() {
  const tip = ref<Tip | null>(null)

  function show(e: { clientX: number; clientY: number }, title: string, rows: TipRow[] = []): void {
    tip.value = { x: e.clientX, y: e.clientY, title, rows }
  }

  function hide(): void {
    tip.value = null
  }

  return { tip, show, hide }
}
