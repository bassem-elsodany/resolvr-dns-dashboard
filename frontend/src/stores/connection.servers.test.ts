import { describe, it, expect, vi, beforeEach } from "vitest"
import { createPinia, setActivePinia } from "pinia"

vi.mock("../api/app", async () => {
  const actual = await vi.importActual<typeof import("../api/app")>("../api/app")
  return { ...actual, getStatus: vi.fn(), setServerConfig: vi.fn(), listServers: vi.fn() }
})

import { listServers } from "../api/app"
import { getActiveServerId, setActiveServerId } from "../lib/activeServer"
import { useConnectionStore } from "./connection"

const PRIMARY = { id: 0, name: "", baseUrl: "http://a:5380", primary: true, configured: true }
const SECOND = { id: 2, name: "Segment 129", baseUrl: "http://b:5380", primary: false, configured: true }

describe("connection store: several servers", () => {
  beforeEach(() => {
    localStorage.clear()
    setActiveServerId(0)
    setActivePinia(createPinia())
    vi.mocked(listServers).mockReset()
  })

  it("loads the servers the backend knows about", async () => {
    vi.mocked(listServers).mockResolvedValue({ servers: [PRIMARY, SECOND] })
    const store = useConnectionStore()

    await store.loadServers()

    expect(store.servers).toEqual([PRIMARY, SECOND])
    expect(store.activeServerId).toBe(0)
  })

  it("falls back to the primary when the chosen server no longer exists", async () => {
    setActiveServerId(7)
    setActivePinia(createPinia())
    vi.mocked(listServers).mockResolvedValue({ servers: [PRIMARY, SECOND] })
    const store = useConnectionStore()
    expect(store.activeServerId).toBe(7)

    await store.loadServers()

    expect(store.activeServerId).toBe(0)
    expect(getActiveServerId()).toBe(0)
  })

  it("keeps working as a single-server dashboard when the list cannot be loaded", async () => {
    vi.mocked(listServers).mockRejectedValue(new Error("404"))
    const store = useConnectionStore()

    await store.loadServers()

    expect(store.servers).toEqual([])
  })
})
