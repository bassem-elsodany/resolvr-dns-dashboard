<script setup lang="ts">
import { computed, ref, onMounted, watch } from "vue"
import { useConnectionStore } from "../../stores/connection"
import { useRefreshStore } from "../../stores/refresh"
import { useAuthStore } from "../../stores/auth"
import { listApps, TechnitiumApiError, type DnsAppSummary } from "../../api/technitium"
import { uninstallApp, AppApiError } from "../../api/app"
import { CLUSTER, NODE_COLORS, useStatsScopeStore } from "../../stores/statsScope"
import ScopeChip from "../../components/overview/ScopeChip.vue"

const connection = useConnectionStore()
const refresh = useRefreshStore()
const auth = useAuthStore()

const statsScope = useStatsScopeStore()

// Apps are installed per node (installing one on a node does not install it
// on the others), so the page lays the nodes side by side.
const targets = computed(() => statsScope.targets("appsPage"))
const isCluster = computed(() => statsScope.available && statsScope.scopeOf("appsPage") === CLUSTER)
const nodeNames = computed(() => targets.value.map((t) => t.name))
const shortName = (name: string): string => (name ? name.split(".")[0]! : "this node")
const colorOf = (name: string): string => NODE_COLORS[Math.max(0, statsScope.nodeNames.indexOf(name)) % NODE_COLORS.length]!

const loading = ref(false)
const loadError = ref<string | null>(null)
const perNode = ref<Record<string, DnsAppSummary[]>>({})
const failedNodes = ref<string[]>([])
type Presence = "all" | "both" | "some"
const presence = ref<Presence>("all")

interface AppRow {
  name: string
  description: string
  // The node's copy of the app, for each node that has it.
  byNode: Record<string, DnsAppSummary>
}
const rows = computed<AppRow[]>(() => {
  const byName = new Map<string, AppRow>()
  for (const [node, list] of Object.entries(perNode.value)) {
    for (const a of list) {
      const row = byName.get(a.name) ?? { name: a.name, description: a.description, byNode: {} }
      row.byNode[node] = a
      byName.set(a.name, row)
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
})
const onEveryNode = (r: AppRow): boolean => nodeNames.value.every((n) => n in r.byNode)
const shown = computed(() =>
  rows.value.filter((r) => (presence.value === "all" ? true : presence.value === "both" ? onEveryNode(r) : !onEveryNode(r))),
)
const counts = computed(() => ({
  all: rows.value.length,
  both: rows.value.filter(onEveryNode).length,
  some: rows.value.filter((r) => !onEveryNode(r)).length,
}))
// The first node's copy, used for the single-node card.
const first = (r: AppRow): DnsAppSummary => r.byNode[nodeNames.value[0] ?? ""] ?? Object.values(r.byNode)[0]!

async function load(): Promise<void> {
  if (!connection.isConfigured) return
  loading.value = true
  loadError.value = null
  try {
    const settled = await Promise.allSettled(
      targets.value.map(async (t) => {
        const res = t.node ? await listApps(connection.credentials, { node: t.node }) : await listApps(connection.credentials)
        return { name: t.name, apps: res.response.apps }
      }),
    )
    const ok = settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []))
    if (ok.length === 0) {
      const firstFail = settled.find((s): s is PromiseRejectedResult => s.status === "rejected")
      throw firstFail?.reason ?? new Error("No node answered")
    }
    perNode.value = Object.fromEntries(ok.map((o) => [o.name, o.apps]))
    failedNodes.value = settled.flatMap((s, i) => (s.status === "rejected" ? [targets.value[i]!.name] : []))
  } catch (err) {
    loadError.value = err instanceof TechnitiumApiError ? err.message : "Could not load DNS apps."
  } finally {
    loading.value = false
  }
}

const confirmingUninstall = ref<string | null>(null)
// Which node's copy to remove: every node that has it, or one by name.
const uninstallPick = ref("all")
const uninstalling = ref(false)
const uninstallError = ref<string | null>(null)

function startUninstall(name: string): void {
  confirmingUninstall.value = name
  uninstallError.value = null
  uninstallPick.value = "all"
}

function cancelUninstall(): void {
  confirmingUninstall.value = null
}

async function confirmUninstall(name: string): Promise<void> {
  uninstalling.value = true
  uninstallError.value = null
  try {
    const row = rows.value.find((r) => r.name === name)
    const holders = targets.value.filter((t) => !row || t.name in row.byNode)
    const chosen = isCluster.value && uninstallPick.value !== "all" ? holders.filter((t) => t.name === uninstallPick.value) : holders
    for (const t of chosen.length > 0 ? chosen : targets.value) {
      await (t.node ? uninstallApp(name, t.node) : uninstallApp(name))
    }
    confirmingUninstall.value = null
    await load()
  } catch (err) {
    uninstallError.value = err instanceof AppApiError ? err.message : "Could not uninstall this app."
  } finally {
    uninstalling.value = false
  }
}

const scopeKey = computed(() => JSON.stringify([statsScope.nodeParam("appsPage"), nodeNames.value]))
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
        <h1 class="text-lg font-semibold tracking-tight text-fg">DNS Apps</h1>
        <p class="mt-1 text-sm text-gray-500">Installed extensions that shape how {{ isCluster ? "each node" : "this server" }} resolves and blocks</p>
      </div>
      <ScopeChip v-if="connection.isConfigured" panel="appsPage" heading="Show apps on" />
    </div>

    <p v-if="!connection.isConfigured" class="text-sm text-gray-500">
      Connect to a Technitium server on the
      <router-link to="/connect" class="font-medium text-accent">Connection Settings</router-link> page to see
      installed apps.
    </p>
    <p v-else-if="loadError" id="apps-error" class="text-sm text-crit">{{ loadError }}</p>
    <p v-else-if="loading && rows.length === 0" class="text-sm text-gray-500">Loading…</p>

    <template v-else>
      <p v-if="failedNodes.length" id="apps-partial" class="mb-3 rounded-lg border border-warn/35 bg-warn/10 px-3.5 py-2 text-[12.5px] font-medium">
        <span class="font-mono">{{ failedNodes.join(", ") }}</span> could not be read, so this is partial.
      </p>
      <p v-if="uninstallError" id="uninstall-app-error" class="mb-3 text-sm text-crit">{{ uninstallError }}</p>
      <div v-if="isCluster" class="mb-3 flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter apps">
        <button
          v-for="f in ([['all', 'All'], ['both', 'On every node'], ['some', 'On some nodes only']] as const)"
          :key="f[0]"
          type="button"
          :data-presence="f[0]"
          :aria-pressed="presence === f[0]"
          class="rounded-full border px-2.5 py-0.5 text-xs"
          :class="presence === f[0] ? 'border-accent/50 bg-accent/15 font-semibold text-accent' : 'border-border-hover'"
          @click="presence = f[0]"
        >
          {{ f[1] }}<span class="ml-1 tabular-nums text-gray-500">{{ counts[f[0]] }}</span>
        </button>
        <span class="text-[11.5px] text-gray-500">An app installed on one node is not installed on the others.</span>
      </div>
      <!-- Cards share the row: a lone app fills the width instead of sitting in a third of it. -->
      <div class="grid grid-cols-[repeat(auto-fit,minmax(340px,1fr))] gap-3">
        <div v-for="row in shown" :key="row.name" class="app-card rounded-lg border border-border bg-background-card p-3.5">
          <div class="flex items-start justify-between gap-2">
            <span class="text-[13px] font-semibold">{{ row.name }}</span>
            <template v-if="!isCluster">
              <span
                v-if="first(row).updateAvailable"
                class="whitespace-nowrap rounded-md bg-warn/12 px-1.5 py-0.5 text-[10.5px] font-semibold text-warn"
              >
                Update to v{{ first(row).updateVersion }}
              </span>
              <span v-else class="whitespace-nowrap rounded-md bg-ok/12 px-1.5 py-0.5 text-[10.5px] font-semibold text-ok">
                v{{ first(row).version }}
              </span>
            </template>
          </div>
          <div v-if="isCluster" class="app-nodes mt-2 flex flex-col gap-1">
            <div v-for="n in nodeNames" :key="n" class="flex items-center justify-between gap-2 text-[11.5px]">
              <span class="inline-flex items-center gap-1.5 font-mono">
                <span class="inline-block h-2 w-2 rounded-sm" :style="{ background: colorOf(n) }" />{{ shortName(n) }}
              </span>
              <span v-if="!(n in row.byNode)" class="rounded-md bg-background-hover px-1.5 py-0.5 text-[10.5px] font-semibold text-gray-500">not installed</span>
              <span
                v-else-if="row.byNode[n]!.updateAvailable"
                class="rounded-md bg-warn/12 px-1.5 py-0.5 text-[10.5px] font-semibold text-warn"
              >
                Update to v{{ row.byNode[n]!.updateVersion }}
              </span>
              <span v-else class="rounded-md bg-ok/12 px-1.5 py-0.5 text-[10.5px] font-semibold text-ok">v{{ row.byNode[n]!.version }}</span>
            </div>
          </div>
          <p class="mt-1.5 line-clamp-3 text-[11.5px] leading-relaxed text-gray-500">{{ row.description }}</p>

          <div v-if="auth.isAdmin" class="mt-2.5 border-t border-border pt-2.5">
            <div v-if="confirmingUninstall === row.name" class="flex flex-col gap-1.5">
              <div v-if="isCluster" class="uninstall-choice flex flex-wrap gap-x-3 gap-y-1 text-[11.5px]">
                <label v-for="o in ['all', ...nodeNames.filter((n) => n in row.byNode)]" :key="o" class="inline-flex items-center gap-1.5">
                  <input v-model="uninstallPick" type="radio" name="uninstall-target" :value="o" />
                  {{ o === "all" ? "Every node that has it" : shortName(o) }}
                </label>
              </div>
              <div class="flex items-center gap-2">
                <span class="text-[11px] text-crit">Uninstall this app?</span>
                <button
                  type="button"
                  :disabled="uninstalling"
                  class="text-[11.5px] font-semibold text-crit disabled:opacity-50"
                  @click="confirmUninstall(row.name)"
                >
                  {{ uninstalling ? "Uninstalling…" : "Confirm" }}
                </button>
                <button type="button" class="text-[11.5px] text-gray-500" @click="cancelUninstall">Cancel</button>
              </div>
            </div>
            <button
              v-else
              type="button"
              class="uninstall-app text-[11.5px] font-medium text-crit"
              @click="startUninstall(row.name)"
            >
              Uninstall
            </button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
