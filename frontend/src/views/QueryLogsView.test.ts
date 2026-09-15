import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { mount } from "@vue/test-utils"
import { createPinia, setActivePinia } from "pinia"

vi.mock("../api/technitium", async () => {
  const actual = await vi.importActual<typeof import("../api/technitium")>("../api/technitium")
  return { ...actual, getTopStats: vi.fn(), queryLogs: vi.fn(), exportLogs: vi.fn(), listApps: vi.fn() }
})
vi.mock("../lib/download", () => ({ triggerDownload: vi.fn() }))

import { getTopStats, queryLogs, exportLogs, listApps, TechnitiumApiError, type QueryLogEntry } from "../api/technitium"
import { triggerDownload } from "../lib/download"
import { useConnectionStore } from "../stores/connection"
import QueryLogsView from "./QueryLogsView.vue"

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function logsResult(overrides: Partial<{ totalEntries: number; totalPages: number; entries: QueryLogEntry[] }> = {}) {
  return {
    response: {
      pageNumber: 1,
      totalPages: overrides.totalPages ?? 1,
      totalEntries: overrides.totalEntries ?? 0,
      entries: overrides.entries ?? [],
    },
  }
}

const sampleEntry = {
  rowNumber: 1,
  timestamp: "2026-09-15T11:31:15Z",
  clientIpAddress: "10.0.10.30",
  protocol: "Udp",
  responseType: "Blocked",
  rcode: "NxDomain",
  qname: "sessions.bugsnag.com",
  qtype: "A",
  qclass: "IN",
  answer: null,
}

async function mountConnected() {
  const wrapper = mount(QueryLogsView, { global: { stubs: { RouterLink: true } } })
  const connection = useConnectionStore()
  connection.setConfig("http://10.0.60.60:5380", "secret-token")
  await flushPromises()
  return { wrapper, connection }
}

describe("QueryLogsView", () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    vi.mocked(getTopStats).mockReset().mockResolvedValue({ response: { topClients: [] } })
    vi.mocked(queryLogs).mockReset().mockResolvedValue(logsResult())
    vi.mocked(exportLogs).mockReset()
    vi.mocked(triggerDownload).mockReset()
    vi.mocked(listApps)
      .mockReset()
      .mockResolvedValue({
        response: { apps: [{ name: "Query Logs (Sqlite)", description: "", version: "9.1.1", updateAvailable: false }] },
      })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("renders log rows from the table query, including a mechanism-only 'Blocked by' label", async () => {
    vi.mocked(queryLogs).mockResolvedValue(logsResult({ totalEntries: 1, entries: [sampleEntry] }))

    const { wrapper } = await mountConnected()

    expect(wrapper.text()).toContain("sessions.bugsnag.com")
    expect(wrapper.text()).toContain("Blocked")
  })

  it("resets to page 1 and refetches when a filter changes", async () => {
    const { wrapper } = await mountConnected()
    vi.mocked(queryLogs).mockClear()

    await wrapper.get("#filter-qname").setValue("example.com")
    await wrapper.get("#filter-qname").trigger("change")
    await flushPromises()

    expect(queryLogs).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ qname: "example.com", pageNumber: 1 }),
    )
  })

  it("paginates using pageNumber and disables Prev on page 1", async () => {
    vi.mocked(queryLogs).mockResolvedValue(logsResult({ totalEntries: 100, totalPages: 5, entries: [sampleEntry] }))
    const { wrapper } = await mountConnected()

    expect(wrapper.get("#prev-page").attributes("disabled")).toBeDefined()

    vi.mocked(queryLogs).mockClear()
    await wrapper.get("#next-page").trigger("click")
    await flushPromises()

    expect(queryLogs).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ pageNumber: 2 }))
  })

  it("polls the table every 5 seconds while Live is on, and stops when toggled off", async () => {
    const { wrapper } = await mountConnected()
    vi.mocked(queryLogs).mockClear()
    vi.useFakeTimers()

    await wrapper.get("#live-toggle").trigger("click")
    await vi.advanceTimersByTimeAsync(5000)
    await vi.advanceTimersByTimeAsync(5000)

    expect(queryLogs).toHaveBeenCalledTimes(2)

    await wrapper.get("#live-toggle").trigger("click") // turn off
    vi.mocked(queryLogs).mockClear()
    await vi.advanceTimersByTimeAsync(10000)

    expect(queryLogs).not.toHaveBeenCalled()
  })

  it("selecting a host chip filters the table and requests the host-insight counts", async () => {
    vi.mocked(getTopStats).mockResolvedValue({
      response: { topClients: [{ name: "10.0.10.30", domain: "studio.villa58.lan", hits: 500, rateLimited: false }] },
    })
    // selectHost() fires loadHostInsight()'s four queryLogs calls (total,
    // Blocked, CacheBlocked, UpstreamBlocked, in that Promise.all order)
    // before loadTable()'s refresh call — see selectHost() in the component.
    vi.mocked(queryLogs)
      .mockResolvedValueOnce(logsResult()) // initial table load (via the isConfigured watcher)
      .mockResolvedValueOnce(logsResult({ totalEntries: 800 })) // insight: total
      .mockResolvedValueOnce(logsResult({ totalEntries: 150 })) // insight: Blocked
      .mockResolvedValueOnce(logsResult({ totalEntries: 20 })) // insight: CacheBlocked
      .mockResolvedValueOnce(logsResult({ totalEntries: 5 })) // insight: UpstreamBlocked
      .mockResolvedValueOnce(logsResult({ totalEntries: 800, entries: [sampleEntry] })) // table after host select

    const { wrapper } = await mountConnected()
    await wrapper.get(".host-chip").trigger("click")
    await flushPromises()

    expect(wrapper.find("#host-insight").exists()).toBe(true)
    expect(wrapper.text()).toContain("studio.villa58.lan")
    const clientFilterValue = (wrapper.get("#filter-client").element as HTMLInputElement).value
    expect(clientFilterValue).toBe("10.0.10.30")
  })

  it("exports the current filter set as a CSV download", async () => {
    vi.mocked(exportLogs).mockResolvedValue({ blob: new Blob(["a"]), filename: "query-logs.csv" })
    const { wrapper } = await mountConnected()

    await wrapper.get("#filter-qname").setValue("example.com")
    await wrapper.get("#filter-qname").trigger("change")
    await flushPromises()
    await wrapper.get("#export-csv").trigger("click")
    await flushPromises()

    expect(exportLogs).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ qname: "example.com" }))
    expect(triggerDownload).toHaveBeenCalledWith({ blob: expect.any(Blob), filename: "query-logs.csv" })
  })

  it("shows a readable inline error, not a raw stack trace, when loading fails", async () => {
    vi.mocked(queryLogs).mockRejectedValue(new TechnitiumApiError("Invalid token or session expired.", 200))

    const { wrapper } = await mountConnected()

    expect(wrapper.find("#logs-error").text()).toBe("Invalid token or session expired.")
  })

  it("shows a dedicated message instead of the table when the Query Logs app isn't installed", async () => {
    vi.mocked(listApps).mockResolvedValue({
      response: { apps: [{ name: "Advanced Blocking", description: "", version: "11.1", updateAvailable: false }] },
    })

    const { wrapper } = await mountConnected()

    expect(wrapper.find("#query-logs-app-missing").exists()).toBe(true)
    expect(wrapper.text()).toContain("Query Logs (Sqlite)")
    expect(queryLogs).not.toHaveBeenCalled()
  })
})
