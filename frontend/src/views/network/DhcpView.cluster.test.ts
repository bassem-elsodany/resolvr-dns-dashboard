import { describe, it, expect, vi, beforeEach } from "vitest"
import { mount } from "@vue/test-utils"
import { createPinia, setActivePinia } from "pinia"

vi.mock("../../api/technitium", async () => {
  const actual = await vi.importActual<typeof import("../../api/technitium")>("../../api/technitium")
  return { ...actual, listDhcpScopes: vi.fn(), listDhcpLeases: vi.fn(), getClusterState: vi.fn() }
})

import { listDhcpScopes, listDhcpLeases, getClusterState } from "../../api/technitium"
import { useConnectionStore } from "../../stores/connection"
import { useStatsScopeStore } from "../../stores/statsScope"
import DhcpView from "./DhcpView.vue"

const NODE1 = "node1.cluster.test"
const NODE2 = "node2.cluster.test"
const flush = () => new Promise((r) => setTimeout(r, 0))
const scope = (name: string, s: string, e: string) => ({ name, enabled: true, startingAddress: s, endingAddress: e, subnetMask: "255.255.255.0" })
const lease = (address: string, mac: string, scopeName: string) => ({ scope: scopeName, hardwareAddress: mac, address, hostName: null, leaseObtained: "", leaseExpires: "2026-10-13T00:00:00Z" })

let SCOPES: Record<string, ReturnType<typeof scope>[]>
let LEASES: Record<string, ReturnType<typeof lease>[]>

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
  const s = useStatsScopeStore()
  await vi.waitFor(() => expect(s.nodes.length).toBe(2))
  if (scopeNode) s.set("dhcpPage", scopeNode)
  const wrapper = mount(DhcpView, { global: { stubs: { RouterLink: true } } })
  connection.isConfigured = true
  await flush()
  await flush()
  return wrapper
}

describe("DhcpView on a cluster", () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    SCOPES = { [NODE1]: [scope("LAN", "10.0.10.10", "10.0.10.200")], [NODE2]: [scope("IoT", "10.0.30.10", "10.0.30.100")] }
    LEASES = { [NODE1]: [lease("10.0.10.20", "aa:00", "LAN")], [NODE2]: [lease("10.0.30.20", "bb:00", "IoT")] }
    vi.mocked(getClusterState).mockReset()
    vi.mocked(listDhcpScopes).mockReset().mockImplementation((async (_c: unknown, o?: { node?: string }) => ({ response: { scopes: SCOPES[o?.node ?? NODE1] } })) as never)
    vi.mocked(listDhcpLeases).mockReset().mockImplementation((async (_c: unknown, o?: { node?: string }) => ({ response: { leases: LEASES[o?.node ?? NODE1] } })) as never)
  })

  it("merges both nodes' scopes and leases and says which node each is on", async () => {
    const wrapper = await mountCluster()

    expect(wrapper.text()).toContain("10.0.10.20")
    expect(wrapper.text()).toContain("10.0.30.20")
    const nodes = wrapper.findAll(".dhcp-node").map((n) => n.text())
    expect(nodes.filter((n) => n === "node1")).toHaveLength(2) // one scope + one lease
    expect(nodes.filter((n) => n === "node2")).toHaveLength(2)
  })

  it("keeps two leases with the same hardware address apart when they are on different nodes", async () => {
    LEASES = { [NODE1]: [lease("10.0.10.20", "aa:00", "LAN")], [NODE2]: [lease("10.0.30.20", "aa:00", "IoT")] }
    const wrapper = await mountCluster()

    expect(wrapper.text()).toContain("10.0.10.20")
    expect(wrapper.text()).toContain("10.0.30.20")
  })

  it("warns when the same scope range is defined on more than one node", async () => {
    SCOPES = { [NODE1]: [scope("LAN", "10.0.10.10", "10.0.10.200")], [NODE2]: [scope("LAN", "10.0.10.10", "10.0.10.200")] }
    const wrapper = await mountCluster()

    expect(wrapper.get("#dhcp-shared").text()).toContain("LAN")
  })

  it("scoped to one node it looks like the plain page", async () => {
    const wrapper = await mountCluster(NODE2)

    expect(wrapper.find(".dhcp-node").exists()).toBe(false)
    expect(wrapper.text()).toContain("10.0.30.20")
    expect(wrapper.text()).not.toContain("10.0.10.20")
  })
})
