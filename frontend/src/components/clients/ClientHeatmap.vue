<script setup lang="ts">
import { computed } from "vue"
import { fmtInt } from "../../lib/charts"
import type { ClientActivity } from "../../lib/clients"
import { useChartTip } from "../../composables/useChartTip"
import ChartTip from "../charts/ChartTip.vue"

const props = defineProps<{
  start: number
  end: number
  rows: ClientActivity[]
  labels: Record<string, string>
  selectedIp: string | null
}>()
const emit = defineEmits<{ (e: "select", ip: string): void }>()
const { tip, show, hide } = useChartTip()

const n = computed(() => props.rows[0]?.counts.length ?? 24)
const max = computed(() => Math.max(1, ...props.rows.flatMap((r) => r.counts)))
const slice = computed(() => (props.end - props.start) / n.value)
const span = computed(() => props.end - props.start)

function stamp(ms: number): string {
  const d = new Date(ms)
  return span.value > 36 * 3600_000
    ? d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })
    : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false })
}

function cell(v: number): Record<string, string> {
  const p = 10 + Math.round((v / max.value) * 90)
  return { background: `color-mix(in srgb, rgb(var(--color-chart-blue)) ${p}%, rgb(var(--color-bg-hover)))` }
}
</script>

<template>
  <div>
    <div class="overflow-x-auto">
      <div id="client-heatmap" class="grid min-w-[640px] grid-cols-[150px_repeat(24,minmax(0,1fr))] gap-0.5">
        <div />
        <div v-for="i in n" :key="i" class="whitespace-nowrap text-center text-[11px] text-gray-500">
          {{ (i - 1) % 6 === 0 ? stamp(start + (i - 1) * slice) : "" }}
        </div>
        <template v-for="r in rows" :key="r.ip">
          <button
            type="button"
            class="heat-row-label truncate rounded px-1 text-left text-xs"
            :class="r.ip === selectedIp ? 'bg-accent/15 font-semibold text-accent' : 'hover:bg-background-hover'"
            :aria-pressed="r.ip === selectedIp"
            @click="emit('select', r.ip)"
          >
            {{ (labels[r.ip] ?? r.ip).replace(/\.lan$/, "") }}
          </button>
          <div
            v-for="(v, i) in r.counts"
            :key="i"
            class="heat-cell h-[22px] cursor-pointer rounded-[3px]"
            :style="cell(v)"
            @pointermove="show($event, labels[r.ip] ?? r.ip, [{ label: `${stamp(start + i * slice)}`, value: `${fmtInt(v)} queries` }])"
            @pointerleave="hide"
            @click="emit('select', r.ip)"
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
  </div>
</template>
