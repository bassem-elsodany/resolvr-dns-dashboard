<script setup lang="ts">
import { computed } from "vue"

const props = defineProps<{
  title: string
  items: { name: string; hits: number; domain?: string }[]
  tone: "accent" | "ok" | "crit"
  // Which Query Logs filter clicking a row should jump to: "client" filters
  // by that IP (see its logs), "qname" filters by that domain name (see
  // every host that queried it) — used for Top clients vs. Top domains/
  // Top blocked respectively.
  filterKey: "client" | "qname"
}>()

const max = computed(() => Math.max(1, ...props.items.map((i) => i.hits)))
const barColor = { accent: "rgb(var(--color-accent))", ok: "rgb(var(--color-ok))", crit: "rgb(var(--color-crit))" }
</script>

<template>
  <div class="rounded-lg border border-border bg-background-card p-3">
    <div class="mb-2 text-[12.5px] font-semibold">{{ title }}</div>
    <div v-if="items.length === 0" class="py-6 text-center text-xs text-gray-500">No data yet.</div>
    <div v-else class="flex flex-col gap-2">
      <router-link
        v-for="item in items"
        :key="item.name"
        :to="{ path: '/logs', query: { [filterKey]: item.name } }"
        :title="filterKey === 'client' ? 'View this client in Query Logs' : 'View this domain in Query Logs'"
        class="top-list-row block rounded px-1 py-0.5 -mx-1 text-xs transition-colors hover:bg-background-hover"
      >
        <div class="flex items-baseline justify-between gap-2">
          <span class="min-w-0 flex-1 truncate font-mono text-fg">{{ item.name }}</span>
          <span class="tabular-nums text-gray-500">{{ item.hits.toLocaleString() }}</span>
        </div>
        <div v-if="item.domain" class="truncate text-[10.5px] text-gray-500">{{ item.domain }}</div>
        <div class="mt-1 h-1 overflow-hidden rounded-full bg-background-hover">
          <div
            class="h-full rounded-full"
            :style="{ width: `${(item.hits / max) * 100}%`, background: barColor[tone] }"
          />
        </div>
      </router-link>
    </div>
  </div>
</template>
