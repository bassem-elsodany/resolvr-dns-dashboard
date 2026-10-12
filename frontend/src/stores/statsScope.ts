import { defineStore } from "pinia"
import { computed, ref, watch } from "vue"
import { getClusterState, type ClusterNode } from "../api/technitium"
import { useConnectionStore } from "./connection"

// Value of a statistics panel's scope when it shows the whole cluster.
export const CLUSTER = "cluster"

// Panels fed by Technitium's statistics can show the whole cluster
// (`node=cluster`); the others read data Technitium keeps per node (query
// logs, DHCP, zones, cache), so they only ever pick one node.
export const STATS_PANELS = [
  "tiles",
  "queries",
  "types",
  "heatmap",
  "answers",
  "outcomes",
  "topClients",
  "topDomains",
  "topBlocked",
  // The Clients page has one scope for the whole page (list and detail must
  // agree), so it is a single "panel".
  "clients",
  // Same for Query Logs: one scope for the page, so the table and its totals agree.
  "logs",
  // The Cache page: each node's cache laid side by side, or one node's.
  "cachePage",
  // The zone pages: Zones differ per node, the allowed and blocked lists
  // are synced but can lag, so each is shown side by side or for one node.
  "zonesPage",
  "allowedPage",
  "blockedPage",
  // The remaining pages, all per-node data laid side by side or for one node.
  "dhcpPage",
  "resolverPage",
  "appsPage",
  "serverPage",
  "sessionsPage",
] as const
export const NODE_PANELS = ["responseTime", "flow", "dhcp", "zones", "cache"] as const

export type StatsPanel = (typeof STATS_PANELS)[number]
export type NodePanel = (typeof NODE_PANELS)[number]
export type PanelId = StatsPanel | NodePanel

// One colour per cluster node, in node order, used wherever nodes are told
// apart (compare lines, split bars, the node column).
export const NODE_COLORS = [
  "rgb(var(--color-chart-blue))",
  "rgb(var(--color-chart-orange))",
  "rgb(var(--color-chart-violet))",
  "rgb(var(--color-chart-aqua))",
] as const

export interface ScopeOption {
  id: string
  title: string
  sub: string
  disabled: boolean
}

// What "Whole cluster" means for pages where it is not a sum.
const CLUSTER_MEANING: Partial<Record<PanelId, string>> = {
  cachePage: "side by side",
  zonesPage: "side by side",
  allowedPage: "side by side",
  blockedPage: "side by side",
  dhcpPage: "merged, with the node",
  resolverPage: "ask every node and compare",
  appsPage: "side by side",
  serverPage: "side by side",
  sessionsPage: "merged, with the node",
  logs: "merged by time",
  clients: "merged",
}

const STORAGE_KEY = "resolvr.panelScopes"

function isStatsPanel(panel: PanelId): panel is StatsPanel {
  return (STATS_PANELS as readonly string[]).includes(panel)
}

function readStored(): Record<string, string> {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, unknown>
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(raw)) if (typeof v === "string") out[k] = v
    return out
  } catch {
    return {}
  }
}

// One scope per panel, remembered in this browser. Only meaningful when the
// connected Technitium server is part of a cluster; a standalone server never
// sends a `node` parameter and shows no scope control.
export const useStatsScopeStore = defineStore("statsScope", () => {
  const connection = useConnectionStore()

  const nodes = ref<ClusterNode[]>([])
  const stored = ref<Record<string, string>>(readStored())
  // "Compare nodes" on the queries-over-time panel: one line per node.
  const compare = ref(false)

  const available = computed(() => connection.clusterInitialized)
  const self = computed(() => connection.serverDomain ?? "")
  const nodeNames = computed(() => {
    const names = nodes.value.map((n) => n.name)
    if (self.value && !names.includes(self.value)) names.unshift(self.value)
    return names
  })

  async function loadNodes(): Promise<void> {
    if (!available.value) {
      nodes.value = []
      return
    }
    try {
      const res = await getClusterState(connection.credentials)
      nodes.value = res.response.clusterNodes ?? []
    } catch {
      // The panels still work against the connected node; only the choice
      // of other nodes is unavailable.
      nodes.value = []
    }
  }

  watch(available, (a) => void (a ? loadNodes() : (nodes.value = [])), { immediate: true })

  function scopeOf(panel: PanelId): string {
    const v = stored.value[panel]
    if (isStatsPanel(panel)) {
      if (v === CLUSTER || (v !== undefined && nodeNames.value.includes(v))) return v
      return CLUSTER
    }
    if (v !== undefined && nodeNames.value.includes(v)) return v
    return self.value
  }

  // The value of Technitium's `node` parameter for a panel, or undefined to
  // let the connected node answer.
  function nodeParam(panel: PanelId): string | undefined {
    if (!available.value) return undefined
    const scope = scopeOf(panel)
    if (scope === CLUSTER) return CLUSTER
    return scope === self.value ? undefined : scope
  }

  function set(panel: PanelId, scope: string): void {
    stored.value = { ...stored.value, [panel]: scope }
    if (panel === "queries") compare.value = false
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stored.value))
    } catch {
      // Storage blocked: the choice just is not remembered.
    }
  }

  function setCompare(on: boolean): void {
    compare.value = on
  }

  // The nodes whose data a panel's scope covers: every reachable node for the
  // whole cluster, one node otherwise. `node` is the value to send as Technitium's
  // `node` parameter (undefined for the connected node), `name` is for display.
  function targets(panel: PanelId): { node: string | undefined; name: string }[] {
    const connected = self.value
    if (!available.value) return [{ node: undefined, name: connected }]
    const toTarget = (name: string) => ({ node: name === connected ? undefined : name, name })
    const scope = scopeOf(panel)
    if (scope !== CLUSTER) return [toTarget(scope)]
    const down = new Set(nodes.value.filter((n) => n.state === "Unreachable").map((n) => n.name))
    return nodeNames.value.filter((n) => !down.has(n)).map(toTarget)
  }

  const reachableCount = computed(() => nodes.value.filter((n) => n.state !== "Unreachable").length)

  function options(panel: PanelId): ScopeOption[] {
    const byName = new Map(nodes.value.map((n) => [n.name, n]))
    const out: ScopeOption[] = []
    if (isStatsPanel(panel)) {
      const total = nodeNames.value.length
      const up = nodes.value.length ? reachableCount.value : total
      out.push({
        id: CLUSTER,
        title: "Whole cluster",
        sub:
          up < total
            ? `${up} of ${total} nodes reachable, totals may be partial`
            : `${total} nodes, ${CLUSTER_MEANING[panel] ?? "combined"}`,
        disabled: false,
      })
    }
    for (const name of nodeNames.value) {
      const n = byName.get(name)
      const unreachable = n?.state === "Unreachable"
      const role = n ? n.type : "This node"
      out.push({
        id: name,
        title: name,
        sub: unreachable ? `${role}, unreachable` : n ? `${role}, connected` : role,
        disabled: unreachable,
      })
    }
    return out
  }

  return { nodes, nodeNames, available, self, compare, scopeOf, nodeParam, targets, set, setCompare, options, loadNodes }
})
