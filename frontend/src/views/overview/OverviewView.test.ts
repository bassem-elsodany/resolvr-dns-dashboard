import { describe, it, expect, vi, beforeEach } from "vitest"
import { mount } from "@vue/test-utils"
import { createPinia, setActivePinia } from "pinia"
import { createRouter, createMemoryHistory } from "vue-router"

vi.mock("../../api/technitium", async () => {
  const actual = await vi.importActual<typeof import("../../api/technitium")>("../../api/technitium")
  return { ...actual, getDashboardStats: vi.fn(), getTopStats: vi.fn(), getSettings: vi.fn() }
})

vi.mock("../../api/app", async () => {
  const actual = await vi.importActual<typeof import("../../api/app")>("../../api/app")
  return { ...actual, forceUpdateBlockLists: vi.fn() }
})

import { getDashboardStats, getTopStats, getSettings, TechnitiumApiError } from "../../api/technitium"
import { forceUpdateBlockLists, AppApiError } from "../../api/app"
import { useConnectionStore } from "../../stores/connection"
import { useTimeRangeStore } from "../../stores/timeRange"
import { useRefreshStore } from "../../stores/refresh"
import { useAuthStore } from "../../stores/auth"
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
    localStorage.clear()
    setActivePinia(createPinia())
    vi.mocked(getDashboardStats).mockReset()
    vi.mocked(forceUpdateBlockLists).mockReset()
    vi.mocked(getTopStats).mockReset()
    vi.mocked(getSettings).mockReset()
    vi.mocked(getTopStats).mockResolvedValue({ response: {} })
    vi.mocked(getSettings).mockResolvedValue({ response: {} as never })
  })

  it("prompts to connect when no server is configured", async () => {
    const router = makeRouter()
    const wrapper = mount(OverviewView, { global: { plugins: [router] } })
    await router.isReady()

    expect(wrapper.text()).toContain("Connect to a Technitium server")
    expect(getDashboardStats).not.toHaveBeenCalled()
  })

  it("renders stat tiles, chart, and top lists from live stats once connected", async () => {
    vi.mocked(getDashboardStats).mockResolvedValue(baseStats)
    const { wrapper } = await mountConnected()
    await flushPromises()

    expect(wrapper.text()).toContain("5,133")
    expect(wrapper.text()).toContain("10.0.10.30")
    expect(wrapper.text()).toContain("pool.ntp.org")
    expect(wrapper.text()).toContain("sessions.bugsnag.com")
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

    expect(getDashboardStats).toHaveBeenCalledTimes(1)
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
})

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}
