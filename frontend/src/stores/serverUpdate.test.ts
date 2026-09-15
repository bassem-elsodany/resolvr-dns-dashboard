import { describe, it, expect, vi, beforeEach } from "vitest"
import { createPinia, setActivePinia } from "pinia"

vi.mock("../api/technitium", async () => {
  const actual = await vi.importActual<typeof import("../api/technitium")>("../api/technitium")
  return { ...actual, checkForUpdate: vi.fn() }
})

import { checkForUpdate } from "../api/technitium"
import { useServerUpdateStore } from "./serverUpdate"

const credentials = { baseUrl: "http://10.0.60.60:5380", token: "secret" }

describe("serverUpdate store", () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(checkForUpdate).mockReset()
  })

  it("starts with no update flagged", () => {
    const store = useServerUpdateStore()
    expect(store.updateAvailable).toBe(false)
  })

  it("records an available update from a real checkForUpdate response", async () => {
    vi.mocked(checkForUpdate).mockResolvedValue({
      response: { updateAvailable: true, updateVersion: "16.0", updateTitle: "New version available" },
    })
    const store = useServerUpdateStore()

    await store.check(credentials)

    expect(store.updateAvailable).toBe(true)
    expect(store.updateVersion).toBe("16.0")
  })

  it("stays false when the server reports no update available", async () => {
    vi.mocked(checkForUpdate).mockResolvedValue({ response: { updateAvailable: false } })
    const store = useServerUpdateStore()

    await store.check(credentials)

    expect(store.updateAvailable).toBe(false)
  })

  it("fails silently on error, leaving state unchanged", async () => {
    vi.mocked(checkForUpdate).mockRejectedValue(new Error("network error"))
    const store = useServerUpdateStore()

    await expect(store.check(credentials)).resolves.toBeUndefined()
    expect(store.updateAvailable).toBe(false)
  })
})
