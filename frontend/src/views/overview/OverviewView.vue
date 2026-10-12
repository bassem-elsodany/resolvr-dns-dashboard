<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue"
import { useRouter } from "vue-router"
import { useConnectionStore } from "../../stores/connection"
import { useTimeRangeStore } from "../../stores/timeRange"
import { useRefreshStore } from "../../stores/refresh"
import { useStatsScopeStore, type PanelId } from "../../stores/statsScope"
import { useAuthStore } from "../../stores/auth"
import {
  getDashboardStats,
  getTopStats,
  getSettings,
  TechnitiumApiError,
  type DashboardStatsResult,
  type TopClientEntry,
} from "../../api/technitium"
import { forceUpdateBlockLists, AppApiError } from "../../api/app"
import { useLivePolling } from "../../composables/useLivePolling"
import { useRouteTab } from "../../composables/useRouteTab"
import TabBar from "../../components/ui/TabBar.vue"
import { usePreviousStats } from "../../composables/usePreviousStats"
import { useLogSample } from "../../composables/useLogSample"
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
import { buildFlows } from "../../lib/charts"
import TopList from "../../components/overview/TopList.vue"
import ScopeChip from "../../components/overview/ScopeChip.vue"
import NodeCompareChart, { type CompareSeries } from "../../components/overview/NodeCompareChart.vue"
import ClusterNodesPanel from "../../components/overview/ClusterNodesPanel.vue"
import LiveToggle from "../../components/ui/LiveToggle.vue"

const connection = useConnectionStore()
const router = useRouter()
const auth = useAuthStore()
// Time range is a single global control in the topbar (AppShell.vue),
// not a per-page copy — the wireframe puts it there once and Overview
// and Clients both read the same selection.
const timeRange = useTimeRangeStore()
const refresh = useRefreshStore()
const statsScope = useStatsScopeStore()

const loading = ref(false)
const loadError = ref<string | null>(null)
// Each panel has its own scope (a node, or the whole cluster), so stats are
// kept per scope. A standalone server only ever has the "self" entry.
const statsByKey = ref<Record<string, DashboardStatsResult["response"]>>({})
const keyOf = (node: string | undefined): string => node ?? "self"
const nodeOf = (key: string): string | undefined => (key === "self" ? undefined : key)
const statsOf = (panel: PanelId): DashboardStatsResult["response"] | null => statsByKey.value[keyOf(statsScope.nodeParam(panel))] ?? null
// The page gates on the trend tiles' stats. While another scope is loading,
// keep showing what is there rather than blanking the page.
const stats = computed(() => statsOf("tiles") ?? Object.values(statsByKey.value)[0] ?? null)
const { prevStats, loadPrevious } = usePreviousStats()
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

// The charts are grouped into tabs so the page is not one long scroll.
// The open tab lives in the URL (?tab=), so a refresh or a shared link
// lands on the same group, and falls back to the last tab used.
const TABS = [
  { id: "traffic", label: "Traffic" },
  { id: "resolution", label: "Resolution" },
  { id: "top", label: "Top lists" },
  { id: "infra", label: "Infrastructure" },
] as const
const { tab, setTab } = useRouteTab(TABS.map((t) => t.id), "resolvr.overviewTab", "traffic")

// The response-time and flow panels read a shared sample of the latest
// logged queries (see useLogSample for how it is cached).
// Response time and the resolution flow can each be aimed at a different
// node, so each has its own sample (shared when they pick the same node).
const { entries: rtEntries, state: rtState, load: loadRtSample } = useLogSample()
const { entries: flowEntries, state: flowState, load: loadFlowSample } = useLogSample()
function loadLogSamples(force: boolean): void {
  void loadRtSample(force, statsScope.nodeParam("responseTime"))
  void loadFlowSample(force, statsScope.nodeParam("flow"))
}
let forceNext = false
// Only the tab that draws from the log sample asks for it.
const needsLogSample = computed(() => tab.value === "resolution")

const rtts = computed(() => rtEntries.value.map((e) => e.responseRtt).filter((r): r is number => typeof r === "number"))
const flows = computed(() => (flowState.value === "ready" ? buildFlows(flowEntries.value) : null))

// Which stats each tab needs, so only those are requested. With one scope
// (a standalone server, or every panel on the same node) this is one call.
const neededKeys = computed<string[]>(() => {
  const keys = new Set<string>([keyOf(statsScope.nodeParam("tiles"))])
  const add = (panel: PanelId): void => void keys.add(keyOf(statsScope.nodeParam(panel)))
  if (tab.value === "traffic") {
    add("queries")
    add("types")
    if (statsScope.compare) for (const name of statsScope.nodeNames) keys.add(keyOf(name === statsScope.self ? undefined : name))
  } else if (tab.value === "resolution") {
    add("answers")
    add("outcomes")
  } else if (tab.value === "top") {
    add("topClients")
    add("topDomains")
    add("topBlocked")
  } else {
    add("cache")
  }
  return [...keys]
})

const COMPARE_COLORS = [
  "rgb(var(--color-chart-blue))",
  "rgb(var(--color-chart-orange))",
  "rgb(var(--color-chart-violet))",
  "rgb(var(--color-chart-aqua))",
]
const compareSeries = computed<CompareSeries[]>(() =>
  statsScope.nodeNames.map((name, i) => {
    const r = statsByKey.value[keyOf(name === statsScope.self ? undefined : name)]
    const total = r?.mainChartData.datasets.find((d) => d.label === "Total")
    return { name, color: COMPARE_COLORS[i % COMPARE_COLORS.length]!, dashed: i % 2 === 1, data: total?.data ?? [] }
  }),
)
const compareLabels = computed(() => {
  const first = statsByKey.value[keyOf(statsScope.nodeNames[0] === statsScope.self ? undefined : statsScope.nodeNames[0])]
  return first?.mainChartData.labels ?? []
})

// Reload when any panel's scope (or compare mode) changes.
const scopeSignature = computed(() =>
  JSON.stringify([
    (["tiles", "queries", "types", "answers", "outcomes", "topClients", "topDomains", "topBlocked", "cache", "responseTime", "flow"] as PanelId[]).map((p) =>
      statsScope.nodeParam(p),
    ),
    statsScope.compare,
  ]),
)

async function load(): Promise<void> {
  if (!connection.isConfigured) return
  loading.value = true
  loadError.value = null
  try {
    const keys = neededKeys.value
    const tilesNode = statsScope.nodeParam("tiles")
    const [rateLimitedRes, settingsRes, , fetched] = await Promise.all([
      getTopStats("TopClients", timeRange.selected, connection.credentials, {
        onlyRateLimitedClients: true,
        limit: 1,
        node: tilesNode,
      }),
      getSettings(connection.credentials),
      loadPrevious(tilesNode),
      Promise.all(keys.map((k) => getDashboardStats(timeRange.selected, connection.credentials, { utc: true, node: nodeOf(k) }))),
    ])
    const next = { ...statsByKey.value }
    keys.forEach((k, i) => {
      next[k] = fetched[i]!.response
    })
    statsByKey.value = next
    rateLimitedClient.value = rateLimitedRes.response.topClients?.[0] ?? null
    blockListFreshness.value = computeBlockListFreshness(settingsRes.response)
    const force = forceNext
    forceNext = false
    if (needsLogSample.value) loadLogSamples(force)
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
  const s = statsOf("answers")?.stats
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
  const s = statsOf("outcomes")?.stats
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
  const c = statsOf("types")?.queryTypeChartData
  if (!c) return { labels: [] as string[], values: [] as number[] }
  const pairs = c.labels.map((label, i) => ({ label, value: c.datasets[0]?.data[i] ?? 0 })).sort((a, b) => b.value - a.value)
  return { labels: pairs.map((p) => p.label), values: pairs.map((p) => p.value) }
})

const { liveOn, toggle: toggleLive } = useLivePolling(() => load(), 5000, "overview")

onMounted(load)
watch(() => timeRange.selected, load)
// Opening Resolution is what asks for the log sample (it is a large request).
watch(tab, (t) => {
  if (t === "resolution" && connection.isConfigured) loadLogSamples(false)
})
// A panel's scope changed (or compare mode): fetch what it now needs.
watch(scopeSignature, () => {
  if (connection.isConfigured) void load()
})
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
          Live resolver activity<span v-if="connection.serverDomain"> for {{ connection.serverDomain }}</span
          ><span v-if="statsScope.available && statsScope.nodeNames.length > 1"> &middot; cluster of {{ statsScope.nodeNames.length }} nodes</span>
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

      <div v-if="statsScope.available" class="mb-2 flex justify-end"><ScopeChip panel="tiles" /></div>
      <TrendTiles :stats="stats.stats" :prev="prevStats" :chart="stats.mainChartData" :duration="timeRange.selected" class="mb-3.5" />

      <TabBar :tabs="TABS" :model-value="tab" id-prefix="overview-tab" panel-id="overview-tabpanel" label="Overview sections" @update:model-value="setTab" />

      <div id="overview-tabpanel" role="tabpanel" :aria-labelledby="`overview-tab-${tab}`">
        <div v-if="tab === 'traffic'" class="flex flex-col gap-3.5">
          <div class="grid grid-cols-1 gap-3.5 lg:grid-cols-12">
            <ChartPanel title="Queries over time" hint="Select a window on the chart to zoom in or open it in Query Logs." class="lg:col-span-8">
              <template #actions><ScopeChip panel="queries" /></template>
              <NodeCompareChart v-if="statsScope.available && statsScope.compare" :labels="compareLabels" :series="compareSeries" />
              <QueriesChart v-else-if="statsOf('queries')" :chart="statsOf('queries')!.mainChartData" />
            </ChartPanel>
            <ChartPanel title="Query types" hint="Click a bar to filter Query Logs." class="lg:col-span-4">
              <template #actions><ScopeChip panel="types" /></template>
              <TypeBars :labels="typeRows.labels" :values="typeRows.values" @select="onTypeSelect" />
            </ChartPanel>
          </div>
          <HeatmapPanel />
        </div>

        <div v-else-if="tab === 'resolution'" class="flex flex-col gap-3.5">
          <div class="grid grid-cols-1 gap-3.5 lg:grid-cols-12">
            <ChartPanel title="Where answers come from" hint="Click a slice to filter Query Logs." class="lg:col-span-4">
              <template #actions><ScopeChip panel="answers" /></template>
              <DonutChart id="path-donut" :items="pathItems" center-sub="queries" @select="onPathSelect" />
            </ChartPanel>
            <ChartPanel title="Response outcomes" hint="Click a slice to filter Query Logs." class="lg:col-span-4">
              <template #actions><ScopeChip panel="outcomes" /></template>
              <DonutChart id="outcome-donut" :items="outcomeItems" center-sub="responses" @select="onOutcomeSelect" />
            </ChartPanel>
            <LatencyPanel :rtts="rtts" :sample-size="rtEntries.length" :state="rtState" class="lg:col-span-4" />
          </div>
          <FlowPanel :flows="flows" :state="flowState" />
        </div>

        <div v-else-if="tab === 'top'" class="grid grid-cols-1 gap-3.5 md:grid-cols-3">
          <TopList title="Top clients" :items="statsOf('topClients')?.topClients ?? []" tone="accent" filter-key="client">
            <template #actions><ScopeChip panel="topClients" /></template>
          </TopList>
          <TopList title="Top domains" :items="statsOf('topDomains')?.topDomains ?? []" tone="ok" filter-key="qname">
            <template #actions><ScopeChip panel="topDomains" /></template>
          </TopList>
          <TopList title="Top blocked" :items="statsOf('topBlocked')?.topBlockedDomains ?? []" tone="crit" filter-key="qname">
            <template #actions><ScopeChip panel="topBlocked" /></template>
          </TopList>
        </div>

        <div v-else class="flex flex-col gap-3.5">
          <ClusterNodesPanel v-if="statsScope.available" />
          <div class="grid grid-cols-1 gap-3.5 lg:grid-cols-3">
            <DhcpUsagePanel />
            <ZoneTypesPanel />
            <CacheSizePanel :entries="(statsOf('cache') ?? stats).stats.cachedEntries" />
          </div>
        </div>
      </div>
    </template>

    <p v-else-if="loading" class="text-sm text-gray-500">Loading…</p>
  </div>
</template>
