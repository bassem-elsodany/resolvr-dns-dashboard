<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue"
import { useRoute, useRouter } from "vue-router"
import {
  getTopStats,
  listDhcpLeases,
  queryLogs,
  type DashboardStatsResult,
  type QueryLogEntry,
  type StatsDuration,
} from "../../api/technitium"
import { useConnectionStore } from "../../stores/connection"
import { useRefreshStore } from "../../stores/refresh"
import { useQueryLogsAppStore } from "../../stores/queryLogsApp"
import { mapLimit } from "../../lib/async"
import { absChange, cached, fmtInt, pct, RANGE_NOUN } from "../../lib/charts"
import { durationToRange } from "../../lib/dateRange"
import {
  HEAVY_MIN_QUERIES,
  blockedShare,
  bucketEntries,
  clientActivity,
  displayName,
  knownAtPageLoad,
  matchesFilter,
  newClientIps,
  rememberClients,
  searchClients,
  shareSegments,
  sortClients,
  summarizeSample,
  type ClientFilter,
  type ClientRow,
  type ClientSort,
} from "../../lib/clients"
import ChartPanel from "../charts/ChartPanel.vue"
import ClientShareBar from "./ClientShareBar.vue"
import ClientList from "./ClientList.vue"
import ClientDetail from "./ClientDetail.vue"
import ClientHeatmap from "./ClientHeatmap.vue"

type Resp = DashboardStatsResult["response"]

const props = defineProps<{
  stats: Resp["stats"]
  prevStats: Resp["stats"] | null
  duration: StatsDuration
  // The shared sample of the latest logged queries, loaded by Overview.
  logEntries: QueryLogEntry[]
  logState: "loading" | "ready" | "missing" | "error"
}>()

const connection = useConnectionStore()
const refresh = useRefreshStore()
const queryLogsApp = useQueryLogsAppStore()
const route = useRoute()
const router = useRouter()

const CLIENT_LIMIT = 20
const COUNT_CONCURRENCY = 6
const SAMPLE_SIZE = 1000
const TTL_MS = 60 * 1000

// ---------- the client list ----------

const rows = ref<ClientRow[]>([])
const listState = ref<"loading" | "ready" | "missing" | "error">("loading")

// Per client: its queries and blocked queries in the selected window, as
// two one-row log queries (the same method the Clients page uses). Counts
// come from the log itself so both numbers cover exactly the same window.
async function fetchRows(duration: StatsDuration): Promise<ClientRow[]> {
  const app = queryLogsApp.app!
  const creds = connection.credentials
  const top = await getTopStats("TopClients", duration, creds, { limit: CLIENT_LIMIT })
  const { start, end } = durationToRange(duration)
  return mapLimit(top.response.topClients ?? [], COUNT_CONCURRENCY, async (entry) => {
    const [total, blocked] = await Promise.all([
      queryLogs(creds, app, { clientIpAddress: entry.name, start, end, entriesPerPage: 1, descendingOrder: true }),
      queryLogs(creds, app, { clientIpAddress: entry.name, responseType: "Blocked", start, end, entriesPerPage: 1 }),
    ])
    return {
      ip: entry.name,
      hostname: entry.domain ?? null,
      hits: total.response.totalEntries,
      blocked: blocked.response.totalEntries,
      rateLimited: entry.rateLimited,
      lastSeen: total.response.entries[0]?.timestamp ?? null,
    }
  })
}

const leases = ref<Record<string, { mac: string; scope: string }>>({})

async function loadLeases(force: boolean): Promise<void> {
  try {
    const res = await cached("dhcp-leases", TTL_MS, () => listDhcpLeases(connection.credentials), force)
    const map: Record<string, { mac: string; scope: string }> = {}
    for (const l of res.response.leases) map[l.address] = { mac: l.hardwareAddress, scope: l.scope }
    leases.value = map
  } catch {
    // Not every server runs DHCP; the MAC and lease are simply left out.
  }
}

const known = knownAtPageLoad()
const newIps = computed(() => newClientIps(rows.value.map((r) => r.ip), known))

async function loadList(force = false): Promise<void> {
  if (!connection.isConfigured) return
  await queryLogsApp.ensure(connection.credentials)
  if (queryLogsApp.missing) {
    listState.value = "missing"
    return
  }
  if (!queryLogsApp.app) {
    listState.value = "error"
    return
  }
  try {
    const duration = props.duration
    rows.value = await cached(`clients-${duration}`, TTL_MS, () => fetchRows(duration), force)
    listState.value = "ready"
    rememberClients(rows.value.map((r) => r.ip), known)
    void loadLeases(force)
  } catch {
    listState.value = "error"
  }
}

onMounted(() => void loadList())
// A new range, a Live refresh or a manual refresh all replace `stats`;
// the 60 s cache keeps Live polling from re-running 40 count queries.
watch(() => props.stats, () => void loadList())
watch(() => props.duration, () => void loadList())
watch(() => refresh.tick, () => void loadList(true))
watch(() => connection.isConfigured, (c) => c && void loadList())

// ---------- filters and selection ----------

const search = ref("")
const filter = ref<ClientFilter>("all")
const sort = ref<ClientSort>("queries")

const FILTER_IDS: ClientFilter[] = ["all", "heavy", "limited", "new", "quiet", "attention"]
const counts = computed(() => {
  const out = {} as Record<ClientFilter, number>
  for (const f of FILTER_IDS) out[f] = rows.value.filter((r) => matchesFilter(r, f, newIps.value)).length
  return out
})
const visible = computed(() =>
  sortClients(searchClients(rows.value.filter((r) => matchesFilter(r, filter.value, newIps.value)), search.value), sort.value),
)

const selectedIp = computed<string | null>(() => {
  const q = route.query.client
  if (typeof q === "string" && rows.value.some((r) => r.ip === q)) return q
  return sortClients(rows.value, "queries")[0]?.ip ?? null
})
const selected = computed(() => rows.value.find((r) => r.ip === selectedIp.value) ?? null)

function select(ip: string): void {
  void router.replace({ query: { ...route.query, tab: "clients", client: ip } })
}

// A selection must stay visible, so choosing a client that the current
// search or filter hides (from the share bar or heatmap) clears them.
function selectAndReveal(ip: string): void {
  const row = rows.value.find((r) => r.ip === ip)
  if (row && !visible.value.some((r) => r.ip === ip)) {
    search.value = ""
    filter.value = "all"
  }
  select(ip)
}

// ---------- the selected client's recent queries ----------

const sample = ref<QueryLogEntry[]>([])
const sampleState = ref<"loading" | "ready" | "error">("loading")
let sampleToken = 0

async function loadSample(ip: string | null): Promise<void> {
  if (!ip || !queryLogsApp.app) return
  const token = ++sampleToken
  sampleState.value = "loading"
  const app = queryLogsApp.app
  const duration = props.duration
  try {
    const res = await cached(`client-sample-${ip}-${duration}`, TTL_MS, () =>
      queryLogs(connection.credentials, app, {
        clientIpAddress: ip,
        ...durationToRange(duration),
        pageNumber: 1,
        entriesPerPage: SAMPLE_SIZE,
        descendingOrder: true,
      }),
    )
    if (token !== sampleToken) return
    sample.value = res.response.entries
    sampleState.value = "ready"
  } catch {
    if (token === sampleToken) sampleState.value = "error"
  }
}

watch([selectedIp, () => props.duration, () => props.stats], () => void loadSample(selectedIp.value))
watch(listState, (s) => s === "ready" && void loadSample(selectedIp.value))

const summary = computed(() => (sampleState.value === "ready" ? summarizeSample(sample.value) : null))
const buckets = computed(() => (sampleState.value === "ready" ? bucketEntries(sample.value, 24) : null))

// ---------- summary tiles, share bar, heatmap ----------

const vs = computed(() => `vs previous ${RANGE_NOUN[props.duration]}`)
const topTalker = computed(() => sortClients(rows.value, "queries")[0] ?? null)
const highestBlock = computed(() => {
  const eligible = rows.value.filter((r) => r.hits >= HEAVY_MIN_QUERIES)
  return eligible.sort((a, b) => blockedShare(b) - blockedShare(a))[0] ?? null
})
const attention = computed(() => rows.value.filter((r) => r.rateLimited || newIps.value.has(r.ip)))
const clientChange = computed(() => (props.prevStats ? absChange(props.stats.totalClients, props.prevStats.totalClients) : null))

const segments = computed(() => shareSegments(rows.value, props.stats.totalQueries))
const labels = computed(() => Object.fromEntries(rows.value.map((r) => [r.ip, displayName(r)])))
const activity = computed(() => (props.logState === "ready" ? clientActivity(props.logEntries, 8, 24) : null))

function openLogs(query: Record<string, string>): void {
  void router.push({ path: "/logs", query })
}

function showAttention(): void {
  filter.value = "attention"
  search.value = ""
}
</script>

<template>
  <div class="flex flex-col gap-3.5">
    <p v-if="listState === 'loading'" class="py-10 text-center text-sm text-gray-500">Loading clients…</p>
    <p v-else-if="listState === 'missing'" class="py-10 text-center text-sm text-gray-500">
      Client activity needs a query-logging app installed on the Technitium server.
    </p>
    <p v-else-if="listState === 'error'" class="py-10 text-center text-sm text-gray-500">Could not load client activity.</p>
    <p v-else-if="rows.length === 0" class="py-10 text-center text-sm text-gray-500">No client activity in the selected range.</p>

    <template v-else>
      <div class="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3.5">
        <div id="client-tile-active" class="min-w-0 rounded-lg border border-border bg-background-card px-4 py-3">
          <div class="text-xs text-gray-400">Active clients</div>
          <div class="text-2xl font-bold tabular-nums leading-tight">{{ fmtInt(stats.totalClients) }}</div>
          <div class="text-xs text-gray-400">
            <span v-if="clientChange" class="font-medium">{{ clientChange.text }}</span> {{ vs }}
          </div>
        </div>
        <button
          v-if="topTalker"
          id="client-tile-top"
          type="button"
          class="min-w-0 rounded-lg border border-border bg-background-card px-4 py-3 text-left hover:border-border-hover"
          @click="select(topTalker.ip)"
        >
          <div class="text-xs text-gray-400">Top talker</div>
          <div class="break-words text-2xl font-bold leading-tight">{{ displayName(topTalker) }}</div>
          <div class="text-xs text-gray-400">{{ pct(topTalker.hits, stats.totalQueries, 0) }} of all queries</div>
        </button>
        <button
          id="client-tile-block"
          type="button"
          class="min-w-0 rounded-lg border border-border bg-background-card px-4 py-3 text-left hover:border-border-hover disabled:cursor-default"
          :disabled="!highestBlock"
          @click="highestBlock && select(highestBlock.ip)"
        >
          <div class="text-xs text-gray-400">Highest block rate</div>
          <div class="break-words text-2xl font-bold leading-tight">{{ highestBlock ? displayName(highestBlock) : "–" }}</div>
          <div class="text-xs text-gray-400">
            {{ highestBlock ? `${pct(highestBlock.blocked, highestBlock.hits)} of its queries blocked` : `No client has ${HEAVY_MIN_QUERIES}+ queries yet` }}
          </div>
        </button>
        <button
          id="client-tile-attention"
          type="button"
          class="min-w-0 rounded-lg border border-border bg-background-card px-4 py-3 text-left hover:border-border-hover"
          @click="showAttention"
        >
          <div class="text-xs text-gray-400">Needs a look</div>
          <div class="text-2xl font-bold leading-tight">{{ attention.length }} {{ attention.length === 1 ? "client" : "clients" }}</div>
          <div class="text-xs text-gray-400">{{ counts.new }} new, {{ counts.limited }} rate limited</div>
        </button>
      </div>

      <ChartPanel title="Who uses your DNS" hint="Share of all queries in the selected range. Click a segment to open that client.">
        <ClientShareBar :segments="segments" :selected-ip="selectedIp" :total-queries="stats.totalQueries" @select="selectAndReveal" />
      </ChartPanel>

      <div class="grid grid-cols-1 items-start gap-3.5 lg:grid-cols-[minmax(300px,380px)_minmax(0,1fr)]">
        <section class="min-w-0 rounded-lg border border-border bg-background-card p-3 lg:sticky lg:top-[72px]" aria-label="Client list">
          <ClientList
            v-model:filter="filter"
            v-model:sort="sort"
            v-model:search="search"
            :rows="visible"
            :total="rows.length"
            :selected-ip="selectedIp"
            :new-ips="newIps"
            :counts="counts"
            @select="select"
          />
        </section>
        <section class="min-w-0 rounded-lg border border-border bg-background-card px-4 py-3.5" aria-live="polite">
          <ClientDetail
            v-if="selected"
            :client="selected"
            :is-new="newIps.has(selected.ip)"
            :lease="leases[selected.ip] ?? null"
            :summary="summary"
            :buckets="buckets"
            :sample-state="sampleState"
            @open-logs="openLogs"
          />
        </section>
      </div>

      <ChartPanel title="Recent activity by client" hint="The busiest clients in the latest logged queries, split into equal time slices. Click a row or cell to open that client.">
        <p v-if="logState === 'loading'" class="py-6 text-center text-sm text-gray-500">Loading…</p>
        <p v-else-if="logState !== 'ready' || !activity" class="py-6 text-center text-sm text-gray-500">Not enough logged queries to draw activity yet.</p>
        <ClientHeatmap v-else :start="activity.start" :end="activity.end" :rows="activity.rows" :labels="labels" :selected-ip="selectedIp" @select="selectAndReveal" />
      </ChartPanel>
    </template>
  </div>
</template>
