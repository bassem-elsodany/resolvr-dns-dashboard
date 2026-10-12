<script setup lang="ts">
import { computed, ref } from "vue"
import { useElementWidth } from "../../composables/useElementWidth"
import { fmtInt } from "../../lib/charts"

export interface CompareSeries {
  name: string
  color: string
  dashed?: boolean
  data: number[]
}

// Queries over time, one line per cluster node on the same axis, so you can
// see how traffic is shared between nodes. Shown instead of the full queries
// chart when "Compare nodes" is on. Fixed height, fluid width: a viewBox
// scaled to the container grows tall on a full-width page.
const props = defineProps<{ labels: string[]; series: CompareSeries[] }>()

// Measured on the wrapper, which is always rendered (the svg only exists once
// there is data, after the width would have been read).
const box = ref<HTMLElement | null>(null)
const W = useElementWidth(box, 640, 280, 2400)
const H = 224
const LEFT = 52
const RIGHT = 12
const TOP = 12
const BOTTOM = 34
const plotW = computed(() => W.value - LEFT - RIGHT)
const plotH = H - TOP - BOTTOM

const n = computed(() => props.labels.length)
const max = computed(() => {
  const m = Math.max(0, ...props.series.flatMap((s) => s.data))
  if (m === 0) return 1
  const mag = Math.pow(10, Math.floor(Math.log10(m)))
  return Math.ceil(m / mag / 2) * mag * 2
})
const ticks = computed(() => [0, 1, 2, 3, 4].map((i) => ({ v: (max.value * i) / 4, y: TOP + plotH - (plotH * i) / 4 })))

function points(data: number[]): string {
  const last = Math.max(1, n.value - 1)
  return data.map((v, i) => `${(LEFT + (i / last) * plotW.value).toFixed(1)},${(TOP + plotH - (v / max.value) * plotH).toFixed(1)}`).join(" ")
}

const xLabels = computed(() => {
  if (n.value === 0) return []
  const first = new Date(props.labels[0]!).getTime()
  const lastT = new Date(props.labels[n.value - 1]!).getTime()
  const longRange = lastT - first > 36 * 3600_000
  const fmt = (raw: string): string => {
    const d = new Date(raw)
    if (Number.isNaN(d.getTime())) return raw
    return longRange
      ? d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
      : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
  }
  const idx = [0, Math.floor((n.value - 1) / 2), n.value - 1]
  // The outer labels sit on the plot edges, so anchor them inward to keep the
  // text inside the drawing.
  return idx.map((i, k) => ({
    text: fmt(props.labels[i]!),
    x: LEFT + (i / Math.max(1, n.value - 1)) * plotW.value,
    anchor: k === 0 ? "start" : k === idx.length - 1 ? "end" : "middle",
  }))
})
</script>

<template>
  <div ref="box">
    <p v-if="n === 0 || series.length === 0" class="py-10 text-center text-sm text-gray-500">No query data for this time range yet.</p>
    <template v-else>
      <svg :viewBox="`0 0 ${W} ${H}`" :style="{ height: `${H}px` }" class="block w-full" role="img" aria-label="Queries over time for each node">
        <g v-for="t in ticks" :key="t.y">
          <line :x1="LEFT" :x2="W - RIGHT" :y1="t.y" :y2="t.y" stroke="rgb(var(--color-border))" />
          <text :x="LEFT - 6" :y="t.y + 4" text-anchor="end" font-size="11" fill="rgb(var(--color-gray-500))">{{ fmtInt(t.v) }}</text>
        </g>
        <text v-for="(l, i) in xLabels" :key="i" :x="l.x" :y="H - 10" :text-anchor="l.anchor" font-size="11" fill="rgb(var(--color-gray-500))">{{ l.text }}</text>
        <polyline
          v-for="s in series"
          :key="s.name"
          class="compare-line"
          :points="points(s.data)"
          fill="none"
          :stroke="s.color"
          stroke-width="2.2"
          stroke-linejoin="round"
          :stroke-dasharray="s.dashed ? '6 4' : undefined"
        />
      </svg>
      <div class="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
        <span v-for="s in series" :key="s.name" class="inline-flex items-center gap-1.5">
          <span class="inline-block w-4 border-t-[2.5px]" :style="{ borderColor: s.color, borderTopStyle: s.dashed ? 'dashed' : 'solid' }" />
          <span class="font-mono">{{ s.name }}</span>
        </span>
      </div>
    </template>
  </div>
</template>
