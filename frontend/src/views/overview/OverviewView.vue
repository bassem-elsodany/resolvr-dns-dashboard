<script setup lang="ts">
import { ref, onMounted, watch } from "vue"
import { useConnectionStore } from "../../stores/connection"
import { useTimeRangeStore } from "../../stores/timeRange"
import { useRefreshStore } from "../../stores/refresh"
import {
  getDashboardStats,
  getTopStats,
  getSettings,
  TechnitiumApiError,
  type DashboardStatsResult,
  type TopClientEntry,
} from "../../api/technitium"
import StatTiles from "../../components/overview/StatTiles.vue"
import QueriesChart from "../../components/overview/QueriesChart.vue"
import TopList from "../../components/overview/TopList.vue"

const connection = useConnectionStore()
// Time range is a single global control in the topbar (AppShell.vue),
// not a per-page copy — the wireframe puts it there once and Overview
// and Clients both read the same selection.
const timeRange = useTimeRangeStore()
const refresh = useRefreshStore()

const loading = ref(false)
const loadError = ref<string | null>(null)
const stats = ref<DashboardStatsResult["response"] | null>(null)
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

async function load(): Promise<void> {
  if (!connection.isConfigured) return
  loading.value = true
  loadError.value = null
  try {
    const [statsRes, rateLimitedRes, settingsRes] = await Promise.all([
      getDashboardStats(timeRange.selected, connection.credentials, { utc: true }),
      getTopStats("TopClients", timeRange.selected, connection.credentials, {
        onlyRateLimitedClients: true,
        limit: 1,
      }),
      getSettings(connection.credentials),
    ])
    stats.value = statsRes.response
    rateLimitedClient.value = rateLimitedRes.response.topClients?.[0] ?? null
    blockListFreshness.value = computeBlockListFreshness(settingsRes.response)
  } catch (err) {
    loadError.value = err instanceof TechnitiumApiError ? err.message : "Could not load dashboard stats."
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(() => timeRange.selected, load)
watch(() => refresh.tick, load)
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
    <div class="mb-5">
      <h1 class="text-lg font-semibold tracking-tight text-fg">Overview</h1>
      <p class="mt-1 text-sm text-gray-500">
        Live resolver activity<span v-if="connection.serverDomain"> for {{ connection.serverDomain }}</span>
      </p>
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
          class="flex items-center gap-2 rounded-lg border px-3.5 py-2.5 text-[12.5px]"
          :class="blockListFreshness.overdue ? 'border-crit/35 bg-crit/10' : 'border-warn/35 bg-warn/10'"
        >
          {{ blockListFreshness.message }}
        </div>
      </div>

      <StatTiles :stats="stats.stats" class="mb-5" />

      <div class="mb-5 grid grid-cols-1 gap-3.5 lg:grid-cols-[1.7fr_1fr]">
        <div class="rounded-lg border border-border bg-background-elevated p-4">
          <div class="mb-2 text-[12.5px] font-semibold">Queries over time</div>
          <QueriesChart :chart="stats.mainChartData" />
        </div>
        <div class="rounded-lg border border-border bg-background-elevated p-4">
          <div class="mb-2 text-[12.5px] font-semibold">Query types</div>
          <div v-if="stats.queryTypeChartData" class="flex flex-col gap-2">
            <div
              v-for="(label, i) in stats.queryTypeChartData.labels"
              :key="label"
              class="flex items-center gap-2 text-[11px]"
            >
              <span class="w-12 flex-none font-mono text-gray-500">{{ label }}</span>
              <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-background-hover">
                <div
                  class="h-full rounded-full bg-accent"
                  :style="{
                    width: `${(stats.queryTypeChartData.datasets[0]!.data[i]! / Math.max(1, ...stats.queryTypeChartData.datasets[0]!.data)) * 100}%`,
                  }"
                />
              </div>
              <span class="w-10 text-right tabular-nums text-gray-500">{{
                stats.queryTypeChartData.datasets[0]!.data[i]
              }}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="grid grid-cols-1 gap-3.5 md:grid-cols-3">
        <TopList title="Top clients" :items="stats.topClients ?? []" tone="accent" />
        <TopList title="Top domains" :items="stats.topDomains ?? []" tone="ok" />
        <TopList title="Top blocked" :items="stats.topBlockedDomains ?? []" tone="crit" />
      </div>
    </template>

    <p v-else-if="loading" class="text-sm text-gray-500">Loading…</p>
  </div>
</template>
