import { describe, it, expect, vi, beforeEach } from "vitest"
import { createPinia, setActivePinia } from "pinia"

vi.mock("../api/technitium", async () => {
  const actual = await vi.importActual<typeof import("../api/technitium")>("../api/technitium")
  return { ...actual, getUserSession: vi.fn() }
})

import { getUserSession, TechnitiumApiError } from "../api/technitium"
import { useConnectionStore } from "./connection"

describe("connection store", () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    vi.mocked(getUserSession).mockReset()
  })

  it("starts unconfigured with no stored config", () => {
    const store = useConnectionStore()

    expect(store.isConfigured).toBe(false)
    expect(store.status).toBe("idle")
  })

  it("persists the server URL and token to localStorage on setConfig", () => {
    const store = useConnectionStore()

    store.setConfig("http://10.0.60.60:5380", "secret-token")

    expect(JSON.parse(localStorage.getItem("resolvr.connection")!)).toEqual({
      baseUrl: "http://10.0.60.60:5380",
      token: "secret-token",
    })
  })

  it("trims trailing slashes and whitespace from the server URL", () => {
    const store = useConnectionStore()

    store.setConfig("  http://10.0.60.60:5380/  ", "  secret-token  ")

    expect(store.baseUrl).toBe("http://10.0.60.60:5380")
    expect(store.token).toBe("secret-token")
  })

  it("restores a previously saved config on store creation, surviving a reload", () => {
    localStorage.setItem(
      "resolvr.connection",
      JSON.stringify({ baseUrl: "http://10.0.60.60:5380", token: "secret-token" }),
    )

    const store = useConnectionStore()

    expect(store.baseUrl).toBe("http://10.0.60.60:5380")
    expect(store.token).toBe("secret-token")
    expect(store.isConfigured).toBe(true)
  })

  it("sets status to connected and records server info on a successful test", async () => {
    vi.mocked(getUserSession).mockResolvedValue({
      username: "admin",
      info: { version: "15.4", dnsServerDomain: "dns.villa58.lan", uptimestamp: "", clusterInitialized: false },
    })
    const store = useConnectionStore()
    store.setConfig("http://10.0.60.60:5380", "secret-token")

    await store.testConnection()

    expect(store.status).toBe("connected")
    expect(store.serverDomain).toBe("dns.villa58.lan")
    expect(store.serverVersion).toBe("15.4")
    expect(store.error).toBeNull()
  })

  it("sets status to error with a readable message on a failed test, not a raw stack trace", async () => {
    vi.mocked(getUserSession).mockRejectedValue(
      new TechnitiumApiError("Invalid token or session expired.", 200),
    )
    const store = useConnectionStore()
    store.setConfig("http://10.0.60.60:5380", "wrong-token")

    await store.testConnection()

    expect(store.status).toBe("error")
    expect(store.error).toBe("Invalid token or session expired.")
  })

  it("refuses to test when the server URL or token is missing", async () => {
    const store = useConnectionStore()

    await store.testConnection()

    expect(store.status).toBe("error")
    expect(getUserSession).not.toHaveBeenCalled()
  })

  it("clears config and status on disconnect", () => {
    const store = useConnectionStore()
    store.setConfig("http://10.0.60.60:5380", "secret-token")

    store.disconnect()

    expect(store.baseUrl).toBe("")
    expect(store.token).toBe("")
    expect(store.isConfigured).toBe(false)
    expect(localStorage.getItem("resolvr.connection")).toBeNull()
  })
})
