import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { mount, flushPromises } from "@vue/test-utils"
import { createPinia, setActivePinia } from "pinia"
import { createRouter, createMemoryHistory } from "vue-router"

vi.mock("../../api/technitium", async () => {
  const actual = await vi.importActual<typeof import("../../api/technitium")>("../../api/technitium")
  return { ...actual, getDashboardStats: vi.fn(), getTopStats: vi.fn(), queryLogs: vi.fn(), listDhcpLeases: vi.fn(), listApps: vi.fn() }
})

import { getDashboardStats, getTopStats, queryLogs, listDhcpLeases, listApps, TechnitiumApiError } from "../../api/technitium"
import { useConnectionStore } from "../../stores/connection"
import { useTimeRangeStore } from "../../stores/timeRange"
import { useRefreshStore } from "../../stores/refresh"
import { clearCache } from "../../lib/charts"
import { resetKnownForTests } from "../../lib/clients"
import ClientsView from "./ClientsView.vue"

const statsResult = {
  response: {
    stats: {
      totalQueries: 1000, totalNoError: 900, totalServerFailure: 0, totalNxDomain: 50, totalRefused: 0, totalAuthoritative: 10,
      totalRecursive: 400, totalCached: 500, totalBlocked: 200, totalDropped: 0, totalClients: 7, zones: 1, cachedEntries: 1,
      allowedZones: 0, blockedZones: 0, allowListZones: 0, blockListZones: 0,
    },
    mainChartData: { labelFormat: "HH:mm", labels: [], datasets: [] },
  },
}

const entry = (ip: string, i: number) => ({
  rowNumber: i, timestamp: new Date().toISOString(), clientIpAddress: ip, protocol: "Udp", responseType: "Cached", rcode: "NoError",
  qname: "a.example.com", qtype: "A", qclass: "IN", answer: null,
})

function mockApis() {
  vi.mocked(getDashboardStats).mockResolvedValue(statsResult as never)
  vi.mocked(listApps).mockResolvedValue({
    response: { apps: [{ name: "Query Logs (Sqlite)", description: "", version: "1", updateAvailable: false, dnsApps: [{ classPath: "Q.App", isQueryLogger: true }] }] },
  })
  vi.mocked(getTopStats).mockResolvedValue({ response: { topClients: [{ name: "10.0.0.1", domain: "media.lan", hits: 500, rateLimited: false }] } })
  vi.mocked(listDhcpLeases).mockResolvedValue({ response: { leases: [] } })
  vi.mocked(queryLogs).mockImplementation((async () => ({
    response: { pageNumber: 1, totalPages: 1, totalEntries: 3, entries: [entry("10.0.0.1", 1)] },
  })) as never)
}

async function mountView() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/clients", component: ClientsView },
      { path: "/connect", component: { template: "<div>connect</div>" } },
      { path: "/logs", component: { template: "<div>logs</div>" } },
    ],
  })
  await router.push("/clients")
  const wrapper = mount(ClientsView, { global: { plugins: [router] } })
  await router.isReady()
  return { wrapper, router, connection: useConnectionStore() }
}

describe("ClientsView", () => {
  beforeEach(() => {
    clearCache()
    localStorage.clear()
    resetKnownForTests()
    setActivePinia(createPinia())
    for (const f of [getDashboardStats, getTopStats, queryLogs, listDhcpLeases, listApps]) vi.mocked(f).mockReset()
    mockApis()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("prompts to connect when no server is configured", async () => {
    const { wrapper } = await mountView()
    await flushPromises()
    expect(wrapper.text()).toContain("Connect to a Technitium server")
    expect(getDashboardStats).not.toHaveBeenCalled()
    expect(wrapper.find("#clients-live-toggle").exists()).toBe(false)
  })

  it("shows the client explorer once connected", async () => {
    const { wrapper, connection } = await mountView()
    connection.isConfigured = true
    await flushPromises()
    expect(wrapper.get("h1").text()).toBe("Clients")
    expect(wrapper.findAll(".client-row")).toHaveLength(1)
    expect(wrapper.get("#client-detail").text()).toContain("media.lan")
    expect(wrapper.get("#client-tile-active").text()).toContain("7")
  })

  it("shows a readable inline error, not a raw stack trace, when loading fails", async () => {
    vi.mocked(getDashboardStats).mockRejectedValue(new TechnitiumApiError("Invalid token or session expired.", 401))
    const { wrapper, connection } = await mountView()
    connection.isConfigured = true
    await flushPromises()
    expect(wrapper.get("#clients-error").text()).toBe("Invalid token or session expired.")
  })

  it("explains when no query-logging app is installed", async () => {
    vi.mocked(listApps).mockResolvedValue({ response: { apps: [] } })
    const { wrapper, connection } = await mountView()
    connection.isConfigured = true
    await flushPromises()
    expect(wrapper.text()).toContain("query-logging app")
  })

  it("refetches when the shared time-range store changes (the control lives in AppShell's topbar)", async () => {
    const { connection } = await mountView()
    connection.isConfigured = true
    await flushPromises()
    vi.mocked(getDashboardStats).mockClear()

    useTimeRangeStore().set("LastDay")
    await flushPromises()
    expect(getDashboardStats).toHaveBeenCalledWith("LastDay", expect.anything(), expect.objectContaining({ utc: true }))
  })

  it("refetches when the topbar refresh button is used, bypassing the short-lived caches", async () => {
    const { connection } = await mountView()
    connection.isConfigured = true
    await flushPromises()
    vi.mocked(getTopStats).mockClear()

    useRefreshStore().trigger()
    await flushPromises()
    expect(getTopStats).toHaveBeenCalledTimes(1)
  })

  it("polls every 5 seconds while Live is on, and stops when it is switched off", async () => {
    vi.useFakeTimers()
    const { wrapper, connection } = await mountView()
    connection.isConfigured = true
    await vi.advanceTimersByTimeAsync(0)
    vi.mocked(getDashboardStats).mockClear()

    await wrapper.get("#clients-live-toggle").trigger("click")
    await vi.advanceTimersByTimeAsync(5000)
    expect(getDashboardStats).toHaveBeenCalledTimes(1)

    await wrapper.get("#clients-live-toggle").trigger("click")
    vi.mocked(getDashboardStats).mockClear()
    await vi.advanceTimersByTimeAsync(15000)
    expect(getDashboardStats).not.toHaveBeenCalled()
  })

  it("opens a client's Query Logs from the detail panel", async () => {
    const { wrapper, router, connection } = await mountView()
    connection.isConfigured = true
    await flushPromises()
    await wrapper.get("#client-open-logs").trigger("click")
    await flushPromises()
    expect(router.currentRoute.value.path).toBe("/logs")
    expect(router.currentRoute.value.query.client).toBe("10.0.0.1")
  })
})
