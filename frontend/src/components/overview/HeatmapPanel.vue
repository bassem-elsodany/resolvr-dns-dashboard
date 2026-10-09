<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue"
import { useRouter } from "vue-router"
import { getDashboardStats, type DashboardStatsResult } from "../../api/technitium"
import { useConnectionStore } from "../../stores/connection"
import { useRefreshStore } from "../../stores/refresh"
import { bucketHeatmap, cached, fmtInt, lastOccurrence } from "../../lib/charts"
import { useChartTip } from "../../composables/useChartTip"
import ChartPanel from "../charts/ChartPanel.vue"
import ChartTip from "../charts/ChartTip.vue"

const connection = useConnectionStore()
const refresh = useRefreshStore()
const router = useRouter()
const { tip, show, hide } = useChartTip()

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
const state = ref<"loading" | "ready" | "error">("loading")
const grid = ref<number[][]>([])

const DAY_MS = 86400_000
const TTL_MS = 10 * 60 * 1000

// Technitium returns hourly points only for spans of about three days or
// less, so the week is fetched as three consecutive windows. A point on a
// boundary appears in two windows; keying by time counts it once.
async function fetchWeek(): Promise<{ time: string; value: number }[]> {
  const now = Date.now()
  const edges = [now - 7 * DAY_MS, now - 4 * DAY_MS, now - 1 * DAY_MS, now]
  const results = await Promise.all(
    [0, 1, 2].map((i) =>
      getDashboardStats("Custom", connection.credentials, {
        utc: true,
        start: new Date(edges[i]!).toISOString(),
        end: new Date(edges[i + 1]!).toISOString(),
      }),
    ),
  )
  const byTime = new Map<string, number>()
  for (const r of results as DashboardStatsResult[]) {
    const total = r.response.mainChartData.datasets.find((d) => d.label === "Total")
    r.response.mainChartData.labels.forEach((label, i) => {
      byTime.set(new Date(label).toISOString(), total?.data[i] ?? 0)
    })
  }
  return [...byTime].map(([time, value]) => ({ time, value }))
}

async function load(force = false): Promise<void> {
  if (!connection.isConfigured) return
  try {
    const points = await cached("heatmap-week", TTL_MS, fetchWeek, force)
    grid.value = bucketHeatmap(points)
    state.value = "ready"
  } catch {
    state.value = "error"
  }
}

onMounted(() => void load())
watch(() => refresh.tick, () => void load(true))
watch(() => connection.isConfigured, (c) => c && void load())

const max = computed(() => Math.max(1, ...grid.value.flat()))
const quiet = computed(() => max.value <= 1)
function cellStyle(v: number): Record<string, string> {
  const p = 10 + Math.round((v / max.value) * 90)
  return { background: `color-mix(in srgb, rgb(var(--color-chart-blue)) ${p}%, rgb(var(--color-bg-hover)))` }
}

function hourLabel(h: number): string {
  return `${h < 10 ? "0" : ""}${h}:00`
}

function onClick(day: number, hour: number): void {
  const { start, end } = lastOccurrence(day, hour)
  void router.push({ path: "/logs", query: { start, end } })
}
</script>

<template>
  <ChartPanel title="When your network is busy" hint="Queries per hour over the last 7 days. Click a cell to see that hour in Query Logs.">
    <p v-if="state === 'loading'" class="py-8 text-center text-sm text-gray-500">Loading…</p>
    <p v-else-if="state === 'error'" class="py-8 text-center text-sm text-gray-500">Could not load the last 7 days of activity.</p>
    <p v-else-if="quiet" class="py-8 text-center text-sm text-gray-500">No queries recorded in the last 7 days.</p>
    <template v-else>
      <div class="overflow-x-auto">
        <div id="heatmap" class="grid min-w-[560px] grid-cols-[36px_repeat(24,minmax(0,1fr))] gap-0.5">
          <div />
          <div v-for="h in 24" :key="h" class="flex items-center justify-center text-[11px] text-gray-500">
            {{ (h - 1) % 3 === 0 ? h - 1 : "" }}
          </div>
          <template v-for="(row, d) in grid" :key="d">
            <div class="flex items-center text-[11px] text-gray-500">{{ DAYS[d] }}</div>
            <div
              v-for="(v, h) in row"
              :key="h"
              class="heat-cell min-h-3.5 cursor-pointer rounded-[3px]"
              :style="{ ...cellStyle(v), aspectRatio: '1.5' }"
              @pointermove="show($event, `${DAYS[d]} ${hourLabel(h)}`, [{ label: 'queries', value: fmtInt(v) }])"
              @pointerleave="hide"
              @click="onClick(d, h)"
            />
          </template>
        </div>
      </div>
      <div class="mt-2 flex items-center gap-1.5 text-[11.5px] text-gray-500">
        <span>Quiet</span>
        <span
          v-for="p in [10, 40, 70, 100]"
          :key="p"
          class="inline-block h-2.5 w-[18px] rounded-sm"
          :style="{ background: `color-mix(in srgb, rgb(var(--color-chart-blue)) ${p}%, rgb(var(--color-bg-hover)))` }"
        />
        <span>Busy</span>
      </div>
      <ChartTip :tip="tip" />
    </template>
  </ChartPanel>
</template>
