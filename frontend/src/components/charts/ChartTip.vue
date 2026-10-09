<script setup lang="ts">
import { computed } from "vue"
import type { Tip } from "../../composables/useChartTip"

const props = defineProps<{ tip: Tip | null }>()

// Hangs left of the pointer near the right edge, and below it near the
// top, so it never runs off screen.
const style = computed(() => {
  const t = props.tip
  if (!t) return {}
  const flipX = typeof window !== "undefined" && t.x > window.innerWidth - 260
  const flipY = t.y < 90
  return {
    left: `${flipX ? t.x - 14 : t.x + 14}px`,
    top: `${flipY ? t.y + 16 : t.y - 12}px`,
    transform: `translate(${flipX ? "-100%" : "0"}, ${flipY ? "0" : "-100%"})`,
  }
})
</script>

<template>
  <div
    v-if="tip"
    class="chart-tip pointer-events-none fixed z-50 max-w-[240px] rounded-md bg-fg px-2.5 py-1.5 text-xs tabular-nums text-background-canvas shadow-lg"
    :style="style"
    role="status"
  >
    <div class="font-semibold">{{ tip.title }}</div>
    <div v-for="row in tip.rows" :key="row.label" class="flex items-center gap-2">
      <span v-if="row.color" class="inline-block h-2 w-2 flex-none rounded-sm" :style="{ background: row.color }" />
      <span>{{ row.label }}</span>
      <span class="ml-auto pl-2 font-semibold">{{ row.value }}</span>
    </div>
  </div>
</template>
