import { describe, it, expect, vi, beforeEach } from "vitest"
import { mount, flushPromises } from "@vue/test-utils"
import { createPinia, setActivePinia } from "pinia"
import { createRouter, createMemoryHistory } from "vue-router"

vi.mock("../../api/technitium", async () => {
  const actual = await vi.importActual<typeof import("../../api/technitium")>("../../api/technitium")
  return { ...actual, getTopStats: vi.fn(), queryLogs: vi.fn(), listDhcpLeases: vi.fn(), listApps: vi.fn() }
})

import { getTopStats, queryLogs, listDhcpLeases, listApps, type QueryLogEntry } from "../../api/technitium"
import { useConnectionStore } from "../../stores/connection"
import { clearCache } from "../../lib/charts"
import { resetKnownForTests } from "../../lib/clients"
import ClientsTab from "./ClientsTab.vue"

const NOW = Date.now()
const ago = (min: number) => new Date(NOW - min * 60000).toISOString()

const stats = {
  totalQueries: 1000, totalNoError: 900, totalServerFailure: 0, totalNxDomain: 50, totalRefused: 0, totalAuthoritative: 10,
  totalRecursive: 400, totalCached: 500, totalBlocked: 200, totalDropped: 0, totalClients: 12, zones: 1, cachedEntries: 1,
  allowedZones: 0, blockedZones: 0, allowListZones: 0, blockListZones: 0,
}

// ip -> [total, blocked, minutes since last query]
const COUNTS: Record<string, [number, number, number]> = {
  "10.0.0.1": [500, 25, 1],
  "10.0.0.2": [300, 90, 5],
  "10.0.0.3": [40, 1, 120],
}

function entry(ip: string, i: number, over: Partial<QueryLogEntry> = {}): QueryLogEntry {
  return { rowNumber: i, timestamp: ago(i), clientIpAddress: ip, protocol: "Udp", responseType: "Cached", rcode: "NoError", qname: `d${i % 3}.example.com`, qtype: "A", qclass: "IN", answer: null, ...over }
}

function mockApis() {
  vi.mocked(listApps).mockResolvedValue({
    response: { apps: [{ name: "Query Logs (Sqlite)", description: "", version: "1", updateAvailable: false, dnsApps: [{ classPath: "Q.App", isQueryLogger: true }] }] },
  })
  vi.mocked(getTopStats).mockResolvedValue({
    response: {
      topClients: [
        { name: "10.0.0.1", domain: "media.lan", hits: 500, rateLimited: false },
        { name: "10.0.0.2", domain: "laptop.lan", hits: 300, rateLimited: true },
        { name: "10.0.0.3", hits: 40, rateLimited: false },
      ],
    },
  })
  vi.mocked(listDhcpLeases).mockResolvedValue({
    response: { leases: [{ scope: "Home", hardwareAddress: "aa:bb:cc:00:00:01", address: "10.0.0.1", hostName: null, leaseObtained: "", leaseExpires: "" }] },
  })
  vi.mocked(queryLogs).mockImplementation((async (_c: unknown, _a: unknown, f: Record<string, unknown>) => {
    const ip = String(f.clientIpAddress)
    const [total, blocked, last] = COUNTS[ip] ?? [0, 0, 0]
    if (f.entriesPerPage === 1) {
      return { response: { pageNumber: 1, totalPages: 1, totalEntries: f.responseType === "Blocked" ? blocked : total, entries: [entry(ip, last)] } }
    }
    const entries = [
      entry(ip, 1, { qname: "cdn.example.com" }),
      entry(ip, 2, { qname: "cdn.example.com", responseType: "Recursive", responseRtt: 20, protocol: "Https" }),
      entry(ip, 3, { qname: "ads.example.net", responseType: "Blocked" }),
      entry(ip, 4, { qname: "api.example.org", qtype: "AAAA" }),
    ]
    return { response: { pageNumber: 1, totalPages: 1, totalEntries: entries.length, entries } }
  }) as never)
}

async function mountTab(props: Partial<InstanceType<typeof ClientsTab>["$props"]> = {}, path = "/") {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: { template: "<div />" } },
      { path: "/logs", component: { template: "<div />" } },
    ],
  })
  await router.push(path)
  const wrapper = mount(ClientsTab, {
    props: { stats, prevStats: { ...stats, totalClients: 10 }, duration: "LastDay", logEntries: [], logState: "ready", ...props },
    global: { plugins: [router] },
  })
  useConnectionStore().isConfigured = true
  await flushPromises()
  return { wrapper, router }
}

describe("ClientsTab", () => {
  beforeEach(() => {
    clearCache()
    localStorage.clear()
    resetKnownForTests()
    setActivePinia(createPinia())
    vi.mocked(getTopStats).mockReset()
    vi.mocked(queryLogs).mockReset()
    vi.mocked(listDhcpLeases).mockReset()
    vi.mocked(listApps).mockReset()
    mockApis()
  })

  it("lists the busiest clients with exact counts from the log", async () => {
    const { wrapper } = await mountTab()
    const rows = wrapper.findAll(".client-row")
    expect(rows).toHaveLength(3)
    expect(rows[0]!.text()).toContain("media.lan")
    expect(rows[0]!.text()).toContain("500")
    expect(rows[0]!.text()).toContain("5% blocked") // 25 of 500
    expect(rows[2]!.text()).toContain("10.0.0.3") // no hostname: falls back to the address
    expect(wrapper.get("#client-count").text()).toBe("3 of 3")
  })

  it("makes at most one top-clients call and two count queries per client", async () => {
    await mountTab()
    expect(getTopStats).toHaveBeenCalledTimes(1)
    const counts = vi.mocked(queryLogs).mock.calls.filter((c) => (c[2] as { entriesPerPage?: number }).entriesPerPage === 1)
    expect(counts).toHaveLength(6)
  })

  it("fills the summary tiles", async () => {
    const { wrapper } = await mountTab()
    expect(wrapper.get("#client-tile-active").text()).toContain("12")
    expect(wrapper.get("#client-tile-active").text()).toContain("▲ 2")
    expect(wrapper.get("#client-tile-top").text()).toContain("media.lan")
    expect(wrapper.get("#client-tile-top").text()).toContain("50% of all queries")
    expect(wrapper.get("#client-tile-block").text()).toContain("laptop.lan") // 30% blocked
    expect(wrapper.get("#client-tile-attention").text()).toContain("1 client") // the rate-limited one
  })

  it("flags heavy blocking and rate limiting on the right rows", async () => {
    const { wrapper } = await mountTab()
    const rows = wrapper.findAll(".client-row")
    expect(rows[1]!.find(".badge-heavy").exists()).toBe(true)
    expect(rows[1]!.find(".badge-limited").exists()).toBe(true)
    expect(rows[0]!.find(".badge-heavy").exists()).toBe(false)
  })

  it("opens on the busiest client and shows its details, including the DHCP lease", async () => {
    const { wrapper } = await mountTab()
    const detail = wrapper.get("#client-detail")
    expect(detail.text()).toContain("media.lan")
    expect(detail.text()).toContain("aa:bb:cc:00:00:01")
    expect(detail.text()).toContain("Home")
    expect(wrapper.get("#detail-queries").text()).toBe("500")
    expect(wrapper.get("#detail-blocked").text()).toBe("5.0%")
    expect(wrapper.get("#detail-rtt").text()).toBe("20 ms")
    expect(wrapper.findAll(".domain-row").map((r) => r.text())[0]).toContain("cdn.example.com")
    expect(wrapper.findAll(".blocked-row")[0]!.text()).toContain("ads.example.net")
    expect(wrapper.findAll(".recent-row")).toHaveLength(4)
    expect(wrapper.findAll(".protocol-legend").map((p) => p.text())).toEqual(expect.arrayContaining([expect.stringContaining("UDP"), expect.stringContaining("DoH")]))
  })

  it("switches the detail panel when another client is chosen, and records it in the URL", async () => {
    const { wrapper, router } = await mountTab()
    await wrapper.findAll(".client-row")[1]!.trigger("click")
    await flushPromises()
    expect(router.currentRoute.value.query.client).toBe("10.0.0.2")
    expect(wrapper.get("#client-detail").text()).toContain("laptop.lan")
    expect(wrapper.get("#detail-queries").text()).toBe("300")
  })

  it("opens the client named in the URL", async () => {
    const { wrapper } = await mountTab({}, "/?client=10.0.0.3")
    expect(wrapper.get("#client-detail").text()).toContain("10.0.0.3")
  })

  it("searches by name or address and filters by flag", async () => {
    const { wrapper } = await mountTab()
    await wrapper.get("#client-search").setValue("laptop")
    expect(wrapper.findAll(".client-row")).toHaveLength(1)
    expect(wrapper.get("#client-count").text()).toBe("1 of 3")

    await wrapper.get("#client-search").setValue("")
    await wrapper.get('[data-filter="quiet"]').trigger("click") // 10.0.0.3 last seen 2 h ago
    expect(wrapper.findAll(".client-row").map((r) => r.attributes("data-ip"))).toEqual(["10.0.0.3"])
    await wrapper.get('[data-filter="limited"]').trigger("click")
    expect(wrapper.findAll(".client-row").map((r) => r.attributes("data-ip"))).toEqual(["10.0.0.2"])
  })

  it("shows a message when nothing matches", async () => {
    const { wrapper } = await mountTab()
    await wrapper.get("#client-search").setValue("zzz")
    expect(wrapper.text()).toContain("No clients match")
  })

  it("sorts by block rate", async () => {
    const { wrapper } = await mountTab()
    await wrapper.get("#client-sort").setValue("blocked")
    expect(wrapper.findAll(".client-row")[0]!.attributes("data-ip")).toBe("10.0.0.2")
  })

  it("marks addresses this browser has not seen before as new, but not on the very first visit", async () => {
    const first = await mountTab()
    expect(first.wrapper.findAll(".badge-new")).toHaveLength(0)
    first.wrapper.unmount()

    localStorage.setItem("resolvr.knownClients", JSON.stringify(["10.0.0.1", "10.0.0.2"]))
    resetKnownForTests()
    clearCache()
    const { wrapper } = await mountTab()
    expect(wrapper.findAll(".client-row").find((r) => r.attributes("data-ip") === "10.0.0.3")!.find(".badge-new").exists()).toBe(true)
    expect(wrapper.get("#client-tile-attention").text()).toContain("2 clients") // new + rate limited
  })

  it("jumps to Query Logs for the client, a domain, or a record type", async () => {
    const { wrapper, router } = await mountTab()
    await wrapper.get("#client-open-logs").trigger("click")
    await flushPromises()
    expect(router.currentRoute.value.path).toBe("/logs")
    expect(router.currentRoute.value.query).toEqual({ client: "10.0.0.1" })

    await router.push("/")
    await wrapper.findAll(".domain-row")[0]!.trigger("click")
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ client: "10.0.0.1", qname: "cdn.example.com" })

    await router.push("/")
    await wrapper.findAll(".type-row")[0]!.trigger("click")
    await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({ client: "10.0.0.1", qtype: "A" })
  })

  it("selects a client from the traffic share bar, and clears a filter that would hide it", async () => {
    const { wrapper, router } = await mountTab()
    await wrapper.get('[data-filter="quiet"]').trigger("click")
    const seg = wrapper.findAll(".share-seg")[1]! // second busiest: 10.0.0.2
    await seg.trigger("click")
    await flushPromises()
    expect(router.currentRoute.value.query.client).toBe("10.0.0.2")
    expect(wrapper.findAll(".client-row")).toHaveLength(3)
  })

  it("adds a remainder segment so the bar covers all queries", async () => {
    const { wrapper } = await mountTab()
    // 500 + 300 + 40 listed of 1,000 total
    expect(wrapper.findAll(".share-seg")).toHaveLength(4)
    expect(wrapper.get("#share-bar").element.parentElement!.textContent).toContain("84% of traffic")
  })

  it("draws the recent-activity grid from the shared log sample", async () => {
    const logEntries = [entry("10.0.0.1", 90), entry("10.0.0.1", 60), entry("10.0.0.2", 30), entry("10.0.0.1", 0)]
    const { wrapper } = await mountTab({ logEntries })
    expect(wrapper.findAll(".heat-row-label").map((r) => r.text())).toEqual(["media", "laptop"]) // the .lan suffix is trimmed to save width
    expect(wrapper.findAll(".heat-cell")).toHaveLength(48)
  })

  it("explains when the query-logging app is missing or loading fails", async () => {
    vi.mocked(listApps).mockResolvedValue({ response: { apps: [] } })
    expect((await mountTab()).wrapper.text()).toContain("query-logging app")

    clearCache()
    setActivePinia(createPinia())
    mockApis()
    vi.mocked(getTopStats).mockRejectedValue(new Error("boom"))
    expect((await mountTab()).wrapper.text()).toContain("Could not load client activity")
  })

  it("says so when a client has no logged queries in the range", async () => {
    vi.mocked(queryLogs).mockImplementation((async (_c: unknown, _a: unknown, f: Record<string, unknown>) => ({
      response: { pageNumber: 1, totalPages: 1, totalEntries: f.entriesPerPage === 1 ? 5 : 0, entries: [] },
    })) as never)
    const { wrapper } = await mountTab()
    expect(wrapper.get("#client-detail").text()).toContain("No logged queries from this client")
  })
})
