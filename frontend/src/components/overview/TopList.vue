<script setup lang="ts">
import { computed } from "vue"

const props = defineProps<{
  title: string
  items: { name: string; hits: number; domain?: string }[]
  tone: "accent" | "ok" | "crit"
}>()

const max = computed(() => Math.max(1, ...props.items.map((i) => i.hits)))
const barColor = { accent: "rgb(var(--color-accent))", ok: "rgb(var(--color-ok))", crit: "rgb(var(--color-crit))" }
</script>

<template>
  <div class="rounded-lg border border-border bg-background-card p-3">
    <div class="mb-2 text-[12.5px] font-semibold">{{ title }}</div>
    <div v-if="items.length === 0" class="py-6 text-center text-xs text-gray-500">No data yet.</div>
    <div v-else class="flex flex-col gap-2">
      <div v-for="item in items" :key="item.name" class="text-xs">
        <div class="flex items-baseline justify-between gap-2">
          <span class="min-w-0 flex-1 truncate font-mono">{{ item.name }}</span>
          <span class="tabular-nums text-gray-500">{{ item.hits.toLocaleString() }}</span>
        </div>
        <div v-if="item.domain" class="truncate text-[10.5px] text-gray-500">{{ item.domain }}</div>
        <div class="mt-1 h-1 overflow-hidden rounded-full bg-background-hover">
          <div
            class="h-full rounded-full"
            :style="{ width: `${(item.hits / max) * 100}%`, background: barColor[tone] }"
          />
        </div>
      </div>
    </div>
  </div>
</template>
