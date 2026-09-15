import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  getUserSession,
  getDashboardStats,
  exportBlockedZones,
  TechnitiumApiError,
  type TechnitiumCredentials,
} from "./technitium"

const credentials: TechnitiumCredentials = {
  baseUrl: "http://10.0.60.60:5380",
  token: "secret-token",
}

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...init.headers },
  })
}

describe("technitium API client", () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("calls the backend proxy, authenticated via the session cookie rather than per-request credentials", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ username: "admin", info: { version: "15.4" } }))

    await getUserSession(credentials)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [calledUrl, calledInit] = fetchMock.mock.calls[0]!
    expect(String(calledUrl)).toBe("http://localhost:8787/api/technitium/user/session/get")
    expect(calledInit?.credentials).toBe("include")
  })

  it("builds query params from the duration type on dashboard stats", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ response: { stats: {}, mainChartData: {} } }))

    await getDashboardStats("LastDay", credentials, { utc: true })

    const [calledUrl] = fetchMock.mock.calls[0]!
    const url = new URL(String(calledUrl))
    expect(url.pathname).toBe("/api/technitium/dashboard/stats/get")
    expect(url.searchParams.get("type")).toBe("LastDay")
    expect(url.searchParams.get("utc")).toBe("true")
  })

  it("returns the parsed JSON body on success", async () => {
    const stats = { response: { stats: { totalQueries: 5133 }, mainChartData: {} } }
    fetchMock.mockResolvedValue(jsonResponse(stats))

    const result = await getDashboardStats("LastHour", credentials)

    expect(result).toEqual(stats)
  })

  it("throws a TechnitiumApiError when the proxy responds with a non-2xx status", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "Path not allowed: /zones/delete" }, { status: 403 }))

    await expect(getUserSession(credentials)).rejects.toThrow(TechnitiumApiError)
  })

  it("throws a TechnitiumApiError when Technitium itself reports status: error", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ status: "error", errorMessage: "Invalid token or session expired." }),
    )

    await expect(getUserSession(credentials)).rejects.toThrow("Invalid token or session expired.")
  })

  it("throws a TechnitiumApiError for a non-'ok', non-'error' status like 'invalid-token' (confirmed live: HTTP 200 with this exact status for a bad token)", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ status: "invalid-token", errorMessage: "Invalid token or session expired." }),
    )

    await expect(getUserSession(credentials)).rejects.toThrow("Invalid token or session expired.")
  })

  it("throws a TechnitiumApiError when the backend proxy is unreachable", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"))

    await expect(getUserSession(credentials)).rejects.toThrow(TechnitiumApiError)
  })

  it("returns a Blob and filename for export endpoints, authenticated via the session cookie", async () => {
    const csv = "domain\nexample.com\n"
    fetchMock.mockResolvedValue(
      new Response(csv, {
        status: 200,
        headers: {
          "content-type": "text/csv",
          "content-disposition": 'attachment; filename="blocked.csv"',
        },
      }),
    )

    const result = await exportBlockedZones(credentials)

    expect(result.filename).toBe("blocked.csv")
    expect(await result.blob.text()).toBe(csv)
    const [, calledInit] = fetchMock.mock.calls[0]!
    expect(calledInit?.credentials).toBe("include")
  })
})
