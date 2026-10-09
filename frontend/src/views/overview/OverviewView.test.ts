import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { mount } from "@vue/test-utils"
import { createPinia, setActivePinia } from "pinia"
import { createRouter, createMemoryHistory } from "vue-router"

vi.mock("../../api/technitium", async () => {
  const actual = await vi.importActual<typeof import("../../api/technitium")>("../../api/technitium")
  // Everything the extra panels fetch is stubbed to fail, so these tests
  // never reach a real network and the panels fall back to their
  // "unavailable" states.
  const unavailable = () => vi.fn().mockRejectedValue(new Error("not mocked"))
  return {
    ...actual,
    getDashboardStats: vi.fn(),
    getTopStats: vi.fn(),
    getSettings: vi.fn(),
    queryLogs: unavailable(),
    listApps: unavailable(),
    listDhcpScopes: unavailable(),
    listDhcpLeases: unavailable(),
    listZones: unavailable(),
  }
})

vi.mock("../../api/app", async () => {
  const actual = await vi.importActual<typeof import("../../api/app")>("../../api/app")
  return { ...actual, forceUpdateBlockLists: vi.fn() }
})

import { getDashboardStats, getTopStats, getSettings, listApps, TechnitiumApiError } from "../../api/technitium"
import { forceUpdateBlockLists, AppApiError } from "../../api/app"
import { useConnectionStore } from "../../stores/connection"
import { useTimeRangeStore } from "../../stores/timeRange"
import { useRefreshStore } from "../../stores/refresh"
import { useAuthStore } from "../../stores/auth"
import { clearCache } from "../../lib/charts"
import OverviewView from "./OverviewView.vue"

const baseStats = {
  response: {
    stats: {
      totalQueries: 5133,
      totalNoError: 3419,
      totalServerFailure: 0,
      totalNxDomain: 1714,
      totalRefused: 0,
      totalAuthoritative: 68,
      totalRecursive: 1509,
      totalCached: 1913,
      totalBlocked: 1643,
      totalDropped: 0,
      totalClients: 21,
      zones: 17,
      cachedEntries: 7368,
      allowedZones: 1,
      blockedZones: 73,
      allowListZones: 11,
      blockListZones: 1435491,
    },
    mainChartData: { labelFormat: "HH:mm", labels: ["10:00"], datasets: [{ label: "Total", data: [10] }] },
    queryTypeChartData: { labels: ["A"], datasets: [{ data: [10] }] },
    topClients: [{ name: "10.0.10.30", hits: 842, rateLimited: false }],
    topDomains: [{ name: "pool.ntp.org", hits: 209 }],
    topBlockedDomains: [{ name: "sessions.bugsnag.com", hits: 58 }],
  },
}

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: OverviewView },
      { path: "/clients", component: { template: "<div>clients</div>" } },
      { path: "/logs", component: { template: "<div>logs</div>" } },
      { path: "/connect", component: { template: "<div>connect</div>" } },
    ],
  })
}

async function mountConnected() {
  const router = makeRouter()
  const wrapper = mount(OverviewView, { global: { plugins: [router] } })
  await router.isReady()
  const connection = useConnectionStore()
  connection.isConfigured = true
  return { wrapper, connection }
}

describe("OverviewView", () => {
  beforeEach(() => {
    clearCache()
    localStorage.clear()
    setActivePinia(createPinia())
    vi.mocked(getDashboardStats).mockReset()
    vi.mocked(forceUpdateBlockLists).mockReset()
    vi.mocked(getTopStats).mockReset()
    vi.mocked(getSettings).mockReset()
    vi.mocked(getTopStats).mockResolvedValue({ response: {} })
    vi.mocked(getSettings).mockResolvedValue({ response: {} as never })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("prompts to connect when no server is configured", async () => {
    const router = makeRouter()
    const wrapper = mount(OverviewView, { global: { plugins: [router] } })
    await router.isReady()

    expect(wrapper.text()).toContain("Connect to a Technitium server")
    expect(getDashboardStats).not.toHaveBeenCalled()
  })

  async function openTab(wrapper: Awaited<ReturnType<typeof mountConnected>>["wrapper"], id: string) {
    await wrapper.get(`#overview-tab-${id}`).trigger("click")
    await flushPromises()
  }

  it("renders stat tiles, chart, and top lists from live stats once connected", async () => {
    vi.mocked(getDashboardStats).mockResolvedValue(baseStats)
    const { wrapper } = await mountConnected()
    await flushPromises()

    expect(wrapper.text()).toContain("5,133")
    await openTab(wrapper, "top")
    expect(wrapper.text()).toContain("10.0.10.30")
    expect(wrapper.text()).toContain("pool.ntp.org")
    expect(wrapper.text()).toContain("sessions.bugsnag.com")
  })

  it("compares against the previous period with one extra stats call", async () => {
    vi.mocked(getDashboardStats).mockResolvedValue(baseStats)
    vi.mocked(getTopStats).mockResolvedValue({ response: {} })
    vi.mocked(getSettings).mockResolvedValue({ response: {} } as never)
    await mountConnected()
    await flushPromises()

    // The default range is one hour, so the comparison window is one hour
    // long. (The heatmap panel makes its own three multi-day Custom calls.)
    const hourLong = vi
      .mocked(getDashboardStats)
      .mock.calls.filter((c) => c[0] === "Custom")
      .filter((c) => new Date(c[2]!.end!).getTime() - new Date(c[2]!.start!).getTime() === 3600_000)
    expect(hourLong).toHaveLength(1)
    expect(hourLong[0]![2]).toEqual(expect.objectContaining({ utc: true }))
  })

  it("still renders when the previous-period call fails", async () => {
    vi.mocked(getDashboardStats).mockImplementation(async (type) => {
      if (type === "Custom") throw new Error("boom")
      return baseStats
    })
    vi.mocked(getTopStats).mockResolvedValue({ response: {} })
    vi.mocked(getSettings).mockResolvedValue({ response: {} } as never)
    const { wrapper } = await mountConnected()
    await flushPromises()

    expect(wrapper.text()).toContain("5,133")
    expect(wrapper.find("#overview-error").exists()).toBe(false)
  })

  it("jumps to Query Logs filtered by the slice that was clicked", async () => {
    vi.mocked(getDashboardStats).mockResolvedValue(baseStats)
    vi.mocked(getTopStats).mockResolvedValue({ response: {} })
    vi.mocked(getSettings).mockResolvedValue({ response: {} } as never)
    const { wrapper } = await mountConnected()
    await flushPromises()
    const router = wrapper.vm.$router
    await openTab(wrapper, "resolution")

    await wrapper.get("#path-donut").findAll(".donut-row")[0]!.trigger("click") // Cached
    await flushPromises()
    expect(router.currentRoute.value.path).toBe("/logs")
    expect(router.currentRoute.value.query).toEqual({ responseType: "Cached" })

    await router.push("/")
    await wrapper.get("#outcome-donut").findAll(".donut-row")[1]!.trigger("click") // NXDomain
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ rcode: "NxDomain" })
  })

  describe("tabs", () => {
    async function mountWithStats() {
      vi.mocked(getDashboardStats).mockResolvedValue(baseStats)
      vi.mocked(getTopStats).mockResolvedValue({ response: {} })
      vi.mocked(getSettings).mockResolvedValue({ response: {} } as never)
      vi.mocked(listApps).mockClear()
      const m = await mountConnected()
      await flushPromises()
      return m
    }

    it("keeps the tiles above the tabs and opens on Traffic", async () => {
      const { wrapper } = await mountWithStats()
      expect(wrapper.findAll('[role="tab"]').map((t) => t.text())).toEqual(["Traffic", "Resolution", "Top lists", "Infrastructure"])
      expect(wrapper.get("#overview-tab-traffic").attributes("aria-selected")).toBe("true")
      expect(wrapper.find("#queries-chart").exists()).toBe(true)
      expect(wrapper.find(".type-row").exists()).toBe(true)
      // Other groups are not rendered until their tab is open.
      expect(wrapper.find("#path-donut").exists()).toBe(false)
      expect(wrapper.text()).not.toContain("Top domains")
      expect(wrapper.find('[data-tile="total"]').exists()).toBe(true)
    })

    it("shows only the chosen group, and puts the choice in the URL", async () => {
      const { wrapper } = await mountWithStats()
      await openTab(wrapper, "infra")
      expect(wrapper.vm.$route.query.tab).toBe("infra")
      expect(wrapper.text()).toContain("Cache size")
      expect(wrapper.find("#queries-chart").exists()).toBe(false)
      expect(wrapper.get("#overview-tab-infra").attributes("aria-selected")).toBe("true")
    })

    it("opens on the tab named in the URL, and ignores an unknown one", async () => {
      vi.mocked(getDashboardStats).mockResolvedValue(baseStats)
      vi.mocked(getTopStats).mockResolvedValue({ response: {} })
      vi.mocked(getSettings).mockResolvedValue({ response: {} } as never)
      const router = makeRouter()
      await router.push("/?tab=top")
      const wrapper = mount(OverviewView, { global: { plugins: [router] } })
      useConnectionStore().isConfigured = true
      await flushPromises()
      expect(wrapper.text()).toContain("Top domains")

      await router.push("/?tab=nonsense")
      await flushPromises()
      expect(wrapper.get("#overview-tab-traffic").attributes("aria-selected")).toBe("true")
    })

    it("remembers the last tab when the page is opened again", async () => {
      const first = await mountWithStats()
      await openTab(first.wrapper, "top")
      first.wrapper.unmount()

      const { wrapper } = await mountWithStats()
      expect(wrapper.get("#overview-tab-top").attributes("aria-selected")).toBe("true")
    })

    it("moves between tabs with the arrow keys", async () => {
      const { wrapper } = await mountWithStats()
      await wrapper.get("#overview-tab-traffic").trigger("keydown", { key: "ArrowRight" })
      await flushPromises()
      expect(wrapper.get("#overview-tab-resolution").attributes("aria-selected")).toBe("true")
      await wrapper.get("#overview-tab-resolution").trigger("keydown", { key: "ArrowLeft" })
      await flushPromises()
      // Wraps around from the first tab to the last.
      await wrapper.get("#overview-tab-traffic").trigger("keydown", { key: "ArrowLeft" })
      await flushPromises()
      expect(wrapper.get("#overview-tab-infra").attributes("aria-selected")).toBe("true")
    })

    it("only asks for the query-log sample once the Resolution tab is opened", async () => {
      const { wrapper } = await mountWithStats()
      expect(listApps).not.toHaveBeenCalled()
      await openTab(wrapper, "resolution")
      expect(listApps).toHaveBeenCalled()
    })
  })

  it("jumps to Query Logs filtered by a clicked query type", async () => {
    vi.mocked(getDashboardStats).mockResolvedValue(baseStats)
    vi.mocked(getTopStats).mockResolvedValue({ response: {} })
    vi.mocked(getSettings).mockResolvedValue({ response: {} } as never)
    const { wrapper } = await mountConnected()
    await flushPromises()

    await wrapper.get(".type-row").trigger("click")
    await flushPromises()
    expect(wrapper.vm.$router.currentRoute.value.query).toEqual({ qtype: "A" })
  })

  it("refetches stats when the shared time-range store changes (the control now lives in AppShell's topbar, not this page)", async () => {
    vi.mocked(getDashboardStats).mockResolvedValue(baseStats)
    const { wrapper } = await mountConnected()
    await flushPromises()
    vi.mocked(getDashboardStats).mockClear()

    useTimeRangeStore().set("LastWeek")
    await wrapper.vm.$nextTick()
    await flushPromises()

    expect(getDashboardStats).toHaveBeenCalledWith(
      "LastWeek",
      expect.anything(),
      expect.objectContaining({ utc: true }),
    )
  })

  it("refetches stats when the shared refresh store's tick changes (the topbar refresh button)", async () => {
    vi.mocked(getDashboardStats).mockResolvedValue(baseStats)
    const { wrapper } = await mountConnected()
    await flushPromises()
    vi.mocked(getDashboardStats).mockClear()

    useRefreshStore().trigger()
    await wrapper.vm.$nextTick()
    await flushPromises()

    // The heatmap panel also re-fetches its week of Custom windows; the
    // page's own stats are the one call that is not Custom.
    const main = vi.mocked(getDashboardStats).mock.calls.filter((c) => c[0] !== "Custom")
    expect(main).toHaveLength(1)
  })

  it("shows the rate-limited banner only when the API reports a rate-limited client", async () => {
    vi.mocked(getDashboardStats).mockResolvedValue(baseStats)
    vi.mocked(getTopStats).mockResolvedValue({
      response: { topClients: [{ name: "10.0.10.30", hits: 1, rateLimited: true }] },
    })
    const { wrapper } = await mountConnected()
    await flushPromises()

    expect(wrapper.text()).toContain("is being rate-limited")
  })

  it("does not show the rate-limited banner when no client is rate-limited", async () => {
    vi.mocked(getDashboardStats).mockResolvedValue(baseStats)
    vi.mocked(getTopStats).mockResolvedValue({ response: { topClients: [] } })
    const { wrapper } = await mountConnected()
    await flushPromises()

    expect(wrapper.text()).not.toContain("is being rate-limited")
  })

  it("shows a readable inline error instead of a raw stack trace when the load fails", async () => {
    vi.mocked(getDashboardStats).mockRejectedValue(new TechnitiumApiError("Invalid token or session expired.", 200))
    const { wrapper } = await mountConnected()
    await flushPromises()

    const errorEl = wrapper.find("#overview-error")
    expect(errorEl.text()).toBe("Invalid token or session expired.")
  })

  describe("block-list freshness admin action", () => {
    function mockOverdueSettings() {
      vi.mocked(getSettings).mockResolvedValue({
        response: {
          blockListNextUpdatedOn: new Date(Date.now() - 3600_000).toISOString(),
          blockListUpdateIntervalHours: 24,
        } as never,
      })
    }

    it("shows an 'Update now' button for an admin when block lists are overdue", async () => {
      useAuthStore().user = { id: 1, username: "admin", role: "admin" }
      vi.mocked(getDashboardStats).mockResolvedValue(baseStats)
      mockOverdueSettings()
      const { wrapper } = await mountConnected()
      await flushPromises()

      expect(wrapper.find("#force-update-block-lists").exists()).toBe(true)
    })

    it("hides the 'Update now' button for a viewer, even when block lists are overdue", async () => {
      useAuthStore().user = { id: 2, username: "reader", role: "viewer" }
      vi.mocked(getDashboardStats).mockResolvedValue(baseStats)
      mockOverdueSettings()
      const { wrapper } = await mountConnected()
      await flushPromises()

      expect(wrapper.find("#force-update-block-lists").exists()).toBe(false)
    })

    it("triggers a block-list update and shows confirmation, without waiting for the scheduled interval", async () => {
      useAuthStore().user = { id: 1, username: "admin", role: "admin" }
      vi.mocked(getDashboardStats).mockResolvedValue(baseStats)
      mockOverdueSettings()
      vi.mocked(forceUpdateBlockLists).mockResolvedValue({ status: "ok" })
      const { wrapper } = await mountConnected()
      await flushPromises()

      await wrapper.get("#force-update-block-lists").trigger("click")
      await flushPromises()

      expect(forceUpdateBlockLists).toHaveBeenCalled()
      expect(wrapper.text()).toContain("Update triggered")
    })

    it("shows a readable error, not a raw stack trace, when triggering the update fails", async () => {
      useAuthStore().user = { id: 1, username: "admin", role: "admin" }
      vi.mocked(getDashboardStats).mockResolvedValue(baseStats)
      mockOverdueSettings()
      vi.mocked(forceUpdateBlockLists).mockRejectedValue(new AppApiError("Permission denied.", 502))
      const { wrapper } = await mountConnected()
      await flushPromises()

      await wrapper.get("#force-update-block-lists").trigger("click")
      await flushPromises()

      expect(wrapper.find("#force-update-block-lists-error").text()).toBe("Permission denied.")
    })
  })

  describe("Live toggle", () => {
    it("polls the dashboard every 5 seconds while Live is on, and stops when toggled off", async () => {
      vi.mocked(getDashboardStats).mockResolvedValue(baseStats)
      const { wrapper } = await mountConnected()
      await flushPromises()
      vi.mocked(getDashboardStats).mockClear()
      vi.useFakeTimers()

      await wrapper.get("#overview-live-toggle").trigger("click")
      await vi.advanceTimersByTimeAsync(5000)
      await vi.advanceTimersByTimeAsync(5000)

      expect(getDashboardStats).toHaveBeenCalledTimes(2)

      await wrapper.get("#overview-live-toggle").trigger("click") // turn off
      vi.mocked(getDashboardStats).mockClear()
      await vi.advanceTimersByTimeAsync(10000)

      expect(getDashboardStats).not.toHaveBeenCalled()
    })

    it("hides the Live toggle until a server is configured", async () => {
      const router = makeRouter()
      const wrapper = mount(OverviewView, { global: { plugins: [router] } })
      await router.isReady()

      expect(wrapper.find("#overview-live-toggle").exists()).toBe(false)
    })
  })
})

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}
