import { describe, it, expect, vi, beforeEach } from "vitest"
import { mount } from "@vue/test-utils"
import { createPinia, setActivePinia } from "pinia"

vi.mock("../../api/technitium", async () => {
  const actual = await vi.importActual<typeof import("../../api/technitium")>("../../api/technitium")
  return { ...actual, getSettings: vi.fn(), getClusterState: vi.fn(), checkForUpdate: vi.fn() }
})

import { getSettings, getClusterState } from "../../api/technitium"
import { useConnectionStore } from "../../stores/connection"
import { useStatsScopeStore } from "../../stores/statsScope"
import ServerInfoView from "./ServerInfoView.vue"

const NODE1 = "node1.cluster.test"
const NODE2 = "node2.cluster.test"
const flush = () => new Promise((r) => setTimeout(r, 0))

const settings = (domain: string, over: Record<string, unknown> = {}) => ({
  response: {
    version: "15.6.1",
    dnsServerDomain: domain,
    uptimestamp: "2026-10-12T05:00:00Z",
    dnsServerLocalEndPoints: ["0.0.0.0:53"],
    ipv6Mode: "Enabled",
    dnssecValidation: true,
    eDnsClientSubnet: false,
    udpPayloadSize: 1232,
    qpmPrefixLimitsIPv4: [],
    qpmLimitSampleMinutes: 5,
    defaultRecordTtl: 3600,
    defaultNsRecordTtl: 3600,
    defaultSoaRecordTtl: 900,
    ...over,
  },
}) as never

let BY_NODE: Record<string, unknown>

async function mountCluster(scopeNode?: string) {
  const connection = useConnectionStore()
  connection.serverDomain = NODE1
  connection.clusterInitialized = true
  vi.mocked(getClusterState).mockResolvedValue({
    response: {
      clusterInitialized: true,
      clusterDomain: "cluster.test",
      clusterNodes: [
        { id: 1, name: NODE1, type: "Primary", state: "Self", version: "15.6.1" },
        { id: 2, name: NODE2, type: "Secondary", state: "Connected", version: "15.6.1" },
      ],
    },
  })
  const s = useStatsScopeStore()
  await vi.waitFor(() => expect(s.nodes.length).toBe(2))
  if (scopeNode) s.set("serverPage", scopeNode)
  const wrapper = mount(ServerInfoView, { global: { stubs: { RouterLink: true } } })
  connection.isConfigured = true
  await flush()
  await flush()
  return wrapper
}

describe("ServerInfoView on a cluster", () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    vi.mocked(getClusterState).mockReset()
    BY_NODE = { [NODE1]: settings(NODE1), [NODE2]: settings(NODE2) }
    vi.mocked(getSettings).mockReset().mockImplementation((async (_c: unknown, o?: { node?: string }) => BY_NODE[o?.node ?? NODE1]) as never)
  })

  it("shows the cluster and each node's role and state", async () => {
    const wrapper = await mountCluster()

    const card = wrapper.get("#cluster-card").text()
    expect(card).toContain("cluster.test")
    expect(card).toContain("Primary")
    expect(card).toContain("Secondary")
    expect(wrapper.findAll(".cluster-node")).toHaveLength(2)
  })

  it("says every setting matches when the nodes are configured alike", async () => {
    const wrapper = await mountCluster()

    expect(wrapper.get("#settings-differences").text()).toContain("Every setting matches")
  })

  it("names how many settings differ and can show only those", async () => {
    BY_NODE[NODE2] = settings(NODE2, { dnssecValidation: false, udpPayloadSize: 4096 })
    const wrapper = await mountCluster()

    expect(wrapper.get("#settings-differences").text()).toContain("2 settings differ")
    const all = wrapper.findAll(".setting-row").length
    await wrapper.get("#only-differences").setValue(true)
    const only = wrapper.findAll(".setting-row")
    expect(only.length).toBeLessThan(all)
    expect(only).toHaveLength(2)
  })

  it("scoped to one node it shows that node's plain cards", async () => {
    const wrapper = await mountCluster(NODE2)

    expect(wrapper.find("#cluster-card").exists()).toBe(false)
    expect(wrapper.text()).toContain(NODE2)
    expect(wrapper.text()).toContain("Identity")
  })
})
