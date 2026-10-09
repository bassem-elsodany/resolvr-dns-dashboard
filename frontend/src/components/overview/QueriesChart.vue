<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue"
import { useRouter } from "vue-router"
import type { DashboardStatsResult } from "../../api/technitium"
import { bucketEnd, fmtInt, fullLabel, niceMax, pct, tickLabel } from "../../lib/charts"
import { useChartTip } from "../../composables/useChartTip"
import ChartTip from "../charts/ChartTip.vue"

const props = defineProps<{ chart: DashboardStatsResult["response"]["mainChartData"] }>()
const router = useRouter()
const { tip, show, hide } = useChartTip()

const W = 720
const H = 250
const ML = 46
const MR = 12
const MT = 10
const MB = 26

// mainChartData carries 11 series; the chart offers the four that answer
// "what is my resolver doing". Colour follows the series, so toggling one
// never repaints the others.
const SERIES = [
  { key: "total", dataset: "Total", label: "Total", color: "rgb(var(--color-chart-blue))" },
  { key: "blocked", dataset: "Blocked", label: "Blocked", color: "rgb(var(--color-chart-red))" },
  { key: "nx", dataset: "NX Domain", label: "NXDomain", color: "rgb(var(--color-chart-orange))" },
  { key: "cached", dataset: "Cached", label: "Cached", color: "rgb(var(--color-chart-aqua))" },
] as const

const BLUE = "rgb(var(--color-chart-blue))"
const RED = "rgb(var(--color-chart-red))"

function dataOf(dataset: string): number[] {
  return props.chart.datasets.find((d) => d.label === dataset)?.data ?? []
}

const labels = computed(() => props.chart.labels)
const n = computed(() => labels.value.length)
const available = computed(() => SERIES.filter((s) => dataOf(s.dataset).length > 0))
const total = computed(() => dataOf("Total"))
const blocked = computed(() => dataOf("Blocked"))
const allowed = computed(() => total.value.map((v, i) => Math.max(0, v - (blocked.value[i] ?? 0))))
const canStack = computed(() => total.value.length > 0 && blocked.value.length > 0)

const on = reactive<Record<string, boolean>>({ total: true, blocked: true, nx: false, cached: false })
const mode = ref<"lines" | "stack">("lines")
const view = reactive({ lo: 0, hi: 0 })
const brush = ref<{ a: number; b: number } | null>(null)
const hover = ref<number | null>(null)
const dragging = ref(false)

// A new range (different number of points) starts fully zoomed out; a
// live refresh that merely rolls the window keeps the user's zoom but
// drops a selection, whose indexes would now point at different times.
watch(
  () => n.value,
  (len) => {
    view.lo = 0
    view.hi = Math.max(0, len - 1)
    brush.value = null
  },
  { immediate: true },
)
watch(
  () => labels.value[0],
  () => {
    brush.value = null
  },
)

function toggle(key: string): void {
  on[key] = !on[key]
  if (!SERIES.some((s) => on[s.key])) on[key] = true
}

const active = computed(() => available.value.filter((s) => on[s.key]))
const zoomed = computed(() => view.lo !== 0 || view.hi !== n.value - 1)
const span = computed(() => view.hi - view.lo + 1)

const ymax = computed(() => {
  let mx = 1
  for (let i = view.lo; i <= view.hi; i++) {
    if (mode.value === "stack") mx = Math.max(mx, total.value[i] ?? 0)
    else for (const s of active.value) mx = Math.max(mx, dataOf(s.dataset)[i] ?? 0)
  }
  return niceMax(mx * 1.05)
})

const x = (i: number) => ML + ((i - view.lo) / Math.max(1, span.value - 1)) * (W - ML - MR)
const y = (v: number) => MT + (1 - v / ymax.value) * (H - MT - MB)

const yTicks = computed(() => [0, 1, 2, 3, 4].map((t) => ({ y: y((ymax.value * t) / 4), label: fmtInt((ymax.value * t) / 4), axis: t === 0 })))
const xTicks = computed(() => {
  const step = span.value > 12 ? Math.ceil(span.value / 6) : span.value > 6 ? 2 : 1
  const out: { x: number; label: string }[] = []
  for (let i = view.lo; i <= view.hi; i += step) out.push({ x: x(i), label: tickLabel(labels.value[i]!, labels.value) })
  return out
})

function line(data: number[]): string {
  let d = ""
  for (let i = view.lo; i <= view.hi; i++) d += `${i === view.lo ? "M" : "L"}${x(i).toFixed(1)},${y(data[i] ?? 0).toFixed(1)}`
  return d
}

function areaBetween(lower: number[], upper: number[]): string {
  let d = ""
  for (let i = view.lo; i <= view.hi; i++) d += `${i === view.lo ? "M" : "L"}${x(i).toFixed(1)},${y(upper[i] ?? 0).toFixed(1)}`
  for (let i = view.hi; i >= view.lo; i--) d += `L${x(i).toFixed(1)},${y(lower[i] ?? 0).toFixed(1)}`
  return `${d}Z`
}

const lines = computed(() =>
  active.value.map((s, idx) => {
    const d = line(dataOf(s.dataset))
    return {
      ...s,
      d,
      area: idx === 0 ? `${d}L${x(view.hi)},${y(0)}L${x(view.lo)},${y(0)}Z` : null,
    }
  }),
)

const stacks = computed(() => {
  const zero = total.value.map(() => 0)
  const top = total.value.map((_, i) => allowed.value[i]! + (blocked.value[i] ?? 0))
  return [
    { key: "allowed", color: BLUE, d: areaBetween(zero, allowed.value) },
    { key: "blocked", color: RED, d: areaBetween(allowed.value, top) },
  ]
})

const dots = computed(() => {
  const i = hover.value
  if (i === null || dragging.value) return []
  if (mode.value === "stack") {
    return [
      { color: BLUE, cx: x(i), cy: y(allowed.value[i] ?? 0) },
      { color: RED, cx: x(i), cy: y(total.value[i] ?? 0) },
    ]
  }
  return active.value.map((s) => ({ color: s.color, cx: x(i), cy: y(dataOf(s.dataset)[i] ?? 0) }))
})

const brushRect = computed(() => {
  const b = brush.value
  if (!b) return null
  const a = Math.min(b.a, b.b)
  const z = Math.max(b.a, b.b)
  return { x: x(a), width: Math.max(1, x(z) - x(a)) }
})

const svgEl = ref<SVGSVGElement | null>(null)

function indexAt(e: PointerEvent): number {
  const rect = svgEl.value!.getBoundingClientRect()
  if (rect.width === 0) return view.lo
  const vx = ((e.clientX - rect.left) / rect.width) * W
  const i = view.lo + Math.round(((vx - ML) / (W - ML - MR)) * (span.value - 1))
  return Math.max(view.lo, Math.min(view.hi, i))
}

function onDown(e: PointerEvent): void {
  const i = indexAt(e)
  brush.value = { a: i, b: i }
  dragging.value = true
  hide()
  ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
}

function onMove(e: PointerEvent): void {
  const i = indexAt(e)
  if (dragging.value) {
    brush.value!.b = i
    return
  }
  hover.value = i
  const rows =
    mode.value === "stack"
      ? [
          { label: "Allowed", value: fmtInt(allowed.value[i] ?? 0), color: BLUE },
          { label: "Blocked", value: fmtInt(blocked.value[i] ?? 0), color: RED },
        ]
      : active.value.map((s) => ({ label: s.label, value: fmtInt(dataOf(s.dataset)[i] ?? 0), color: s.color }))
  show(e, fullLabel(labels.value[i]!), rows)
}

function onUp(): void {
  dragging.value = false
  if (brush.value && brush.value.a === brush.value.b) brush.value = null
}

function onLeave(): void {
  if (dragging.value) return
  hover.value = null
  hide()
}

const selection = computed(() => {
  const b = brush.value
  if (!b || dragging.value || b.a === b.b) return null
  const lo = Math.min(b.a, b.b)
  const hi = Math.max(b.a, b.b)
  const sum = (a: number[]) => a.slice(lo, hi + 1).reduce((s, v) => s + v, 0)
  return {
    lo,
    hi,
    from: tickLabel(labels.value[lo]!, labels.value),
    to: tickLabel(labels.value[hi]!, labels.value),
    queries: sum(total.value),
    blocked: sum(blocked.value),
  }
})

function openInLogs(): void {
  const s = selection.value
  if (!s) return
  void router.push({
    path: "/logs",
    query: { start: new Date(labels.value[s.lo]!).toISOString(), end: bucketEnd(labels.value, s.hi) },
  })
}

function zoomIn(): void {
  const s = selection.value
  if (!s) return
  view.lo = s.lo
  view.hi = Math.min(n.value - 1, Math.max(s.hi, s.lo + 2))
  brush.value = null
}

function resetZoom(): void {
  view.lo = 0
  view.hi = Math.max(0, n.value - 1)
  brush.value = null
}
</script>

<template>
  <div>
    <div v-if="available.length === 0 || n === 0" class="py-10 text-center text-sm text-gray-500">
      No query data for this time range yet.
    </div>
    <template v-else>
      <div class="mb-2 mt-1 flex flex-wrap items-center gap-1.5">
        <button
          v-for="s in available"
          :key="s.key"
          type="button"
          :data-series="s.key"
          :aria-pressed="mode === 'lines' && on[s.key]"
          :disabled="mode === 'stack'"
          class="series-chip inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs disabled:opacity-50"
          :class="mode === 'lines' && !on[s.key] ? 'border-dashed border-gray-600 text-gray-500' : 'border-border-hover text-fg'"
          @click="toggle(s.key)"
        >
          <span class="inline-block h-2.5 w-2.5 rounded-sm" :style="{ background: s.color, opacity: mode === 'lines' && !on[s.key] ? 0.35 : 1 }" />
          {{ s.label }}
        </button>
        <div
          v-if="canStack"
          role="group"
          aria-label="Chart mode"
          class="ml-auto inline-flex gap-0.5 rounded-lg border border-border bg-background-card p-0.5"
        >
          <button
            id="mode-lines"
            type="button"
            :aria-pressed="mode === 'lines'"
            class="rounded-md px-2.5 py-1 text-xs"
            :class="mode === 'lines' ? 'bg-background-hover font-semibold text-fg' : 'text-gray-500'"
            @click="mode = 'lines'"
          >
            Lines
          </button>
          <button
            id="mode-stack"
            type="button"
            :aria-pressed="mode === 'stack'"
            class="rounded-md px-2.5 py-1 text-xs"
            :class="mode === 'stack' ? 'bg-background-hover font-semibold text-fg' : 'text-gray-500'"
            @click="mode = 'stack'"
          >
            Allowed vs blocked
          </button>
        </div>
      </div>

      <div id="queries-chart" class="relative touch-pan-y">
        <svg
          ref="svgEl"
          :viewBox="`0 0 ${W} ${H}`"
          class="block h-auto w-full cursor-crosshair select-none"
          role="img"
          aria-label="Queries over time"
          @pointerdown="onDown"
          @pointermove="onMove"
          @pointerup="onUp"
          @pointerleave="onLeave"
        >
          <g v-for="t in yTicks" :key="t.label + t.y">
            <line
              :x1="ML"
              :x2="W - MR"
              :y1="t.y"
              :y2="t.y"
              :stroke="t.axis ? 'rgb(var(--color-border-hover))' : 'rgb(var(--color-border))'"
            />
            <text :x="ML - 8" :y="t.y + 4" font-size="11" text-anchor="end" style="fill: rgb(var(--color-gray-500))">{{ t.label }}</text>
          </g>
          <text
            v-for="t in xTicks"
            :key="t.x"
            :x="t.x"
            :y="H - 7"
            font-size="11"
            text-anchor="middle"
            style="fill: rgb(var(--color-gray-500))"
          >
            {{ t.label }}
          </text>

          <template v-if="mode === 'stack' && canStack">
            <path
              v-for="s in stacks"
              :key="s.key"
              :d="s.d"
              :fill="s.color"
              fill-opacity="0.85"
              stroke="rgb(var(--color-bg-card))"
              stroke-width="2"
              stroke-linejoin="round"
            />
          </template>
          <template v-else>
            <template v-for="l in lines" :key="l.key">
              <path v-if="l.area" :d="l.area" :fill="l.color" fill-opacity="0.1" />
              <path :d="l.d" fill="none" :stroke="l.color" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
            </template>
          </template>

          <rect
            v-if="brushRect"
            id="chart-brush"
            :x="brushRect.x"
            :y="MT"
            :width="brushRect.width"
            :height="H - MT - MB"
            fill="rgb(var(--color-chart-blue))"
            fill-opacity="0.14"
            stroke="rgb(var(--color-chart-blue))"
            stroke-dasharray="4 3"
          />
          <template v-if="hover !== null && !dragging">
            <line :x1="x(hover)" :x2="x(hover)" :y1="MT" :y2="H - MB" stroke="rgb(var(--color-gray-400))" stroke-dasharray="3 3" />
            <circle
              v-for="(d, i) in dots"
              :key="i"
              :cx="d.cx"
              :cy="d.cy"
              r="4.5"
              :fill="d.color"
              stroke="rgb(var(--color-bg-card))"
              stroke-width="2"
            />
          </template>
        </svg>
      </div>

      <div id="chart-selection" class="mt-1.5 flex min-h-8 flex-wrap items-center gap-2 text-xs text-gray-500">
        <template v-if="selection">
          <span>
            <b class="tabular-nums text-fg">{{ selection.from }} to {{ selection.to }}</b>
            &middot; {{ fmtInt(selection.queries) }} queries &middot; {{ fmtInt(selection.blocked) }} blocked ({{
              pct(selection.blocked, selection.queries)
            }})
          </span>
          <button id="selection-open" type="button" class="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white" @click="openInLogs">
            Open in Query Logs
          </button>
          <button id="selection-zoom" type="button" class="rounded-md border border-border-hover px-2.5 py-1 text-xs text-fg" @click="zoomIn">
            Zoom in
          </button>
          <button id="selection-clear" type="button" class="rounded-md border border-border-hover px-2.5 py-1 text-xs text-fg" @click="brush = null">
            Clear
          </button>
        </template>
        <template v-else-if="zoomed">
          <span>
            Zoomed to
            <b class="tabular-nums text-fg">{{ tickLabel(labels[view.lo]!, labels) }} to {{ tickLabel(labels[view.hi]!, labels) }}</b>
          </span>
          <button id="zoom-reset" type="button" class="rounded-md border border-border-hover px-2.5 py-1 text-xs text-fg" @click="resetZoom">
            Reset zoom
          </button>
        </template>
        <span v-else>Hover for values. Drag across the chart to select a time window.</span>
      </div>
      <ChartTip :tip="tip" />
    </template>
  </div>
</template>
