<script setup lang="ts">
import { ref, onMounted, watch } from "vue"
import { useConnectionStore } from "../../stores/connection"
import { useTimeRangeStore } from "../../stores/timeRange"
import { useRefreshStore } from "../../stores/refresh"
import { getDashboardStats, TechnitiumApiError, type DashboardStatsResult } from "../../api/technitium"
import { useLivePolling } from "../../composables/useLivePolling"
import { usePreviousStats } from "../../composables/usePreviousStats"
import { useLogSample } from "../../composables/useLogSample"
import ClientsExplorer from "../../components/clients/ClientsExplorer.vue"
import LiveToggle from "../../components/ui/LiveToggle.vue"

const connection = useConnectionStore()
// Time range is the single global control in AppShell's topbar — see
// OverviewView.vue for the same pattern.
const timeRange = useTimeRangeStore()
const refresh = useRefreshStore()

const stats = ref<DashboardStatsResult["response"] | null>(null)
const loading = ref(false)
const loadError = ref<string | null>(null)
const { prevStats, loadPrevious } = usePreviousStats()
const { entries: logEntries, state: logState, load: loadLogSample } = useLogSample()
let forceNext = false

// The page's own numbers (total queries and clients, for the share bar
// and the first tile) come from the dashboard stats; the explorer loads
// the per-client detail itself.
async function load(): Promise<void> {
  if (!connection.isConfigured) return
  loading.value = true
  loadError.value = null
  try {
    const [res] = await Promise.all([getDashboardStats(timeRange.selected, connection.credentials, { utc: true }), loadPrevious()])
    stats.value = res.response
    const force = forceNext
    forceNext = false
    void loadLogSample(force)
  } catch (err) {
    loadError.value = err instanceof TechnitiumApiError ? err.message : "Could not load client activity."
  } finally {
    loading.value = false
  }
}

const { liveOn, toggle: toggleLive } = useLivePolling(() => load(), 5000, "clients")

onMounted(load)
watch(() => timeRange.selected, load)
watch(
  () => refresh.tick,
  () => {
    forceNext = true
    void load()
  },
)
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
        <p class="mt-1 text-sm text-gray-500">Who is using your DNS server, and what they are asking for</p>
      </div>
      <LiveToggle v-if="connection.isConfigured" id="clients-live-toggle" :model-value="liveOn" @update:model-value="toggleLive" />
    </div>

    <p v-if="!connection.isConfigured" class="text-sm text-gray-500">
      Connect to a Technitium server on the
      <router-link to="/connect" class="font-medium text-accent">Connection Settings</router-link> page to see
      client activity.
    </p>
    <p v-else-if="loadError" id="clients-error" class="text-sm text-crit">{{ loadError }}</p>
    <ClientsExplorer
      v-else-if="stats"
      :stats="stats.stats"
      :prev-stats="prevStats"
      :duration="timeRange.selected"
      :log-entries="logEntries"
      :log-state="logState"
    />
    <p v-else-if="loading" class="text-sm text-gray-500">Loading…</p>
  </div>
</template>
