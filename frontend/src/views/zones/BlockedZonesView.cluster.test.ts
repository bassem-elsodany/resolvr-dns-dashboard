import { describe, it, expect, vi, beforeEach } from "vitest"
import { mount, flushPromises } from "@vue/test-utils"
import { createPinia, setActivePinia } from "pinia"
import { createRouter, createMemoryHistory } from "vue-router"

vi.mock("../../api/technitium", async () => {
  const actual = await vi.importActual<typeof import("../../api/technitium")>("../../api/technitium")
  return {
    ...actual,
    listBlockedZones: vi.fn(),
    exportBlockedZones: vi.fn(),
    getSettings: vi.fn(),
    getDashboardStats: vi.fn(),
    resolveDnsQuery: vi.fn(),
    getClusterState: vi.fn(),
  }
})
vi.mock("../../lib/download", () => ({ triggerDownload: vi.fn() }))
vi.mock("../../api/app", async () => {
  const actual = await vi.importActual<typeof import("../../api/app")>("../../api/app")
  return { ...actual, updateBlockListUrls: vi.fn(), blockDomain: vi.fn(), unblockDomain: vi.fn(), forceUpdateBlockLists: vi.fn() }
})

import { listBlockedZones, getSettings, getDashboardStats, resolveDnsQuery, getClusterState } from "../../api/technitium"
import { updateBlockListUrls, forceUpdateBlockLists } from "../../api/app"
import { clearCache } from "../../lib/charts"
import { useConnectionStore } from "../../stores/connection"
import { useAuthStore } from "../../stores/auth"
import { useStatsScopeStore } from "../../stores/statsScope"
import BlockedZonesView from "./BlockedZonesView.vue"

const NODE1 = "node1.cluster.test"
const NODE2 = "node2.cluster.test"
const HOUR = 3600_000
const NEXT = new Date(Date.now() + 5 * HOUR).toISOString()

// node2 still has the previous feed list and has not got a newer domain yet.
const FEEDS: Record<string, string[]> = {
  [NODE1]: ["# Threat", "https://a.example.com/t.txt", "https://new.example.com/n.txt"],
  [NODE2]: ["# Threat", "https://a.example.com/t.txt"],
}
const ROOT: Record<string, string[]> = { [NODE1]: ["com", "net"], [NODE2]: ["com"] }
const TOTAL: Record<string, number> = { [NODE1]: 1203411, [NODE2]: 1201507 }

async function mountCluster(opts: { scope?: string; path?: string } = {}) {
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
  if (opts.scope) scope.set("blockedPage", opts.scope)
  useAuthStore().user = { id: 1, username: "admin", role: "admin" }
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/blocked", component: BlockedZonesView }, { path: "/logs", component: { template: "<div />" } }],
  })
  await router.push(opts.path ?? "/blocked")
  const wrapper = mount(BlockedZonesView, { global: { plugins: [router] } })
  connection.isConfigured = true
  await flushPromises()
  await new Promise((r) => setTimeout(r, 0))
  await flushPromises()
  return wrapper
}

describe("BlockedZonesView on a cluster", () => {
  beforeEach(() => {
    clearCache()
    localStorage.clear()
    setActivePinia(createPinia())
    vi.mocked(getClusterState).mockReset()
    vi.mocked(getSettings).mockReset().mockImplementation((async (_c: unknown, o?: { node?: string }) => ({
      response: {
        enableBlocking: true,
        blockingType: "NxDomain",
        blockListUrls: FEEDS[o?.node ?? NODE1],
        blockListUpdateIntervalHours: 24,
        blockListNextUpdatedOn: NEXT,
      },
    })) as never)
    vi.mocked(getDashboardStats).mockReset().mockImplementation((async (_t: string, _c: unknown, o?: { node?: string }) => ({
      response: { stats: { blockListZones: TOTAL[o?.node ?? NODE1] } },
    })) as never)
    vi.mocked(listBlockedZones).mockReset().mockImplementation((async (_c: unknown, d = "", o?: { node?: string }) => ({
      response: { domain: d, zones: d === "" ? ROOT[o?.node ?? NODE1]! : [], records: [] },
    })) as never)
    vi.mocked(forceUpdateBlockLists).mockReset().mockResolvedValue({ status: "ok" })
    vi.mocked(updateBlockListUrls).mockReset().mockResolvedValue({ status: "ok" })
    vi.mocked(resolveDnsQuery).mockReset()
  })

  it("shows each node's own count and schedule side by side", async () => {
    const wrapper = await mountCluster()

    const nodes = wrapper.findAll(".block-node")
    expect(nodes).toHaveLength(2)
    expect(nodes[0]!.text()).toContain("node1")
    expect(nodes[0]!.text()).toContain("1,203,411")
    expect(nodes[1]!.text()).toContain("node2")
    expect(nodes[1]!.text()).toContain("1,201,507")
  })

  it("says when a node has a different feed list", async () => {
    const wrapper = await mountCluster()

    expect(wrapper.get("#feeds-sync").text()).toContain("different feed lists")
  })

  it("says the feed lists match when they do", async () => {
    vi.mocked(getSettings).mockImplementation((async () => ({
      response: { enableBlocking: true, blockListUrls: FEEDS[NODE2], blockListUpdateIntervalHours: 24, blockListNextUpdatedOn: NEXT },
    })) as never)
    const wrapper = await mountCluster()

    expect(wrapper.get("#feeds-sync").text()).toContain("Same feed list on every node")
  })

  it("sends Update now to every node by default, and to one when it is chosen", async () => {
    const wrapper = await mountCluster()
    const click = async () => {
      await wrapper.get("#update-now").trigger("click")
      await flushPromises()
    }

    await click()
    const first = vi.mocked(forceUpdateBlockLists).mock.calls.map((c) => c[0])
    expect(first).toContain(undefined)
    expect(first).toContain(NODE2)
  })

  it("asks the chosen node only when a single node is picked for the update", async () => {
    const wrapper = await mountCluster()
    await wrapper.get(`[data-update-on="${NODE2}"]`).trigger("click")

    await wrapper.get("#update-now").trigger("click")
    await flushPromises()

    expect(forceUpdateBlockLists).toHaveBeenCalledTimes(1)
    expect(vi.mocked(forceUpdateBlockLists).mock.calls[0]![0]).toBe(NODE2)
  })

  it("scoped to one node, shows only that node: no strip and no sync banner", async () => {
    const wrapper = await mountCluster({ scope: NODE2 })

    expect(wrapper.find("#block-nodes").exists()).toBe(false)
    expect(wrapper.find("#feeds-sync").exists()).toBe(false)
    expect(vi.mocked(getSettings).mock.calls.every((c) => (c[1] as { node?: string } | undefined)?.node === NODE2)).toBe(true)
  })

  it("saves feeds on the connected node on the whole cluster (Technitium syncs them)", async () => {
    const wrapper = await mountCluster()
    const feeds = wrapper.findComponent({ name: "BlockListFeeds" })
    expect(feeds.exists()).toBe(true)
    feeds.vm.$emit("save", ["https://x.example.com/x.txt"], false)
    await flushPromises()

    expect(updateBlockListUrls).toHaveBeenCalledWith(["https://x.example.com/x.txt"])
  })

  it("checks a domain on every node and shows each node's answer", async () => {
    vi.mocked(resolveDnsQuery).mockImplementation((async (_d: string, _t: string, _c: unknown, o?: { node?: string }) => {
      const blocked = o?.node !== NODE2
      return {
        response: {
          result: {
            Metadata: { ResponseCode: blocked ? "NxDomain" : "NoError" },
            Answer: blocked ? [] : [{ Name: "x.test", Type: "A", RDATA: { IPAddress: "1.2.3.4" } }],
          },
        },
      }
    }) as never)
    const wrapper = await mountCluster({ path: "/blocked?tab=check" })

    await wrapper.get("#check-domain").setValue("x.test")
    await wrapper.findComponent({ name: "DomainChecker" }).get("form").trigger("submit")
    await flushPromises()

    expect(resolveDnsQuery).toHaveBeenCalledTimes(2)
    const nodes = vi.mocked(resolveDnsQuery).mock.calls.map((c) => (c[3] as { node?: string }).node)
    expect(nodes).toContain(NODE2)
    expect(wrapper.get("#check-per-node").text()).toContain("node1")
    expect(wrapper.get("#check-per-node").text()).toContain("node2")
  })
})
