import { describe, it, expect, vi, beforeEach } from "vitest"
import { createPinia, setActivePinia } from "pinia"

vi.mock("../api/app", async () => {
  const actual = await vi.importActual<typeof import("../api/app")>("../api/app")
  return { ...actual, getStatus: vi.fn() }
})

import { getStatus } from "../api/app"
import { useConnectionStore } from "./connection"

describe("connection store", () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(getStatus).mockReset()
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
      serverDomain: "dns.example.lan",
      serverVersion: "15.4",
    })
    const store = useConnectionStore()

    await store.testConnection()

    expect(store.isConfigured).toBe(true)
    expect(store.status).toBe("connected")
    expect(store.serverDomain).toBe("dns.example.lan")
    expect(store.serverVersion).toBe("15.4")
    expect(store.error).toBeNull()
  })

  it("remembers whether the connected server is part of a Technitium cluster", async () => {
    vi.mocked(getStatus).mockResolvedValue({
      configured: true,
      connected: true,
      serverDomain: "node1.cluster.test",
      serverVersion: "15.6.1",
      clusterInitialized: true,
    })
    const store = useConnectionStore()

    await store.testConnection()

    expect(store.clusterInitialized).toBe(true)
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
})
