import type { StatsDuration } from "../api/technitium"
import { durationToRange, type DateRange } from "./dateRange"

// Pure helpers behind the Overview charts. Nothing here touches the DOM
// or the network, so the geometry and bucketing rules are unit-tested
// directly instead of through rendered SVG.

export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("en-US")
}

export function pct(part: number, total: number, digits = 1): string {
  if (total <= 0) return "0%"
  return `${((part / total) * 100).toFixed(digits)}%`
}

// ---------- previous period (for the tiles' "vs previous" change) ----------

// The window of the same length that ends where the current one starts.
// Custom has no fixed length, so it has no comparison.
export function previousRange(duration: StatsDuration, now: Date = new Date()): DateRange | null {
  if (duration === "Custom") return null
  const cur = durationToRange(duration, now)
  const start = new Date(cur.start).getTime()
  const span = new Date(cur.end).getTime() - start
  return { start: new Date(start - span).toISOString(), end: cur.start }
}

export const RANGE_NOUN: Record<StatsDuration, string> = {
  LastHour: "hour",
  LastDay: "24h",
  LastWeek: "7d",
  LastMonth: "30d",
  LastYear: "year",
  Custom: "period",
}

export interface Change {
  dir: "up" | "down" | "flat"
  text: string
}

function direction(diff: number): Change["dir"] {
  return diff > 0 ? "up" : diff < 0 ? "down" : "flat"
}

const ARROW = { up: "▲", down: "▼", flat: "•" } as const

// Relative change of a count ("▲ 11.9%"). Null when there is nothing to
// compare against, so the tile shows no change instead of "Infinity%".
export function countChange(cur: number, prev: number): Change | null {
  if (prev <= 0) return null
  const diff = cur - prev
  const dir = direction(diff)
  return { dir, text: dir === "flat" ? `${ARROW.flat} no change` : `${ARROW[dir]} ${Math.abs((diff / prev) * 100).toFixed(1)}%` }
}

// Change of a share, in percentage points ("▲ 2.1 pts").
export function shareChange(cur: number, curTotal: number, prev: number, prevTotal: number): Change | null {
  if (prevTotal <= 0 || curTotal <= 0) return null
  const diff = (cur / curTotal - prev / prevTotal) * 100
  const rounded = Math.round(diff * 10) / 10
  const dir = direction(rounded)
  return { dir, text: dir === "flat" ? `${ARROW.flat} no change` : `${ARROW[dir]} ${Math.abs(rounded).toFixed(1)} pts` }
}

// Change of a small absolute number ("▲ 2").
export function absChange(cur: number, prev: number): Change | null {
  if (prev <= 0) return null
  const diff = cur - prev
  const dir = direction(diff)
  return { dir, text: dir === "flat" ? `${ARROW.flat} no change` : `${ARROW[dir]} ${fmtInt(Math.abs(diff))}` }
}

// ---------- scales ----------

// Rounds a maximum up to 1, 2, 4, 8 or 10 times a power of ten. The axis has
// four intervals, and these are the steps whose quarters stay whole numbers.
export function niceMax(v: number): number {
  if (v <= 0) return 1
  const p = Math.pow(10, Math.floor(Math.log10(v)))
  for (const m of [1, 2, 4, 8, 10]) if (m * p >= v) return m * p
  return 10 * p
}

// ---------- time labels ----------

function stepMs(labels: string[]): number {
  if (labels.length < 2) return 3600_000
  return Math.max(1, new Date(labels[1]!).getTime() - new Date(labels[0]!).getTime())
}

// Axis label for a data point. Technitium's labels are always full ISO
// timestamps, so the granularity is read from the spacing between them.
export function tickLabel(iso: string, labels: string[]): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const step = stepMs(labels)
  if (step >= 28 * 86400_000 * 0.9) return d.toLocaleDateString(undefined, { month: "short", year: "2-digit" })
  if (step >= 20 * 3600_000) return d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
  if (step >= 3600_000) return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false })
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false })
}

export function fullLabel(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
}

// End of the bucket that starts at labels[i]: the next label, or one
// step after the last. Used to turn a brushed index range into a window.
export function bucketEnd(labels: string[], i: number): string {
  const next = labels[i + 1]
  if (next) return new Date(next).toISOString()
  return new Date(new Date(labels[i]!).getTime() + stepMs(labels)).toISOString()
}

// ---------- donuts ----------

export interface Slice<T> {
  item: T
  value: number
  share: number
  start: number
  end: number
}

// Clockwise from 12 o'clock. Zero-value items keep their legend row but
// get a zero-width arc.
export function sliceAngles<T extends { value: number }>(items: T[]): Slice<T>[] {
  const total = items.reduce((a, b) => a + b.value, 0)
  let a = 0
  return items.map((item) => {
    const span = total > 0 ? (item.value / total) * Math.PI * 2 : 0
    const s: Slice<T> = { item, value: item.value, share: total > 0 ? item.value / total : 0, start: a, end: a + span }
    a += span
    return s
  })
}

export function arcPath(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string {
  if (a1 - a0 <= 0) return ""
  // A single full-circle slice cannot be drawn as one arc.
  const end = a1 - a0 >= Math.PI * 2 ? a0 + Math.PI * 2 - 0.0001 : a1
  const pt = (r: number, a: number) => `${(cx + r * Math.sin(a)).toFixed(2)},${(cy - r * Math.cos(a)).toFixed(2)}`
  const large = end - a0 > Math.PI ? 1 : 0
  return `M${pt(r1, a0)}A${r1},${r1} 0 ${large} 1 ${pt(r1, end)}L${pt(r0, end)}A${r0},${r0} 0 ${large} 0 ${pt(r0, a0)}Z`
}

// ---------- heatmap ----------

// Buckets hourly points into weekday (Mon = 0) by hour of day, in the
// viewer's local time, summing points that land in the same cell.
export function bucketHeatmap(points: { time: string; value: number }[]): number[][] {
  const grid = Array.from({ length: 7 }, () => Array<number>(24).fill(0))
  for (const p of points) {
    const d = new Date(p.time)
    if (Number.isNaN(d.getTime())) continue
    const day = (d.getDay() + 6) % 7
    grid[day]![d.getHours()]! += p.value
  }
  return grid
}

// ---------- latency ----------

export const LATENCY_BINS: { label: string; max: number }[] = [
  { label: "<1", max: 1 },
  { label: "1–2", max: 2 },
  { label: "2–5", max: 5 },
  { label: "5–10", max: 10 },
  { label: "10–20", max: 20 },
  { label: "20–50", max: 50 },
  { label: "50–100", max: 100 },
  { label: "100–200", max: 200 },
  { label: ">200", max: Infinity },
]
// Bins from this index on are the slow tail and are drawn in orange.
export const SLOW_BIN_FROM = 7

export function latencyBins(rtts: number[]): { label: string; count: number }[] {
  const counts = LATENCY_BINS.map(() => 0)
  for (const r of rtts) {
    const i = LATENCY_BINS.findIndex((b) => r < b.max)
    counts[i === -1 ? counts.length - 1 : i]!++
  }
  return LATENCY_BINS.map((b, i) => ({ label: b.label, count: counts[i]! }))
}

// The bin that contains the p-th percentile (p in 0..1).
export function percentileBin(bins: { label: string; count: number }[], p: number): string {
  const total = bins.reduce((a, b) => a + b.count, 0)
  if (total === 0) return "–"
  let cum = 0
  for (const b of bins) {
    cum += b.count
    if (cum >= total * p) return b.label
  }
  return bins[bins.length - 1]!.label
}

// ---------- flow diagram ----------

export interface FlowNode {
  x: number
  y: number
  h: number
  value: number
}

// Stacks nodes top to bottom, each as tall as its share of the total
// (never thinner than minH, so small flows stay visible).
export function stackNodes(values: number[], x: number, top: number, scale: number, gap: number, minH = 3): FlowNode[] {
  let y = top
  return values.map((value) => {
    const h = Math.max(minH, value * scale)
    const node = { x, y, h, value }
    y += h + gap
    return node
  })
}
