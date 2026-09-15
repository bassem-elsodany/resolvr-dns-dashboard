import { describe, it, expect, vi, beforeEach } from "vitest"
import { createPinia, setActivePinia } from "pinia"

vi.mock("../api/technitium", async () => {
  const actual = await vi.importActual<typeof import("../api/technitium")>("../api/technitium")
  return { ...actual, listApps: vi.fn() }
})

import { listApps, TechnitiumApiError } from "../api/technitium"
import { useQueryLogsAppStore } from "./queryLogsApp"

const credentials = { baseUrl: "http://10.0.60.60:5380", token: "secret-token" }

describe("queryLogsApp store", () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(listApps).mockReset()
  })

  it("finds the installed query-logging app via isQueryLogger, whichever backend it is", async () => {
    vi.mocked(listApps).mockResolvedValue({
      response: {
        apps: [
          { name: "Advanced Blocking", description: "", version: "11.1", updateAvailable: false, dnsApps: [{ classPath: "AdvancedBlocking.App", isQueryLogger: false }] },
          { name: "Query Logs (MySQL)", description: "", version: "9.1.1", updateAvailable: false, dnsApps: [{ classPath: "QueryLogsMySql.App", isQueryLogger: true }] },
        ],
      },
    })
    const store = useQueryLogsAppStore()

    await store.ensure(credentials)

    expect(store.app).toEqual({ name: "Query Logs (MySQL)", classPath: "QueryLogsMySql.App" })
    expect(store.name).toBe("Query Logs (MySQL)")
    expect(store.missing).toBe(false)
  })

  it("flags missing when no installed app provides query logging", async () => {
    vi.mocked(listApps).mockResolvedValue({
      response: { apps: [{ name: "Advanced Blocking", description: "", version: "11.1", updateAvailable: false }] },
    })
    const store = useQueryLogsAppStore()

    await store.ensure(credentials)

    expect(store.missing).toBe(true)
    expect(store.app).toBeNull()
  })

  it("only calls listApps once — subsequent ensure() calls reuse the cached result", async () => {
    vi.mocked(listApps).mockResolvedValue({
      response: { apps: [{ name: "Query Logs (Sqlite)", description: "", version: "9.1.1", updateAvailable: false, dnsApps: [{ classPath: "QueryLogsSqlite.App", isQueryLogger: true }] }] },
    })
    const store = useQueryLogsAppStore()

    await store.ensure(credentials)
    await store.ensure(credentials)

    expect(listApps).toHaveBeenCalledTimes(1)
  })

  it("does not treat a failed check as 'missing' — lets the caller's own queryLogs() call surface the error", async () => {
    vi.mocked(listApps).mockRejectedValue(new TechnitiumApiError("Invalid token or session expired.", 200))
    const store = useQueryLogsAppStore()

    await store.ensure(credentials)

    expect(store.missing).toBe(false)
    expect(store.checked).toBe(true)
  })
})
