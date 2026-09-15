<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted, watch } from "vue"
import { useConnectionStore } from "../stores/connection"
import {
  getTopStats,
  queryLogs,
  exportLogs,
  listApps,
  TechnitiumApiError,
  type QueryLogEntry,
  type TopClientEntry,
} from "../api/technitium"
import { durationToRange } from "../lib/dateRange"
import { blockedByLabel } from "../lib/blockMechanism"
import { triggerDownload } from "../lib/download"
import HostInsightPanel from "../components/logs/HostInsightPanel.vue"

const connection = useConnectionStore()

const ENTRIES_PER_PAGE = 20

const filters = reactive({
  clientIpAddress: "",
  qname: "",
  responseType: "",
  protocol: "",
  rcode: "",
})
const pageNumber = ref(1)

const loading = ref(false)
const loadError = ref<string | null>(null)
const entries = ref<QueryLogEntry[]>([])
const totalEntries = ref(0)
const totalPages = ref(1)
const appChecked = ref(false)
const appMissing = ref(false)

const hostChips = ref<TopClientEntry[]>([])
const hostInsight = ref<{
  ip: string
  hostname: string | null
  total: number
  blocked: number
  cacheBlocked: number
  upstreamBlocked: number
} | null>(null)

const liveOn = ref(false)
let liveTimer: ReturnType<typeof setInterval> | null = null

function activeFilters() {
  const f: Record<string, string> = {}
  if (filters.clientIpAddress) f.clientIpAddress = filters.clientIpAddress
  if (filters.qname) f.qname = filters.qname
  if (filters.responseType) f.responseType = filters.responseType
  if (filters.protocol) f.protocol = filters.protocol
  if (filters.rcode) f.rcode = filters.rcode
  return f
}

async function checkAppInstalled(): Promise<boolean> {
  if (appChecked.value) return !appMissing.value
  try {
    const res = await listApps(connection.credentials)
    appMissing.value = !res.response.apps.some((app) => app.name === "Query Logs (Sqlite)")
  } catch {
    // If the check itself fails, don't block the page on it — the
    // subsequent queryLogs() call will surface its own error.
    appMissing.value = false
  } finally {
    appChecked.value = true
  }
  return !appMissing.value
}

async function loadTable(): Promise<void> {
  if (!connection.isConfigured) return
  if (!(await checkAppInstalled())) return
  loading.value = true
  loadError.value = null
  try {
    const res = await queryLogs(connection.credentials, {
      ...activeFilters(),
      pageNumber: pageNumber.value,
      entriesPerPage: ENTRIES_PER_PAGE,
      descendingOrder: true,
    })
    entries.value = res.response.entries
    totalEntries.value = res.response.totalEntries
    totalPages.value = res.response.totalPages
  } catch (err) {
    loadError.value = err instanceof TechnitiumApiError ? err.message : "Could not load query logs."
  } finally {
    loading.value = false
  }
}

async function loadHostChips(): Promise<void> {
  if (!connection.isConfigured) return
  try {
    const res = await getTopStats("TopClients", "LastDay", connection.credentials, { limit: 6 })
    hostChips.value = res.response.topClients ?? []
  } catch {
    hostChips.value = []
  }
}

async function loadHostInsight(entry: TopClientEntry): Promise<void> {
  const { start, end } = durationToRange("LastDay")
  const base = { clientIpAddress: entry.name, start, end, entriesPerPage: 1 }
  const [totalRes, blockedRes, cacheRes, upstreamRes] = await Promise.all([
    queryLogs(connection.credentials, base),
    queryLogs(connection.credentials, { ...base, responseType: "Blocked" }),
    queryLogs(connection.credentials, { ...base, responseType: "CacheBlocked" }),
    queryLogs(connection.credentials, { ...base, responseType: "UpstreamBlocked" }),
  ])
  hostInsight.value = {
    ip: entry.name,
    hostname: entry.domain ?? null,
    total: totalRes.response.totalEntries,
    blocked:
      blockedRes.response.totalEntries + cacheRes.response.totalEntries + upstreamRes.response.totalEntries,
    cacheBlocked: cacheRes.response.totalEntries,
    upstreamBlocked: upstreamRes.response.totalEntries,
  }
}

function selectHost(entry: TopClientEntry): void {
  filters.clientIpAddress = entry.name
  pageNumber.value = 1
  void loadHostInsight(entry)
  void loadTable()
}

function clearHost(): void {
  filters.clientIpAddress = ""
  hostInsight.value = null
  pageNumber.value = 1
  void loadTable()
}

function onFilterChange(): void {
  pageNumber.value = 1
  void loadTable()
}

function goToPage(delta: number): void {
  const next = pageNumber.value + delta
  if (next < 1 || next > totalPages.value) return
  pageNumber.value = next
  void loadTable()
}

function toggleLive(): void {
  liveOn.value = !liveOn.value
  if (liveOn.value) {
    liveTimer = setInterval(loadTable, 5000)
  } else if (liveTimer) {
    clearInterval(liveTimer)
    liveTimer = null
  }
}

async function onExport(): Promise<void> {
  try {
    const file = await exportLogs(connection.credentials, activeFilters())
    triggerDownload(file)
  } catch (err) {
    loadError.value = err instanceof TechnitiumApiError ? err.message : "Could not export query logs."
  }
}

onMounted(() => {
  loadTable()
  loadHostChips()
})
onUnmounted(() => {
  if (liveTimer) clearInterval(liveTimer)
})
watch(
  () => connection.isConfigured,
  (configured) => {
    if (configured) {
      loadTable()
      loadHostChips()
    }
  },
)
</script>

<template>
  <div>
    <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="text-lg font-semibold tracking-tight text-fg">Query Logs</h1>
        <p class="mt-1 text-sm text-gray-500">Every request answered by the resolver</p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <button
          id="live-toggle"
          type="button"
          class="inline-flex items-center gap-1.5 rounded-md border border-border bg-background-card px-2.5 py-1.5 text-[11.5px] font-semibold"
          :class="liveOn ? 'text-ok' : 'text-gray-500'"
          @click="toggleLive"
        >
          <span class="h-1.5 w-1.5 rounded-full" :class="liveOn ? 'bg-ok' : 'bg-gray-500'" />
          Live
        </button>
        <button
          id="export-csv"
          type="button"
          class="rounded-md border border-border bg-background-card px-2.5 py-1.5 text-[11.5px] font-semibold text-gray-500"
          @click="onExport"
        >
          Export CSV
        </button>
      </div>
    </div>

    <p v-if="!connection.isConfigured" class="text-sm text-gray-500">
      Connect to a Technitium server on the
      <router-link to="/connect" class="font-medium text-accent">Connection Settings</router-link> page to see
      query logs.
    </p>

    <div v-else-if="appMissing" id="query-logs-app-missing" class="rounded-lg border border-warn/35 bg-warn/10 px-4 py-3 text-sm">
      The <span class="font-mono">Query Logs (Sqlite)</span> app isn't installed on this server, so no
      query history is available. Install it from the Technitium web console's Apps section to enable
      this page.
    </div>

    <template v-else>
      <div v-if="hostChips.length > 0" class="mb-4 flex flex-wrap gap-2">
        <button
          v-for="chip in hostChips"
          :key="chip.name"
          type="button"
          class="host-chip rounded-full border px-2.5 py-1 text-[11.5px]"
          :class="
            filters.clientIpAddress === chip.name
              ? 'border-accent bg-accent/10 font-semibold text-accent'
              : 'border-border text-gray-500'
          "
          @click="selectHost(chip)"
        >
          <span class="font-mono">{{ chip.name }}</span>
        </button>
        <button
          v-if="filters.clientIpAddress"
          type="button"
          class="rounded-full border border-border px-2.5 py-1 text-[11.5px] text-gray-500"
          @click="clearHost"
        >
          All hosts
        </button>
      </div>

      <HostInsightPanel
        v-if="hostInsight"
        :ip="hostInsight.ip"
        :hostname="hostInsight.hostname"
        :total="hostInsight.total"
        :blocked="hostInsight.blocked"
        :cache-blocked="hostInsight.cacheBlocked"
        :upstream-blocked="hostInsight.upstreamBlocked"
      />

      <div class="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
        <input
          id="filter-client"
          v-model="filters.clientIpAddress"
          placeholder="Client IP"
          class="rounded-md border border-border bg-background-card px-2.5 py-1.5 text-xs font-mono"
          @change="onFilterChange"
        />
        <input
          id="filter-qname"
          v-model="filters.qname"
          placeholder="Query name"
          class="rounded-md border border-border bg-background-card px-2.5 py-1.5 text-xs"
          @change="onFilterChange"
        />
        <select
          id="filter-response-type"
          v-model="filters.responseType"
          class="rounded-md border border-border bg-background-card px-2.5 py-1.5 text-xs"
          @change="onFilterChange"
        >
          <option value="">All responses</option>
          <option value="Recursive">Recursive</option>
          <option value="Cached">Cached</option>
          <option value="Authoritative">Authoritative</option>
          <option value="Blocked">Blocked</option>
          <option value="CacheBlocked">Cache Block</option>
          <option value="UpstreamBlocked">Upstream Block</option>
        </select>
        <select
          id="filter-protocol"
          v-model="filters.protocol"
          class="rounded-md border border-border bg-background-card px-2.5 py-1.5 text-xs"
          @change="onFilterChange"
        >
          <option value="">All protocols</option>
          <option value="Udp">UDP</option>
          <option value="Tcp">TCP</option>
          <option value="Tls">DoT</option>
          <option value="Https">DoH</option>
          <option value="Quic">DoQ</option>
        </select>
        <input
          id="filter-rcode"
          v-model="filters.rcode"
          placeholder="RCODE"
          class="rounded-md border border-border bg-background-card px-2.5 py-1.5 text-xs"
          @change="onFilterChange"
        />
      </div>

      <p v-if="loadError" id="logs-error" class="mb-3 text-sm text-crit">{{ loadError }}</p>

      <div class="overflow-x-auto rounded-lg border border-border">
        <table class="w-full text-left text-[12px]">
          <thead>
            <tr class="border-b border-border bg-background-elevated text-[10.5px] uppercase text-gray-500">
              <th class="px-2.5 py-2 font-bold">Time</th>
              <th class="px-2.5 py-2 font-bold">Client</th>
              <th class="px-2.5 py-2 font-bold">Protocol</th>
              <th class="px-2.5 py-2 font-bold">Response</th>
              <th class="px-2.5 py-2 font-bold">Blocked by</th>
              <th class="px-2.5 py-2 font-bold">RCODE</th>
              <th class="px-2.5 py-2 font-bold">Query</th>
              <th class="px-2.5 py-2 font-bold">Type</th>
              <th class="px-2.5 py-2 font-bold">Answer</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="entries.length === 0">
              <td colspan="9" class="px-3 py-6 text-center text-gray-500">
                {{ loading ? "Loading…" : "No entries match these filters." }}
              </td>
            </tr>
            <tr v-for="row in entries" :key="row.rowNumber" class="border-b border-border last:border-b-0">
              <td class="whitespace-nowrap px-2.5 py-1.5 text-gray-500">{{ new Date(row.timestamp).toLocaleTimeString() }}</td>
              <td class="px-2.5 py-1.5 font-mono">{{ row.clientIpAddress }}</td>
              <td class="px-2.5 py-1.5">{{ row.protocol }}</td>
              <td class="px-2.5 py-1.5">{{ row.responseType }}</td>
              <td class="px-2.5 py-1.5">{{ blockedByLabel(row.responseType) ?? "–" }}</td>
              <td class="px-2.5 py-1.5">{{ row.rcode }}</td>
              <td class="max-w-[220px] truncate px-2.5 py-1.5 font-mono">{{ row.qname }}</td>
              <td class="px-2.5 py-1.5 text-gray-500">{{ row.qtype }}</td>
              <td class="max-w-[200px] truncate px-2.5 py-1.5 font-mono text-gray-500">{{ row.answer ?? "–" }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="mt-2 flex items-center justify-between text-[11.5px] text-gray-500">
        <span>Showing page {{ pageNumber }} of {{ totalPages }} &middot; {{ totalEntries.toLocaleString() }} entries</span>
        <div class="flex gap-1">
          <button
            id="prev-page"
            type="button"
            class="rounded-md border border-border px-2 py-1 disabled:opacity-40"
            :disabled="pageNumber <= 1"
            @click="goToPage(-1)"
          >
            Prev
          </button>
          <button
            id="next-page"
            type="button"
            class="rounded-md border border-border px-2 py-1 disabled:opacity-40"
            :disabled="pageNumber >= totalPages"
            @click="goToPage(1)"
          >
            Next
          </button>
        </div>
      </div>
    </template>
  </div>
</template>
