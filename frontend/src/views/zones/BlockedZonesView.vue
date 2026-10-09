<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue"
import { useConnectionStore } from "../../stores/connection"
import { useRefreshStore } from "../../stores/refresh"
import { useAuthStore } from "../../stores/auth"
import { getDashboardStats, getSettings, TechnitiumApiError } from "../../api/technitium"
import { updateBlockListUrls, AppApiError } from "../../api/app"
import { useUndoToast } from "../../composables/useUndoToast"
import { useRouteTab } from "../../composables/useRouteTab"
import TabBar from "../../components/ui/TabBar.vue"
import BlockListStatus from "../../components/blocked/BlockListStatus.vue"
import BlockListFeeds from "../../components/blocked/BlockListFeeds.vue"
import BlockedDomains from "../../components/blocked/BlockedDomains.vue"
import DomainChecker from "../../components/blocked/DomainChecker.vue"
import UndoToast from "../../components/ui/UndoToast.vue"

const connection = useConnectionStore()
const refresh = useRefreshStore()
const auth = useAuthStore()
const { toast, show, runUndo } = useUndoToast()

// ---------- what the server says about its block lists ----------

const lines = ref<string[]>([])
const enableBlocking = ref<boolean | null>(null)
const blockingType = ref<string | null>(null)
const nextUpdatedOn = ref<string | undefined>(undefined)
const intervalHours = ref<number | undefined>(undefined)
const total = ref<number | null>(null)
const loadError = ref<string | null>(null)

async function loadSettings(): Promise<void> {
  const res = await getSettings(connection.credentials)
  lines.value = res.response.blockListUrls ?? []
  enableBlocking.value = res.response.enableBlocking ?? null
  blockingType.value = res.response.blockingType ?? null
  nextUpdatedOn.value = res.response.blockListNextUpdatedOn
  intervalHours.value = res.response.blockListUpdateIntervalHours
}

// Domains held by the lists. The count does not depend on the time range;
// the shortest range is the cheapest call that carries it.
async function loadTotal(): Promise<number | null> {
  try {
    const res = await getDashboardStats("LastHour", connection.credentials, { utc: true })
    total.value = res.response.stats.blockListZones ?? null
  } catch {
    total.value = null
  }
  return total.value
}

async function load(): Promise<void> {
  if (!connection.isConfigured) return
  loadError.value = null
  try {
    await Promise.all([loadSettings(), loadTotal()])
  } catch (err) {
    loadError.value = err instanceof TechnitiumApiError ? err.message : "Could not load the block list settings."
  }
}

// Used while watching an update finish.
async function fetchStatus(): Promise<{ next?: string; total: number | null }> {
  await loadSettings()
  return { next: nextUpdatedOn.value, total: await loadTotal() }
}

onMounted(load)
watch(() => refresh.tick, load)
watch(
  () => connection.isConfigured,
  (configured) => {
    if (configured) load()
  },
)

// ---------- feeds ----------

const statusRef = ref<InstanceType<typeof BlockListStatus> | null>(null)
const feedsRef = ref<InstanceType<typeof BlockListFeeds> | null>(null)
const saving = ref(false)
const saveError = ref<string | null>(null)

async function onSave(newLines: string[], updateAfter: boolean): Promise<void> {
  saving.value = true
  saveError.value = null
  try {
    await updateBlockListUrls(newLines)
    await loadSettings()
    const feeds = newLines.filter((l) => !l.startsWith("#")).length
    show(updateAfter ? `Saved ${feeds} feeds. Updating now.` : `Saved ${feeds} feeds. They are used from the next update.`)
    if (updateAfter) void statusRef.value?.startUpdate()
  } catch (err) {
    saveError.value = err instanceof AppApiError ? err.message : "Could not save the feeds."
  } finally {
    saving.value = false
  }
}

// ---------- pointing at what a domain check matched ----------

const highlightFeed = ref<string | null>(null)
const highlightDomain = ref<string | null>(null)

function onMatched(m: { feed: string | null; domain: string | null }): void {
  highlightFeed.value = m.feed
  highlightDomain.value = m.domain
}

const hasUnsavedFeeds = computed(() => Boolean(feedsRef.value?.hasChanges))

// ---------- tabs ----------

// The status card stays on top; what you manage sits in tabs beneath it.
// Feeds stays mounted when hidden, so an unfinished edit survives a visit
// to another tab, and the tab says so.
const tabs = computed(() => [
  { id: "feeds", label: "Feeds", flag: hasUnsavedFeeds.value ? "Unsaved changes" : null },
  { id: "domains", label: "Your domains" },
  { id: "check", label: "Check a domain" },
] as const)
const { tab, setTab } = useRouteTab(["feeds", "domains", "check"] as const, "resolvr.blockedTab", "feeds")
</script>

<template>
  <div class="flex max-w-[1100px] flex-col gap-3.5">
    <div>
      <h1 class="text-lg font-semibold tracking-tight text-fg">Blocked Zones</h1>
      <p class="mt-1 text-sm text-gray-500">What your DNS server refuses to resolve: the feeds it downloads, plus domains you block yourself.</p>
    </div>

    <p v-if="!connection.isConfigured" class="text-sm text-gray-500">
      Connect to a Technitium server on the
      <router-link to="/connect" class="font-medium text-accent">Connection Settings</router-link> page to see blocked zones.
    </p>

    <template v-else>
      <p v-if="loadError" id="settings-error" class="text-sm text-crit">{{ loadError }}</p>

      <BlockListStatus
        ref="statusRef"
        :enable-blocking="enableBlocking"
        :blocking-type="blockingType"
        :next-updated-on="nextUpdatedOn"
        :interval-hours="intervalHours"
        :total="total"
        :is-admin="auth.isAdmin"
        :has-unsaved-feeds="hasUnsavedFeeds"
        :fetch-status="fetchStatus"
        @updated="load"
      />
      <TabBar :tabs="tabs" :model-value="tab" id-prefix="blocked-tab" panel-id="blocked-tabpanel" label="Blocked zone sections" class="self-start !mb-0" @update:model-value="setTab" />
      <div id="blocked-tabpanel" role="tabpanel" :aria-labelledby="`blocked-tab-${tab}`">
        <BlockListFeeds
          v-show="tab === 'feeds'"
          ref="feedsRef"
          :lines="lines"
          :is-admin="auth.isAdmin"
          :saving="saving"
          :save-error="saveError"
          :highlight-url="highlightFeed"
          @save="onSave"
        />
        <BlockedDomains v-if="tab === 'domains'" :is-admin="auth.isAdmin" :highlight-domain="highlightDomain" />
        <DomainChecker v-if="tab === 'check'" @matched="onMatched" @show="setTab" />
      </div>
    </template>
    <UndoToast :toast="toast" @undo="runUndo" />
  </div>
</template>
