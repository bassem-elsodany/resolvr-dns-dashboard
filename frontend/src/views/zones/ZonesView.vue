<script setup lang="ts">
import { computed, ref, onMounted, watch } from "vue"
import { useConnectionStore } from "../../stores/connection"
import { useRefreshStore } from "../../stores/refresh"
import { useAuthStore } from "../../stores/auth"
import { CLUSTER, NODE_COLORS, useStatsScopeStore } from "../../stores/statsScope"
import { listZones, getZoneRecords, TechnitiumApiError, type ZoneSummary, type ZoneRecord } from "../../api/technitium"
import { createZone, addRecord, deleteZone, AppApiError } from "../../api/app"
import { formatRecordValue } from "../../lib/formatRecordValue"
import ScopeChip from "../../components/overview/ScopeChip.vue"

const connection = useConnectionStore()
const refresh = useRefreshStore()
const auth = useAuthStore()
const statsScope = useStatsScopeStore()

const ZONES_PER_PAGE = 15

// Zones are kept per node and are not synced (only catalog zones are), so
// the page has one scope: the nodes whose zones are shown. A zone that exists
// on one node only gives a different answer from the other, which is the
// thing worth seeing on a load-balanced pair.
const targets = computed(() => statsScope.targets("zonesPage"))
const isCluster = computed(() => statsScope.available && statsScope.scopeOf("zonesPage") === CLUSTER)
const nodeNames = computed(() => targets.value.map((t) => t.name))
const shortName = (name: string): string => (name ? name.split(".")[0]! : "this node")
const colorOf = (name: string): string => NODE_COLORS[Math.max(0, statsScope.nodeNames.indexOf(name)) % NODE_COLORS.length]!


const filterName = ref("")
const pageNumber = ref(1)
const totalPages = ref(1)
const totalZones = ref(0)

const loading = ref(false)
const loadError = ref<string | null>(null)
const zones = ref<ZoneSummary[]>([])

// One row per zone name, with the node's copy of it (cluster view).
interface ZoneRow {
  name: string
  byNode: Record<string, ZoneSummary>
}
const merged = ref<ZoneRow[]>([])
const failedNodes = ref<string[]>([])
type Presence = "all" | "both" | "one" | "serial"
const presence = ref<Presence>("all")

const selectedZone = ref<string | null>(null)
const zoneRecords = ref<ZoneRecord[]>([])
const recordsLoading = ref(false)
const recordsError = ref<string | null>(null)

type Health = "ok" | "expired" | "syncFailed" | "notifyFailed" | "onlyOn" | "serialDiffers"

function zoneHealth(zone: ZoneSummary): Health {
  if (zone.isExpired) return "expired"
  if (zone.syncFailed) return "syncFailed"
  if (zone.notifyFailed) return "notifyFailed"
  return "ok"
}

const healthLabel: Record<Health, string> = {
  ok: "Healthy",
  expired: "Expired",
  syncFailed: "Sync failed",
  notifyFailed: "Notify failed",
  onlyOn: "Only on one node",
  serialDiffers: "Serial differs",
}

async function load(): Promise<void> {
  if (!connection.isConfigured) return
  loading.value = true
  loadError.value = null
  try {
    if (!isCluster.value) {
      // One node (or a standalone server): server-side paging, as before.
      const node = targets.value[0]?.node
      const res = await listZones(connection.credentials, {
        pageNumber: pageNumber.value,
        zonesPerPage: ZONES_PER_PAGE,
        filterName: filterName.value || undefined,
        ...(node ? { node } : {}),
      })
      zones.value = res.response.zones
      totalPages.value = res.response.totalPages
      totalZones.value = res.response.totalZones
      merged.value = []
      failedNodes.value = []
    } else {
      // Whole cluster: every node's zones, matched up by name, paged here.
      const settled = await Promise.allSettled(
        targets.value.map(async (t) => ({
          name: t.name,
          res: await listZones(connection.credentials, {
            zonesPerPage: 1000,
            filterName: filterName.value || undefined,
            ...(t.node ? { node: t.node } : {}),
          }),
        })),
      )
      const ok = settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []))
      if (ok.length === 0) {
        const first = settled.find((s): s is PromiseRejectedResult => s.status === "rejected")
        throw first?.reason ?? new Error("No node answered")
      }
      const byName = new Map<string, ZoneRow>()
      for (const { name, res } of ok) {
        for (const z of res.response.zones) {
          const row = byName.get(z.name) ?? { name: z.name, byNode: {} }
          row.byNode[name] = z
          byName.set(z.name, row)
        }
      }
      merged.value = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
      failedNodes.value = settled.flatMap((s, i) => (s.status === "rejected" ? [targets.value[i]!.name] : []))
      zones.value = []
    }
  } catch (err) {
    loadError.value = err instanceof TechnitiumApiError ? err.message : "Could not load zones."
  } finally {
    loading.value = false
  }
}

// Where the preview of a zone is read from: the connected node when it holds
// the zone, otherwise the first node that does.
const recordsFrom = ref<{ name: string; node: string | undefined }>({ name: "", node: undefined })
function recordsNode(zone: string): { name: string; node: string | undefined } {
  const holders = isCluster.value ? (merged.value.find((r) => r.name === zone) ? Object.keys(merged.value.find((r) => r.name === zone)!.byNode) : []) : []
  const pick = holders.find((n) => n === statsScope.self) ?? holders[0] ?? targets.value[0]?.name ?? ""
  const t = targets.value.find((x) => x.name === pick)
  return { name: pick, node: t?.node }
}

async function selectZone(name: string): Promise<void> {
  selectedZone.value = name
  recordsLoading.value = true
  recordsError.value = null
  confirmingDelete.value = false
  deleteMappingError.value = null
  try {
    const from = recordsNode(name)
    recordsFrom.value = from
    const res = from.node
      ? await getZoneRecords(name, connection.credentials, { node: from.node })
      : await getZoneRecords(name, connection.credentials)
    zoneRecords.value = res.response.records
  } catch (err) {
    recordsError.value = err instanceof TechnitiumApiError ? err.message : "Could not load zone records."
    zoneRecords.value = []
  } finally {
    recordsLoading.value = false
  }
}

// Host-to-IP mapping (the AdGuard "DNS rewrites" equivalent) — see
// backend/src/routes/actionRoutes.ts for why this is a zone create
// followed by a record add rather than one call.
const newHostname = ref("")
const newIpAddress = ref("")
const addingMapping = ref(false)
const addMappingError = ref<string | null>(null)

// Which node(s) a change is applied to. Zones are not synced, so a mapping
// that should answer from either node has to be made on both; that is the
// default.
const applyTo = ref<string>("both")
const applyTargets = computed(() =>
  isCluster.value && applyTo.value !== "both" ? targets.value.filter((t) => t.name === applyTo.value) : targets.value,
)

async function onAddMapping(): Promise<void> {
  const hostname = newHostname.value.trim()
  const ipAddress = newIpAddress.value.trim()
  if (!hostname || !ipAddress) return
  addingMapping.value = true
  addMappingError.value = null
  try {
    // One node at a time, so a failure names where it stopped.
    for (const t of applyTargets.value) {
      try {
        await createZone(hostname, ...(t.node ? [t.node] : []))
        await addRecord({ domain: hostname, zone: hostname, type: "A", ipAddress, ...(t.node ? { node: t.node } : {}) })
      } catch (err) {
        if (applyTargets.value.length > 1) {
          const msg = err instanceof AppApiError ? err.message : "failed"
          throw new AppApiError(`${shortName(t.name)}: ${msg}`, err instanceof AppApiError ? err.status : 0)
        }
        throw err
      }
    }
    newHostname.value = ""
    newIpAddress.value = ""
    await load()
  } catch (err) {
    addMappingError.value = err instanceof AppApiError ? err.message : "Could not create this host mapping."
  } finally {
    addingMapping.value = false
  }
}

const confirmingDelete = ref(false)
const deletingMapping = ref(false)
const deleteMappingError = ref<string | null>(null)

async function onDeleteMapping(): Promise<void> {
  if (!selectedZone.value) return
  deletingMapping.value = true
  deleteMappingError.value = null
  try {
    for (const t of applyTargets.value) {
      // Only nodes that actually hold the zone are asked.
      const row = merged.value.find((r) => r.name === selectedZone.value)
      if (isCluster.value && row && !(t.name in row.byNode)) continue
      await deleteZone(selectedZone.value, ...(t.node ? [t.node] : []))
    }
    selectedZone.value = null
    zoneRecords.value = []
    confirmingDelete.value = false
    await load()
  } catch (err) {
    deleteMappingError.value = err instanceof AppApiError ? err.message : "Could not delete this zone."
  } finally {
    deletingMapping.value = false
  }
}

function onFilterChange(): void {
  pageNumber.value = 1
  void load()
}

// ---------- cluster view: matching zones across nodes ----------

function typesOf(row: ZoneRow): string[] {
  return nodeNames.value.map((n) => row.byNode[n]?.type ?? "")
}
function rowHealth(row: ZoneRow): Health {
  const present = nodeNames.value.filter((n) => n in row.byNode)
  if (present.length < nodeNames.value.length) return "onlyOn"
  const serials = new Set(present.map((n) => row.byNode[n]!.soaSerial))
  if (serials.size > 1) return "serialDiffers"
  const worst = present.map((n) => zoneHealth(row.byNode[n]!)).find((h) => h !== "ok")
  return worst ?? "ok"
}
const presenceCounts = computed(() => ({
  all: merged.value.length,
  both: merged.value.filter((r) => nodeNames.value.every((n) => n in r.byNode)).length,
  one: merged.value.filter((r) => nodeNames.value.some((n) => !(n in r.byNode))).length,
  serial: merged.value.filter((r) => rowHealth(r) === "serialDiffers").length,
}))
const clusterFiltered = computed(() =>
  merged.value.filter((r) => {
    if (presence.value === "all") return true
    if (presence.value === "both") return nodeNames.value.every((n) => n in r.byNode)
    if (presence.value === "one") return nodeNames.value.some((n) => !(n in r.byNode))
    return rowHealth(r) === "serialDiffers"
  }),
)

interface DisplayRow {
  name: string
  type: string
  types: string[]
  dnssec: string
  health: Health
}
const displayRows = computed<DisplayRow[]>(() => {
  if (!isCluster.value) {
    return zones.value.map((z) => ({ name: z.name, type: z.type, types: [], dnssec: z.dnssecStatus, health: zoneHealth(z) }))
  }
  const start = (pageNumber.value - 1) * ZONES_PER_PAGE
  return clusterFiltered.value.slice(start, start + ZONES_PER_PAGE).map((r) => {
    const any = Object.values(r.byNode)[0]!
    return { name: r.name, type: any.type, types: typesOf(r), dnssec: any.dnssecStatus, health: rowHealth(r) }
  })
})
const pagesShown = computed(() => (isCluster.value ? Math.max(1, Math.ceil(clusterFiltered.value.length / ZONES_PER_PAGE)) : totalPages.value))
const countShown = computed(() => (isCluster.value ? merged.value.length : totalZones.value))

function goToPageAny(delta: number): void {
  const next = pageNumber.value + delta
  if (next < 1 || next > pagesShown.value) return
  pageNumber.value = next
  if (!isCluster.value) void load()
}

// A different scope (or a node coming or going) changes whose zones these are.
const scopeKey = computed(() => JSON.stringify([statsScope.nodeParam("zonesPage"), nodeNames.value]))
watch(scopeKey, () => {
  pageNumber.value = 1
  presence.value = "all"
  applyTo.value = "both"
  selectedZone.value = null
  void load()
})
watch(presence, () => {
  pageNumber.value = 1
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
        <h1 class="text-lg font-semibold tracking-tight text-fg">Authoritative Zones</h1>
        <p class="mt-1 text-sm text-gray-500">
          {{ countShown }} zones <template v-if="isCluster">across {{ nodeNames.length }} nodes</template
          ><template v-else>hosted on this server</template>
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <ScopeChip v-if="connection.isConfigured" panel="zonesPage" heading="Show zones on" />
        <form v-if="auth.isAdmin" class="flex items-center gap-1.5" @submit.prevent="onAddMapping">
          <input
            id="new-mapping-hostname"
            v-model="newHostname"
            placeholder="hostname"
            class="w-32 rounded-md border border-border bg-background-card px-2.5 py-1.5 font-mono text-xs"
          />
          <span class="text-xs text-gray-500">&rarr;</span>
          <input
            id="new-mapping-ip"
            v-model="newIpAddress"
            placeholder="10.0.10.50"
            class="w-32 rounded-md border border-border bg-background-card px-2.5 py-1.5 font-mono text-xs"
          />
          <button
            id="add-mapping"
            type="submit"
            :disabled="addingMapping"
            class="rounded-md bg-accent px-2.5 py-1.5 text-[11.5px] font-semibold text-white disabled:opacity-50"
          >
            {{ addingMapping ? "Adding…" : "Add mapping" }}
          </button>
        </form>
        <input
          id="zone-filter"
          v-model="filterName"
          placeholder="Filter by zone name…"
          class="w-56 rounded-md border border-border bg-background-card px-3 py-1.5 text-sm"
          @change="onFilterChange"
        />
      </div>
    </div>
    <div v-if="auth.isAdmin && isCluster" id="apply-to" class="mb-3 flex flex-wrap items-center gap-2 text-xs text-gray-500">
      <span class="font-semibold">Apply changes to</span>
      <button
        v-for="o in ['both', ...nodeNames]"
        :key="o"
        type="button"
        :data-apply="o"
        :aria-pressed="applyTo === o"
        class="rounded-full border px-2.5 py-0.5"
        :class="applyTo === o ? 'border-accent/50 bg-accent/15 font-semibold text-accent' : 'border-border-hover text-fg'"
        @click="applyTo = o"
      >
        {{ o === "both" ? "Every node" : shortName(o) }}
      </button>
      <span>Zones are not synced between nodes, so a name added on one node only answers from that node.</span>
    </div>
    <p v-if="addMappingError" id="add-mapping-error" class="mb-3 text-sm text-crit">{{ addMappingError }}</p>
    <p v-if="failedNodes.length" id="zones-partial" class="mb-3 rounded-lg border border-warn/35 bg-warn/10 px-3.5 py-2 text-[12.5px] font-medium">
      <span class="font-mono">{{ failedNodes.join(", ") }}</span> could not be read, so this is partial.
    </p>

    <p v-if="!connection.isConfigured" class="text-sm text-gray-500">
      Connect to a Technitium server on the
      <router-link to="/connect" class="font-medium text-accent">Connection Settings</router-link> page to see
      zones.
    </p>
    <p v-else-if="loadError" id="zones-error" class="text-sm text-crit">{{ loadError }}</p>

    <div v-else class="grid grid-cols-1 gap-4 lg:grid-cols-[1.1fr_1.4fr]">
      <div>
        <div v-if="isCluster" class="mb-2 flex flex-wrap gap-1.5" role="group" aria-label="Filter zones">
          <button
            v-for="f in ([['all', 'All'], ['both', 'On every node'], ['one', 'On one node only'], ['serial', 'Serial differs']] as const)"
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
        <div class="overflow-x-auto rounded-lg border border-border">
          <table class="w-full text-left text-[12.5px]">
            <thead>
              <tr class="border-b border-border bg-background-elevated text-[10.5px] uppercase text-gray-500">
                <th class="px-2.5 py-2 font-bold">Zone</th>
                <template v-if="isCluster">
                  <th v-for="n in nodeNames" :key="n" class="px-2.5 py-2 font-bold">
                    <span class="mr-1.5 inline-block h-2 w-2 rounded-sm" :style="{ background: colorOf(n) }" />{{ shortName(n) }}
                  </th>
                </template>
                <th v-else class="px-2.5 py-2 font-bold">Type</th>
                <th class="px-2.5 py-2 font-bold">DNSSEC</th>
                <th class="px-2.5 py-2 font-bold">Health</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="displayRows.length === 0">
                <td :colspan="isCluster ? 3 + nodeNames.length : 4" class="px-3 py-6 text-center text-gray-500">
                  {{ loading ? "Loading…" : "No zones match." }}
                </td>
              </tr>
              <tr
                v-for="zone in displayRows"
                :key="zone.name"
                class="cursor-pointer border-b border-border last:border-b-0"
                :class="selectedZone === zone.name ? 'bg-accent/7' : ''"
                @click="selectZone(zone.name)"
              >
                <td class="px-2.5 py-1.5 font-mono">{{ zone.name || "(root)" }}</td>
                <template v-if="isCluster">
                  <td
                    v-for="(t, i) in zone.types"
                    :key="i"
                    class="zone-type px-2.5 py-1.5"
                    :class="t ? 'text-gray-500' : 'text-gray-500/60'"
                  >
                    {{ t || "not on this node" }}
                  </td>
                </template>
                <td v-else class="px-2.5 py-1.5 text-gray-500">{{ zone.type }}</td>
                <td class="px-2.5 py-1.5 text-gray-500">{{ zone.dnssec }}</td>
                <td class="px-2.5 py-1.5">
                  <span
                    class="rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold"
                    :class="{
                      ok: 'bg-ok/12 text-ok',
                      expired: 'bg-crit/12 text-crit',
                      syncFailed: 'bg-crit/12 text-crit',
                      notifyFailed: 'bg-warn/12 text-warn',
                      onlyOn: 'bg-warn/12 text-warn',
                      serialDiffers: 'bg-warn/12 text-warn',
                    }[zone.health]"
                  >
                    {{ healthLabel[zone.health] }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="pagesShown > 1" class="mt-2 flex items-center justify-between text-[11.5px] text-gray-500">
          <span>Page {{ pageNumber }} of {{ pagesShown }}</span>
          <div class="flex gap-1">
            <button
              type="button"
              class="rounded-md border border-border px-2 py-1 disabled:opacity-40"
              :disabled="pageNumber <= 1"
              @click="goToPageAny(-1)"
            >
              Prev
            </button>
            <button
              type="button"
              class="rounded-md border border-border px-2 py-1 disabled:opacity-40"
              :disabled="pageNumber >= pagesShown"
              @click="goToPageAny(1)"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      <div class="rounded-lg border border-border bg-background-card p-3.5">
        <div v-if="!selectedZone" class="py-10 text-center text-sm text-gray-500">
          Select any zone on the left to preview its records here &mdash; view only.
        </div>
        <template v-else>
          <div class="mb-2 flex items-center justify-between gap-2">
            <div class="font-mono text-[13px] font-semibold">{{ selectedZone }}</div>
            <div v-if="auth.isAdmin" class="flex-none">
              <div v-if="confirmingDelete" class="flex items-center gap-1.5">
                <span class="text-[11px] text-gray-500">Delete this zone?</span>
                <button
                  id="confirm-delete-zone"
                  type="button"
                  :disabled="deletingMapping"
                  class="text-[11px] font-semibold text-crit disabled:opacity-50"
                  @click="onDeleteMapping"
                >
                  {{ deletingMapping ? "Deleting…" : "Confirm" }}
                </button>
                <button type="button" class="text-[11px] text-gray-500" @click="confirmingDelete = false">
                  Cancel
                </button>
              </div>
              <button
                v-else
                id="delete-zone"
                type="button"
                class="text-[11px] font-medium text-crit"
                @click="confirmingDelete = true"
              >
                Delete zone
              </button>
            </div>
          </div>
          <p v-if="deleteMappingError" id="delete-zone-error" class="mb-2 text-sm text-crit">
            {{ deleteMappingError }}
          </p>
          <p v-if="isCluster && recordsFrom.name" id="records-from" class="mb-2 text-[11.5px] text-gray-500">
            Records shown from <span class="font-mono">{{ shortName(recordsFrom.name) }}</span>. View only.
          </p>
          <p v-if="recordsError" id="zone-records-error" class="text-sm text-crit">{{ recordsError }}</p>
          <p v-else-if="recordsLoading" class="text-sm text-gray-500">Loading…</p>
          <div v-else class="overflow-x-auto rounded-lg border border-border">
            <table class="w-full text-left text-[12px]">
              <thead>
                <tr class="border-b border-border bg-background-elevated text-[10.5px] uppercase text-gray-500">
                  <th class="px-2.5 py-1.5 font-bold">Name</th>
                  <th class="px-2.5 py-1.5 font-bold">Type</th>
                  <th class="px-2.5 py-1.5 font-bold">TTL</th>
                  <th class="px-2.5 py-1.5 font-bold">Value</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(record, i) in zoneRecords" :key="i" class="border-b border-border last:border-b-0">
                  <td class="px-2.5 py-1.5 font-mono">{{ record.name }}</td>
                  <td class="px-2.5 py-1.5 text-gray-500">{{ record.type }}</td>
                  <td class="px-2.5 py-1.5 tabular-nums">{{ record.ttl }}</td>
                  <td class="max-w-[260px] truncate px-2.5 py-1.5 font-mono text-gray-500">
                    {{ formatRecordValue(record.rData) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>
