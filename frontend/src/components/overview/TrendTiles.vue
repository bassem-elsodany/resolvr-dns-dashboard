<script setup lang="ts">
import { computed, ref } from "vue"
import type { DashboardStatsResult, StatsDuration } from "../../api/technitium"
import {
  absChange,
  countChange,
  fmtInt,
  fullLabel,
  pct,
  RANGE_NOUN,
  shareChange,
  type Change,
} from "../../lib/charts"
import { useChartTip } from "../../composables/useChartTip"
import ChartTip from "../charts/ChartTip.vue"

type Resp = DashboardStatsResult["response"]

const props = defineProps<{
  stats: Resp["stats"]
  // Totals for the window just before this one; null when unavailable.
  prev: Resp["stats"] | null
  chart: Resp["mainChartData"]
  duration: StatsDuration
}>()

const { tip, show, hide } = useChartTip()
const W = 200
const H = 34

interface Tile {
  key: string
  label: string
  value: string
  change: Change | null
  // Whether a rise is good news, bad news, or just a number.
  tone: "good" | "bad" | "neutral"
  note: string
  series: string
  color: string
}

function dataOf(label: string): number[] {
  return props.chart.datasets.find((d) => d.label === label)?.data ?? []
}

const vs = computed(() => `vs previous ${RANGE_NOUN[props.duration]}`)

const tiles = computed<Tile[]>(() => {
  const s = props.stats
  const p = props.prev
  return [
    {
      key: "total",
      label: "Total queries",
      value: fmtInt(s.totalQueries),
      change: p ? countChange(s.totalQueries, p.totalQueries) : null,
      tone: "neutral",
      note: vs.value,
      series: "Total",
      color: "rgb(var(--color-chart-blue))",
    },
    {
      key: "blocked",
      label: "Blocked",
      value: fmtInt(s.totalBlocked),
      change: p ? shareChange(s.totalBlocked, s.totalQueries, p.totalBlocked, p.totalQueries) : null,
      tone: "neutral",
      note: `${pct(s.totalBlocked, s.totalQueries)} of queries`,
      series: "Blocked",
      color: "rgb(var(--color-chart-red))",
    },
    {
      key: "cache",
      label: "Cache hit rate",
      value: pct(s.totalCached, s.totalQueries),
      change: p ? shareChange(s.totalCached, s.totalQueries, p.totalCached, p.totalQueries) : null,
      tone: "good",
      note: vs.value,
      series: "Cached",
      color: "rgb(var(--color-chart-aqua))",
    },
    {
      key: "nx",
      label: "NXDomain",
      value: fmtInt(s.totalNxDomain),
      change: p ? shareChange(s.totalNxDomain, s.totalQueries, p.totalNxDomain, p.totalQueries) : null,
      tone: "bad",
      note: `${pct(s.totalNxDomain, s.totalQueries)} of queries`,
      series: "NX Domain",
      color: "rgb(var(--color-chart-orange))",
    },
    {
      key: "clients",
      label: "Active clients",
      value: fmtInt(s.totalClients),
      change: p ? absChange(s.totalClients, p.totalClients) : null,
      tone: "neutral",
      note: vs.value,
      series: "Clients",
      color: "rgb(var(--color-chart-violet))",
    },
  ]
})

function changeClass(t: Tile): string {
  const c = t.change
  if (!c || c.dir === "flat" || t.tone === "neutral") return "text-gray-400"
  const worse = (c.dir === "up") === (t.tone === "bad")
  return worse ? "text-crit" : "text-ok"
}

function geometry(data: number[]) {
  const mx = Math.max(...data)
  const mn = Math.min(...data)
  const x = (i: number) => (data.length <= 1 ? 0 : (i / (data.length - 1)) * W)
  const y = (v: number) => H - 3 - ((v - mn) / Math.max(1, mx - mn)) * (H - 8)
  return { x, y }
}

function linePath(data: number[]): string {
  const { x, y } = geometry(data)
  return data.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")
}

const hover = ref<{ key: string; i: number } | null>(null)

function onMove(e: PointerEvent, t: Tile): void {
  const data = dataOf(t.series)
  if (data.length === 0) return
  const rect = (e.currentTarget as Element).getBoundingClientRect()
  const rel = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0
  const i = Math.max(0, Math.min(data.length - 1, Math.round(rel * (data.length - 1))))
  hover.value = { key: t.key, i }
  show(e, fullLabel(props.chart.labels[i] ?? ""), [{ label: t.label, value: fmtInt(data[i]!) }])
}

function onLeave(): void {
  hover.value = null
  hide()
}

function dotStyle(t: Tile) {
  const data = dataOf(t.series)
  if (!hover.value || hover.value.key !== t.key) return { display: "none" }
  const { x, y } = geometry(data)
  return {
    left: `${(x(hover.value.i) / W) * 100}%`,
    top: `${(y(data[hover.value.i]!) / H) * 100}%`,
    background: t.color,
  }
}
</script>

<template>
  <div class="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-3.5">
    <div
      v-for="t in tiles"
      :key="t.key"
      :data-tile="t.key"
      class="min-w-0 rounded-lg border border-border bg-background-card px-4 py-3.5"
    >
      <div class="text-xs text-gray-500">{{ t.label }}</div>
      <div class="text-[26px] font-bold leading-tight tracking-tight tabular-nums">{{ t.value }}</div>
      <div class="flex flex-wrap gap-x-1.5 text-xs tabular-nums text-gray-500">
        <span v-if="t.change" class="tile-change font-medium" :class="changeClass(t)">{{ t.change.text }}</span>
        <span>{{ t.note }}</span>
      </div>
      <div
        v-if="dataOf(t.series).length > 1"
        class="relative mt-1.5 h-[34px]"
        @pointermove="onMove($event, t)"
        @pointerleave="onLeave"
      >
        <svg :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none" class="block h-full w-full overflow-visible">
          <path :d="`${linePath(dataOf(t.series))} L${W},${H} L0,${H} Z`" :fill="t.color" fill-opacity="0.12" />
          <path
            :d="linePath(dataOf(t.series))"
            fill="none"
            :stroke="t.color"
            stroke-width="2"
            stroke-linejoin="round"
            vector-effect="non-scaling-stroke"
          />
        </svg>
        <span
          class="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background-card"
          :style="dotStyle(t)"
        />
      </div>
    </div>
    <ChartTip :tip="tip" />
  </div>
</template>
