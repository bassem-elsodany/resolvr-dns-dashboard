<script setup lang="ts">
import { computed } from "vue"

const props = defineProps<{
  ip: string
  hostname: string | null
  total: number
  blocked: number
  cacheBlocked: number
  upstreamBlocked: number
}>()

const allowedPct = computed(() => (props.total > 0 ? Math.round(((props.total - props.blocked) / props.total) * 100) : 0))

// "Blocked" here means the generic mechanism (Blocked Zone / Block List /
// Advanced Blocking app combined) — see src/lib/blockMechanism.ts for why
// it can't be split further.
const genericBlocked = computed(() => Math.max(0, props.blocked - props.cacheBlocked - props.upstreamBlocked))
const maxBreakdown = computed(() => Math.max(1, genericBlocked.value, props.cacheBlocked, props.upstreamBlocked))

// Same color per mechanism as src/lib/badgeTones.ts's blockedByTone(),
// so a mechanism reads as the same color here and in the Query Logs
// table's "Blocked by" column.
const breakdownRows = computed(() => [
  { label: "Blocked (zone / list)", n: genericBlocked.value, bar: "bg-crit" },
  { label: "Cache Block", n: props.cacheBlocked, bar: "bg-cache" },
  { label: "Upstream Block", n: props.upstreamBlocked, bar: "bg-info" },
])
</script>

<template>
  <div id="host-insight" class="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2">
    <div class="rounded-lg border border-border bg-background-card p-4">
      <div class="text-[12.5px] font-semibold">Allowed vs. blocked</div>
      <div class="font-mono text-[11px] text-gray-500">{{ ip }}<span v-if="hostname"> &middot; {{ hostname }}</span></div>
      <div class="mt-3 flex items-center gap-4">
        <div
          class="flex h-24 w-24 flex-none items-center justify-center rounded-full"
          :style="{
            background: `conic-gradient(rgb(var(--color-ok)) 0 ${allowedPct}%, rgb(var(--color-crit)) ${allowedPct}% 100%)`,
          }"
        >
          <div class="flex h-14 w-14 flex-col items-center justify-center rounded-full bg-background-card">
            <span class="text-base font-bold tabular-nums">{{ allowedPct }}%</span>
            <span class="text-[8px] font-semibold uppercase text-gray-500">Allowed</span>
          </div>
        </div>
        <div class="flex flex-col gap-1 text-xs">
          <div class="flex items-center gap-1.5">
            <span class="h-2 w-2 flex-none rounded-sm bg-ok" />
            Allowed <span class="ml-2 tabular-nums text-gray-500">{{ (total - blocked).toLocaleString() }}</span>
          </div>
          <div class="flex items-center gap-1.5">
            <span class="h-2 w-2 flex-none rounded-sm bg-crit" />
            Blocked <span class="ml-2 tabular-nums text-gray-500">{{ blocked.toLocaleString() }}</span>
          </div>
          <div class="text-gray-500">{{ total.toLocaleString() }} queries</div>
        </div>
      </div>
    </div>

    <div class="rounded-lg border border-border bg-background-card p-4">
      <div class="text-[12.5px] font-semibold">Blocked by</div>
      <div class="text-[11px] text-gray-500">Blocking mechanism reported by the resolver</div>
      <div class="mt-3 flex flex-col gap-2">
        <div v-for="row in breakdownRows" :key="row.label" class="flex items-center gap-2 text-[11px]">
          <span class="w-32 flex-none text-gray-500">{{ row.label }}</span>
          <div class="h-2 flex-1 overflow-hidden rounded-full bg-background-hover">
            <div class="h-full rounded-full" :class="row.bar" :style="{ width: `${(row.n / maxBreakdown) * 100}%` }" />
          </div>
          <span class="w-8 text-right tabular-nums">{{ row.n }}</span>
        </div>
      </div>
    </div>

    <p class="md:col-span-2 rounded-lg border border-border bg-background-elevated px-3.5 py-2.5 text-[11px] leading-relaxed text-gray-500">
      Technitium reports <em>how</em> a query was blocked (zone/list/app vs. cache vs. upstream) but
      not the specific list file or rule &mdash; that detail isn't exposed by the DNS server's API.
    </p>
  </div>
</template>
