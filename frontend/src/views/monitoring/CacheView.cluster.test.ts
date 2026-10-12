import { describe, it, expect, vi, beforeEach } from "vitest"
import { mount } from "@vue/test-utils"
import { createPinia, setActivePinia } from "pinia"
import { createRouter, createMemoryHistory } from "vue-router"

vi.mock("../../api/technitium", async () => {
  const actual = await vi.importActual<typeof import("../../api/technitium")>("../../api/technitium")
  return { ...actual, listCache: vi.fn(), getDashboardStats: vi.fn(), getClusterState: vi.fn() }
})
vi.mock("../../api/app", async () => {
  const actual = await vi.importActual<typeof import("../../api/app")>("../../api/app")
  return { ...actual, flushCache: vi.fn() }
})

import { listCache, getDashboardStats, getClusterState } from "../../api/technitium"
import { flushCache } from "../../api/app"
import { useConnectionStore } from "../../stores/connection"
import { useAuthStore } from "../../stores/auth"
import { useStatsScopeStore } from "../../stores/statsScope"
import CacheView from "./CacheView.vue"

const NODE1 = "node1.cluster.test"
const NODE2 = "node2.cluster.test"
const flush = () => new Promise((r) => setTimeout(r, 0))

const rec = (name: string, type: string, ttl: string, ip: string) => ({ name, type, ttl, rData: { ipAddress: ip } })

// node1 and node2 cache different things (and a different time left).
const CACHE: Record<string, { zones: string[]; records: ReturnType<typeof rec>[] }> = {
  [NODE1]: { zones: ["com", "net"], records: [rec("shared.test", "A", "300 (5 mins)", "1.1.1.1"), rec("only1.test", "A", "60 (1 min)", "2.2.2.2")] },
  [NODE2]: { zones: ["com", "org"], records: [rec("shared.test", "A", "120 (2 mins)", "1.1.1.1")] },
}

async function mountCluster(opts: { scope?: string; states?: [string, string] } = {}) {
  const connection = useConnectionStore()
  connection.serverDomain = NODE1
  connection.clusterInitialized = true
  vi.mocked(getClusterState).mockResolvedValue({
    response: {
      clusterInitialized: true,
      clusterNodes: [
        { id: 1, name: NODE1, type: "Primary", state: opts.states?.[0] ?? "Self" },
        { id: 2, name: NODE2, type: "Secondary", state: opts.states?.[1] ?? "Connected" },
      ],
    },
  })
  const scope = useStatsScopeStore()
  await vi.waitFor(() => expect(scope.nodes.length).toBe(2))
  if (opts.scope) scope.set("cachePage", opts.scope)
  useAuthStore().user = { id: 1, username: "admin", role: "admin" }
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/", component: CacheView }] })
  await router.push("/")
  const wrapper = mount(CacheView, { global: { plugins: [router] } })
  connection.isConfigured = true
  await flush()
  return wrapper
}

async function browse(wrapper: Awaited<ReturnType<typeof mountCluster>>) {
  await wrapper.get("#cache-domain").setValue("")
  await wrapper.get("form").trigger("submit")
  await flush()
  await flush()
}

describe("CacheView on a cluster", () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    vi.mocked(listCache).mockReset().mockImplementation((async (_d: string, _c: unknown, o?: { node?: string }) => {
      const c = CACHE[o?.node ?? NODE1]!
      return { response: { domain: "", zones: c.zones, records: c.records } }
    }) as never)
    vi.mocked(getDashboardStats).mockReset().mockImplementation((async (_t: string, _c: unknown, o?: { node?: string }) => ({
      response: { stats: { cachedEntries: o?.node === NODE2 ? 9214 : 12480 } },
    })) as never)
    vi.mocked(flushCache).mockReset().mockResolvedValue({ status: "ok" })
    vi.mocked(getClusterState).mockReset()
  })

  it("lays both nodes' caches side by side, with each node's time left and 'not cached' where it is missing", async () => {
    const wrapper = await mountCluster()
    await browse(wrapper)

    const rows = wrapper.findAll(".cache-row")
    expect(rows).toHaveLength(2)
    const shared = rows.find((r) => r.text().includes("shared.test"))!
    expect(shared.findAll(".ttl-cell").map((c) => c.text())).toEqual(["300 (5 mins)", "120 (2 mins)"])
    const only1 = rows.find((r) => r.text().includes("only1.test"))!
    expect(only1.findAll(".ttl-cell").map((c) => c.text())).toEqual(["60 (1 min)", "not cached"])
  })

  it("shows the subdomains of both nodes, marking which node holds each", async () => {
    const wrapper = await mountCluster()
    await browse(wrapper)

    const names = wrapper.findAll(".cache-zone-chip").map((c) => c.text())
    expect(names).toEqual(["com", "net", "org"])
    const net = wrapper.findAll(".cache-zone-chip").find((c) => c.text() === "net")!
    expect(net.get("[title]").attributes("title")).toBe("cached on node1")
  })

  it("filters to records held on some nodes only", async () => {
    const wrapper = await mountCluster()
    await browse(wrapper)

    await wrapper.get('[data-presence="one"]').trigger("click")

    const rows = wrapper.findAll(".cache-row")
    expect(rows).toHaveLength(1)
    expect(rows[0]!.text()).toContain("only1.test")
  })

  it("shows how many entries each node holds", async () => {
    const wrapper = await mountCluster()

    const held = wrapper.get("#cache-held").text()
    expect(held).toContain("12,480")
    expect(held).toContain("9,214")
  })

  it("scoped to one node it looks like the plain page: that node's cache, one TTL column", async () => {
    const wrapper = await mountCluster({ scope: NODE2 })
    await browse(wrapper)

    expect(wrapper.find("#cache-held").exists()).toBe(false)
    expect(wrapper.findAll(".ttl-cell")).toHaveLength(0)
    const text = wrapper.text()
    expect(text).toContain("TTL remaining")
    expect(text).toContain("120 (2 mins)")
    expect(text).not.toContain("only1.test")
    expect(vi.mocked(listCache).mock.calls.every((c) => (c[2] as { node?: string } | undefined)?.node === NODE2)).toBe(true)
  })

  it("flushes every node when 'Every node' is confirmed", async () => {
    const wrapper = await mountCluster()

    await wrapper.get("#flush-cache").trigger("click")
    expect(wrapper.get("#flush-choice").text()).toContain("Clear the cache on")
    await wrapper.get("#confirm-flush-cache").trigger("click")
    await flush()

    expect(flushCache).toHaveBeenCalledTimes(2)
    const args = vi.mocked(flushCache).mock.calls.map((c) => c[0])
    expect(args).toContain(undefined)
    expect(args).toContain(NODE2)
    expect(wrapper.text()).toContain("Cache flushed on every node.")
  })

  it("flushes only the chosen node, and says the other is untouched", async () => {
    const wrapper = await mountCluster()
    await wrapper.get("#flush-cache").trigger("click")
    expect(wrapper.get("#flush-choice").text()).toContain("not touched")

    await wrapper.get(`input[value="${NODE2}"]`).setValue(true)
    await wrapper.get("#confirm-flush-cache").trigger("click")
    await flush()

    expect(flushCache).toHaveBeenCalledTimes(1)
    expect(vi.mocked(flushCache).mock.calls[0]![0]).toBe(NODE2)
    expect(wrapper.text()).toContain("Cache flushed on node2.")
  })

  it("keeps the other node's cache on screen and names the node that could not be read", async () => {
    vi.mocked(listCache).mockImplementation((async (_d: string, _c: unknown, o?: { node?: string }) => {
      if (o?.node === NODE2) throw new Error("boom")
      return { response: { domain: "", zones: CACHE[NODE1]!.zones, records: CACHE[NODE1]!.records } }
    }) as never)
    const wrapper = await mountCluster()
    await browse(wrapper)

    expect(wrapper.text()).toContain("only1.test")
    expect(wrapper.get("#cache-partial").text()).toContain(NODE2)
  })
})
