<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue"
import { useConnectionStore } from "../../stores/connection"
import { useRefreshStore } from "../../stores/refresh"
import { listAllowedZones, exportAllowedZones, TechnitiumApiError } from "../../api/technitium"
import { triggerDownload } from "../../lib/download"
import { CLUSTER, NODE_COLORS, useStatsScopeStore } from "../../stores/statsScope"
import { diffLists } from "../../lib/listSync"
import ScopeChip from "../../components/overview/ScopeChip.vue"

const connection = useConnectionStore()
const refresh = useRefreshStore()
const statsScope = useStatsScopeStore()

// Allowed domains are synced between cluster nodes, so a change needs no
// node picked. What a cluster adds is whether every node has caught up.
const targets = computed(() => statsScope.targets("allowedPage"))
const isCluster = computed(() => statsScope.available && statsScope.scopeOf("allowedPage") === CLUSTER)
const nodeNames = computed(() => targets.value.map((t) => t.name))
const shortName = (name: string): string => (name ? name.split(".")[0]! : "this node")
const colorOf = (name: string): string => NODE_COLORS[Math.max(0, statsScope.nodeNames.indexOf(name)) % NODE_COLORS.length]!

// Each node's own list of domains (cluster view).
const perNode = ref<Record<string, string[]>>({})
const failedNodes = ref<string[]>([])
type Presence = "all" | "both" | "missing"
const presence = ref<Presence>("all")

const loading = ref(false)
const loadError = ref<string | null>(null)
const domains = ref<string[]>([])
const filterText = ref("")

const filteredDomains = computed(() => {
  const needle = filterText.value.trim().toLowerCase()
  const base = isCluster.value ? clusterDomains.value : domains.value
  if (!needle) return base
  return base.filter((d) => d.toLowerCase().includes(needle))
})

const sync = computed(() => diffLists(perNode.value, nodeNames.value))
const clusterDomains = computed(() =>
  sync.value.union.filter((d) => {
    if (presence.value === "all") return true
    const missing = sync.value.missingOn[d] ?? []
    return presence.value === "missing" ? missing.length > 0 : missing.length === 0
  }),
)
const presenceCounts = computed(() => ({
  all: sync.value.union.length,
  both: sync.value.union.filter((d) => (sync.value.missingOn[d] ?? []).length === 0).length,
  missing: sync.value.union.filter((d) => (sync.value.missingOn[d] ?? []).length > 0).length,
}))
const hasDomain = (d: string, n: string): boolean => !(sync.value.missingOn[d] ?? []).includes(n)

// A tree root lists its domains as zones, or, with a single entry, as records.
function domainsFrom(res: Awaited<ReturnType<typeof listAllowedZones>>): string[] {
  return res.response.zones.length > 0 ? res.response.zones : [...new Set(res.response.records.map((r) => r.name))]
}

async function load(): Promise<void> {
  if (!connection.isConfigured) return
  loading.value = true
  loadError.value = null
  try {
    if (!isCluster.value) {
      const node = targets.value[0]?.node
      // /api/allowed/list is a domain-tree browser, not a flat lister: with
      // only one entry under the root, the API auto-descends and returns it
      // via `records` instead of `zones` — confirmed against the live
      // server, which has exactly one allowed zone and returned it this way.
      const res = node ? await listAllowedZones(connection.credentials, "", { node }) : await listAllowedZones(connection.credentials)
      domains.value = domainsFrom(res)
      perNode.value = {}
      failedNodes.value = []
    } else {
      const settled = await Promise.allSettled(
        targets.value.map(async (t) => ({
          name: t.name,
          list: domainsFrom(t.node ? await listAllowedZones(connection.credentials, "", { node: t.node }) : await listAllowedZones(connection.credentials)),
        })),
      )
      const ok = settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []))
      if (ok.length === 0) {
        const first = settled.find((r): r is PromiseRejectedResult => r.status === "rejected")
        throw first?.reason ?? new Error("No node answered")
      }
      perNode.value = Object.fromEntries(ok.map((o) => [o.name, o.list]))
      failedNodes.value = settled.flatMap((r, i) => (r.status === "rejected" ? [targets.value[i]!.name] : []))
      domains.value = []
    }
  } catch (err) {
    loadError.value = err instanceof TechnitiumApiError ? err.message : "Could not load allowed zones."
  } finally {
    loading.value = false
  }
}

async function onExport(): Promise<void> {
  try {
    // The list is synced, so one node's export stands for the cluster.
    const node = targets.value[0]?.node
    triggerDownload(node ? await exportAllowedZones(connection.credentials, { node }) : await exportAllowedZones(connection.credentials))
  } catch (err) {
    loadError.value = err instanceof TechnitiumApiError ? err.message : "Could not export allowed zones."
  }
}

const scopeKey = computed(() => JSON.stringify([statsScope.nodeParam("allowedPage"), nodeNames.value]))
watch(scopeKey, () => {
  presence.value = "all"
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
</script>

<template>
  <div>
    <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="text-lg font-semibold tracking-tight text-fg">Allowed Zones</h1>
        <p class="mt-1 text-sm text-gray-500">Domains explicitly exempted from blocking</p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <ScopeChip v-if="connection.isConfigured" panel="allowedPage" heading="Show the list on" />
        <input
          id="allowed-filter"
          v-model="filterText"
          placeholder="Filter…"
          class="w-44 rounded-md border border-border bg-background-card px-3 py-1.5 text-sm"
        />
        <button
          id="export-allowed"
          type="button"
          class="rounded-md border border-border bg-background-card px-2.5 py-1.5 text-[11.5px] font-semibold text-gray-500"
          @click="onExport"
        >
          Export
        </button>
      </div>
    </div>

    <p v-if="!connection.isConfigured" class="text-sm text-gray-500">
      Connect to a Technitium server on the
      <router-link to="/connect" class="font-medium text-accent">Connection Settings</router-link> page to see
      allowed zones.
    </p>
    <p v-else-if="loadError" id="allowed-error" class="text-sm text-crit">{{ loadError }}</p>

    <div
      v-else-if="isCluster"
      id="allowed-sync"
      class="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3.5 py-2.5 text-[12.5px]"
      :class="sync.inSync && failedNodes.length === 0 ? 'border-ok/35 bg-ok/10' : 'border-warn/35 bg-warn/10'"
    >
      <span class="font-semibold">{{ sync.inSync && failedNodes.length === 0 ? "In sync" : failedNodes.length ? "Partial" : "Not in sync yet" }}</span>
      <span class="text-gray-500">
        <template v-if="failedNodes.length"><span class="font-mono">{{ failedNodes.map(shortName).join(", ") }}</span> could not be read.</template>
        <template v-else-if="sync.inSync">Every node holds the same list.</template>
        <template v-else>Some domains have not reached every node yet. Technitium refreshes about every 15 minutes.</template>
      </span>
      <span class="ml-auto inline-flex flex-wrap gap-x-3 text-gray-500">
        <span v-for="n in nodeNames" :key="n" class="inline-flex items-center gap-1.5">
          <span class="inline-block h-2 w-2 rounded-sm" :style="{ background: colorOf(n) }" />{{ shortName(n) }}
          <span class="tabular-nums">{{ (perNode[n] ?? []).length }}</span>
        </span>
      </span>
    </div>

    <div v-if="connection.isConfigured && !loadError && isCluster" class="mb-2 flex flex-wrap gap-1.5" role="group" aria-label="Filter domains">
      <button
        v-for="f in ([['all', 'All'], ['both', 'On every node'], ['missing', 'Missing on a node']] as const)"
        :key="f[0]"
        type="button"
        :data-presence="f[0]"
        :aria-pressed="presence === f[0]"
        class="rounded-full border px-2.5 py-0.5 text-xs"
        :class="presence === f[0] ? 'border-accent/50 bg-accent/15 font-semibold text-accent' : 'border-border-hover'"
        @click="presence = f[0]"
      >
        {{ f[1] }}<span class="ml-1 tabular-nums text-gray-500">{{ presenceCounts[f[0]] }}</span>
      </button>
    </div>

    <div v-if="connection.isConfigured && !loadError" class="overflow-x-auto rounded-lg border border-border">
      <table class="w-full text-left text-[12.5px]">
        <thead>
          <tr class="border-b border-border bg-background-elevated text-[10.5px] uppercase text-gray-500">
            <th class="px-3 py-2 font-bold">Domain</th>
            <template v-if="isCluster">
              <th v-for="n in nodeNames" :key="n" class="w-36 px-3 py-2 font-bold">
                <span class="mr-1.5 inline-block h-2 w-2 rounded-sm" :style="{ background: colorOf(n) }" />{{ shortName(n) }}
              </th>
            </template>
          </tr>
        </thead>
        <tbody>
          <tr v-if="filteredDomains.length === 0">
            <td :colspan="isCluster ? 1 + nodeNames.length : 1" class="px-3 py-6 text-center text-gray-500">
              {{ loading ? "Loading…" : "No allowed zones." }}
            </td>
          </tr>
          <tr v-for="domain in filteredDomains" :key="domain" class="border-b border-border last:border-b-0">
            <td class="px-3 py-2 font-mono">{{ domain }}</td>
            <template v-if="isCluster">
              <td
                v-for="n in nodeNames"
                :key="n"
                class="presence-cell px-3 py-2 text-xs"
                :class="hasDomain(domain, n) ? 'text-gray-500' : 'font-semibold text-warn'"
              >
                {{ hasDomain(domain, n) ? "present" : "not yet" }}
              </td>
            </template>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
