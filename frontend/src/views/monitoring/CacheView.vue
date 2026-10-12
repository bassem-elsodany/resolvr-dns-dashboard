<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { useConnectionStore } from "../../stores/connection"
import { useRefreshStore } from "../../stores/refresh"
import { useAuthStore } from "../../stores/auth"
import { CLUSTER, NODE_COLORS, useStatsScopeStore } from "../../stores/statsScope"
import { listCache, getDashboardStats, TechnitiumApiError } from "../../api/technitium"
import { flushCache, AppApiError } from "../../api/app"
import { mergeCaches, matchesPresence, type MergedRecord, type MergedZone, type PresenceFilter } from "../../lib/cacheMerge"
import ScopeChip from "../../components/overview/ScopeChip.vue"

const connection = useConnectionStore()
const refresh = useRefreshStore()
const auth = useAuthStore()
const statsScope = useStatsScopeStore()

// The page has one scope: the nodes whose cache is shown. Each node keeps
// its own cache and they are not synced, so the whole cluster is laid out
// side by side rather than added up.
const targets = computed(() => statsScope.targets("cachePage"))
const isCluster = computed(() => statsScope.available && statsScope.scopeOf("cachePage") === CLUSTER)
const nodeNames = computed(() => targets.value.map((t) => t.name))
const shortName = (name: string): string => (name ? name.split(".")[0]! : "this node")
const colorOf = (name: string): string => NODE_COLORS[Math.max(0, statsScope.nodeNames.indexOf(name)) % NODE_COLORS.length]!
const singleName = computed(() => nodeNames.value[0] ?? "")

const domainInput = ref("")
const searchedDomain = ref<string | null>(null)
const loading = ref(false)
const loadError = ref<string | null>(null)
const records = ref<MergedRecord[]>([])
const zones = ref<MergedZone[]>([])
const failedNodes = ref<string[]>([])
const presence = ref<PresenceFilter>("all")

const flushing = ref(false)
const flushError = ref<string | null>(null)
const flushedText = ref<string | null>(null)
const confirmingFlush = ref(false)
// Which node's cache to clear: every node, or one by name.
const flushPick = ref<string>("both")

function startFlushConfirm(): void {
  confirmingFlush.value = true
  flushError.value = null
  flushedText.value = null
  flushPick.value = "both"
}

function cancelFlushConfirm(): void {
  confirmingFlush.value = false
}

async function confirmFlushCache(): Promise<void> {
  flushing.value = true
  flushError.value = null
  try {
    const chosen =
      isCluster.value && flushPick.value !== "both" ? targets.value.filter((t) => t.name === flushPick.value) : targets.value
    await Promise.all(chosen.map((t) => flushCache(t.node)))
    flushedText.value = isCluster.value
      ? `Cache flushed on ${chosen.length === targets.value.length ? "every node" : shortName(chosen[0]!.name)}.`
      : "Cache flushed."
    confirmingFlush.value = false
    if (searchedDomain.value !== null) void browse(searchedDomain.value) // reflect the now-empty cache immediately
    void loadHeld()
  } catch (err) {
    flushError.value = err instanceof AppApiError ? err.message : "Could not flush the cache."
  } finally {
    flushing.value = false
  }
}

// /api/cache/list is a tree browser, not a flat "give me this exact
// domain's records" lookup (same shape as /api/blocked/list and
// /api/allowed/list, confirmed live): a domain can have its own cached
// records, further cached subdomains (zones), both, or neither. An
// empty domain means "browse from the root" and is a valid, useful
// query on its own — not something to block.
async function browse(domain = domainInput.value.trim()): Promise<void> {
  if (!connection.isConfigured) return
  loading.value = true
  loadError.value = null
  try {
    const settled = await Promise.allSettled(
      targets.value.map(async (t) => {
        // The connected node is asked exactly as before; others are named.
        const res = t.node ? await listCache(domain, connection.credentials, { node: t.node }) : await listCache(domain, connection.credentials)
        return { node: t.name, zones: res.response.zones, records: res.response.records }
      }),
    )
    const ok = settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []))
    if (ok.length === 0) {
      const first = settled.find((s): s is PromiseRejectedResult => s.status === "rejected")
      throw first?.reason ?? new Error("No node answered")
    }
    const merged = mergeCaches(ok)
    records.value = merged.records
    zones.value = merged.zones
    failedNodes.value = settled.flatMap((s, i) => (s.status === "rejected" ? [targets.value[i]!.name] : []))
    domainInput.value = domain
    searchedDomain.value = domain
  } catch (err) {
    loadError.value = err instanceof TechnitiumApiError ? err.message : "Could not browse the cache."
    records.value = []
    zones.value = []
    failedNodes.value = []
  } finally {
    loading.value = false
  }
}

function browseZone(zone: string): void {
  void browse(zone)
}

// Entries each node holds, from its statistics (cluster view only).
const held = ref<Record<string, number | null>>({})
async function loadHeld(): Promise<void> {
  if (!connection.isConfigured || !isCluster.value) return
  const out: Record<string, number | null> = {}
  await Promise.all(
    targets.value.map(async (t) => {
      try {
        const res = await getDashboardStats("LastHour", connection.credentials, { utc: true, node: t.node })
        out[t.name] = res.response.stats.cachedEntries
      } catch {
        out[t.name] = null
      }
    }),
  )
  held.value = out
}

const shown = computed(() => records.value.filter((r) => matchesPresence(r, nodeNames.value.length, presence.value)))
const presenceChips = computed(() => {
  const n = nodeNames.value.length
  const count = (f: PresenceFilter) => records.value.filter((r) => matchesPresence(r, n, f)).length
  return [
    { id: "all" as PresenceFilter, label: "All", n: count("all") },
    { id: "both" as PresenceFilter, label: "On every node", n: count("both") },
    { id: "one" as PresenceFilter, label: "On some nodes only", n: count("one") },
  ]
})
const nothing = computed(() => records.value.length === 0 && zones.value.length === 0)
const ttlOf = (r: MergedRecord, node: string): string => (node in r.ttl ? String(r.ttl[node]) : "not cached")

// The topbar refresh button re-browses whatever domain is currently
// shown (not whatever's been typed but not submitted) — there's
// nothing to refresh before a first search.
watch(
  () => refresh.tick,
  () => {
    void loadHeld()
    if (searchedDomain.value === null) return // nothing browsed yet
    void browse(searchedDomain.value)
  },
)

// The connection can become configured after this page has mounted.
watch(
  () => connection.isConfigured,
  (configured) => {
    if (configured) void loadHeld()
  },
)

// A different scope (or a node coming or going) changes whose cache this is.
const scopeKey = computed(() => JSON.stringify([statsScope.nodeParam("cachePage"), nodeNames.value]))
watch(
  scopeKey,
  () => {
    presence.value = "all"
    void loadHeld()
    if (searchedDomain.value !== null) void browse(searchedDomain.value)
  },
  { immediate: true },
)
</script>

<template>
  <div>
    <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="text-lg font-semibold tracking-tight text-fg">DNS Cache</h1>
        <p class="mt-1 text-sm text-gray-500">Browse records your Technitium DNS server currently holds in memory</p>
      </div>
      <div class="flex flex-col items-end gap-1.5">
        <div class="flex flex-wrap items-center gap-2">
          <ScopeChip v-if="connection.isConfigured" panel="cachePage" heading="Show the cache of" />
          <button
            v-if="auth.isAdmin && connection.isConfigured && !confirmingFlush"
            id="flush-cache"
            type="button"
            title="Clear all cached records — your DNS server will make recursive queries again to repopulate it"
            class="rounded-md border border-border bg-background-card px-2.5 py-1.5 text-[11.5px] font-semibold text-gray-500 hover:text-crit"
            @click="startFlushConfirm"
          >
            Flush cache
          </button>
        </div>
        <div v-if="auth.isAdmin && connection.isConfigured && confirmingFlush" class="flex flex-col items-end gap-1.5">
          <div v-if="!isCluster" class="flex items-center gap-1.5">
            <span class="text-[11.5px] text-crit">Clear the entire cache?</span>
            <button
              id="confirm-flush-cache"
              type="button"
              :disabled="flushing"
              class="text-[11.5px] font-semibold text-crit disabled:opacity-50"
              @click="confirmFlushCache"
            >
              {{ flushing ? "Flushing…" : "Confirm" }}
            </button>
            <button type="button" class="text-[11.5px] text-gray-500" @click="cancelFlushConfirm">Cancel</button>
          </div>
          <div v-else id="flush-choice" class="w-72 rounded-lg border border-crit/35 bg-crit/5 px-3.5 py-3">
            <div class="text-[12.5px] font-semibold text-crit">Clear the cache on</div>
            <label v-for="o in ['both', ...nodeNames]" :key="o" class="flex cursor-pointer items-center gap-2.5 py-1.5 text-[13px]">
              <input v-model="flushPick" type="radio" name="flush-target" :value="o" class="accent-[rgb(var(--color-crit))]" />
              <span class="font-semibold">{{ o === "both" ? "Every node" : shortName(o) }}</span>
              <span class="text-gray-500">{{ o === "both" ? "all caches in the cluster" : o }}</span>
            </label>
            <p class="mt-1 text-[11.5px] text-gray-500">
              That server makes recursive queries again to refill it. The other nodes' caches are not touched.
            </p>
            <div class="mt-2.5 flex items-center gap-3">
              <button
                id="confirm-flush-cache"
                type="button"
                :disabled="flushing"
                class="text-[12.5px] font-bold text-crit disabled:opacity-50"
                @click="confirmFlushCache"
              >
                {{ flushing ? "Flushing…" : "Confirm" }}
              </button>
              <button type="button" class="text-[12.5px] text-gray-500" @click="cancelFlushConfirm">Cancel</button>
            </div>
          </div>
        </div>
        <span v-if="flushedText" class="text-[11px] text-ok">{{ flushedText }}</span>
        <span v-if="flushError" id="flush-cache-error" class="text-[11px] text-crit">{{ flushError }}</span>
      </div>
    </div>

    <p v-if="!connection.isConfigured" class="text-sm text-gray-500">
      Connect to a Technitium server on the
      <router-link to="/connect" class="font-medium text-accent">Connection Settings</router-link> page to
      browse the cache.
    </p>

    <template v-else>
      <div v-if="isCluster" id="cache-held" class="mb-4 flex flex-wrap items-center gap-3">
        <div
          v-for="n in nodeNames"
          :key="n"
          class="min-w-[200px] rounded-lg border border-border bg-background-card px-4 py-2.5"
        >
          <div class="flex items-center gap-2 text-xs text-gray-500">
            <span class="inline-block h-2.5 w-2.5 rounded-sm" :style="{ background: colorOf(n) }" />
            <span class="font-mono">{{ n }}</span>
          </div>
          <div class="text-xl font-bold tabular-nums leading-tight">{{ held[n] == null ? "–" : held[n]!.toLocaleString() }}</div>
          <div class="text-xs text-gray-500">entries in its cache</div>
        </div>
        <p class="max-w-md flex-1 text-xs text-gray-500">
          Each node keeps its own cache and they are not synced, so the same name can be cached on one node and not
          the other, with a different time left.
        </p>
      </div>

      <form class="mb-4 flex items-end gap-2" @submit.prevent="browse()">
        <div class="flex-1">
          <label for="cache-domain" class="mb-1 block text-[11px] font-semibold text-gray-500">Domain</label>
          <input
            id="cache-domain"
            v-model="domainInput"
            placeholder="Leave blank to browse from the root, or enter a domain e.g. google.com"
            class="w-full rounded-md border border-border bg-background-card px-3 py-1.5 font-mono text-sm"
          />
        </div>
        <button
          id="browse-cache"
          type="submit"
          :disabled="loading"
          class="rounded-md bg-accent px-3.5 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {{ loading ? "Browsing…" : "Browse" }}
        </button>
      </form>

      <p v-if="failedNodes.length" id="cache-partial" class="mb-3 rounded-lg border border-warn/35 bg-warn/10 px-3.5 py-2 text-[12.5px] font-medium">
        <span class="font-mono">{{ failedNodes.join(", ") }}</span> could not be read, so this is partial.
      </p>

      <p v-if="loadError" id="cache-error" class="mb-3 text-sm text-crit">{{ loadError }}</p>

      <template v-else-if="searchedDomain !== null">
        <div v-if="nothing" id="cache-empty" class="text-sm text-gray-500">
          Nothing cached
          <template v-if="searchedDomain">for <span class="font-mono">{{ searchedDomain }}</span></template
          ><template v-else>right now</template><template v-if="isCluster"> on any node</template>.
        </div>

        <template v-else>
          <div v-if="zones.length > 0" class="mb-3">
            <p class="mb-1.5 text-[11px] font-semibold text-gray-500">
              {{ searchedDomain ? "Cached subdomains under this name" : "Cached top-level domains" }} &mdash;
              click to browse in
            </p>
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="zone in zones"
                :key="zone.name"
                type="button"
                class="cache-zone-chip inline-flex items-center gap-2 rounded-full border border-border px-2.5 py-1 font-mono text-[11.5px] text-gray-500 hover:border-accent hover:text-accent"
                @click="browseZone(zone.name)"
              >
                {{ zone.name }}
                <span v-if="isCluster" class="inline-flex gap-0.5" :title="`cached on ${zone.nodes.map(shortName).join(', ')}`">
                  <span
                    v-for="n in nodeNames"
                    :key="n"
                    class="inline-block h-2 w-2 rounded-sm"
                    :style="{ background: zone.nodes.includes(n) ? colorOf(n) : 'rgb(var(--color-border))' }"
                  />
                </span>
              </button>
            </div>
          </div>

          <div v-if="records.length > 0">
            <div v-if="isCluster" class="mb-2 flex flex-wrap gap-1.5" role="group" aria-label="Filter records">
              <button
                v-for="f in presenceChips"
                :key="f.id"
                type="button"
                :data-presence="f.id"
                :aria-pressed="presence === f.id"
                class="rounded-full border px-2.5 py-0.5 text-xs"
                :class="presence === f.id ? 'border-accent/50 bg-accent/15 font-semibold text-accent' : 'border-border-hover'"
                @click="presence = f.id"
              >
                {{ f.label }}<span class="ml-1 tabular-nums text-gray-500">{{ f.n }}</span>
              </button>
            </div>
            <div class="overflow-x-auto rounded-lg border border-border">
              <table class="w-full text-left text-[12.5px]">
                <thead>
                  <tr class="border-b border-border bg-background-elevated text-[10.5px] uppercase text-gray-500">
                    <th class="px-3 py-2 font-bold">Name</th>
                    <th class="px-3 py-2 font-bold">Type</th>
                    <template v-if="isCluster">
                      <th v-for="n in nodeNames" :key="n" class="px-3 py-2 font-bold">
                        <span class="mr-1.5 inline-block h-2 w-2 rounded-sm" :style="{ background: colorOf(n) }" />{{ shortName(n) }} TTL
                      </th>
                    </template>
                    <th v-else class="px-3 py-2 font-bold">TTL remaining</th>
                    <th class="px-3 py-2 font-bold">Value</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(record, i) in shown" :key="i" class="cache-row border-b border-border last:border-b-0">
                    <td class="px-3 py-2 font-mono">{{ record.name }}</td>
                    <td class="px-3 py-2 text-gray-500">{{ record.type }}</td>
                    <template v-if="isCluster">
                      <td
                        v-for="n in nodeNames"
                        :key="n"
                        class="ttl-cell whitespace-nowrap px-3 py-2 tabular-nums"
                        :class="n in record.ttl ? '' : 'text-gray-500'"
                      >
                        {{ ttlOf(record, n) }}
                      </td>
                    </template>
                    <td v-else class="px-3 py-2 tabular-nums">{{ ttlOf(record, singleName) }}</td>
                    <td class="max-w-[360px] truncate px-3 py-2 font-mono text-gray-500">{{ record.value }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </template>
      </template>
    </template>
  </div>
</template>
