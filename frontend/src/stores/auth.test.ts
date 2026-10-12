import { describe, it, expect, vi, beforeEach } from "vitest"
import { createPinia, setActivePinia } from "pinia"

vi.mock("../api/app", async () => {
  const actual = await vi.importActual<typeof import("../api/app")>("../api/app")
  return { ...actual, login: vi.fn(), logout: vi.fn(), fetchMe: vi.fn() }
})

import { login, logout, fetchMe, AppApiError } from "../api/app"
import { useAuthStore } from "./auth"

describe("auth store", () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(login).mockReset()
    vi.mocked(logout).mockReset()
    vi.mocked(fetchMe).mockReset()
  })

  it("starts unauthenticated and unchecked", () => {
    const store = useAuthStore()

    expect(store.isAuthenticated).toBe(false)
    expect(store.checked).toBe(false)
  })

  it("checkSession populates the current user from an existing session cookie", async () => {
    vi.mocked(fetchMe).mockResolvedValue({ id: 1, username: "admin", role: "admin" })
    const store = useAuthStore()

    await store.checkSession()

    expect(store.isAuthenticated).toBe(true)
    expect(store.isAdmin).toBe(true)
    expect(store.checked).toBe(true)
  })

  it("checkSession leaves the store unauthenticated (not throwing) when there's no session", async () => {
    vi.mocked(fetchMe).mockRejectedValue(new AppApiError("Not authenticated", 401))
    const store = useAuthStore()

    await store.checkSession()

    expect(store.isAuthenticated).toBe(false)
    expect(store.checked).toBe(true)
  })

  it("login sets the current user on success", async () => {
    vi.mocked(login).mockResolvedValue({ id: 2, username: "reader", role: "viewer" })
    vi.mocked(fetchMe).mockResolvedValue({ id: 2, username: "reader", role: "viewer" })
    const store = useAuthStore()

    const ok = await store.login("reader", "readerpass1")

    expect(ok).toBe(true)
    expect(store.user).toEqual({ id: 2, username: "reader", role: "viewer" })
    expect(store.isAdmin).toBe(false)
  })

  // The browser can silently drop the session cookie (a Secure cookie over
  // plain http://), so the sign-in call returns 200 while every later request
  // is 401 (issue #18). The store must not report "signed in" in that case.
  it("login says the cookie is not being sent, and stays signed out, when the next request is unauthenticated", async () => {
    vi.mocked(login).mockResolvedValue({ id: 1, username: "admin", role: "admin" })
    vi.mocked(fetchMe).mockRejectedValue(new AppApiError("Not authenticated", 401))
    const store = useAuthStore()

    const ok = await store.login("admin", "adminpass1")

    expect(ok).toBe(false)
    expect(store.isAuthenticated).toBe(false)
    expect(store.error).toMatch(/session cookie/i)
    expect(store.error).toMatch(/COOKIE_SECURE/)
  })

  it("login still succeeds when the follow-up check fails for a reason that is not a 401", async () => {
    vi.mocked(login).mockResolvedValue({ id: 1, username: "admin", role: "admin" })
    vi.mocked(fetchMe).mockRejectedValue(new AppApiError("Bad gateway", 502))
    const store = useAuthStore()

    expect(await store.login("admin", "adminpass1")).toBe(true)
    expect(store.isAuthenticated).toBe(true)
  })

  it("login surfaces a readable error, not a raw stack trace, on invalid credentials", async () => {
    vi.mocked(login).mockRejectedValue(new AppApiError("Invalid username or password", 401))
    const store = useAuthStore()

    const ok = await store.login("reader", "wrong-password")

    expect(ok).toBe(false)
    expect(store.error).toBe("Invalid username or password")
    expect(store.isAuthenticated).toBe(false)
  })

  it("logout clears the current user", async () => {
    vi.mocked(login).mockResolvedValue({ id: 1, username: "admin", role: "admin" })
    vi.mocked(logout).mockResolvedValue({ status: "ok" })
    vi.mocked(fetchMe).mockResolvedValue({ id: 1, username: "admin", role: "admin" })
    const store = useAuthStore()
    await store.login("admin", "adminpass1")

    await store.logout()

    expect(store.isAuthenticated).toBe(false)
  })
})
