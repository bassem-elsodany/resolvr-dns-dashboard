import { describe, it, expect, vi, beforeEach } from "vitest"
import { mount } from "@vue/test-utils"
import { createPinia, setActivePinia } from "pinia"
import { createRouter, createMemoryHistory } from "vue-router"

vi.mock("../../api/technitium", async () => {
  const actual = await vi.importActual<typeof import("../../api/technitium")>("../../api/technitium")
  return { ...actual, getTopStats: vi.fn(), queryLogs: vi.fn(), exportLogs: vi.fn(), listApps: vi.fn(), getClusterState: vi.fn() }
})
vi.mock("../../lib/download", () => ({ triggerDownload: vi.fn() }))

import { getTopStats, queryLogs, exportLogs, listApps, getClusterState, type QueryLogEntry } from "../../api/technitium"
import { triggerDownload } from "../../lib/download"
import { useConnectionStore } from "../../stores/connection"
import { useStatsScopeStore } from "../../stores/statsScope"
import QueryLogsView from "./QueryLogsView.vue"

const NODE1 = "node1.cluster.test"
const NODE2 = "node2.cluster.test"
const flush = () => new Promise((r) => setTimeout(r, 0))

function entry(row: number, at: string, qname: string): QueryLogEntry {
  return { rowNumber: row, timestamp: at, clientIpAddress: "10.0.0.1", protocol: "Udp", responseType: "Cached", rcode: "NoError", qname, qtype: "A", qclass: "IN", answer: null }
}

// Each node has its own log (and its own row numbers).
const LOGS: Record<string, { total: number; entries: QueryLogEntry[] }> = {
  [NODE1]: { total: 28, entries: [entry(1, "2026-10-12T10:00:03Z", "n1-newest.test"), entry(2, "2026-10-12T10:00:01Z", "n1-oldest.test")] },
  [NODE2]: { total: 23, entries: [entry(1, "2026-10-12T10:00:02Z", "n2-middle.test")] },
}

async function mountClustered(opts: { states?: [string, string]; scope?: string } = {}) {
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
  if (opts.scope) scope.set("logs", opts.scope)
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/logs", component: QueryLogsView }] })
  await router.push("/logs")
  const wrapper = mount(QueryLogsView, { global: { plugins: [router] } })
  connection.isConfigured = true
  await flush()
  await flush()
  return wrapper
}

describe("QueryLogsView on a cluster", () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    vi.mocked(getTopStats).mockReset().mockResolvedValue({ response: { topClients: [] } })
    vi.mocked(exportLogs).mockReset()
    vi.mocked(triggerDownload).mockReset()
    vi.mocked(getClusterState).mockReset()
    vi.mocked(queryLogs).mockReset().mockImplementation((async (_c: unknown, _a: unknown, f: { node?: string }) => {
      const log = LOGS[f.node ?? NODE1]!
      return { response: { pageNumber: 1, totalPages: 1, totalEntries: log.total, entries: log.entries } }
    }) as never)
    vi.mocked(listApps).mockReset().mockResolvedValue({
      response: { apps: [{ name: "Query Logs (Sqlite)", description: "", version: "9", updateAvailable: false, dnsApps: [{ classPath: "Q.App", isQueryLogger: true }] }] },
    })
  })

  it("merges both nodes' logs newest first and says which node answered each row", async () => {
    const wrapper = await mountClustered()

    const rows = wrapper.findAll("tbody tr")
    expect(rows.map((r) => r.text())).toEqual([
      expect.stringContaining("n1-newest.test"),
      expect.stringContaining("n2-middle.test"),
      expect.stringContaining("n1-oldest.test"),
    ])
    const nodes = wrapper.findAll(".log-node").map((n) => n.text())
    expect(nodes).toEqual(["node1", "node2", "node1"])
  })

  it("adds up the entries and shows each node's share", async () => {
    const wrapper = await mountClustered()

    expect(wrapper.text()).toContain("51 entries")
    const totals = wrapper.get("#node-totals").text()
    expect(totals).toContain("node1")
    expect(totals).toContain("28")
    expect(totals).toContain("node2")
    expect(totals).toContain("23")
  })

  it("asks the connected node without naming it, and the other node by name", async () => {
    await mountClustered()

    const nodes = vi.mocked(queryLogs).mock.calls.map((c) => (c[2] as { node?: string }).node)
    expect(nodes).toContain(undefined)
    expect(nodes).toContain(NODE2)
  })

  it("aggregates the host chips across the cluster", async () => {
    await mountClustered()

    expect(vi.mocked(getTopStats).mock.calls[0]![3]).toMatchObject({ node: "cluster" })
  })

  it("scoped to one node it looks like the plain page: no node column, only that node's log", async () => {
    const wrapper = await mountClustered({ scope: NODE2 })

    expect(wrapper.find(".log-node").exists()).toBe(false)
    expect(wrapper.findAll("tbody tr")).toHaveLength(1)
    expect(wrapper.text()).toContain("n2-middle.test")
    expect(wrapper.find("#node-totals").exists()).toBe(false)
  })

  it("says so when a node is unreachable, and does not ask it", async () => {
    const wrapper = await mountClustered({ states: ["Self", "Unreachable"] })

    expect(wrapper.get("#logs-partial").text()).toContain(NODE2)
    const nodes = vi.mocked(queryLogs).mock.calls.map((c) => (c[2] as { node?: string }).node)
    expect(nodes).not.toContain(NODE2)
  })

  it("keeps showing the other node when one node's request fails", async () => {
    vi.mocked(queryLogs).mockImplementation((async (_c: unknown, _a: unknown, f: { node?: string }) => {
      if (f.node === NODE2) throw new Error("boom")
      const log = LOGS[NODE1]!
      return { response: { pageNumber: 1, totalPages: 1, totalEntries: log.total, entries: log.entries } }
    }) as never)

    const wrapper = await mountClustered()

    expect(wrapper.text()).toContain("n1-newest.test")
    expect(wrapper.get("#logs-partial").text()).toContain(NODE2)
  })

  it("exports one merged file with a Node column on the whole cluster", async () => {
    const csv = (rows: string) => new Blob([`﻿RowNumber,Timestamp,ClientIpAddress\n${rows}`], { type: "text/csv" })
    vi.mocked(exportLogs).mockImplementation((async (_c: unknown, _a: unknown, f: { node?: string }) => ({
      blob: f.node === NODE2 ? csv("1,2026-10-12T10:00:02Z,10.0.0.2\n") : csv("1,2026-10-12T10:00:01Z,10.0.0.1\n"),
      filename: "x.csv",
    })) as never)
    const wrapper = await mountClustered()

    await wrapper.get("#export-csv").trigger("click")
    await flush()
    await flush()

    expect(exportLogs).toHaveBeenCalledTimes(2)
    const file = vi.mocked(triggerDownload).mock.calls[0]![0] as { blob: Blob; filename: string }
    expect(file.filename).toMatch(/^cluster_.*_query_logs\.csv$/)
    const text = await file.blob.text()
    expect(text).toContain("Node,RowNumber,Timestamp")
    expect(text).toContain("node1.cluster.test,1,2026-10-12T10:00:01Z")
    expect(text).toContain("node2.cluster.test,1,2026-10-12T10:00:02Z")
  })
})
