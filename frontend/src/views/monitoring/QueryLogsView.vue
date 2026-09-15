<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from "vue"
import { useRoute } from "vue-router"
import { useConnectionStore } from "../../stores/connection"
import { useRefreshStore } from "../../stores/refresh"
import { useQueryLogsAppStore } from "../../stores/queryLogsApp"
import {
  getTopStats,
  queryLogs,
  exportLogs,
  TechnitiumApiError,
  type QueryLogEntry,
  type TopClientEntry,
} from "../../api/technitium"
import { durationToRange } from "../../lib/dateRange"
import { blockedByLabel } from "../../lib/blockMechanism"
import { triggerDownload } from "../../lib/download"
import { formatRtt } from "../../lib/formatRtt"
import { responseTypeTone, rcodeTone, blockedByTone } from "../../lib/badgeTones"
import { useLivePolling } from "../../composables/useLivePolling"
import HostInsightPanel from "../../components/logs/HostInsightPanel.vue"
import Badge from "../../components/ui/Badge.vue"
import LiveToggle from "../../components/ui/LiveToggle.vue"

const connection = useConnectionStore()
const refresh = useRefreshStore()
const route = useRoute()
const queryLogsApp = useQueryLogsAppStore()

const ENTRIES_PER_PAGE = 20

const filters = reactive({
  clientIpAddress: "",
  qname: "",
  responseType: "",
  protocol: "",
  rcode: "",
  qtype: "",
})
const pageNumber = ref(1)

const loading = ref(false)
const loadError = ref<string | null>(null)
const entries = ref<QueryLogEntry[]>([])
const totalEntries = ref(0)
const totalPages = ref(1)

const hostChips = ref<TopClientEntry[]>([])
const hostInsight = ref<{
  ip: string
  hostname: string | null
  total: number
  blocked: number
  cacheBlocked: number
  upstreamBlocked: number
} | null>(null)

const { liveOn, toggle: toggleLive } = useLivePolling(() => loadTable())

// Matches the wireframe's "Showing 1–10 of N" footer wording.
const rangeStart = computed(() => (totalEntries.value === 0 ? 0 : (pageNumber.value - 1) * ENTRIES_PER_PAGE + 1))
const rangeEnd = computed(() => Math.min(pageNumber.value * ENTRIES_PER_PAGE, totalEntries.value))

function activeFilters() {
  const f: Record<string, string> = {}
  if (filters.clientIpAddress) f.clientIpAddress = filters.clientIpAddress
  if (filters.qname) f.qname = filters.qname
  if (filters.responseType) f.responseType = filters.responseType
  if (filters.protocol) f.protocol = filters.protocol
  if (filters.rcode) f.rcode = filters.rcode
  if (filters.qtype) f.qtype = filters.qtype
  return f
}

async function loadTable(): Promise<void> {
  if (!connection.isConfigured) return
  await queryLogsApp.ensure(connection.credentials)
  if (queryLogsApp.missing || !queryLogsApp.app) return
  loading.value = true
  loadError.value = null
  try {
    const res = await queryLogs(connection.credentials, queryLogsApp.app, {
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

// Reads the count from a settled logs/query call, treating a rejected
// one as 0 rather than failing the whole panel. This matters in
// practice: Technitium's own APIDOCS.md lists "CacheBlocked" as a valid
// responseType filter value, but v15.4 rejects it live with "Requested
// value 'CacheBlocked' was not found." — confirmed against the real
// server. A single filter value one server version doesn't recognize
// must not silently take down the entire host-insight feature.
function countFrom(result: PromiseSettledResult<Awaited<ReturnType<typeof queryLogs>>>): number {
  return result.status === "fulfilled" ? result.value.response.totalEntries : 0
}

async function loadHostInsight(entry: TopClientEntry): Promise<void> {
  await queryLogsApp.ensure(connection.credentials)
  if (!queryLogsApp.app) return
  const app = queryLogsApp.app
  const { start, end } = durationToRange("LastDay")
  const base = { clientIpAddress: entry.name, start, end, entriesPerPage: 1 }
  const [totalRes, blockedRes, cacheRes, upstreamRes] = await Promise.allSettled([
    queryLogs(connection.credentials, app, base),
    queryLogs(connection.credentials, app, { ...base, responseType: "Blocked" }),
    queryLogs(connection.credentials, app, { ...base, responseType: "CacheBlocked" }),
    queryLogs(connection.credentials, app, { ...base, responseType: "UpstreamBlocked" }),
  ])
  const cacheBlocked = countFrom(cacheRes)
  const upstreamBlocked = countFrom(upstreamRes)
  hostInsight.value = {
    ip: entry.name,
    hostname: entry.domain ?? null,
    total: countFrom(totalRes),
    blocked: countFrom(blockedRes) + cacheBlocked + upstreamBlocked,
    cacheBlocked,
    upstreamBlocked,
  }
}

function selectHost(entry: TopClientEntry): void {
  filters.clientIpAddress = entry.name
  pageNumber.value = 1
  // loadHostInsight no longer rejects (see countFrom above), but a
  // fire-and-forget call should never be able to produce an unhandled
  // rejection regardless of what future changes do inside it.
  loadHostInsight(entry).catch(() => {})
  void loadTable()
}

function clearHost(): void {
  filters.clientIpAddress = ""
  hostInsight.value = null
  pageNumber.value = 1
  void loadTable()
}

// Lets any query name — a table row's Query cell, or a domain clicked
// from Overview's Top domains/Top blocked — become the qname filter in
// one click, without the user re-typing it.
function filterByQname(qname: string): void {
  filters.qname = qname
  pageNumber.value = 1
  void loadTable()
}

// Selecting a client this way (table row click, or arriving via
// /logs?client=...) works even for a client outside the top-6 chip
// list — it's the general case selectHost's callers (the chips) are
// just one instance of.
function filterByClient(ip: string): void {
  selectHost({ name: ip, hits: 0, rateLimited: false })
}

// Reads ?client=<ip> or ?qname=<domain> — set by TopList's links on
// Overview and by ClientsView's client links — so arriving here from
// elsewhere in the app lands pre-filtered instead of dumping the user
// on an unfiltered 10,000-row table they have to re-filter by hand.
function applyRouteQuery(): void {
  if (!connection.isConfigured) return
  const qClient = route.query.client
  const qQname = route.query.qname
  if (typeof qClient === "string" && qClient) {
    filterByClient(qClient)
  } else if (typeof qQname === "string" && qQname) {
    filterByQname(qQname)
  } else {
    void loadTable()
  }
}

function onFilterChange(): void {
  pageNumber.value = 1
  void loadTable()
}

// Typing an IP straight into the Client IP field is the same intent as
// clicking a host chip — the Allowed/blocked breakdown should appear
// either way, not only when the user happens to click a suggested chip.
function onClientFilterChange(): void {
  pageNumber.value = 1
  if (filters.clientIpAddress) {
    const chip = hostChips.value.find((c) => c.name === filters.clientIpAddress)
    loadHostInsight(chip ?? { name: filters.clientIpAddress, hits: 0, rateLimited: false }).catch(() => {})
  } else {
    hostInsight.value = null
  }
  void loadTable()
}

function goToPage(delta: number): void {
  const next = pageNumber.value + delta
  if (next < 1 || next > totalPages.value) return
  pageNumber.value = next
  void loadTable()
}

async function onExport(): Promise<void> {
  if (!queryLogsApp.app) return
  try {
    const file = await exportLogs(connection.credentials, queryLogsApp.app, activeFilters())
    triggerDownload(file)
  } catch (err) {
    loadError.value = err instanceof TechnitiumApiError ? err.message : "Could not export query logs."
  }
}

onMounted(() => {
  applyRouteQuery()
  loadHostChips()
})
watch(
  () => connection.isConfigured,
  (configured) => {
    if (configured) {
      applyRouteQuery()
      loadHostChips()
    }
  },
)
// The route component instance is reused across /logs navigations with
// different query strings (Vue Router doesn't remount for a query-only
// change), so onMounted alone would miss a second click-through from
// Overview while already on this page — this watcher covers that.
watch(() => route.query, applyRouteQuery)
watch(() => refresh.tick, loadTable)
</script>

<template>
  <div>
    <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="text-lg font-semibold tracking-tight text-fg">Query Logs</h1>
        <p class="mt-1 text-sm text-gray-500">
          Every request answered by the resolver<span v-if="queryLogsApp.name">
            &middot; sourced from the {{ queryLogsApp.name }} app</span
          ><span v-if="totalEntries > 0"> &middot; {{ totalEntries.toLocaleString() }} entries</span>
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <LiveToggle id="live-toggle" :model-value="liveOn" @update:model-value="toggleLive" />
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

    <div v-else-if="queryLogsApp.missing" id="query-logs-app-missing" class="rounded-lg border border-warn/35 bg-warn/10 px-4 py-3 text-sm">
      No <span class="font-mono">Query Logs</span> app is installed on this server, so no query history is
      available. Install one from the Technitium web console's Apps section — Sqlite, MySQL, PostgreSQL and
      SQL Server variants are all supported here.
    </div>

    <template v-else>
      <div class="mb-4 rounded-lg border border-border bg-background-card p-3.5">
        <div v-if="hostChips.length > 0" class="mb-3">
          <label class="mb-1 block text-[11px] font-semibold text-gray-500">Filter by host</label>
          <div class="flex flex-wrap gap-1.5">
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
              <span class="font-mono font-semibold">{{ chip.name }}</span>
              <span v-if="chip.domain" class="ml-1.5 text-gray-500">{{ chip.domain.split(".")[0] }}</span>
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
        </div>

        <div class="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-6">
          <div class="flex flex-col gap-1">
            <label for="filter-client" class="text-[11px] font-semibold text-gray-500">Client IP</label>
            <input
              id="filter-client"
              v-model="filters.clientIpAddress"
              placeholder="10.0.10.30"
              class="rounded-md border border-border bg-background-card px-2.5 py-1.5 text-xs font-mono"
              @change="onClientFilterChange"
            />
          </div>
          <div class="flex flex-col gap-1">
            <label for="filter-qname" class="text-[11px] font-semibold text-gray-500">Query name</label>
            <input
              id="filter-qname"
              v-model="filters.qname"
              placeholder="example.com"
              class="rounded-md border border-border bg-background-card px-2.5 py-1.5 text-xs"
              @change="onFilterChange"
            />
          </div>
          <div class="flex flex-col gap-1">
            <label for="filter-response-type" class="text-[11px] font-semibold text-gray-500">Response type</label>
            <select
              id="filter-response-type"
              v-model="filters.responseType"
              class="rounded-md border border-border bg-background-card px-2.5 py-1.5 text-xs"
              @change="onFilterChange"
            >
              <option value="">All</option>
              <option value="Recursive">Recursive</option>
              <option value="Cached">Cached</option>
              <option value="Authoritative">Authoritative</option>
              <option value="Blocked">Blocked</option>
              <option value="CacheBlocked">Cache Block</option>
              <option value="UpstreamBlocked">Upstream Block</option>
            </select>
          </div>
          <div class="flex flex-col gap-1">
            <label for="filter-protocol" class="text-[11px] font-semibold text-gray-500">Protocol</label>
            <select
              id="filter-protocol"
              v-model="filters.protocol"
              class="rounded-md border border-border bg-background-card px-2.5 py-1.5 text-xs"
              @change="onFilterChange"
            >
              <option value="">All</option>
              <option value="Udp">UDP</option>
              <option value="Tcp">TCP</option>
              <option value="Tls">DoT</option>
              <option value="Https">DoH</option>
              <option value="Quic">DoQ</option>
            </select>
          </div>
          <div class="flex flex-col gap-1">
            <label for="filter-rcode" class="text-[11px] font-semibold text-gray-500">RCODE</label>
            <select
              id="filter-rcode"
              v-model="filters.rcode"
              class="rounded-md border border-border bg-background-card px-2.5 py-1.5 text-xs"
              @change="onFilterChange"
            >
              <option value="">All</option>
              <option value="NoError">NoError</option>
              <option value="NxDomain">NxDomain</option>
              <option value="ServerFailure">ServerFailure</option>
              <option value="Refused">Refused</option>
            </select>
          </div>
          <div class="flex flex-col gap-1">
            <label for="filter-qtype" class="text-[11px] font-semibold text-gray-500">Record type</label>
            <select
              id="filter-qtype"
              v-model="filters.qtype"
              class="rounded-md border border-border bg-background-card px-2.5 py-1.5 text-xs"
              @change="onFilterChange"
            >
              <option value="">All</option>
              <option value="A">A</option>
              <option value="AAAA">AAAA</option>
              <option value="CNAME">CNAME</option>
              <option value="MX">MX</option>
              <option value="TXT">TXT</option>
              <option value="NS">NS</option>
              <option value="SOA">SOA</option>
              <option value="PTR">PTR</option>
              <option value="SRV">SRV</option>
              <option value="CAA">CAA</option>
              <option value="ANY">ANY</option>
            </select>
          </div>
        </div>
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
              <th class="px-2.5 py-2 text-right font-bold">RTT</th>
              <th class="px-2.5 py-2 font-bold">Answer</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="entries.length === 0">
              <td colspan="10" class="px-3 py-6 text-center text-gray-500">
                {{ loading ? "Loading…" : "No entries match these filters." }}
              </td>
            </tr>
            <tr v-for="row in entries" :key="row.rowNumber" class="border-b border-border last:border-b-0">
              <td class="whitespace-nowrap px-2.5 py-1.5 text-gray-500">{{ new Date(row.timestamp).toLocaleTimeString() }}</td>
              <td class="px-2.5 py-1.5 font-mono">
                <button
                  type="button"
                  title="Filter Query Logs by this client"
                  class="hover:text-accent hover:underline"
                  @click="filterByClient(row.clientIpAddress)"
                >
                  {{ row.clientIpAddress }}
                </button>
              </td>
              <td class="px-2.5 py-1.5">{{ row.protocol }}</td>
              <td class="px-2.5 py-1.5">
                <Badge :tone="responseTypeTone(row.responseType)">{{ row.responseType }}</Badge>
              </td>
              <td class="px-2.5 py-1.5">
                <Badge v-if="blockedByLabel(row.responseType)" :tone="blockedByTone(row.responseType)">{{
                  blockedByLabel(row.responseType)
                }}</Badge>
                <span v-else class="text-gray-500">–</span>
              </td>
              <td class="px-2.5 py-1.5">
                <Badge :tone="rcodeTone(row.rcode)">{{ row.rcode }}</Badge>
              </td>
              <td class="max-w-[220px] truncate px-2.5 py-1.5 font-mono">
                <button
                  type="button"
                  title="Filter Query Logs by this domain"
                  class="hover:text-accent hover:underline"
                  @click="filterByQname(row.qname)"
                >
                  {{ row.qname }}
                </button>
              </td>
              <td class="px-2.5 py-1.5 text-gray-500">{{ row.qtype }}</td>
              <td class="px-2.5 py-1.5 text-right tabular-nums text-gray-500">{{ formatRtt(row.responseRtt) }}</td>
              <td class="max-w-[200px] truncate px-2.5 py-1.5 font-mono text-gray-500">{{ row.answer ?? "–" }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="mt-2 flex items-center justify-between rounded-b-lg border border-t-0 border-border bg-background-elevated px-3 py-1.5 text-[11.5px] text-gray-500">
        <span>Showing {{ rangeStart.toLocaleString() }}&ndash;{{ rangeEnd.toLocaleString() }} of {{ totalEntries.toLocaleString() }}</span>
        <div class="flex gap-1">
          <button
            id="prev-page"
            type="button"
            title="Previous page"
            class="inline-flex h-[26px] w-[26px] items-center justify-center rounded-md border border-border bg-background-card disabled:opacity-40"
            :disabled="pageNumber <= 1"
            @click="goToPage(-1)"
          >
            <svg viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2"><path d="m15 6-6 6 6 6" /></svg>
          </button>
          <button
            id="next-page"
            type="button"
            title="Next page"
            class="inline-flex h-[26px] w-[26px] items-center justify-center rounded-md border border-border bg-background-card disabled:opacity-40"
            :disabled="pageNumber >= totalPages"
            @click="goToPage(1)"
          >
            <svg viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 6 6 6-6 6" /></svg>
          </button>
        </div>
      </div>
    </template>
  </div>
</template>
