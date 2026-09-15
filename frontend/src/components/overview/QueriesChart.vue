<script setup lang="ts">
import { computed } from "vue"
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

// Technitium's API already assigns each dataset a color (mainChartData
// datasets carry their own borderColor/backgroundColor) — reuse those
// instead of hardcoding a palette, so the chart stays correct if the
// server ever adds or reorders series.
const paths = computed(() => {
  const datasets = props.chart.datasets.filter((d) => WIREFRAME_SERIES.includes(d.label))
  const allValues = datasets.flatMap((d) => d.data)
  const max = Math.max(1, ...allValues) * 1.1
  const n = props.chart.labels.length || 1

  const x = (i: number) => (n <= 1 ? PAD : (i / (n - 1)) * (W - 2 * PAD) + PAD)
  const y = (v: number) => H - PAD - (v / max) * (H - 2 * PAD)

  return datasets.map((d) => {
    const line = d.data.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")
    const area = `${line} L${x(n - 1).toFixed(1)},${H - PAD} L${x(0).toFixed(1)},${H - PAD} Z`
    return {
      label: d.label,
      line,
      area,
      stroke: d.borderColor ?? "rgb(var(--color-accent))",
      fill: d.fill ? (d.backgroundColor ?? "transparent") : "none",
    }
  })
})
</script>

<template>
  <div>
    <div v-if="paths.length === 0" class="py-10 text-center text-sm text-gray-500">
      No query data for this time range yet.
    </div>
    <template v-else>
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
      </svg>
      <div class="mt-2 flex flex-wrap gap-3 text-[10.5px] text-gray-500">
        <span v-for="path in paths" :key="path.label" class="inline-flex items-center gap-1.5">
          <span class="inline-block h-2 w-2 rounded-sm" :style="{ background: path.stroke }" />
          {{ path.label }}
        </span>
      </div>
    </template>
  </div>
</template>
