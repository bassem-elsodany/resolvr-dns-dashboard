<script setup lang="ts">
defineProps<{ tone: "ok" | "warn" | "crit" | "info" | "cache" | "neutral" }>()

// Matches the wireframe's .badge style exactly: a small dot + colored
// text on a tinted pill of the same color.
const TONE_CLASSES: Record<string, string> = {
  ok: "bg-ok/12 text-ok",
  warn: "bg-warn/12 text-warn",
  crit: "bg-crit/12 text-crit",
  info: "bg-info/12 text-info",
  cache: "bg-cache/12 text-cache",
  neutral: "bg-background-hover text-gray-500",
}
</script>

<template>
  <span
    class="inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold"
    :class="TONE_CLASSES[tone]"
  >
    <span class="h-1 w-1 flex-none rounded-full bg-current" />
    <slot />
  </span>
</template>
