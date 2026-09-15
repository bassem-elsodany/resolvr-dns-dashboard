<script setup lang="ts">
import type { DashboardStatsResult } from "../../api/technitium"

defineProps<{ stats: DashboardStatsResult["response"]["stats"] }>()

function pct(part: number, total: number): string {
  if (total <= 0) return "0%"
  return `${((part / total) * 100).toFixed(1)}%`
}
</script>

<template>
  <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
    <div class="rounded-lg border border-border bg-background-card px-3.5 py-3">
      <div class="flex items-center gap-1.5 text-[11px] text-gray-500">
        <span class="h-1.5 w-1.5 rounded-sm bg-accent" />
        Total queries
      </div>
      <div class="mt-1 text-xl font-bold tabular-nums">{{ stats.totalQueries.toLocaleString() }}</div>
      <div class="mt-0.5 text-[10.5px] text-gray-500">{{ stats.totalClients }} clients</div>
    </div>

    <div class="rounded-lg border border-border bg-background-card px-3.5 py-3">
      <div class="flex items-center gap-1.5 text-[11px] text-gray-500">
        <span class="h-1.5 w-1.5 rounded-sm bg-ok" />
        No error
      </div>
      <div class="mt-1 text-xl font-bold tabular-nums">{{ stats.totalNoError.toLocaleString() }}</div>
      <div class="mt-0.5 text-[10.5px] text-gray-500">{{ pct(stats.totalNoError, stats.totalQueries) }} of total</div>
    </div>

    <div class="rounded-lg border border-border bg-background-card px-3.5 py-3">
      <div class="flex items-center gap-1.5 text-[11px] text-gray-500">
        <span class="h-1.5 w-1.5 rounded-sm bg-crit" />
        Blocked
      </div>
      <div class="mt-1 text-xl font-bold tabular-nums">{{ stats.totalBlocked.toLocaleString() }}</div>
      <div class="mt-0.5 text-[10.5px] text-gray-500">{{ pct(stats.totalBlocked, stats.totalQueries) }} of total</div>
    </div>

    <div class="rounded-lg border border-border bg-background-card px-3.5 py-3">
      <div class="flex items-center gap-1.5 text-[11px] text-gray-500">
        <span class="h-1.5 w-1.5 rounded-sm bg-info" />
        Recursive
      </div>
      <div class="mt-1 text-xl font-bold tabular-nums">{{ stats.totalRecursive.toLocaleString() }}</div>
      <div class="mt-0.5 text-[10.5px] text-gray-500">
        {{ pct(stats.totalRecursive, stats.totalQueries) }} of total
      </div>
    </div>

    <div class="rounded-lg border border-border bg-background-card px-3.5 py-3">
      <div class="flex items-center gap-1.5 text-[11px] text-gray-500">
        <span class="h-1.5 w-1.5 rounded-sm bg-cache" />
        Served from cache
      </div>
      <div class="mt-1 text-xl font-bold tabular-nums">{{ stats.totalCached.toLocaleString() }}</div>
      <div class="mt-0.5 text-[10.5px] text-gray-500">{{ stats.cachedEntries.toLocaleString() }} cached entries</div>
    </div>

    <div class="rounded-lg border border-border bg-background-card px-3.5 py-3">
      <div class="flex items-center gap-1.5 text-[11px] text-gray-500">
        <span class="h-1.5 w-1.5 rounded-sm bg-gray-500" />
        Authoritative
      </div>
      <div class="mt-1 text-xl font-bold tabular-nums">{{ stats.totalAuthoritative.toLocaleString() }}</div>
      <div class="mt-0.5 text-[10.5px] text-gray-500">{{ stats.zones }} zones hosted</div>
    </div>
  </div>
</template>
