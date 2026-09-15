import { describe, it, expect, vi, beforeEach } from "vitest"
import { createPinia, setActivePinia } from "pinia"

vi.mock("../api/app", async () => {
  const actual = await vi.importActual<typeof import("../api/app")>("../api/app")
  return { ...actual, fetchMe: vi.fn() }
})

import { fetchMe, AppApiError } from "../api/app"
import { router } from "./index"

describe("router auth guard", () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(fetchMe).mockReset()
  })

  it("redirects an unauthenticated visitor to /login, preserving the intended destination", async () => {
    vi.mocked(fetchMe).mockRejectedValue(new AppApiError("Not authenticated", 401))

    await router.push("/zones")

    expect(router.currentRoute.value.path).toBe("/login")
    expect(router.currentRoute.value.query.redirect).toBe("/zones")
  })

  it("lets an authenticated viewer through to a regular page", async () => {
    vi.mocked(fetchMe).mockResolvedValue({ id: 2, username: "reader", role: "viewer" })

    await router.push("/zones")

    expect(router.currentRoute.value.path).toBe("/zones")
  })

  it("bounces a signed-in viewer away from an admin-only route (Connection Settings)", async () => {
    vi.mocked(fetchMe).mockResolvedValue({ id: 2, username: "reader", role: "viewer" })

    await router.push("/connect")

    expect(router.currentRoute.value.path).toBe("/")
  })

  it("lets an admin reach an admin-only route", async () => {
    vi.mocked(fetchMe).mockResolvedValue({ id: 1, username: "admin", role: "admin" })

    await router.push("/users")

    expect(router.currentRoute.value.path).toBe("/users")
  })

  it("redirects an already-authenticated visitor away from /login", async () => {
    vi.mocked(fetchMe).mockResolvedValue({ id: 1, username: "admin", role: "admin" })

    await router.push("/login")

    expect(router.currentRoute.value.path).toBe("/")
  })
})
