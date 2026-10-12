import { describe, it, expect, vi, beforeEach } from "vitest"
import { createPinia, setActivePinia } from "pinia"
import { nextTick } from "vue"

vi.mock("../api/technitium", async () => {
  const actual = await vi.importActual<typeof import("../api/technitium")>("../api/technitium")
  return { ...actual, getClusterState: vi.fn() }
})

import { getClusterState } from "../api/technitium"
import { useConnectionStore } from "./connection"
import { useStatsScopeStore, CLUSTER } from "./statsScope"

const NODES = [
  { id: 1, name: "node1.cluster.test", type: "Primary", state: "Self" },
  { id: 2, name: "node2.cluster.test", type: "Secondary", state: "Connected" },
]

async function clustered() {
  vi.mocked(getClusterState).mockResolvedValue({
    response: { clusterInitialized: true, clusterDomain: "cluster.test", clusterNodes: NODES },
  })
  const connection = useConnectionStore()
  connection.serverDomain = "node1.cluster.test"
  connection.clusterInitialized = true
  const scope = useStatsScopeStore()
  await nextTick()
  await vi.waitFor(() => expect(scope.nodes.length).toBe(2))
  return scope
}

describe("stats scope store (one scope per panel)", () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    vi.mocked(getClusterState).mockReset()
  })

  it("is inactive, and sends no node, for a standalone server", () => {
    const scope = useStatsScopeStore()

    expect(scope.available).toBe(false)
    expect(scope.nodeParam("queries")).toBeUndefined()
    expect(scope.nodeParam("dhcp")).toBeUndefined()
  })

  it("defaults statistics panels to the whole cluster and per-node panels to the connected node", async () => {
    const scope = await clustered()

    expect(scope.scopeOf("queries")).toBe(CLUSTER)
    expect(scope.nodeParam("queries")).toBe(CLUSTER)
    expect(scope.scopeOf("dhcp")).toBe("node1.cluster.test")
    // The connected node answers when no node is named.
    expect(scope.nodeParam("dhcp")).toBeUndefined()
  })

  it("keeps a separate choice for each panel", async () => {
    const scope = await clustered()

    scope.set("topClients", "node2.cluster.test")

    expect(scope.nodeParam("topClients")).toBe("node2.cluster.test")
    expect(scope.nodeParam("topDomains")).toBe(CLUSTER)
    expect(scope.nodeParam("queries")).toBe(CLUSTER)
  })

  it("never offers the whole cluster to a panel whose data Technitium keeps per node", async () => {
    const scope = await clustered()

    expect(scope.options("queries").map((o) => o.id)).toEqual([CLUSTER, "node1.cluster.test", "node2.cluster.test"])
    expect(scope.options("flow").map((o) => o.id)).toEqual(["node1.cluster.test", "node2.cluster.test"])
  })

  it("falls back to the default when a stored choice no longer exists", async () => {
    localStorage.setItem("resolvr.panelScopes", JSON.stringify({ queries: "node9.gone.test", dhcp: CLUSTER }))
    const scope = await clustered()

    expect(scope.scopeOf("queries")).toBe(CLUSTER)
    expect(scope.scopeOf("dhcp")).toBe("node1.cluster.test")
  })

  it("remembers each panel's choice in this browser", async () => {
    const scope = await clustered()
    scope.set("queries", "node2.cluster.test")

    expect(JSON.parse(localStorage.getItem("resolvr.panelScopes") ?? "{}")).toMatchObject({ queries: "node2.cluster.test" })

    setActivePinia(createPinia())
    const again = await clustered()
    expect(again.scopeOf("queries")).toBe("node2.cluster.test")
  })

  it("does not offer a node that is unreachable", async () => {
    vi.mocked(getClusterState).mockResolvedValue({
      response: {
        clusterInitialized: true,
        clusterNodes: [NODES[0]!, { id: 2, name: "node2.cluster.test", type: "Secondary", state: "Unreachable" }],
      },
    })
    const connection = useConnectionStore()
    connection.serverDomain = "node1.cluster.test"
    connection.clusterInitialized = true
    const scope = useStatsScopeStore()
    await vi.waitFor(() => expect(scope.nodes.length).toBe(2))

    const node2 = scope.options("queries").find((o) => o.id === "node2.cluster.test")
    expect(node2?.disabled).toBe(true)
    expect(scope.options("queries").find((o) => o.id === CLUSTER)?.sub).toMatch(/1 of 2/)
  })

  it("keeps the compare-nodes view off until asked, and only for the queries panel", async () => {
    const scope = await clustered()

    expect(scope.compare).toBe(false)
    scope.setCompare(true)
    expect(scope.compare).toBe(true)
    // Choosing a scope for the queries panel leaves compare mode.
    scope.set("queries", "node2.cluster.test")
    expect(scope.compare).toBe(false)
  })
})
