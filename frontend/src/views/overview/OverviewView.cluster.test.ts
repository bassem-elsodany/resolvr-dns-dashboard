import { describe, it, expect, vi, beforeEach } from "vitest"
import { mount, type VueWrapper } from "@vue/test-utils"
import { createPinia, setActivePinia } from "pinia"
import { createRouter, createMemoryHistory } from "vue-router"

vi.mock("../../api/technitium", async () => {
  const actual = await vi.importActual<typeof import("../../api/technitium")>("../../api/technitium")
  const unavailable = () => vi.fn().mockRejectedValue(new Error("not mocked"))
  return {
    ...actual,
    getDashboardStats: vi.fn(),
    getTopStats: vi.fn(),
    getSettings: vi.fn(),
    getClusterState: vi.fn(),
    queryLogs: unavailable(),
    listApps: unavailable(),
    listDhcpScopes: unavailable(),
    listDhcpLeases: unavailable(),
    listZones: unavailable(),
  }
})

import { getDashboardStats, getTopStats, getSettings, getClusterState } from "../../api/technitium"
import { useConnectionStore } from "../../stores/connection"
import { clearCache } from "../../lib/charts"
import OverviewView from "./OverviewView.vue"

const NODE1 = "node1.cluster.test"
const NODE2 = "node2.cluster.test"

// Each scope answers with its own numbers, so a panel showing the wrong
// scope is visible in the test.
function statsFor(node: string | undefined) {
  const label = node ?? "self"
  const total = { cluster: 1500, [NODE2]: 600, self: 900 }[label] ?? 1
  return {
    response: {
      stats: {
        totalQueries: total, totalNoError: total, totalServerFailure: 0, totalNxDomain: 0, totalRefused: 0,
        totalAuthoritative: 0, totalRecursive: 0, totalCached: total, totalBlocked: 0, totalDropped: 0,
        totalClients: 1, zones: 1, cachedEntries: 10, allowedZones: 0, blockedZones: 0, allowListZones: 0, blockListZones: 0,
      },
      mainChartData: { labelFormat: "HH:mm", labels: ["10:00", "11:00"], datasets: [{ label: "Total", data: [1, total] }] },
      queryTypeChartData: { labels: ["A"], datasets: [{ data: [total] }] },
      topClients: [{ name: `client-of-${label}`, hits: total, rateLimited: false }],
      topDomains: [{ name: `domain-of-${label}`, hits: total }],
      topBlockedDomains: [{ name: `blocked-of-${label}`, hits: total }],
    },
  } as never
}

function makeRouter() {
  return createRouter({ history: createMemoryHistory(), routes: [{ path: "/", component: OverviewView }, { path: "/logs", component: { template: "<div/>" } }] })
}

async function mountOverview(clustered: boolean): Promise<VueWrapper> {
  const router = makeRouter()
  const wrapper = mount(OverviewView, { global: { plugins: [router] } })
  await router.isReady()
  const connection = useConnectionStore()
  connection.serverDomain = NODE1
  connection.clusterInitialized = clustered
  connection.isConfigured = true
  await vi.waitFor(() => expect(getDashboardStats).toHaveBeenCalled())
  await new Promise((r) => setTimeout(r, 0))
  return wrapper
}

const nodesRequested = () => vi.mocked(getDashboardStats).mock.calls.map((c) => c[2]?.node)
const settle = () => new Promise((r) => setTimeout(r, 20))

describe("OverviewView on a Technitium cluster", () => {
  beforeEach(() => {
    clearCache()
    localStorage.clear()
    setActivePinia(createPinia())
    vi.mocked(getDashboardStats).mockReset().mockImplementation(async (_t, _c, opts) => statsFor(opts?.node))
    vi.mocked(getTopStats).mockReset().mockResolvedValue({ response: {} })
    vi.mocked(getSettings).mockReset().mockResolvedValue({ response: {} as never })
    vi.mocked(getClusterState).mockReset().mockResolvedValue({
      response: {
        clusterInitialized: true,
        clusterNodes: [
          { id: 1, name: NODE1, type: "Primary", state: "Self" },
          { id: 2, name: NODE2, type: "Secondary", state: "Connected" },
        ],
      },
    })
  })

  it("is unchanged for a standalone server: no scope chips, one plain stats request", async () => {
    const wrapper = await mountOverview(false)

    expect(wrapper.find("#scope-chip-tiles").exists()).toBe(false)
    expect(wrapper.find("#scope-chip-queries").exists()).toBe(false)
    expect(new Set(nodesRequested())).toEqual(new Set([undefined]))
  })

  it("asks for whole-cluster statistics by default and shows a chip on each panel", async () => {
    const wrapper = await mountOverview(true)
    await settle()

    expect(nodesRequested()).toContain("cluster")
    expect(wrapper.find("#scope-chip-tiles").exists()).toBe(true)
    expect(wrapper.find("#scope-chip-queries").exists()).toBe(true)
    expect(wrapper.find("#scope-chip-types").exists()).toBe(true)
    expect(wrapper.get("#scope-chip-queries").text()).toContain("Whole cluster")
  })

  it("choosing a node for one panel requests that node's statistics", async () => {
    const wrapper = await mountOverview(true)
    await settle()
    vi.mocked(getDashboardStats).mockClear()

    await wrapper.get("#scope-chip-queries").trigger("click")
    await wrapper.get(`#scope-option-queries-${NODE2.replace(/\./g, "\\.")}`).trigger("click")
    await settle()

    expect(nodesRequested()).toContain(NODE2)
    // The tiles keep the whole cluster.
    expect(nodesRequested()).toContain("cluster")
    expect(wrapper.get("#scope-chip-queries").text()).toContain(NODE2)
    expect(wrapper.get("#scope-chip-tiles").text()).toContain("Whole cluster")
  })

  it("compare nodes asks for every node and draws one line per node", async () => {
    const wrapper = await mountOverview(true)
    await settle()
    vi.mocked(getDashboardStats).mockClear()

    await wrapper.get("#scope-chip-queries").trigger("click")
    await wrapper.get("#scope-compare").trigger("click")
    await settle()

    expect(nodesRequested()).toContain(NODE2)
    expect(nodesRequested()).toContain(undefined)
    expect(wrapper.findAll("polyline.compare-line")).toHaveLength(2)
  })

  it("top lists each follow their own scope", async () => {
    const wrapper = await mountOverview(true)
    await settle()
    await wrapper.get("#overview-tab-top").trigger("click")
    await settle()

    await wrapper.get("#scope-chip-topClients").trigger("click")
    await wrapper.get(`#scope-option-topClients-${NODE2.replace(/\./g, "\\.")}`).trigger("click")
    await settle()

    const text = wrapper.text()
    expect(text).toContain(`client-of-${NODE2}`)
    expect(text).toContain("domain-of-cluster")
    expect(text).toContain("blocked-of-cluster")
  })
})
