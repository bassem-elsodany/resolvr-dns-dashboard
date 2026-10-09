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

describe("router when Home Assistant signs the user in", () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(fetchMe).mockReset()
  })

  it("keeps the user away from Users, which only makes sense with Resolvr's own accounts", async () => {
    vi.mocked(fetchMe).mockResolvedValue({ id: 0, username: "Bassem", role: "admin", external: true })
    await router.push("/zones")
    await router.push("/users")
    expect(router.currentRoute.value.path).toBe("/")
  })

  it("still lets that user into the other admin page", async () => {
    vi.mocked(fetchMe).mockResolvedValue({ id: 0, username: "Bassem", role: "admin", external: true })
    await router.push("/connect")
    expect(router.currentRoute.value.path).toBe("/connect")
  })
})

describe("router base", () => {
  it("is the path prefix the server wrote into <base href>", async () => {
    const base = document.createElement("base")
    base.href = "http://homeassistant.local:8123/api/hassio_ingress/aB3-_x9/"
    document.head.appendChild(base)
    vi.resetModules()
    const mod = await import("./index")
    expect(mod.router.options.history.base).toBe("/api/hassio_ingress/aB3-_x9")
    base.remove()
  })
})

