import { describe, it, expect, vi, beforeEach } from "vitest"
import { mount } from "@vue/test-utils"
import { createPinia, setActivePinia } from "pinia"

vi.mock("../api/technitium", async () => {
  const actual = await vi.importActual<typeof import("../api/technitium")>("../api/technitium")
  return { ...actual, getUserSession: vi.fn() }
})

import { getUserSession, TechnitiumApiError } from "../api/technitium"
import ConnectView from "./ConnectView.vue"

describe("ConnectView", () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    vi.mocked(getUserSession).mockReset()
  })

  it("shows the connected badge with server domain and version after a successful test", async () => {
    vi.mocked(getUserSession).mockResolvedValue({
      username: "admin",
      info: { version: "15.4", dnsServerDomain: "dns.villa58.lan", uptimestamp: "", clusterInitialized: false },
    })
    const wrapper = mount(ConnectView)

    await wrapper.find("#server-url").setValue("http://10.0.60.60:5380")
    await wrapper.find("#api-token").setValue("secret-token")
    await wrapper.find("form").trigger("submit")
    await flushPromises()

    expect(wrapper.text()).toContain("Connected")
    expect(wrapper.text()).toContain("dns.villa58.lan")
    expect(wrapper.text()).toContain("v15.4")
  })

  it("shows a readable inline error on a failed test, not a raw stack trace", async () => {
    vi.mocked(getUserSession).mockRejectedValue(
      new TechnitiumApiError("Invalid token or session expired.", 200),
    )
    const wrapper = mount(ConnectView)

    await wrapper.find("#server-url").setValue("http://10.0.60.60:5380")
    await wrapper.find("#api-token").setValue("wrong-token")
    await wrapper.find("form").trigger("submit")
    await flushPromises()

    const errorEl = wrapper.find("#connection-error")
    expect(errorEl.exists()).toBe(true)
    expect(errorEl.text()).toBe("Invalid token or session expired.")
    expect(errorEl.text()).not.toMatch(/at .*\.ts:\d+/) // not a stack trace
  })
})

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}
