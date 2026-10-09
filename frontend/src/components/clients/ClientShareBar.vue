<script setup lang="ts">
import { computed } from "vue"
import { fmtInt, pct } from "../../lib/charts"
import type { ShareSegment } from "../../lib/clients"
import { useChartTip } from "../../composables/useChartTip"
import ChartTip from "../charts/ChartTip.vue"

const props = defineProps<{ segments: ShareSegment[]; selectedIp: string | null; totalQueries: number }>()
const emit = defineEmits<{ (e: "select", ip: string): void }>()
const { tip, show, hide } = useChartTip()

// Sequential tints of one hue, darkest for the busiest client. Identity
// is carried by the label and tooltip, so no colour per client is needed.
const segs = computed(() =>
  props.segments.map((s, i) => {
    const selected = s.ip !== null && s.ip === props.selectedIp
    const shade = Math.max(22, 88 - i * 8)
    return {
      ...s,
      selected,
      style: {
        flex: String(Math.max(s.hits, 1)),
        background: s.ip === null
          ? "rgb(var(--color-bg-hover))"
          : selected
            ? "rgb(var(--color-accent))"
            : `color-mix(in srgb, rgb(var(--color-chart-blue)) ${shade}%, rgb(var(--color-bg-hover)))`,
        color: selected || (s.ip !== null && shade > 55) ? "#fff" : "rgb(var(--color-fg))",
      },
    }
  }),
)
const listed = computed(() => props.segments.filter((s) => s.ip !== null).reduce((a, s) => a + s.hits, 0))
</script>

<template>
  <div>
    <div id="share-bar" class="my-1 flex h-[38px] gap-0.5 overflow-hidden rounded-md">
      <component
        :is="s.ip ? 'button' : 'div'"
        v-for="s in segs"
        :key="s.ip ?? 'other'"
        :type="s.ip ? 'button' : undefined"
        :aria-pressed="s.ip ? s.selected : undefined"
        :aria-label="`${s.label} ${pct(s.hits, totalQueries, 0)}`"
        class="share-seg min-w-[4px] overflow-hidden text-ellipsis whitespace-nowrap px-1.5 text-left text-[11.5px] font-semibold"
        :class="s.ip ? 'cursor-pointer hover:brightness-110' : ''"
        :style="s.style"
        @click="s.ip && emit('select', s.ip)"
        @pointermove="show($event, s.label, [{ label: 'queries', value: `${fmtInt(s.hits)} · ${pct(s.hits, totalQueries)}` }])"
        @pointerleave="hide"
      >
        {{ s.share > 0.06 && s.ip ? s.label.replace(/\.lan$/, '') : '' }}
      </component>
    </div>
    <p class="text-[11.5px] text-gray-500">
      {{ fmtInt(totalQueries) }} queries. The {{ segments.filter((s) => s.ip).length }} busiest clients are shown, covering
      {{ pct(listed, totalQueries, 0) }} of traffic.
    </p>
    <ChartTip :tip="tip" />
  </div>
</template>
