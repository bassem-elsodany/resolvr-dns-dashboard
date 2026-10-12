<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue"
import { useConnectionStore } from "../../stores/connection"
import { useRefreshStore } from "../../stores/refresh"
import { useAuthStore } from "../../stores/auth"
import { getDashboardStats, getSettings, listBlockedZones, TechnitiumApiError } from "../../api/technitium"
import { updateBlockListUrls, AppApiError } from "../../api/app"
import { useUndoToast } from "../../composables/useUndoToast"
import { useRouteTab } from "../../composables/useRouteTab"
import { CLUSTER, useStatsScopeStore } from "../../stores/statsScope"
import { diffLists } from "../../lib/listSync"
import ScopeChip from "../../components/overview/ScopeChip.vue"
import BlockNodesStrip, { type BlockNodeStatus } from "../../components/blocked/BlockNodesStrip.vue"
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
const statsScope = useStatsScopeStore()

// The page has one scope: the nodes whose blocking is shown. Each node
// downloads the lists itself; the feed list and your own domains are synced
// between nodes, but a node can lag, so those show whether they agree.
const targets = computed(() => statsScope.targets("blockedPage"))
const isCluster = computed(() => statsScope.available && statsScope.scopeOf("blockedPage") === CLUSTER)
const nodeNames = computed(() => targets.value.map((t) => t.name))
// The node the status card, feeds and your-domains list are read from: the
// connected node on the whole cluster, otherwise the one picked.
const reference = computed(() => targets.value.find((t) => t.name === statsScope.self) ?? targets.value[0])
const refNode = computed(() => reference.value?.node)

// ---------- what the server says about its block lists ----------

const lines = ref<string[]>([])
const enableBlocking = ref<boolean | null>(null)
const blockingType = ref<string | null>(null)
const nextUpdatedOn = ref<string | undefined>(undefined)
const intervalHours = ref<number | undefined>(undefined)
const total = ref<number | null>(null)
const loadError = ref<string | null>(null)

async function loadSettings(): Promise<void> {
  const res = refNode.value ? await getSettings(connection.credentials, { node: refNode.value }) : await getSettings(connection.credentials)
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
    const res = await getDashboardStats("LastHour", connection.credentials, { utc: true, ...(refNode.value ? { node: refNode.value } : {}) })
    total.value = res.response.stats.blockListZones ?? null
  } catch {
    total.value = null
  }
  return total.value
}

// Every node in scope, side by side (cluster view only).
const nodeStatus = ref<BlockNodeStatus[]>([])
const nodeFeeds = ref<Record<string, string[]>>({})
const nodeRoots = ref<Record<string, string[]>>({})
const updateOn = ref("both")

async function loadNodes(): Promise<void> {
  if (!isCluster.value) {
    nodeStatus.value = []
    nodeFeeds.value = {}
    nodeRoots.value = {}
    return
  }
  const out: BlockNodeStatus[] = []
  const feeds: Record<string, string[]> = {}
  const roots: Record<string, string[]> = {}
  await Promise.all(
    targets.value.map(async (t) => {
      const node = t.node ? { node: t.node } : {}
      const [settings, stats, root] = await Promise.allSettled([
        getSettings(connection.credentials, node),
        getDashboardStats("LastHour", connection.credentials, { utc: true, ...node }),
        listBlockedZones(connection.credentials, "", node),
      ])
      const s = settings.status === "fulfilled" ? settings.value.response : null
      out.push({
        name: t.name,
        readable: s !== null,
        enableBlocking: s?.enableBlocking ?? null,
        nextUpdatedOn: s?.blockListNextUpdatedOn,
        intervalHours: s?.blockListUpdateIntervalHours,
        total: stats.status === "fulfilled" ? (stats.value.response.stats.blockListZones ?? null) : null,
      })
      if (s) feeds[t.name] = (s.blockListUrls ?? []).filter((u) => !u.startsWith("#"))
      if (root.status === "fulfilled") roots[t.name] = root.value.response.zones
    }),
  )
  nodeStatus.value = nodeNames.value.map((n) => out.find((o) => o.name === n)!).filter(Boolean)
  nodeFeeds.value = feeds
  nodeRoots.value = roots
}

const feedSync = computed(() => diffLists(nodeFeeds.value, nodeNames.value))
const domainSync = computed(() => diffLists(nodeRoots.value, nodeNames.value))
const updateTargets = computed<(string | undefined)[]>(() => {
  if (!isCluster.value) return [refNode.value]
  const chosen = updateOn.value === "both" ? targets.value : targets.value.filter((t) => t.name === updateOn.value)
  return (chosen.length > 0 ? chosen : targets.value).map((t) => t.node)
})

async function load(): Promise<void> {
  if (!connection.isConfigured) return
  loadError.value = null
  try {
    await Promise.all([loadSettings(), loadTotal(), loadNodes()])
  } catch (err) {
    loadError.value = err instanceof TechnitiumApiError ? err.message : "Could not load the block list settings."
  }
}

// Used while watching an update finish.
async function fetchStatus(): Promise<{ next?: string; total: number | null }> {
  await loadSettings()
  return { next: nextUpdatedOn.value, total: await loadTotal() }
}

// A different scope (or a node coming or going) changes whose blocking this is.
const scopeKey = computed(() => JSON.stringify([statsScope.nodeParam("blockedPage"), nodeNames.value]))
watch(scopeKey, () => {
  updateOn.value = "both"
  void load()
})

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
    await (refNode.value ? updateBlockListUrls(newLines, refNode.value) : updateBlockListUrls(newLines))
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
  <div class="flex flex-col gap-3.5">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="text-lg font-semibold tracking-tight text-fg">Blocked Zones</h1>
        <p class="mt-1 text-sm text-gray-500">What your DNS server refuses to resolve: the feeds it downloads, plus domains you block yourself.</p>
      </div>
      <ScopeChip v-if="connection.isConfigured" panel="blockedPage" heading="Show blocking on" />
    </div>

    <p v-if="!connection.isConfigured" class="text-sm text-gray-500">
      Connect to a Technitium server on the
      <router-link to="/connect" class="font-medium text-accent">Connection Settings</router-link> page to see blocked zones.
    </p>

    <template v-else>
      <p v-if="loadError" id="settings-error" class="text-sm text-crit">{{ loadError }}</p>

      <BlockNodesStrip v-if="isCluster && nodeStatus.length" v-model:update-on="updateOn" :nodes="nodeStatus" :all-names="nodeNames" :is-admin="auth.isAdmin" />

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
        :update-targets="updateTargets"
        @updated="load"
      />
      <TabBar :tabs="tabs" :model-value="tab" id-prefix="blocked-tab" panel-id="blocked-tabpanel" label="Blocked zone sections" class="self-start !mb-0" @update:model-value="setTab" />
      <div id="blocked-tabpanel" role="tabpanel" :aria-labelledby="`blocked-tab-${tab}`">
        <p
          v-if="isCluster && tab === 'feeds' && Object.keys(nodeFeeds).length > 1"
          id="feeds-sync"
          class="mb-2 rounded-lg border px-3.5 py-2 text-[12.5px]"
          :class="feedSync.inSync ? 'border-ok/35 bg-ok/10' : 'border-warn/35 bg-warn/10'"
        >
          <span class="font-semibold">{{ feedSync.inSync ? "Same feed list on every node" : "The nodes have different feed lists" }}</span>
          <span class="text-gray-500">
            {{ feedSync.inSync ? " · Edits are saved on one node and synced by Technitium." : " · A node still has the previous list and will pick up the change on its next refresh." }}
          </span>
        </p>
        <p
          v-if="isCluster && tab === 'domains' && Object.keys(nodeRoots).length > 1"
          id="domains-sync"
          class="mb-2 rounded-lg border px-3.5 py-2 text-[12.5px]"
          :class="domainSync.inSync ? 'border-ok/35 bg-ok/10' : 'border-warn/35 bg-warn/10'"
        >
          <span class="font-semibold">{{ domainSync.inSync ? "Your domains match on every node" : "Your domains differ between nodes" }}</span>
          <span class="text-gray-500">
            {{ domainSync.inSync ? " · Changes are synced by Technitium." : " · A node has not received a recent change yet. Showing the list of the connected node." }}
          </span>
        </p>
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
        <BlockedDomains v-if="tab === 'domains'" :is-admin="auth.isAdmin" :highlight-domain="highlightDomain" :node="refNode" />
        <DomainChecker v-if="tab === 'check'" :targets="isCluster ? targets : undefined" @matched="onMatched" @show="setTab" />
      </div>
    </template>
    <UndoToast :toast="toast" @undo="runUndo" />
  </div>
</template>
