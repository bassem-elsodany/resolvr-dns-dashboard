import { describe, it, expect, vi, beforeEach } from "vitest"
import { mount } from "@vue/test-utils"
import { createPinia, setActivePinia } from "pinia"

vi.mock("../api/technitium", async () => {
  const actual = await vi.importActual<typeof import("../api/technitium")>("../api/technitium")
  return { ...actual, listDhcpScopes: vi.fn(), listDhcpLeases: vi.fn() }
})

import { listDhcpScopes, listDhcpLeases, TechnitiumApiError } from "../api/technitium"
import { useConnectionStore } from "../stores/connection"
import DhcpView from "./DhcpView.vue"

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

async function mountConnected() {
  const wrapper = mount(DhcpView, { global: { stubs: { RouterLink: true } } })
  const connection = useConnectionStore()
  connection.setConfig("http://10.0.60.60:5380", "secret-token")
  await flushPromises()
  return wrapper
}

describe("DhcpView", () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    vi.mocked(listDhcpScopes).mockReset()
    vi.mocked(listDhcpLeases).mockReset()
  })

  it("renders a disabled scope matching the live server's Default scope", async () => {
    vi.mocked(listDhcpScopes).mockResolvedValue({
      response: {
        scopes: [
          { name: "Default", enabled: false, startingAddress: "192.168.1.1", endingAddress: "192.168.1.254", subnetMask: "255.255.255.0" },
        ],
      },
    })
    vi.mocked(listDhcpLeases).mockResolvedValue({ response: { leases: [] } })
    const wrapper = await mountConnected()

    expect(wrapper.text()).toContain("Default")
    expect(wrapper.text()).toContain("Disabled")
    expect(wrapper.text()).toContain("192.168.1.1")
  })

  it("shows a clear empty state, not an error, when there are no active leases", async () => {
    vi.mocked(listDhcpScopes).mockResolvedValue({ response: { scopes: [] } })
    vi.mocked(listDhcpLeases).mockResolvedValue({ response: { leases: [] } })
    const wrapper = await mountConnected()

    expect(wrapper.find("#dhcp-leases-empty").exists()).toBe(true)
    expect(wrapper.find("#dhcp-error").exists()).toBe(false)
  })

  it("renders lease rows when leases exist", async () => {
    vi.mocked(listDhcpScopes).mockResolvedValue({ response: { scopes: [] } })
    vi.mocked(listDhcpLeases).mockResolvedValue({
      response: {
        leases: [
          {
            scope: "Default",
            hardwareAddress: "AA:BB:CC:DD:EE:FF",
            address: "192.168.1.50",
            hostName: "laptop",
            leaseObtained: "2026-09-15T00:00:00Z",
            leaseExpires: "2026-09-16T00:00:00Z",
          },
        ],
      },
    })
    const wrapper = await mountConnected()

    expect(wrapper.find("#dhcp-leases-empty").exists()).toBe(false)
    expect(wrapper.text()).toContain("192.168.1.50")
    expect(wrapper.text()).toContain("laptop")
  })

  it("shows a readable inline error, not a raw stack trace, on failure", async () => {
    vi.mocked(listDhcpScopes).mockRejectedValue(new TechnitiumApiError("Invalid token or session expired.", 200))
    vi.mocked(listDhcpLeases).mockResolvedValue({ response: { leases: [] } })
    const wrapper = await mountConnected()

    expect(wrapper.find("#dhcp-error").text()).toBe("Invalid token or session expired.")
  })
})
