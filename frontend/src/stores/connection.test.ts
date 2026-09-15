import { describe, it, expect, vi, beforeEach } from "vitest"
import { createPinia, setActivePinia } from "pinia"

vi.mock("../api/app", async () => {
  const actual = await vi.importActual<typeof import("../api/app")>("../api/app")
  return { ...actual, getStatus: vi.fn(), setServerConfig: vi.fn() }
})

import { getStatus, setServerConfig, AppApiError } from "../api/app"
import { useConnectionStore } from "./connection"

describe("connection store", () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(getStatus).mockReset()
    vi.mocked(setServerConfig).mockReset()
  })

  it("starts unconfigured before the backend status has been checked", () => {
    const store = useConnectionStore()

    expect(store.isConfigured).toBe(false)
    expect(store.status).toBe("idle")
  })

  it("reflects the backend's configured/connected status after testConnection()", async () => {
    vi.mocked(getStatus).mockResolvedValue({
      configured: true,
      connected: true,
      serverDomain: "dns.villa58.lan",
      serverVersion: "15.4",
    })
    const store = useConnectionStore()

    await store.testConnection()

    expect(store.isConfigured).toBe(true)
    expect(store.status).toBe("connected")
    expect(store.serverDomain).toBe("dns.villa58.lan")
    expect(store.serverVersion).toBe("15.4")
    expect(store.error).toBeNull()
  })

  it("reports an error status when the backend has a config but can't reach Technitium", async () => {
    vi.mocked(getStatus).mockResolvedValue({
      configured: true,
      connected: false,
      serverDomain: null,
      serverVersion: null,
      error: "Could not reach Technitium server: connect ECONNREFUSED",
    })
    const store = useConnectionStore()

    await store.testConnection()

    expect(store.status).toBe("error")
    expect(store.error).toBe("Could not reach Technitium server: connect ECONNREFUSED")
  })

  it("stays idle (not an error) when nothing has been configured yet", async () => {
    vi.mocked(getStatus).mockResolvedValue({ configured: false, connected: false, serverDomain: null, serverVersion: null })
    const store = useConnectionStore()

    await store.testConnection()

    expect(store.status).toBe("idle")
    expect(store.isConfigured).toBe(false)
  })

  it("saves new connection details via the backend, which validates before persisting", async () => {
    vi.mocked(setServerConfig).mockResolvedValue({
      status: "ok",
      serverDomain: "dns.villa58.lan",
      serverVersion: "15.4",
    })
    const store = useConnectionStore()

    await store.setConfig("http://10.0.60.60:5380", "secret-token")

    expect(setServerConfig).toHaveBeenCalledWith("http://10.0.60.60:5380", "secret-token")
    expect(store.isConfigured).toBe(true)
    expect(store.status).toBe("connected")
    expect(store.serverDomain).toBe("dns.villa58.lan")
  })

  it("shows a readable error, not a raw stack trace, when saving invalid connection details fails", async () => {
    vi.mocked(setServerConfig).mockRejectedValue(new AppApiError("Invalid token or session expired.", 400))
    const store = useConnectionStore()

    await store.setConfig("http://10.0.60.60:5380", "wrong-token")

    expect(store.status).toBe("error")
    expect(store.error).toBe("Invalid token or session expired.")
    expect(store.isConfigured).toBe(false)
  })
})
