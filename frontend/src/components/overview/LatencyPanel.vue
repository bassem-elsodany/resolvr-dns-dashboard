<script setup lang="ts">
import { computed } from "vue"
import { fmtInt, latencyBins, pct, percentileBin, SLOW_BIN_FROM } from "../../lib/charts"
import { useChartTip } from "../../composables/useChartTip"
import ChartPanel from "../charts/ChartPanel.vue"
import ChartTip from "../charts/ChartTip.vue"

const props = defineProps<{
  // Round-trip times in ms of the sampled queries that went upstream.
  rtts: number[]
  sampleSize: number
  state: "loading" | "ready" | "missing" | "error"
}>()

const { tip, show, hide } = useChartTip()

const W = 360
const H = 170
const PAD = 6
const BOTTOM = 30
const bins = computed(() => latencyBins(props.rtts))
const total = computed(() => props.rtts.length)
const slow = computed(() => bins.value.slice(SLOW_BIN_FROM).reduce((a, b) => a + b.count, 0))
const yMax = computed(() => Math.max(1, ...bins.value.map((b) => b.count)))
const bw = computed(() => (W - PAD * 2) / bins.value.length)
const plotH = H - BOTTOM - 8
const bars = computed(() =>
  bins.value.map((b, i) => {
    const h = (b.count / yMax.value) * plotH
    return { ...b, i, x: PAD + i * bw.value + 3, y: H - BOTTOM - h, w: bw.value - 6, h, slow: i >= SLOW_BIN_FROM }
  }),
)
const gridY = computed(() => [0, 0.5, 1].map((f) => 8 + (1 - f) * plotH))
</script>

<template>
  <ChartPanel title="Response time" hint="Upstream round-trip time of the latest logged queries that were not served from cache.">
    <p v-if="state === 'loading'" class="py-8 text-center text-sm text-gray-500">Loading…</p>
    <p v-else-if="state === 'missing'" class="py-8 text-center text-sm text-gray-500">
      Needs a query-logging app installed on the Technitium server.
    </p>
    <p v-else-if="state === 'error'" class="py-8 text-center text-sm text-gray-500">Could not load the query log.</p>
    <p v-else-if="total === 0" class="py-8 text-center text-sm text-gray-500">No upstream queries in the sample yet.</p>
    <template v-else>
      <div class="mb-2 flex flex-wrap gap-x-[18px] gap-y-1 text-xs text-gray-500">
        <div>
          <b id="latency-p50" class="block text-lg tabular-nums text-fg">{{ percentileBin(bins, 0.5) }} ms</b>
          median (p50)
        </div>
        <div>
          <b id="latency-p95" class="block text-lg tabular-nums text-fg">{{ percentileBin(bins, 0.95) }} ms</b>
          p95
        </div>
        <div>
          <b id="latency-slow" class="block text-lg tabular-nums text-fg">{{ pct(slow, total) }}</b>
          over 100 ms
        </div>
      </div>
      <svg :viewBox="`0 0 ${W} ${H}`" class="block h-auto w-full" role="img" aria-label="Response time distribution">
        <line
          v-for="(y, i) in gridY"
          :key="i"
          :x1="PAD"
          :x2="W - PAD"
          :y1="y"
          :y2="y"
          :stroke="i === 0 ? 'rgb(var(--color-border))' : 'rgb(var(--color-border-hover))'"
        />
        <g v-for="b in bars" :key="b.label">
          <rect
            class="latency-bar"
            :x="b.x"
            :y="b.y"
            :width="b.w"
            :height="b.h"
            rx="3"
            :fill="b.slow ? 'rgb(var(--color-chart-orange))' : 'rgb(var(--color-chart-blue))'"
            @pointermove="show($event, `${b.label} ms`, [{ label: 'queries', value: `${fmtInt(b.count)} · ${pct(b.count, total)}` }])"
            @pointerleave="hide"
          />
          <text :x="b.x + b.w / 2" :y="H - 16" font-size="10" text-anchor="middle" style="fill: rgb(var(--color-gray-500))">{{ b.label }}</text>
        </g>
        <text :x="W / 2" :y="H - 3" font-size="10.5" text-anchor="middle" style="fill: rgb(var(--color-gray-500))">
          milliseconds · orange = slow tail · {{ fmtInt(total) }} of {{ fmtInt(sampleSize) }} sampled queries
        </text>
      </svg>
      <ChartTip :tip="tip" />
    </template>
  </ChartPanel>
</template>
