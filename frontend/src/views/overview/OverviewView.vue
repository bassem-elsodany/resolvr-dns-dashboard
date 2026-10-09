<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue"
import { useRouter } from "vue-router"
import { useConnectionStore } from "../../stores/connection"
import { useTimeRangeStore } from "../../stores/timeRange"
import { useRefreshStore } from "../../stores/refresh"
import { useAuthStore } from "../../stores/auth"
import { useQueryLogsAppStore } from "../../stores/queryLogsApp"
import {
  getDashboardStats,
  getTopStats,
  getSettings,
  queryLogs,
  TechnitiumApiError,
  type DashboardStatsResult,
  type QueryLogEntry,
  type TopClientEntry,
} from "../../api/technitium"
import { forceUpdateBlockLists, AppApiError } from "../../api/app"
import { useLivePolling } from "../../composables/useLivePolling"
import TrendTiles from "../../components/overview/TrendTiles.vue"
import QueriesChart from "../../components/overview/QueriesChart.vue"
import ChartPanel from "../../components/charts/ChartPanel.vue"
import DonutChart, { type DonutItem } from "../../components/charts/DonutChart.vue"
import TypeBars from "../../components/charts/TypeBars.vue"
import LatencyPanel from "../../components/overview/LatencyPanel.vue"
import HeatmapPanel from "../../components/overview/HeatmapPanel.vue"
import FlowPanel from "../../components/overview/FlowPanel.vue"
import DhcpUsagePanel from "../../components/overview/DhcpUsagePanel.vue"
import ZoneTypesPanel from "../../components/overview/ZoneTypesPanel.vue"
import CacheSizePanel from "../../components/overview/CacheSizePanel.vue"
import { buildFlows, cached, previousRange } from "../../lib/charts"
import { durationToRange } from "../../lib/dateRange"
import TopList from "../../components/overview/TopList.vue"
import LiveToggle from "../../components/ui/LiveToggle.vue"

const connection = useConnectionStore()
const router = useRouter()
const auth = useAuthStore()
const queryLogsApp = useQueryLogsAppStore()
// Time range is a single global control in the topbar (AppShell.vue),
// not a per-page copy — the wireframe puts it there once and Overview
// and Clients both read the same selection.
const timeRange = useTimeRangeStore()
const refresh = useRefreshStore()

const loading = ref(false)
const loadError = ref<string | null>(null)
const stats = ref<DashboardStatsResult["response"] | null>(null)
// Totals for the window just before the selected one, for the tiles'
// "vs previous" change. Cached per range so a Live refresh every few
// seconds does not double the number of calls for data that barely moves.
const prevStats = ref<DashboardStatsResult["response"]["stats"] | null>(null)
let prevCache: { duration: string; at: number; stats: DashboardStatsResult["response"]["stats"] | null } | null = null
const PREV_TTL_MS = 5 * 60 * 1000

async function loadPrevious(): Promise<DashboardStatsResult["response"]["stats"] | null> {
  const duration = timeRange.selected
  if (prevCache && prevCache.duration === duration && Date.now() - prevCache.at < PREV_TTL_MS) return prevCache.stats
  const range = previousRange(duration)
  let result: DashboardStatsResult["response"]["stats"] | null = null
  if (range) {
    try {
      const res = await getDashboardStats("Custom", connection.credentials, { utc: true, ...range })
      result = res.response.stats
    } catch {
      // The comparison is a nicety; the page works without it.
    }
  }
  prevCache = { duration, at: Date.now(), stats: result }
  return result
}
const rateLimitedClient = ref<TopClientEntry | null>(null)
const blockListFreshness = ref<{ overdue: boolean; message: string } | null>(null)

function computeBlockListFreshness(settings: {
  blockListNextUpdatedOn?: string
  blockListUpdateIntervalHours?: number
}): { overdue: boolean; message: string } | null {
  if (!settings.blockListNextUpdatedOn || !settings.blockListUpdateIntervalHours) return null

  const next = new Date(settings.blockListNextUpdatedOn).getTime()
  const now = Date.now()
  const msRemaining = next - now
  const closeThresholdMs = 2 * 60 * 60 * 1000
  if (msRemaining > closeThresholdMs) return null

  const lastUpdated = next - settings.blockListUpdateIntervalHours * 3600 * 1000
  const hoursSince = Math.max(0, Math.round((now - lastUpdated) / 3600000))
  const overdue = msRemaining < 0

  return {
    overdue,
    message: overdue
      ? `Block lists are overdue for an update — last ran ${hoursSince}h ago.`
      : `Block lists last updated ${hoursSince}h ago — next update due soon.`,
  }
}

// The response-time and flow panels read one sample of the latest logged
// queries. It is a single large request, so it is reused for a minute
// (Live refresh included) and only re-fetched early by the refresh button.
const LOG_SAMPLE_SIZE = 5000
const LOG_SAMPLE_TTL_MS = 60 * 1000
const logEntries = ref<QueryLogEntry[]>([])
const logState = ref<"loading" | "ready" | "missing" | "error">("loading")
let forceNext = false

async function loadLogSample(force: boolean): Promise<void> {
  await queryLogsApp.ensure(connection.credentials)
  if (queryLogsApp.missing) {
    logState.value = "missing"
    return
  }
  const app = queryLogsApp.app
  if (!app) {
    logState.value = "error"
    return
  }
  const duration = timeRange.selected
  try {
    const res = await cached(
      `log-sample-${duration}`,
      LOG_SAMPLE_TTL_MS,
      () => queryLogs(connection.credentials, app, { ...durationToRange(duration), pageNumber: 1, entriesPerPage: LOG_SAMPLE_SIZE, descendingOrder: true }),
      force,
    )
    logEntries.value = res.response.entries
    logState.value = "ready"
  } catch {
    logState.value = "error"
  }
}

const rtts = computed(() => logEntries.value.map((e) => e.responseRtt).filter((r): r is number => typeof r === "number"))
const flows = computed(() => (logState.value === "ready" ? buildFlows(logEntries.value) : null))

async function load(): Promise<void> {
  if (!connection.isConfigured) return
  loading.value = true
  loadError.value = null
  try {
    const [statsRes, rateLimitedRes, settingsRes, prev] = await Promise.all([
      getDashboardStats(timeRange.selected, connection.credentials, { utc: true }),
      getTopStats("TopClients", timeRange.selected, connection.credentials, {
        onlyRateLimitedClients: true,
        limit: 1,
      }),
      getSettings(connection.credentials),
      loadPrevious(),
    ])
    prevStats.value = prev
    stats.value = statsRes.response
    rateLimitedClient.value = rateLimitedRes.response.topClients?.[0] ?? null
    blockListFreshness.value = computeBlockListFreshness(settingsRes.response)
    const force = forceNext
    forceNext = false
    void loadLogSample(force)
  } catch (err) {
    loadError.value = err instanceof TechnitiumApiError ? err.message : "Could not load dashboard stats."
  } finally {
    loading.value = false
  }
}

const updatingBlockLists = ref(false)
const blockListUpdateError = ref<string | null>(null)
const blockListUpdateTriggered = ref(false)

async function onForceUpdateBlockLists(): Promise<void> {
  updatingBlockLists.value = true
  blockListUpdateError.value = null
  try {
    await forceUpdateBlockLists()
    blockListUpdateTriggered.value = true
  } catch (err) {
    blockListUpdateError.value = err instanceof AppApiError ? err.message : "Could not trigger the block-list update."
  } finally {
    updatingBlockLists.value = false
  }
}

// Clicking a slice, bar or selection jumps to Query Logs with that
// filter applied. Slices with no filter (Dropped queries are not logged)
// are display-only.
const pathItems = computed<DonutItem[]>(() => {
  const s = stats.value?.stats
  if (!s) return []
  return [
    { label: "Cached", value: s.totalCached, color: "rgb(var(--color-chart-aqua))", filter: "Cached" },
    { label: "Recursive", value: s.totalRecursive, color: "rgb(var(--color-chart-blue))", filter: "Recursive" },
    { label: "Blocked", value: s.totalBlocked, color: "rgb(var(--color-chart-red))", filter: "Blocked" },
    { label: "Authoritative", value: s.totalAuthoritative, color: "rgb(var(--color-chart-violet))", filter: "Authoritative" },
    { label: "Dropped", value: s.totalDropped, color: "rgb(var(--color-chart-gray))", filter: "" },
  ]
})

const outcomeItems = computed<DonutItem[]>(() => {
  const s = stats.value?.stats
  if (!s) return []
  return [
    { label: "No error", value: s.totalNoError, color: "rgb(var(--color-chart-blue))", filter: "NoError" },
    { label: "NXDomain", value: s.totalNxDomain, color: "rgb(var(--color-chart-orange))", filter: "NxDomain" },
    { label: "Server failure", value: s.totalServerFailure, color: "rgb(var(--color-chart-violet))", filter: "ServerFailure" },
    { label: "Refused", value: s.totalRefused, color: "rgb(var(--color-chart-gray))", filter: "Refused" },
  ]
})

function openLogs(query: Record<string, string>): void {
  void router.push({ path: "/logs", query })
}

function onPathSelect(item: DonutItem): void {
  if (item.filter) openLogs({ responseType: item.filter })
}

function onOutcomeSelect(item: DonutItem): void {
  if (item.filter) openLogs({ rcode: item.filter })
}

// The stats chart folds rare record types into "Other", which is not a
// value the log filter understands.
function onTypeSelect(label: string): void {
  if (label !== "Other") openLogs({ qtype: label })
}

const typeRows = computed(() => {
  const c = stats.value?.queryTypeChartData
  if (!c) return { labels: [] as string[], values: [] as number[] }
  const pairs = c.labels.map((label, i) => ({ label, value: c.datasets[0]?.data[i] ?? 0 })).sort((a, b) => b.value - a.value)
  return { labels: pairs.map((p) => p.label), values: pairs.map((p) => p.value) }
})

const { liveOn, toggle: toggleLive } = useLivePolling(() => load(), 5000, "overview")

onMounted(load)
watch(() => timeRange.selected, load)
watch(
  () => refresh.tick,
  () => {
    forceNext = true
    void load()
  },
)
// Reload once the connection becomes configured after this page has
// already mounted (e.g. the user lands here before ever visiting
// Connection Settings) — onMounted alone would only cover the case
// where credentials already existed at mount time.
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
        <h1 class="text-lg font-semibold tracking-tight text-fg">Overview</h1>
        <p class="mt-1 text-sm text-gray-500">
          Live resolver activity<span v-if="connection.serverDomain"> for {{ connection.serverDomain }}</span>
        </p>
      </div>
      <LiveToggle
        v-if="connection.isConfigured"
        id="overview-live-toggle"
        :model-value="liveOn"
        @update:model-value="toggleLive"
      />
    </div>

    <p v-if="!connection.isConfigured" class="text-sm text-gray-500">
      Connect to a Technitium server on the
      <router-link to="/connect" class="font-medium text-accent">Connection Settings</router-link> page to see
      live data.
    </p>

    <p v-else-if="loadError" id="overview-error" class="text-sm text-crit">{{ loadError }}</p>

    <template v-else-if="stats">
      <div class="mb-5 flex flex-col gap-2">
        <div
          v-if="rateLimitedClient"
          class="flex items-center gap-2 rounded-lg border border-crit/35 bg-crit/10 px-3.5 py-2.5 text-[12.5px]"
        >
          <strong class="font-mono">{{ rateLimitedClient.name }}</strong>
          is being rate-limited by the resolver.
          <router-link to="/clients" class="ml-auto font-medium text-accent">View clients</router-link>
        </div>
        <div
          v-if="blockListFreshness"
          class="flex flex-wrap items-center gap-2 rounded-lg border px-3.5 py-2.5 text-[12.5px]"
          :class="blockListFreshness.overdue ? 'border-crit/35 bg-crit/10' : 'border-warn/35 bg-warn/10'"
        >
          <span>{{ blockListFreshness.message }}</span>
          <template v-if="auth.isAdmin">
            <button
              v-if="!blockListUpdateTriggered"
              id="force-update-block-lists"
              type="button"
              :disabled="updatingBlockLists"
              class="ml-auto rounded-md border border-current/30 px-2.5 py-1 text-[11.5px] font-semibold disabled:opacity-50"
              @click="onForceUpdateBlockLists"
            >
              {{ updatingBlockLists ? "Updating…" : "Update now" }}
            </button>
            <span v-else class="ml-auto text-[11.5px] font-semibold">Update triggered &mdash; check back shortly.</span>
          </template>
          <span v-if="blockListUpdateError" id="force-update-block-lists-error" class="w-full text-[11.5px]">{{
            blockListUpdateError
          }}</span>
        </div>
      </div>

      <TrendTiles :stats="stats.stats" :prev="prevStats" :chart="stats.mainChartData" :duration="timeRange.selected" class="mb-3.5" />

      <div class="mb-3.5 grid grid-cols-1 gap-3.5 lg:grid-cols-12">
        <ChartPanel title="Queries over time" hint="Select a window on the chart to zoom in or open it in Query Logs." class="lg:col-span-8">
          <QueriesChart :chart="stats.mainChartData" />
        </ChartPanel>
        <ChartPanel title="Where answers come from" hint="Click a slice to filter Query Logs." class="lg:col-span-4">
          <DonutChart id="path-donut" :items="pathItems" center-sub="queries" @select="onPathSelect" />
        </ChartPanel>
      </div>

      <div class="mb-3.5 grid grid-cols-1 gap-3.5 lg:grid-cols-12">
        <ChartPanel title="Response outcomes" hint="Click a slice to filter Query Logs." class="lg:col-span-4">
          <DonutChart id="outcome-donut" :items="outcomeItems" center-sub="responses" @select="onOutcomeSelect" />
        </ChartPanel>
        <ChartPanel title="Query types" hint="Click a bar to filter Query Logs." class="lg:col-span-4">
          <TypeBars :labels="typeRows.labels" :values="typeRows.values" @select="onTypeSelect" />
        </ChartPanel>
        <LatencyPanel :rtts="rtts" :sample-size="logEntries.length" :state="logState" class="lg:col-span-4" />
      </div>

      <div class="grid grid-cols-1 gap-3.5 md:grid-cols-3">
        <TopList title="Top clients" :items="stats.topClients ?? []" tone="accent" filter-key="client" />
        <TopList title="Top domains" :items="stats.topDomains ?? []" tone="ok" filter-key="qname" />
        <TopList title="Top blocked" :items="stats.topBlockedDomains ?? []" tone="crit" filter-key="qname" />
      </div>

      <div class="mt-3.5 flex flex-col gap-3.5">
        <HeatmapPanel />
        <FlowPanel :flows="flows" :state="logState" />
        <div class="grid grid-cols-1 gap-3.5 lg:grid-cols-3">
          <DhcpUsagePanel />
          <ZoneTypesPanel />
          <CacheSizePanel :entries="stats.stats.cachedEntries" />
        </div>
      </div>
    </template>

    <p v-else-if="loading" class="text-sm text-gray-500">Loading…</p>
  </div>
</template>
