import { describe, it, expect, vi, beforeEach } from "vitest"
import { mount } from "@vue/test-utils"
import { createPinia, setActivePinia } from "pinia"

vi.mock("../../api/app", async () => {
  const actual = await vi.importActual<typeof import("../../api/app")>("../../api/app")
  return { ...actual, setServerConfig: vi.fn(), getServerConfig: vi.fn() }
})

import { setServerConfig, getServerConfig, AppApiError } from "../../api/app"
import ConnectView from "./ConnectView.vue"

describe("ConnectView", () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(setServerConfig).mockReset()
    vi.mocked(getServerConfig).mockReset().mockRejectedValue(new AppApiError("No config saved yet", 200))
  })

  it("shows the connected badge with server domain and version after a successful save", async () => {
    vi.mocked(setServerConfig).mockResolvedValue({
      status: "ok",
      serverDomain: "dns.villa58.lan",
      serverVersion: "15.4",
    })
    const wrapper = mount(ConnectView)
    await flushPromises()

    await wrapper.find("#server-url").setValue("http://10.0.60.60:5380")
    await wrapper.find("#api-token").setValue("secret-token")
    await wrapper.find("form").trigger("submit")
    await flushPromises()

    expect(setServerConfig).toHaveBeenCalledWith("http://10.0.60.60:5380", "secret-token")
    expect(wrapper.text()).toContain("Connected")
    expect(wrapper.text()).toContain("dns.villa58.lan")
    expect(wrapper.text()).toContain("v15.4")
  })

  it("shows a readable inline error on a failed save, not a raw stack trace", async () => {
    vi.mocked(setServerConfig).mockRejectedValue(new AppApiError("Invalid token or session expired.", 400))
    const wrapper = mount(ConnectView)
    await flushPromises()

    await wrapper.find("#server-url").setValue("http://10.0.60.60:5380")
    await wrapper.find("#api-token").setValue("wrong-token")
    await wrapper.find("form").trigger("submit")
    await flushPromises()

    const errorEl = wrapper.find("#connection-error")
    expect(errorEl.exists()).toBe(true)
    expect(errorEl.text()).toBe("Invalid token or session expired.")
    expect(errorEl.text()).not.toMatch(/at .*\.ts:\d+/) // not a stack trace
  })

  it("prefills the form from the currently saved server config", async () => {
    vi.mocked(getServerConfig).mockReset().mockResolvedValue({
      baseUrl: "http://10.0.60.60:5380",
      token: "existing-token",
    })
    const wrapper = mount(ConnectView)
    await flushPromises()

    expect((wrapper.get("#server-url").element as HTMLInputElement).value).toBe("http://10.0.60.60:5380")
    expect((wrapper.get("#api-token").element as HTMLInputElement).value).toBe("existing-token")
  })
})

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}
