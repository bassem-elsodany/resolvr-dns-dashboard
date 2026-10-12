import { describe, it, expect, vi, beforeEach } from "vitest"
import { mount } from "@vue/test-utils"
import { createPinia, setActivePinia } from "pinia"

vi.mock("../../api/technitium", async () => {
  const actual = await vi.importActual<typeof import("../../api/technitium")>("../../api/technitium")
  return { ...actual, listAllowedZones: vi.fn(), exportAllowedZones: vi.fn(), getClusterState: vi.fn() }
})
vi.mock("../../lib/download", () => ({ triggerDownload: vi.fn() }))

import { listAllowedZones, getClusterState } from "../../api/technitium"
import { useConnectionStore } from "../../stores/connection"
import { useStatsScopeStore } from "../../stores/statsScope"
import AllowedZonesView from "./AllowedZonesView.vue"

const NODE1 = "node1.cluster.test"
const NODE2 = "node2.cluster.test"
const flush = () => new Promise((r) => setTimeout(r, 0))

const LISTS: Record<string, string[]> = { [NODE1]: ["a.test", "b.test", "new.test"], [NODE2]: ["a.test", "b.test"] }

async function mountCluster(scopeNode?: string) {
  const connection = useConnectionStore()
  connection.serverDomain = NODE1
  connection.clusterInitialized = true
  vi.mocked(getClusterState).mockResolvedValue({
    response: {
      clusterInitialized: true,
      clusterNodes: [
        { id: 1, name: NODE1, type: "Primary", state: "Self" },
        { id: 2, name: NODE2, type: "Secondary", state: "Connected" },
      ],
    },
  })
  const scope = useStatsScopeStore()
  await vi.waitFor(() => expect(scope.nodes.length).toBe(2))
  if (scopeNode) scope.set("allowedPage", scopeNode)
  const wrapper = mount(AllowedZonesView, { global: { stubs: { RouterLink: true } } })
  connection.isConfigured = true
  await flush()
  await flush()
  return wrapper
}

describe("AllowedZonesView on a cluster", () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    vi.mocked(getClusterState).mockReset()
    vi.mocked(listAllowedZones).mockReset().mockImplementation((async (_c: unknown, _d: string, o?: { node?: string }) => ({
      response: { domain: "", zones: LISTS[o?.node ?? NODE1], records: [] },
    })) as never)
  })

  it("says which domains have not reached a node yet", async () => {
    const wrapper = await mountCluster()

    expect(wrapper.get("#allowed-sync").text()).toContain("Not in sync yet")
    const row = wrapper.findAll("tbody tr").find((r) => r.text().includes("new.test"))!
    expect(row.findAll(".presence-cell").map((c) => c.text())).toEqual(["present", "not yet"])
  })

  it("filters to the domains missing on a node", async () => {
    const wrapper = await mountCluster()

    await wrapper.get('[data-presence="missing"]').trigger("click")

    expect(wrapper.findAll("tbody tr")).toHaveLength(1)
    expect(wrapper.text()).toContain("new.test")
  })

  it("reports in sync when every node holds the same list", async () => {
    vi.mocked(listAllowedZones).mockImplementation((async () => ({ response: { domain: "", zones: ["a.test"], records: [] } })) as never)
    const wrapper = await mountCluster()

    expect(wrapper.get("#allowed-sync").text()).toContain("In sync")
  })

  it("scoped to one node it shows that node's list with no sync strip", async () => {
    const wrapper = await mountCluster(NODE2)

    expect(wrapper.find("#allowed-sync").exists()).toBe(false)
    expect(wrapper.text()).not.toContain("new.test")
    expect(wrapper.text()).toContain("a.test")
  })
})
