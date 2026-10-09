<script setup lang="ts">
import { computed, ref } from "vue"
import { arcPath, fmtInt, pct, sliceAngles } from "../../lib/charts"

export interface DonutItem {
  label: string
  value: number
  color: string
  // What a click passes back, e.g. the responseType value to filter by.
  filter: string
}

const props = defineProps<{ items: DonutItem[]; centerSub: string }>()
const emit = defineEmits<{ (e: "select", item: DonutItem): void }>()

const active = ref<number | null>(null)
const total = computed(() => props.items.reduce((a, b) => a + b.value, 0))
const slices = computed(() =>
  sliceAngles(props.items).map((s, i) => ({ ...s, i, d: arcPath(84, 84, 50, 78, s.start, s.end) })),
)
const centerTop = computed(() => (active.value === null ? fmtInt(total.value) : pct(props.items[active.value]!.value, total.value)))
const centerBottom = computed(() => (active.value === null ? props.centerSub : props.items[active.value]!.label))
</script>

<template>
  <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
    <svg viewBox="0 0 168 168" class="h-[168px] w-[168px] flex-none">
      <path
        v-for="s in slices"
        v-show="s.d"
        :key="s.item.label"
        :d="s.d"
        :fill="s.item.color"
        stroke="rgb(var(--color-bg-card))"
        stroke-width="2"
        tabindex="0"
        role="button"
        class="donut-slice cursor-pointer transition-opacity"
        :style="{ opacity: active !== null && active !== s.i ? 0.35 : 1 }"
        :aria-label="`${s.item.label} ${fmtInt(s.value)}, ${pct(s.value, total)}`"
        @pointerenter="active = s.i"
        @pointerleave="active = null"
        @focus="active = s.i"
        @blur="active = null"
        @click="emit('select', s.item)"
        @keydown.enter.prevent="emit('select', s.item)"
        @keydown.space.prevent="emit('select', s.item)"
      />
      <text x="84" y="82" text-anchor="middle" font-size="19" font-weight="700" class="donut-center" style="fill: rgb(var(--color-fg))">
        {{ centerTop }}
      </text>
      <text x="84" y="100" text-anchor="middle" font-size="11" style="fill: rgb(var(--color-gray-500))">{{ centerBottom }}</text>
    </svg>

    <ul class="m-0 min-w-[150px] flex-1 list-none p-0 text-[12.5px]">
      <li
        v-for="(it, i) in items"
        :key="it.label"
        class="donut-row grid cursor-pointer grid-cols-[12px_1fr_auto_auto] items-center gap-2 rounded-md px-1 py-0.5 tabular-nums hover:bg-background-hover"
        :class="active === i ? 'bg-background-hover' : ''"
        @pointerenter="active = i"
        @pointerleave="active = null"
        @click="emit('select', it)"
      >
        <span class="inline-block h-2.5 w-2.5 rounded-sm" :style="{ background: it.color }" />
        <span class="min-w-0 truncate">{{ it.label }}</span>
        <span>{{ fmtInt(it.value) }}</span>
        <span class="w-11 text-right text-gray-500">{{ pct(it.value, total) }}</span>
      </li>
    </ul>
  </div>
</template>
