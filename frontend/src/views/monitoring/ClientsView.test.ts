import { describe, it, expect, vi, beforeEach } from "vitest"
import { mount } from "@vue/test-utils"
import { createPinia, setActivePinia } from "pinia"
import { createRouter, createMemoryHistory } from "vue-router"

vi.mock("../../api/technitium", async () => {
  const actual = await vi.importActual<typeof import("../../api/technitium")>("../../api/technitium")
  return { ...actual, getTopStats: vi.fn(), queryLogs: vi.fn(), listApps: vi.fn() }
})

import { getTopStats, queryLogs, listApps, TechnitiumApiError } from "../../api/technitium"
import { useConnectionStore } from "../../stores/connection"
import { useTimeRangeStore } from "../../stores/timeRange"
import { useRefreshStore } from "../../stores/refresh"
import ClientsView from "./ClientsView.vue"

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/clients", component: ClientsView },
      { path: "/logs", component: { template: "<div />" } },
      { path: "/connect", component: { template: "<div />" } },
    ],
  })
}

async function mountConnected() {
  const router = makeRouter()
  await router.push("/clients")
  const wrapper = mount(ClientsView, { global: { plugins: [router] } })
  const connection = useConnectionStore()
  connection.isConfigured = true
  return { wrapper, connection, router }
}

describe("ClientsView", () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    vi.mocked(getTopStats).mockReset()
    vi.mocked(queryLogs).mockReset()
    vi.mocked(listApps)
      .mockReset()
      .mockResolvedValue({
        response: {
          apps: [
            {
              name: "Query Logs (Sqlite)",
              description: "",
              version: "9.1.1",
              updateAvailable: false,
              dnsApps: [{ classPath: "QueryLogsSqlite.App", isQueryLogger: true }],
            },
          ],
        },
      })
  })

  it("prompts to connect when no server is configured", async () => {
    const router = makeRouter()
    await router.push("/clients")
    const wrapper = mount(ClientsView, { global: { plugins: [router] } })
    await flushPromises()

    expect(wrapper.text()).toContain("Connect to a Technitium server")
    expect(getTopStats).not.toHaveBeenCalled()
  })

  it("computes blocked % from independent total/blocked query-log counts, not the getTop hits field", async () => {
    vi.mocked(getTopStats).mockResolvedValue({
      response: { topClients: [{ name: "10.0.10.30", domain: "unifi.villa58.lan", hits: 842, rateLimited: false }] },
    })
    vi.mocked(queryLogs).mockImplementation((_creds, _app, filters) => {
      if (filters?.responseType === "Blocked") {
        return Promise.resolve({ response: { pageNumber: 1, totalPages: 1, totalEntries: 200, entries: [] } })
      }
      return Promise.resolve({
        response: {
          pageNumber: 1,
          totalPages: 1,
          totalEntries: 800,
          entries: [
            {
              rowNumber: 1,
              timestamp: "2026-09-15T11:31:15Z",
              clientIpAddress: "10.0.10.30",
              protocol: "Udp",
              responseType: "Recursive",
              rcode: "NoError",
              qname: "example.com",
              qtype: "A",
              qclass: "IN",
              answer: "1.2.3.4",
            },
          ],
        },
      })
    })

    const { wrapper } = await mountConnected()
    await flushPromises()

    expect(wrapper.text()).toContain("10.0.10.30")
    expect(wrapper.text()).toContain("unifi.villa58.lan")
    expect(wrapper.text()).toContain("200") // blocked count
    // allowed % = (800-200)/800 = 75%
    expect(wrapper.text()).toContain("75%")
  })

  it("shows a rate-limited badge only for clients the API flags as rate-limited", async () => {
    vi.mocked(getTopStats).mockResolvedValue({
      response: {
        topClients: [
          { name: "10.0.10.30", hits: 10, rateLimited: true },
          { name: "10.0.10.14", hits: 5, rateLimited: false },
        ],
      },
    })
    vi.mocked(queryLogs).mockResolvedValue({ response: { pageNumber: 1, totalPages: 1, totalEntries: 0, entries: [] } })

    const { wrapper } = await mountConnected()
    await flushPromises()

    const rows = wrapper.findAll("tbody tr")
    expect(rows[0]!.text()).toContain("Rate-limited")
    expect(rows[1]!.text()).toContain("Normal")
  })

  it("filters the table by IP or hostname", async () => {
    vi.mocked(getTopStats).mockResolvedValue({
      response: {
        topClients: [
          { name: "10.0.10.30", domain: "unifi.villa58.lan", hits: 10, rateLimited: false },
          { name: "10.0.10.14", domain: "homeassistant.villa58.lan", hits: 5, rateLimited: false },
        ],
      },
    })
    vi.mocked(queryLogs).mockResolvedValue({ response: { pageNumber: 1, totalPages: 1, totalEntries: 0, entries: [] } })

    const { wrapper } = await mountConnected()
    await flushPromises()

    await wrapper.find("#client-filter").setValue("homeassistant")
    await flushPromises()

    expect(wrapper.text()).not.toContain("10.0.10.30")
    expect(wrapper.text()).toContain("10.0.10.14")
  })

  it("shows a readable inline error, not a raw stack trace, when loading fails", async () => {
    vi.mocked(getTopStats).mockRejectedValue(new TechnitiumApiError("Invalid token or session expired.", 200))

    const { wrapper } = await mountConnected()
    await flushPromises()

    expect(wrapper.find("#clients-error").text()).toBe("Invalid token or session expired.")
  })

  it("refetches when the shared time-range store changes (the control now lives in AppShell's topbar)", async () => {
    vi.mocked(getTopStats).mockResolvedValue({ response: { topClients: [] } })
    vi.mocked(queryLogs).mockResolvedValue({ response: { pageNumber: 1, totalPages: 1, totalEntries: 0, entries: [] } })
    const { wrapper } = await mountConnected()
    await flushPromises()
    vi.mocked(getTopStats).mockClear()

    useTimeRangeStore().set("LastWeek")
    await wrapper.vm.$nextTick()
    await flushPromises()

    expect(getTopStats).toHaveBeenCalledWith("TopClients", "LastWeek", expect.anything(), expect.anything())
  })

  it("refetches when the shared refresh store's tick changes (the topbar refresh button)", async () => {
    vi.mocked(getTopStats).mockResolvedValue({ response: { topClients: [] } })
    vi.mocked(queryLogs).mockResolvedValue({ response: { pageNumber: 1, totalPages: 1, totalEntries: 0, entries: [] } })
    const { wrapper } = await mountConnected()
    await flushPromises()
    vi.mocked(getTopStats).mockClear()

    useRefreshStore().trigger()
    await wrapper.vm.$nextTick()
    await flushPromises()

    expect(getTopStats).toHaveBeenCalledTimes(1)
  })

  it("links each client row to its filtered Query Logs, for easy drill-down", async () => {
    vi.mocked(getTopStats).mockResolvedValue({
      response: { topClients: [{ name: "10.0.10.30", domain: "unifi.villa58.lan", hits: 10, rateLimited: false }] },
    })
    vi.mocked(queryLogs).mockResolvedValue({ response: { pageNumber: 1, totalPages: 1, totalEntries: 0, entries: [] } })

    const { wrapper, router } = await mountConnected()
    await flushPromises()

    const link = wrapper.get("tbody a")
    expect(link.text()).toBe("10.0.10.30")
    await link.trigger("click")
    await flushPromises()

    expect(router.currentRoute.value.path).toBe("/logs")
    expect(router.currentRoute.value.query.client).toBe("10.0.10.30")
  })
})
