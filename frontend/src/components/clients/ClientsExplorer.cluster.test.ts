import { describe, it, expect, vi, beforeEach } from "vitest"
import { mount, flushPromises } from "@vue/test-utils"
import { createPinia, setActivePinia } from "pinia"
import { createRouter, createMemoryHistory } from "vue-router"

vi.mock("../../api/technitium", async () => {
  const actual = await vi.importActual<typeof import("../../api/technitium")>("../../api/technitium")
  return {
    ...actual,
    getTopStats: vi.fn(),
    queryLogs: vi.fn(),
    listDhcpLeases: vi.fn(),
    listApps: vi.fn(),
    getClusterState: vi.fn(),
  }
})

import { getTopStats, queryLogs, listDhcpLeases, listApps, getClusterState, type QueryLogEntry } from "../../api/technitium"
import { useConnectionStore } from "../../stores/connection"
import { useStatsScopeStore } from "../../stores/statsScope"
import { clearCache } from "../../lib/charts"
import { resetKnownForTests } from "../../lib/clients"
import ClientsExplorer from "./ClientsExplorer.vue"

const NODE1 = "node1.cluster.test"
const NODE2 = "node2.cluster.test"
const NOW = Date.now()
const ago = (min: number) => new Date(NOW - min * 60000).toISOString()

const stats = {
  totalQueries: 1000, totalNoError: 900, totalServerFailure: 0, totalNxDomain: 50, totalRefused: 0, totalAuthoritative: 10,
  totalRecursive: 400, totalCached: 500, totalBlocked: 200, totalDropped: 0, totalClients: 3, zones: 1, cachedEntries: 1,
  allowedZones: 0, blockedZones: 0, allowListZones: 0, blockListZones: 0,
}

// ip -> [queries on node1, queries on node2]
const PER_NODE: Record<string, [number, number]> = {
  "10.0.0.1": [300, 200], // uses both nodes
  "10.0.0.2": [120, 0], // pinned to node1
}

function entry(ip: string, i: number): QueryLogEntry {
  return { rowNumber: i, timestamp: ago(i), clientIpAddress: ip, protocol: "Udp", responseType: "Cached", rcode: "NoError", qname: "a.example.com", qtype: "A", qclass: "IN", answer: null }
}

function mockApis() {
  vi.mocked(listApps).mockResolvedValue({
    response: { apps: [{ name: "Query Logs (Sqlite)", description: "", version: "1", updateAvailable: false, dnsApps: [{ classPath: "Q.App", isQueryLogger: true }] }] },
  })
  vi.mocked(getTopStats).mockResolvedValue({
    response: {
      topClients: [
        { name: "10.0.0.1", domain: "media.lan", hits: 500, rateLimited: false },
        { name: "10.0.0.2", domain: "pinned.lan", hits: 120, rateLimited: false },
      ],
    },
  })
  vi.mocked(listDhcpLeases).mockImplementation((async (_c: unknown, opts?: { node?: string }) => ({
    response: {
      leases:
        opts?.node === NODE2
          ? [{ scope: "IoT", hardwareAddress: "aa:bb:cc:00:00:02", address: "10.0.0.1", hostName: null, leaseObtained: "", leaseExpires: "" }]
          : [],
    },
  })) as never)
  vi.mocked(queryLogs).mockImplementation((async (_c: unknown, _a: unknown, f: Record<string, unknown>) => {
    const ip = String(f.clientIpAddress)
    const [n1, n2] = PER_NODE[ip] ?? [0, 0]
    const total = f.node === NODE2 ? n2 : n1
    if (f.entriesPerPage === 1) {
      return { response: { pageNumber: 1, totalPages: 1, totalEntries: f.responseType === "Blocked" ? 0 : total, entries: total ? [entry(ip, 1)] : [] } }
    }
    const entries = total ? [entry(ip, f.node === NODE2 ? 2 : 1), entry(ip, f.node === NODE2 ? 4 : 3)] : []
    return { response: { pageNumber: 1, totalPages: 1, totalEntries: entries.length, entries } }
  }) as never)
}

async function mountClustered(scopeNode?: string) {
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
  if (scopeNode) scope.set("clients", scopeNode)
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/", component: { template: "<div />" } }, { path: "/logs", component: { template: "<div />" } }] })
  await router.push("/")
  const wrapper = mount(ClientsExplorer, {
    props: { stats, prevStats: null, duration: "LastDay", logEntries: [], logState: "ready" },
    global: { plugins: [router] },
  })
  connection.isConfigured = true
  await flushPromises()
  await new Promise((r) => setTimeout(r, 0))
  await flushPromises()
  return wrapper
}

describe("ClientsExplorer on a cluster", () => {
  beforeEach(() => {
    clearCache()
    localStorage.clear()
    resetKnownForTests()
    setActivePinia(createPinia())
    vi.mocked(getTopStats).mockReset()
    vi.mocked(queryLogs).mockReset()
    vi.mocked(listDhcpLeases).mockReset()
    vi.mocked(listApps).mockReset()
    vi.mocked(getClusterState).mockReset()
    mockApis()
  })

  it("adds up a client's queries over both nodes", async () => {
    const wrapper = await mountClustered()

    const rows = wrapper.findAll(".client-row")
    expect(rows[0]!.text()).toContain("media.lan")
    expect(rows[0]!.text()).toContain("500") // 300 + 200
    expect(getTopStats).toHaveBeenCalledWith("TopClients", "LastDay", expect.anything(), expect.objectContaining({ node: "cluster" }))
  })

  it("shows how each client's queries were shared between the nodes", async () => {
    const wrapper = await mountClustered()

    const rows = wrapper.findAll(".client-row")
    expect(rows[0]!.get(".client-split").attributes("aria-label")).toBe(`${NODE1} 60% / ${NODE2} 40%`)
  })

  it("offers a One node only filter that finds clients not using the second node", async () => {
    const wrapper = await mountClustered()

    const chip = wrapper.get('[data-filter="single"]')
    expect(chip.text()).toContain("One node only")
    expect(chip.text()).toContain("1")
    await chip.trigger("click")

    const rows = wrapper.findAll(".client-row")
    expect(rows).toHaveLength(1)
    expect(rows[0]!.text()).toContain("pinned.lan")
  })

  it("answered-by names the node, and the latest queries say which node answered", async () => {
    const wrapper = await mountClustered()

    const answered = wrapper.get("#client-answered-by").text()
    expect(answered).toContain("node1")
    expect(answered).toContain("node2")
    expect(answered).toContain("Both nodes answer this device")
    expect(wrapper.findAll(".recent-node").length).toBeGreaterThan(0)
    expect(wrapper.get("#recent-queries").text()).toMatch(/node1/)
    expect(wrapper.get("#recent-queries").text()).toMatch(/node2/)
  })

  it("says so when a client only ever used one node", async () => {
    const wrapper = await mountClustered()
    await wrapper.get('[data-ip="10.0.0.2"]').trigger("click")
    await flushPromises()

    expect(wrapper.get("#client-answered-by").text()).toContain("Only node1 answers this device")
  })

  it("labels the DHCP lease with the node that issued it", async () => {
    const wrapper = await mountClustered()

    expect(wrapper.get("#client-detail").text()).toContain("from node2")
  })

  it("scoped to one node, shows only that node's counts and no split", async () => {
    const wrapper = await mountClustered(NODE2)

    const rows = wrapper.findAll(".client-row")
    expect(rows[0]!.text()).toContain("200")
    expect(wrapper.find(".client-split").exists()).toBe(false)
    expect(wrapper.find('[data-filter="single"]').exists()).toBe(false)
    expect(wrapper.find("#client-answered-by").exists()).toBe(false)
    expect(vi.mocked(getTopStats).mock.calls[0]![3]).toMatchObject({ node: NODE2 })
  })
})
