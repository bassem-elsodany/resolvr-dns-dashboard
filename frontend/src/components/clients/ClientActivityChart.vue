<script setup lang="ts">
import { computed, ref } from "vue"
import { fmtInt, niceMax } from "../../lib/charts"
import type { Buckets } from "../../lib/clients"
import { useChartTip } from "../../composables/useChartTip"
import ChartTip from "../charts/ChartTip.vue"

const props = defineProps<{ buckets: Buckets; label: string }>()
const { tip, show, hide } = useChartTip()

const W = 640
const H = 190
const ML = 40
const MR = 10
const MT = 8
const MB = 24

const n = computed(() => props.buckets.counts.length)
const top = computed(() => niceMax(Math.max(1, ...props.buckets.counts) * 1.05))
const x = (i: number) => ML + (i / Math.max(1, n.value - 1)) * (W - ML - MR)
const y = (v: number) => MT + (1 - v / top.value) * (H - MT - MB)
const line = (a: number[]) => a.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("")
const slice = computed(() => (props.buckets.end - props.buckets.start) / n.value)

function stamp(ms: number): string {
  const d = new Date(ms)
  const span = props.buckets.end - props.buckets.start
  return span > 36 * 3600_000
    ? d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })
    : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false })
}

const yTicks = computed(() => [0, 1, 2, 3, 4].map((t) => ({ y: y((top.value * t) / 4), label: fmtInt((top.value * t) / 4), axis: t === 0 })))
const xTicks = computed(() => {
  const step = Math.ceil(n.value / 6)
  const out: { x: number; label: string }[] = []
  for (let i = 0; i < n.value; i += step) out.push({ x: x(i), label: stamp(props.buckets.start + i * slice.value) })
  return out
})

const hover = ref<number | null>(null)
const svgEl = ref<SVGSVGElement | null>(null)

function onMove(e: PointerEvent): void {
  const rect = svgEl.value!.getBoundingClientRect()
  if (rect.width === 0) return
  const vx = ((e.clientX - rect.left) / rect.width) * W
  const i = Math.max(0, Math.min(n.value - 1, Math.round(((vx - ML) / (W - ML - MR)) * (n.value - 1))))
  hover.value = i
  const from = props.buckets.start + i * slice.value
  show(e, `${stamp(from)} to ${stamp(from + slice.value)}`, [
    { label: "Queries", value: fmtInt(props.buckets.counts[i]!), color: "rgb(var(--color-chart-blue))" },
    { label: "Blocked", value: fmtInt(props.buckets.blocked[i]!), color: "rgb(var(--color-chart-red))" },
  ])
}

function onLeave(): void {
  hover.value = null
  hide()
}
</script>

<template>
  <div id="client-activity">
    <svg
      ref="svgEl"
      :viewBox="`0 0 ${W} ${H}`"
      class="block h-auto w-full cursor-crosshair"
      role="img"
      :aria-label="label"
      @pointermove="onMove"
      @pointerleave="onLeave"
    >
      <g v-for="t in yTicks" :key="t.label + t.y">
        <line :x1="ML" :x2="W - MR" :y1="t.y" :y2="t.y" :stroke="t.axis ? 'rgb(var(--color-border-hover))' : 'rgb(var(--color-border))'" />
        <text :x="ML - 6" :y="t.y + 4" font-size="11" text-anchor="end" style="fill: rgb(var(--color-gray-500))">{{ t.label }}</text>
      </g>
      <text v-for="t in xTicks" :key="t.x" :x="t.x" :y="H - 6" font-size="11" text-anchor="middle" style="fill: rgb(var(--color-gray-500))">{{ t.label }}</text>
      <path :d="`${line(buckets.counts)}L${x(n - 1)},${y(0)}L${x(0)},${y(0)}Z`" fill="rgb(var(--color-chart-blue))" fill-opacity="0.1" />
      <path :d="line(buckets.counts)" fill="none" stroke="rgb(var(--color-chart-blue))" stroke-width="2" stroke-linejoin="round" />
      <path :d="line(buckets.blocked)" fill="none" stroke="rgb(var(--color-chart-red))" stroke-width="2" stroke-linejoin="round" />
      <template v-if="hover !== null">
        <line :x1="x(hover)" :x2="x(hover)" :y1="MT" :y2="H - MB" stroke="rgb(var(--color-gray-400))" stroke-dasharray="3 3" />
        <circle :cx="x(hover)" :cy="y(buckets.counts[hover]!)" r="4.5" fill="rgb(var(--color-chart-blue))" stroke="rgb(var(--color-bg-card))" stroke-width="2" />
        <circle :cx="x(hover)" :cy="y(buckets.blocked[hover]!)" r="4.5" fill="rgb(var(--color-chart-red))" stroke="rgb(var(--color-bg-card))" stroke-width="2" />
      </template>
    </svg>
    <ChartTip :tip="tip" />
  </div>
</template>
