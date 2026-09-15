import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { mount } from "@vue/test-utils"
import { createPinia, setActivePinia } from "pinia"
import { createRouter, createMemoryHistory } from "vue-router"

vi.mock("../../api/technitium", async () => {
  const actual = await vi.importActual<typeof import("../../api/technitium")>("../../api/technitium")
  return { ...actual, getTopStats: vi.fn(), queryLogs: vi.fn(), exportLogs: vi.fn(), listApps: vi.fn() }
})
vi.mock("../../lib/download", () => ({ triggerDownload: vi.fn() }))

import { getTopStats, queryLogs, exportLogs, listApps, TechnitiumApiError, type QueryLogEntry } from "../../api/technitium"
import { triggerDownload } from "../../lib/download"
import { useConnectionStore } from "../../stores/connection"
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

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/logs", component: QueryLogsView }],
  })
}

async function mountConnected() {
  const router = makeRouter()
  await router.push("/logs")
  const wrapper = mount(QueryLogsView, { global: { plugins: [router] } })
  const connection = useConnectionStore()
  connection.isConfigured = true
  await flushPromises()
  return { wrapper, connection, router }
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

  afterEach(() => {
    vi.useRealTimers()
  })

  it("renders log rows from the table query, including a mechanism-only 'Blocked by' label", async () => {
    vi.mocked(queryLogs).mockResolvedValue(logsResult({ totalEntries: 1, entries: [sampleEntry] }))

    const { wrapper } = await mountConnected()

    expect(wrapper.text()).toContain("sessions.bugsnag.com")
    expect(wrapper.text()).toContain("Blocked")
  })

  it("renders the RTT column — the wireframe's 10th table column, dropped in an earlier build", async () => {
    vi.mocked(queryLogs).mockResolvedValue(
      logsResult({
        totalEntries: 1,
        entries: [{ ...sampleEntry, responseType: "Recursive", responseRtt: 135.86149999999998, answer: "1.2.3.4" }],
      }),
    )

    const { wrapper } = await mountConnected()

    const headers = wrapper.findAll("th").map((h) => h.text())
    expect(headers).toEqual([
      "Time",
      "Client",
      "Protocol",
      "Response",
      "Blocked by",
      "RCODE",
      "Query",
      "Type",
      "RTT",
      "Answer",
    ])
    expect(wrapper.text()).toContain("135.9 ms")
  })

  it("shows a placeholder RTT for blocked entries, which never reach upstream", async () => {
    vi.mocked(queryLogs).mockResolvedValue(logsResult({ totalEntries: 1, entries: [sampleEntry] }))

    const { wrapper } = await mountConnected()

    const lastRow = wrapper.findAll("tbody tr")[0]!
    const cells = lastRow.findAll("td").map((c) => c.text())
    expect(cells[cells.length - 2]).toBe("–") // RTT column, second-to-last
  })

  it("wraps host chips and the filter bar in one panel with a 'Filter by host' label, matching the wireframe", async () => {
    vi.mocked(getTopStats).mockResolvedValue({
      response: { topClients: [{ name: "10.0.10.30", hits: 500, rateLimited: false }] },
    })

    const { wrapper } = await mountConnected()

    expect(wrapper.text()).toContain("Filter by host")
    expect(wrapper.find(".host-chip").exists()).toBe(true)
  })

  it("includes the entry count in the page description once loaded, matching the wireframe", async () => {
    vi.mocked(queryLogs).mockResolvedValue(logsResult({ totalEntries: 11497 }))

    const { wrapper } = await mountConnected()

    expect(wrapper.text()).toContain("sourced from the Query Logs (Sqlite) app")
    expect(wrapper.text()).toContain("11,497 entries")
  })

  it("offers RCODE as a dropdown of real Technitium rcode values, not a free-text input", async () => {
    const { wrapper } = await mountConnected()

    const select = wrapper.get("#filter-rcode")
    expect(select.element.tagName).toBe("SELECT")
    const options = select.findAll("option").map((o) => o.attributes("value"))
    expect(options).toEqual(["", "NoError", "NxDomain", "ServerFailure", "Refused"])
  })

  it("offers a Record type filter (qtype) — a real gap: the API/type already supported it, but no control exposed it", async () => {
    const { wrapper } = await mountConnected()

    const select = wrapper.get("#filter-qtype")
    expect(select.element.tagName).toBe("SELECT")
    const options = select.findAll("option").map((o) => o.attributes("value"))
    expect(options).toEqual(["", "A", "AAAA", "CNAME", "MX", "TXT", "NS", "SOA", "PTR", "SRV", "CAA", "ANY"])
  })

  it("filters the table by record type when the Record type dropdown changes", async () => {
    const { wrapper } = await mountConnected()
    vi.mocked(queryLogs).mockClear()

    await wrapper.get("#filter-qtype").setValue("AAAA")
    await wrapper.get("#filter-qtype").trigger("change")
    await flushPromises()

    expect(queryLogs).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ qtype: "AAAA", pageNumber: 1 }),
    )
  })

  it("shows the wireframe's 'Showing X–Y of N' range text in the pagination footer", async () => {
    vi.mocked(queryLogs).mockResolvedValue(logsResult({ totalEntries: 45, totalPages: 3, entries: [sampleEntry] }))

    const { wrapper } = await mountConnected()

    expect(wrapper.text()).toContain("Showing 1–20 of 45")
  })

  it("resets to page 1 and refetches when a filter changes", async () => {
    const { wrapper } = await mountConnected()
    vi.mocked(queryLogs).mockClear()

    await wrapper.get("#filter-qname").setValue("example.com")
    await wrapper.get("#filter-qname").trigger("change")
    await flushPromises()

    expect(queryLogs).toHaveBeenCalledWith(
      expect.anything(),
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

    expect(queryLogs).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ pageNumber: 2 }),
    )
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
    // Blocked, CacheBlocked, UpstreamBlocked, in that Promise.allSettled
    // order) before loadTable()'s refresh call — see selectHost() in the
    // component.
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

  it("still renders the host-insight panel when the server rejects the CacheBlocked filter (regression: Technitium v15.4 rejects it live with 'Requested value CacheBlocked was not found', which used to crash the whole panel via Promise.all)", async () => {
    vi.mocked(getTopStats).mockResolvedValue({
      response: { topClients: [{ name: "10.0.10.30", domain: "studio.villa58.lan", hits: 500, rateLimited: false }] },
    })
    vi.mocked(queryLogs)
      .mockResolvedValueOnce(logsResult()) // initial table load
      .mockResolvedValueOnce(logsResult({ totalEntries: 800 })) // insight: total
      .mockResolvedValueOnce(logsResult({ totalEntries: 150 })) // insight: Blocked
      .mockRejectedValueOnce(new TechnitiumApiError("Requested value 'CacheBlocked' was not found.", 200)) // insight: CacheBlocked — real server rejects this
      .mockResolvedValueOnce(logsResult({ totalEntries: 5 })) // insight: UpstreamBlocked
      .mockResolvedValueOnce(logsResult({ totalEntries: 800, entries: [sampleEntry] })) // table after host select

    const { wrapper } = await mountConnected()
    await wrapper.get(".host-chip").trigger("click")
    await flushPromises()

    expect(wrapper.find("#host-insight").exists()).toBe(true)
    // 150 (Blocked) + 0 (CacheBlocked, failed) + 5 (UpstreamBlocked) = 155
    expect(wrapper.text()).toContain("155")
  })

  it("exports the current filter set as a CSV download", async () => {
    vi.mocked(exportLogs).mockResolvedValue({ blob: new Blob(["a"]), filename: "query-logs.csv" })
    const { wrapper } = await mountConnected()

    await wrapper.get("#filter-qname").setValue("example.com")
    await wrapper.get("#filter-qname").trigger("change")
    await flushPromises()
    await wrapper.get("#export-csv").trigger("click")
    await flushPromises()

    expect(exportLogs).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ qname: "example.com" }),
    )
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
    expect(wrapper.text()).toContain("Query Logs")
    expect(queryLogs).not.toHaveBeenCalled()
  })

  it("detects any of Technitium's Query Logs apps (Sqlite/MySQL/PostgreSQL/SQL Server), not just Sqlite", async () => {
    vi.mocked(listApps).mockResolvedValue({
      response: {
        apps: [
          {
            name: "Query Logs (MySQL)",
            description: "",
            version: "9.1.1",
            updateAvailable: false,
            dnsApps: [{ classPath: "QueryLogsMySql.App", isQueryLogger: true }],
          },
        ],
      },
    })
    vi.mocked(queryLogs).mockResolvedValue(logsResult({ totalEntries: 5 }))

    const { wrapper } = await mountConnected()

    expect(wrapper.find("#query-logs-app-missing").exists()).toBe(false)
    expect(wrapper.text()).toContain("sourced from the Query Logs (MySQL) app")
    // Regression: the app-missing check used to detect any installed
    // Query Logs app, but the actual queryLogs()/exportLogs() calls
    // still hardcoded the Sqlite variant's name/classPath — which
    // would silently fail against a MySQL/PostgreSQL/SQL Server
    // server. Both must now use the app that was actually detected.
    expect(queryLogs).toHaveBeenCalledWith(
      expect.anything(),
      { name: "Query Logs (MySQL)", classPath: "QueryLogsMySql.App" },
      expect.anything(),
    )
  })

  it("pre-filters by client when navigated to with a ?client= query param (from Overview's Top clients)", async () => {
    const router = makeRouter()
    await router.push("/logs?client=10.0.10.30")
    const wrapper = mount(QueryLogsView, { global: { plugins: [router] } })
    useConnectionStore().isConfigured = true
    await flushPromises()

    const clientFilterValue = (wrapper.get("#filter-client").element as HTMLInputElement).value
    expect(clientFilterValue).toBe("10.0.10.30")
  })

  it("pre-filters by domain when navigated to with a ?qname= query param (from Overview's Top domains/blocked)", async () => {
    const router = makeRouter()
    await router.push("/logs?qname=sessions.bugsnag.com")
    mount(QueryLogsView, { global: { plugins: [router] } })
    useConnectionStore().isConfigured = true
    await flushPromises()

    expect(queryLogs).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ qname: "sessions.bugsnag.com" }),
    )
  })

  it("shows the host-insight graphs when a client IP is typed directly into the filter, not only via a host chip", async () => {
    vi.mocked(queryLogs)
      .mockResolvedValueOnce(logsResult()) // initial table load
      .mockResolvedValueOnce(logsResult({ totalEntries: 300 })) // insight: total
      .mockResolvedValueOnce(logsResult({ totalEntries: 40 })) // insight: Blocked
      .mockResolvedValueOnce(logsResult({ totalEntries: 3 })) // insight: CacheBlocked
      .mockResolvedValueOnce(logsResult({ totalEntries: 1 })) // insight: UpstreamBlocked
      .mockResolvedValueOnce(logsResult({ totalEntries: 300 })) // table after filter change

    const { wrapper } = await mountConnected()
    expect(wrapper.find("#host-insight").exists()).toBe(false)

    await wrapper.get("#filter-client").setValue("10.0.10.99")
    await wrapper.get("#filter-client").trigger("change")
    await flushPromises()

    expect(wrapper.find("#host-insight").exists()).toBe(true)
  })

  it("clicking a Client cell in the table filters the table by that client, in place", async () => {
    vi.mocked(queryLogs).mockResolvedValue(logsResult({ totalEntries: 1, entries: [sampleEntry] }))
    const { wrapper } = await mountConnected()
    vi.mocked(queryLogs).mockClear()

    await wrapper.get("tbody button[title='Filter Query Logs by this client']").trigger("click")
    await flushPromises()

    const clientFilterValue = (wrapper.get("#filter-client").element as HTMLInputElement).value
    expect(clientFilterValue).toBe(sampleEntry.clientIpAddress)
  })

  it("clicking a Query cell in the table filters the table by that domain, in place", async () => {
    vi.mocked(queryLogs).mockResolvedValue(logsResult({ totalEntries: 1, entries: [sampleEntry] }))
    const { wrapper } = await mountConnected()
    vi.mocked(queryLogs).mockClear()

    await wrapper.get("tbody button[title='Filter Query Logs by this domain']").trigger("click")
    await flushPromises()

    expect(queryLogs).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ qname: sampleEntry.qname }),
    )
  })
})
