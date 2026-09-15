<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue"
import { useConnectionStore } from "../../stores/connection"
import { useTimeRangeStore } from "../../stores/timeRange"
import { useRefreshStore } from "../../stores/refresh"
import { getTopStats, queryLogs, TechnitiumApiError } from "../../api/technitium"
import { durationToRange } from "../../lib/dateRange"

const connection = useConnectionStore()
// Time range is the single global control in AppShell's topbar — see
// OverviewView.vue for the same pattern.
const timeRange = useTimeRangeStore()
const refresh = useRefreshStore()
const filterText = ref("")

interface ClientRow {
  ip: string
  hostname: string | null
  hits: number
  blocked: number
  rateLimited: boolean
  lastSeen: string | null
}

const loading = ref(false)
const loadError = ref<string | null>(null)
const clients = ref<ClientRow[]>([])

const filteredClients = computed(() => {
  const needle = filterText.value.trim().toLowerCase()
  if (!needle) return clients.value
  return clients.value.filter(
    (c) => c.ip.toLowerCase().includes(needle) || (c.hostname ?? "").toLowerCase().includes(needle),
  )
})

async function load(): Promise<void> {
  if (!connection.isConfigured) return
  loading.value = true
  loadError.value = null
  try {
    const top = await getTopStats("TopClients", timeRange.selected, connection.credentials, { limit: 15 })
    const entries = top.response.topClients ?? []
    const { start, end } = durationToRange(timeRange.selected)

    clients.value = await Promise.all(
      entries.map(async (entry) => {
        const [totalRes, blockedRes] = await Promise.all([
          queryLogs(connection.credentials, {
            clientIpAddress: entry.name,
            start,
            end,
            entriesPerPage: 1,
            descendingOrder: true,
          }),
          queryLogs(connection.credentials, {
            clientIpAddress: entry.name,
            responseType: "Blocked",
            start,
            end,
            entriesPerPage: 1,
          }),
        ])
        return {
          ip: entry.name,
          hostname: entry.domain ?? null,
          // Use the query-log total for this exact window rather than
          // getTop's `hits` (which uses Technitium's own duration
          // bucketing) — it must match the same window as `blocked`
          // below, or the blocked % compares two different time ranges.
          hits: totalRes.response.totalEntries,
          blocked: blockedRes.response.totalEntries,
          rateLimited: entry.rateLimited,
          lastSeen: totalRes.response.entries[0]?.timestamp ?? null,
        }
      }),
    )
  } catch (err) {
    loadError.value = err instanceof TechnitiumApiError ? err.message : "Could not load client activity."
  } finally {
    loading.value = false
  }
}

function blockedPct(row: ClientRow): number {
  return row.hits > 0 ? Math.round((row.blocked / row.hits) * 100) : 0
}

function formatLastSeen(iso: string | null): string {
  if (!iso) return "–"
  return new Date(iso).toLocaleString()
}

onMounted(load)
watch(() => timeRange.selected, load)
watch(() => refresh.tick, load)
watch(
  () => connection.isConfigured,
  (configured) => {
    if (configured) load()
  },
)
</script>

<template>
  <div>
    <div class="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="text-lg font-semibold tracking-tight text-fg">Clients</h1>
        <p class="mt-1 text-sm text-gray-500">Every device that has queried this resolver</p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <input
          id="client-filter"
          v-model="filterText"
          type="text"
          placeholder="Filter by IP or hostname…"
          class="w-56 rounded-md border border-border bg-background-card px-3 py-1.5 text-sm"
        />
      </div>
    </div>

    <p v-if="!connection.isConfigured" class="text-sm text-gray-500">
      Connect to a Technitium server on the
      <router-link to="/connect" class="font-medium text-accent">Connection Settings</router-link> page to see
      client activity.
    </p>
    <p v-else-if="loadError" id="clients-error" class="text-sm text-crit">{{ loadError }}</p>
    <p v-else-if="loading && clients.length === 0" class="text-sm text-gray-500">Loading…</p>

    <div v-else class="overflow-x-auto rounded-lg border border-border">
      <table class="w-full text-left text-[12.5px]">
        <thead>
          <tr class="border-b border-border bg-background-elevated text-[10.5px] uppercase text-gray-500">
            <th class="px-3 py-2 font-bold">Client</th>
            <th class="px-3 py-2 font-bold">Hostname</th>
            <th class="px-3 py-2 text-right font-bold">Queries</th>
            <th class="px-3 py-2 text-right font-bold">Blocked</th>
            <th class="px-3 py-2 font-bold">Allowed vs blocked</th>
            <th class="px-3 py-2 font-bold">Status</th>
            <th class="px-3 py-2 font-bold">Last seen</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="filteredClients.length === 0">
            <td colspan="7" class="px-3 py-6 text-center text-gray-500">No clients match.</td>
          </tr>
          <tr v-for="row in filteredClients" :key="row.ip" class="border-b border-border last:border-b-0">
            <td class="px-3 py-2 font-mono">{{ row.ip }}</td>
            <td class="px-3 py-2 text-gray-500">{{ row.hostname ?? "–" }}</td>
            <td class="px-3 py-2 text-right tabular-nums">{{ row.hits.toLocaleString() }}</td>
            <td class="px-3 py-2 text-right tabular-nums">{{ row.blocked.toLocaleString() }}</td>
            <td class="px-3 py-2">
              <div class="flex items-center gap-2">
                <div class="h-1.5 w-24 overflow-hidden rounded-full bg-crit/25">
                  <div class="h-full rounded-full bg-ok" :style="{ width: `${100 - blockedPct(row)}%` }" />
                </div>
                <span class="tabular-nums text-gray-500">{{ 100 - blockedPct(row) }}%</span>
              </div>
            </td>
            <td class="px-3 py-2">
              <span
                v-if="row.rateLimited"
                class="inline-flex items-center gap-1 rounded-md bg-crit/12 px-2 py-0.5 text-[10.5px] font-semibold text-crit"
                >Rate-limited</span
              >
              <span
                v-else
                class="inline-flex items-center gap-1 rounded-md bg-ok/12 px-2 py-0.5 text-[10.5px] font-semibold text-ok"
                >Normal</span
              >
            </td>
            <td class="px-3 py-2 text-gray-500">{{ formatLastSeen(row.lastSeen) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
