<script setup lang="ts">
import { ref, computed } from "vue"
import type { DashboardStatsResult } from "../../api/technitium"

const props = defineProps<{ chart: DashboardStatsResult["response"]["mainChartData"] }>()

const W = 640
const H = 200
const PAD = 8

// mainChartData actually carries 11 series (Total, No Error, Server
// Failure, NX Domain, Refused, Authoritative, Recursive, Cached,
// Blocked, Dropped, Clients — confirmed live) — the approved wireframe
// intentionally scoped this chart to 3 (Total / No Error / Blocked),
// matching its "Queries over time" subtitle. Rendering all 11 produced
// a cluttered chart nobody approved; filter back down to those 3.
const WIREFRAME_SERIES = ["Total", "No Error", "Blocked"]

const datasets = computed(() => props.chart.datasets.filter((d) => WIREFRAME_SERIES.includes(d.label)))

// Technitium's API already assigns each dataset a color (mainChartData
// datasets carry their own borderColor/backgroundColor) — reuse those
// instead of hardcoding a palette, so the chart stays correct if the
// server ever adds or reorders series.
const paths = computed(() => {
  const allValues = datasets.value.flatMap((d) => d.data)
  const max = Math.max(1, ...allValues) * 1.1
  const n = props.chart.labels.length || 1

  const x = (i: number) => (n <= 1 ? PAD : (i / (n - 1)) * (W - 2 * PAD) + PAD)
  const y = (v: number) => H - PAD - (v / max) * (H - 2 * PAD)

  return datasets.value.map((d) => {
    const line = d.data.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")
    const area = `${line} L${x(n - 1).toFixed(1)},${H - PAD} L${x(0).toFixed(1)},${H - PAD} Z`
    return {
      label: d.label,
      line,
      area,
      stroke: d.borderColor ?? "rgb(var(--color-accent))",
      fill: d.fill ? (d.backgroundColor ?? "transparent") : "none",
      dotX: x,
      dotY: y,
    }
  })
})

// Hover — tracks the nearest data point to the pointer (as a percent
// of the chart's rendered width, not the SVG's internal viewBox units,
// so it stays correct regardless of how the SVG is scaled on screen)
// and shows a crosshair plus each series' value at that point.
const chartEl = ref<HTMLDivElement | null>(null)
const hoverIndex = ref<number | null>(null)

function onPointerMove(e: PointerEvent): void {
  const el = chartEl.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const n = props.chart.labels.length || 1
  if (n <= 1) {
    hoverIndex.value = 0
    return
  }
  const relX = (e.clientX - rect.left) / rect.width
  hoverIndex.value = Math.min(n - 1, Math.max(0, Math.round(relX * (n - 1))))
}

function onPointerLeave(): void {
  hoverIndex.value = null
}

const hoverPercent = computed(() => {
  if (hoverIndex.value === null) return 0
  const n = props.chart.labels.length || 1
  return n <= 1 ? 0 : (hoverIndex.value / (n - 1)) * 100
})

// Flips the tooltip to hang from the other side once it would
// otherwise run off the chart's edge.
const tooltipAlign = computed<"left" | "right">(() => (hoverPercent.value > 65 ? "right" : "left"))

// Technitium's chart labels are full ISO timestamps regardless of time
// range (confirmed live — even labelFormat: "HH:mm" data carries
// "2026-09-16T02:20:00Z"-style strings), so show something readable
// rather than the raw string.
function formatLabel(label: string): string {
  const date = new Date(label)
  if (Number.isNaN(date.getTime())) return label
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
}

const hoverPoints = computed(() => {
  if (hoverIndex.value === null) return []
  const i = hoverIndex.value
  return datasets.value.map((d) => ({ label: d.label, value: d.data[i] ?? 0, stroke: d.borderColor ?? "rgb(var(--color-accent))" }))
})
</script>

<template>
  <div>
    <div v-if="paths.length === 0" class="py-10 text-center text-sm text-gray-500">
      No query data for this time range yet.
    </div>
    <template v-else>
      <div id="queries-chart" ref="chartEl" class="relative" @pointermove="onPointerMove" @pointerleave="onPointerLeave">
        <svg :viewBox="`0 0 ${W} ${H}`" class="block h-[190px] w-full" preserveAspectRatio="none">
          <line
            v-for="g in [0, 1, 2, 3]"
            :key="g"
            x1="0"
            :y1="PAD + (g * (H - 2 * PAD)) / 3"
            :x2="W"
            :y2="PAD + (g * (H - 2 * PAD)) / 3"
            stroke="rgb(var(--color-border))"
            stroke-width="1"
          />
          <template v-for="path in paths" :key="path.label">
            <path :d="path.area" :fill="path.fill" stroke="none" />
            <path :d="path.line" fill="none" :stroke="path.stroke" stroke-width="2" stroke-linejoin="round" />
          </template>
          <template v-if="hoverIndex !== null">
            <line
              :x1="paths[0]!.dotX(hoverIndex)"
              y1="0"
              :x2="paths[0]!.dotX(hoverIndex)"
              :y2="H"
              stroke="rgb(var(--color-border))"
              stroke-width="1"
              stroke-dasharray="3,3"
            />
            <circle
              v-for="path in paths"
              :key="path.label"
              :cx="path.dotX(hoverIndex)"
              :cy="path.dotY(datasets.find((d) => d.label === path.label)?.data[hoverIndex] ?? 0)"
              r="3.5"
              :fill="path.stroke"
              stroke="rgb(var(--color-bg-card))"
              stroke-width="1.5"
            />
          </template>
        </svg>

        <div
          v-if="hoverIndex !== null"
          id="queries-chart-tooltip"
          class="pointer-events-none absolute top-1 z-10 rounded-md border border-border bg-background-elevated px-2.5 py-2 text-[11px] shadow-md"
          :style="{
            left: tooltipAlign === 'left' ? `${hoverPercent}%` : undefined,
            right: tooltipAlign === 'right' ? `${100 - hoverPercent}%` : undefined,
            transform: tooltipAlign === 'left' ? 'translateX(8px)' : 'translateX(-8px)',
          }"
        >
          <div class="mb-1 font-semibold text-fg">{{ formatLabel(chart.labels[hoverIndex]!) }}</div>
          <div v-for="pt in hoverPoints" :key="pt.label" class="flex items-center gap-1.5 text-gray-500">
            <span class="inline-block h-2 w-2 flex-none rounded-sm" :style="{ background: pt.stroke }" />
            <span class="flex-none">{{ pt.label }}</span>
            <span class="ml-auto pl-2 font-semibold tabular-nums text-fg">{{ pt.value.toLocaleString() }}</span>
          </div>
        </div>
      </div>

      <div class="mt-2 flex flex-wrap gap-3 text-[10.5px] text-gray-500">
        <span v-for="path in paths" :key="path.label" class="inline-flex items-center gap-1.5">
          <span class="inline-block h-2 w-2 rounded-sm" :style="{ background: path.stroke }" />
          {{ path.label }}
        </span>
      </div>
    </template>
  </div>
</template>
