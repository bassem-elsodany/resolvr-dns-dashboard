import { describe, it, expect, vi, beforeEach } from "vitest"
import { mount } from "@vue/test-utils"
import { createPinia, setActivePinia } from "pinia"

vi.mock("../../api/technitium", async () => {
  const actual = await vi.importActual<typeof import("../../api/technitium")>("../../api/technitium")
  return { ...actual, listAdminSessions: vi.fn() }
})

import { listAdminSessions, TechnitiumApiError } from "../../api/technitium"
import { useConnectionStore } from "../../stores/connection"
import SessionsView from "./SessionsView.vue"

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

async function mountConnected() {
  const wrapper = mount(SessionsView, { global: { stubs: { RouterLink: true } } })
  const connection = useConnectionStore()
  connection.setConfig("http://10.0.60.60:5380", "secret-token")
  await flushPromises()
  return wrapper
}

describe("SessionsView", () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    vi.mocked(listAdminSessions).mockReset()
  })

  it("marks the current session and distinguishes API token vs. standard session type", async () => {
    vi.mocked(listAdminSessions).mockResolvedValue({
      response: {
        sessions: [
          {
            username: "admin",
            isCurrentSession: true,
            partialToken: "abc123",
            type: "ApiToken",
            tokenName: "claude",
            lastSeen: "2026-09-15T12:00:00Z",
            lastSeenRemoteAddress: "10.0.60.1",
            lastSeenUserAgent: "",
          },
          {
            username: "admin",
            isCurrentSession: false,
            partialToken: "def456",
            type: "Standard",
            tokenName: null,
            lastSeen: "2026-09-15T11:00:00Z",
            lastSeenRemoteAddress: "10.0.10.8",
            lastSeenUserAgent: "",
          },
        ],
      },
    })
    const wrapper = await mountConnected()

    const rows = wrapper.findAll("tbody tr")
    expect(rows[0]!.text()).toContain("this session")
    expect(rows[0]!.text()).toContain("API token")
    expect(rows[0]!.text()).toContain("claude")
    expect(rows[1]!.text()).not.toContain("this session")
    expect(rows[1]!.text()).toContain("Session")
  })

  it("makes clear the page is view-only", async () => {
    vi.mocked(listAdminSessions).mockResolvedValue({ response: { sessions: [] } })
    const wrapper = await mountConnected()

    expect(wrapper.text()).toContain("view only")
  })

  it("shows a readable inline error, not a raw stack trace, on failure", async () => {
    vi.mocked(listAdminSessions).mockRejectedValue(new TechnitiumApiError("Invalid token or session expired.", 200))
    const wrapper = await mountConnected()

    expect(wrapper.find("#sessions-error").text()).toBe("Invalid token or session expired.")
  })
})
