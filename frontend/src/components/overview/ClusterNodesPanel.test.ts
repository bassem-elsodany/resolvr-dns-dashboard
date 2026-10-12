import { describe, it, expect, vi, beforeEach } from "vitest"
import { mount } from "@vue/test-utils"
import { createPinia, setActivePinia } from "pinia"

vi.mock("../../api/technitium", async () => {
  const actual = await vi.importActual<typeof import("../../api/technitium")>("../../api/technitium")
  return { ...actual, getClusterState: vi.fn(), getDashboardStats: vi.fn() }
})

import { getClusterState, getDashboardStats } from "../../api/technitium"
import { useConnectionStore } from "../../stores/connection"
import ClusterNodesPanel from "./ClusterNodesPanel.vue"

function stats(total: number) {
  return { response: { stats: { totalQueries: total }, mainChartData: { labels: [], datasets: [] } } } as never
}
const flush = () => new Promise((r) => setTimeout(r, 0))

describe("ClusterNodesPanel", () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(getClusterState).mockReset()
    vi.mocked(getDashboardStats).mockReset()
    const c = useConnectionStore()
    c.serverDomain = "node1.cluster.test"
    c.clusterInitialized = true
  })

  it("shows each node's role, state, queries and share of traffic", async () => {
    vi.mocked(getClusterState).mockResolvedValue({
      response: {
        clusterInitialized: true,
        clusterNodes: [
          { id: 1, name: "node1.cluster.test", type: "Primary", state: "Self" },
          { id: 2, name: "node2.cluster.test", type: "Secondary", state: "Connected" },
        ],
      },
    })
    vi.mocked(getDashboardStats).mockImplementation(async (_t, _c, opts) =>
      stats(opts?.node === "node2.cluster.test" ? 300 : 700),
    )

    const wrapper = mount(ClusterNodesPanel)
    await flush()

    const text = wrapper.text()
    expect(text).toContain("node1.cluster.test")
    expect(text).toContain("Primary")
    expect(text).toContain("Secondary")
    expect(text).toContain("70%")
    expect(text).toContain("30%")
    expect(text).toContain("Resolvr connects here")
  })

  it("asks the connected node for its own stats without naming it, and the others by name", async () => {
    vi.mocked(getClusterState).mockResolvedValue({
      response: {
        clusterInitialized: true,
        clusterNodes: [
          { id: 1, name: "node1.cluster.test", type: "Primary", state: "Self" },
          { id: 2, name: "node2.cluster.test", type: "Secondary", state: "Connected" },
        ],
      },
    })
    vi.mocked(getDashboardStats).mockResolvedValue(stats(10))

    mount(ClusterNodesPanel)
    await flush()

    const nodes = vi.mocked(getDashboardStats).mock.calls.map((c) => c[2]?.node)
    expect(nodes).toContain(undefined)
    expect(nodes).toContain("node2.cluster.test")
  })

  it("reports an unreachable node instead of dropping it, and warns the totals are partial", async () => {
    vi.mocked(getClusterState).mockResolvedValue({
      response: {
        clusterInitialized: true,
        clusterNodes: [
          { id: 1, name: "node1.cluster.test", type: "Primary", state: "Self" },
          { id: 2, name: "node2.cluster.test", type: "Secondary", state: "Unreachable" },
        ],
      },
    })
    vi.mocked(getDashboardStats).mockResolvedValue(stats(500))

    const wrapper = mount(ClusterNodesPanel)
    await flush()

    expect(wrapper.text()).toContain("Unreachable")
    expect(wrapper.text()).toMatch(/partial/i)
    // The unreachable node is not asked for stats.
    expect(vi.mocked(getDashboardStats).mock.calls.map((c) => c[2]?.node)).not.toContain("node2.cluster.test")
  })

  it("says so when the cluster state cannot be read", async () => {
    vi.mocked(getClusterState).mockRejectedValue(new Error("nope"))

    const wrapper = mount(ClusterNodesPanel)
    await flush()

    expect(wrapper.text()).toContain("Could not read the cluster state")
  })
})
