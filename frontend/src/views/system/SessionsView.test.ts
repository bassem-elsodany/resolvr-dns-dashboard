import { describe, it, expect, vi, beforeEach } from "vitest"
import { mount } from "@vue/test-utils"
import { createPinia, setActivePinia } from "pinia"

vi.mock("../../api/technitium", async () => {
  const actual = await vi.importActual<typeof import("../../api/technitium")>("../../api/technitium")
  return { ...actual, listAdminSessions: vi.fn() }
})
vi.mock("../../api/app", async () => {
  const actual = await vi.importActual<typeof import("../../api/app")>("../../api/app")
  return { ...actual, revokeSession: vi.fn() }
})

import { listAdminSessions, TechnitiumApiError } from "../../api/technitium"
import { revokeSession, AppApiError } from "../../api/app"
import { useConnectionStore } from "../../stores/connection"
import { useAuthStore } from "../../stores/auth"
import SessionsView from "./SessionsView.vue"

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

const twoSessions = {
  response: {
    sessions: [
      {
        username: "admin",
        isCurrentSession: true,
        partialToken: "abc123",
        type: "ApiToken" as const,
        tokenName: "claude",
        lastSeen: "2026-09-15T12:00:00Z",
        lastSeenRemoteAddress: "10.0.60.1",
        lastSeenUserAgent: "",
      },
      {
        username: "admin",
        isCurrentSession: false,
        partialToken: "def456",
        type: "Standard" as const,
        tokenName: null,
        lastSeen: "2026-09-15T11:00:00Z",
        lastSeenRemoteAddress: "10.0.10.8",
        lastSeenUserAgent: "",
      },
    ],
  },
}

async function mountConnected() {
  const wrapper = mount(SessionsView, { global: { stubs: { RouterLink: true } } })
  const connection = useConnectionStore()
  connection.isConfigured = true
  await flushPromises()
  return wrapper
}

describe("SessionsView", () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    vi.mocked(listAdminSessions).mockReset()
    vi.mocked(revokeSession).mockReset()
  })

  it("marks the current session and distinguishes API token vs. standard session type", async () => {
    vi.mocked(listAdminSessions).mockResolvedValue(twoSessions)
    const wrapper = await mountConnected()

    const rows = wrapper.findAll("tbody tr")
    expect(rows[0]!.text()).toContain("this session")
    expect(rows[0]!.text()).toContain("API token")
    expect(rows[0]!.text()).toContain("claude")
    expect(rows[1]!.text()).not.toContain("this session")
    expect(rows[1]!.text()).toContain("Session")
  })

  it("shows a readable inline error, not a raw stack trace, on failure", async () => {
    vi.mocked(listAdminSessions).mockRejectedValue(new TechnitiumApiError("Invalid token or session expired.", 200))
    const wrapper = await mountConnected()

    expect(wrapper.find("#sessions-error").text()).toBe("Invalid token or session expired.")
  })

  it("hides revoke actions entirely for a viewer", async () => {
    useAuthStore().user = { id: 2, username: "reader", role: "viewer" }
    vi.mocked(listAdminSessions).mockResolvedValue(twoSessions)
    const wrapper = await mountConnected()

    expect(wrapper.find(".revoke-session").exists()).toBe(false)
  })

  it("does not offer to revoke the current session, only other sessions", async () => {
    useAuthStore().user = { id: 1, username: "admin", role: "admin" }
    vi.mocked(listAdminSessions).mockResolvedValue(twoSessions)
    const wrapper = await mountConnected()

    expect(wrapper.findAll(".revoke-session")).toHaveLength(1)
  })

  it("requires a two-step confirmation before revoking, then refreshes the list", async () => {
    useAuthStore().user = { id: 1, username: "admin", role: "admin" }
    vi.mocked(listAdminSessions).mockResolvedValueOnce(twoSessions).mockResolvedValueOnce({
      response: { sessions: [twoSessions.response.sessions[0]!] },
    })
    vi.mocked(revokeSession).mockResolvedValue({ status: "ok" })
    const wrapper = await mountConnected()

    await wrapper.get(".revoke-session").trigger("click")
    expect(revokeSession).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain("Confirm")

    await wrapper.get("button.text-crit").trigger("click")
    await flushPromises()

    expect(revokeSession).toHaveBeenCalledWith("def456")
    expect(listAdminSessions).toHaveBeenCalledTimes(2)
  })

  it("shows a readable error, not a raw stack trace, when revoking fails", async () => {
    useAuthStore().user = { id: 1, username: "admin", role: "admin" }
    vi.mocked(listAdminSessions).mockResolvedValue(twoSessions)
    vi.mocked(revokeSession).mockRejectedValue(new AppApiError("Permission denied.", 502))
    const wrapper = await mountConnected()

    await wrapper.get(".revoke-session").trigger("click")
    await wrapper.get("button.text-crit").trigger("click")
    await flushPromises()

    expect(wrapper.find("#revoke-session-error").text()).toBe("Permission denied.")
  })
})
