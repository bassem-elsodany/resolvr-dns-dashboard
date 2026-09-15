import { describe, it, expect, vi, beforeEach } from "vitest"
import { mount } from "@vue/test-utils"
import { createPinia, setActivePinia } from "pinia"

vi.mock("../../api/technitium", async () => {
  const actual = await vi.importActual<typeof import("../../api/technitium")>("../../api/technitium")
  return { ...actual, resolveDnsQuery: vi.fn() }
})

import { resolveDnsQuery, TechnitiumApiError } from "../../api/technitium"
import { useConnectionStore } from "../../stores/connection"
import ResolverView from "./ResolverView.vue"

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

async function mountConnected() {
  const wrapper = mount(ResolverView, { global: { stubs: { RouterLink: true } } })
  const connection = useConnectionStore()
  connection.isConfigured = true
  await flushPromises()
  return wrapper
}

describe("ResolverView", () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    vi.mocked(resolveDnsQuery).mockReset()
  })

  it("renders the real answer, RTT and classification for a successful resolve", async () => {
    vi.mocked(resolveDnsQuery).mockResolvedValue({
      response: {
        result: {
          Metadata: { NameServer: "hera.ns.cloudflare.com (173.245.58.162)", Protocol: "Udp", DatagramSize: "72 bytes", RoundTripTime: "7.26 ms" },
          RCODE: "NoError",
          Question: [{ Name: "example.com", Type: "A", Class: "IN" }],
          Answer: [{ Name: "example.com", Type: "A", Class: "IN", TTL: "300 (5m)", RDATA: { IPAddress: "104.20.23.154" } }],
          Authority: [],
          Additional: [],
        },
      },
    })
    const wrapper = await mountConnected()

    await wrapper.get("#resolve-domain").setValue("example.com")
    await wrapper.get("form").trigger("submit")
    await flushPromises()

    expect(resolveDnsQuery).toHaveBeenCalledWith(
      "example.com",
      "A",
      expect.anything(),
      expect.objectContaining({ server: "this-server" }),
    )
    expect(wrapper.text()).toContain("NoError")
    expect(wrapper.text()).toContain("7.26 ms")
    expect(wrapper.text()).toContain("104.20.23.154")
  })

  it("renders a non-error RCODE like NXDOMAIN clearly, not as a blank result", async () => {
    vi.mocked(resolveDnsQuery).mockResolvedValue({
      response: {
        result: {
          Metadata: { NameServer: "dns.villa58.lan", Protocol: "Udp", DatagramSize: "40 bytes", RoundTripTime: "0.1 ms" },
          RCODE: "NxDomain",
          Question: [{ Name: "sessions.bugsnag.com", Type: "A", Class: "IN" }],
          Answer: [],
          Authority: [],
          Additional: [],
        },
      },
    })
    const wrapper = await mountConnected()

    await wrapper.get("#resolve-domain").setValue("sessions.bugsnag.com")
    await wrapper.get("form").trigger("submit")
    await flushPromises()

    expect(wrapper.text()).toContain("NxDomain")
    expect(wrapper.text()).toContain("No answer records.")
  })

  it("shows a readable inline error, not a raw stack trace, when the request itself fails", async () => {
    vi.mocked(resolveDnsQuery).mockRejectedValue(new TechnitiumApiError("Could not reach Technitium server: timeout", 502))
    const wrapper = await mountConnected()

    await wrapper.get("#resolve-domain").setValue("example.com")
    await wrapper.get("form").trigger("submit")
    await flushPromises()

    expect(wrapper.find("#resolve-error").text()).toBe("Could not reach Technitium server: timeout")
  })
})
