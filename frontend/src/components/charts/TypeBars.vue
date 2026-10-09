<script setup lang="ts">
import { computed } from "vue"
import { fmtInt, pct } from "../../lib/charts"
import { useChartTip } from "../../composables/useChartTip"
import ChartTip from "./ChartTip.vue"

const props = defineProps<{ labels: string[]; values: number[] }>()
const emit = defineEmits<{ (e: "select", label: string): void }>()
const { tip, show, hide } = useChartTip()

const total = computed(() => props.values.reduce((a, b) => a + b, 0))
const max = computed(() => Math.max(1, ...props.values))
const rows = computed(() => props.labels.map((label, i) => ({ label, value: props.values[i] ?? 0 })))
</script>

<template>
  <div class="flex flex-col gap-1">
    <button
      v-for="r in rows"
      :key="r.label"
      type="button"
      class="type-row grid w-full grid-cols-[54px_1fr_54px] items-center gap-2 rounded-md px-1 py-0.5 text-left text-[12.5px] hover:bg-background-hover"
      @click="emit('select', r.label)"
      @pointermove="show($event, r.label, [{ label: 'queries', value: `${fmtInt(r.value)} · ${pct(r.value, total)}` }])"
      @pointerleave="hide"
    >
      <span class="truncate font-mono text-gray-500">{{ r.label }}</span>
      <span class="h-2 rounded-r bg-background-hover">
        <span class="block h-full rounded-r bg-chart-blue" :style="{ width: `${(r.value / max) * 100}%` }" />
      </span>
      <span class="text-right tabular-nums">{{ fmtInt(r.value) }}</span>
    </button>
    <ChartTip :tip="tip" />
  </div>
</template>
