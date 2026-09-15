import { describe, it, expect, vi, beforeEach } from "vitest"
import { mount } from "@vue/test-utils"
import { createPinia, setActivePinia } from "pinia"

vi.mock("../../api/technitium", async () => {
  const actual = await vi.importActual<typeof import("../../api/technitium")>("../../api/technitium")
  return { ...actual, getSettings: vi.fn() }
})

import { getSettings, TechnitiumApiError } from "../../api/technitium"
import { useConnectionStore } from "../../stores/connection"
import { useServerUpdateStore } from "../../stores/serverUpdate"
import ServerInfoView from "./ServerInfoView.vue"

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

const sampleSettings = {
  version: "15.4",
  uptimestamp: "2026-09-15T11:00:43.9337405Z",
  dnsServerDomain: "dns.villa58.lan",
  dnsServerLocalEndPoints: ["0.0.0.0:53", "[::]:53"],
  ipv6Mode: "Disabled",
  dnssecValidation: true,
  eDnsClientSubnet: false,
  udpPayloadSize: 1232,
  defaultRecordTtl: 3600,
  defaultNsRecordTtl: 14400,
  defaultSoaRecordTtl: 900,
  qpmPrefixLimitsIPv4: [{ prefix: 32, udpLimit: 600, tcpLimit: 600 }],
  qpmLimitSampleMinutes: 5,
}

async function mountConnected() {
  const wrapper = mount(ServerInfoView, { global: { stubs: { RouterLink: true } } })
  const connection = useConnectionStore()
  connection.setConfig("http://10.0.60.60:5380", "secret-token")
  await flushPromises()
  return wrapper
}

describe("ServerInfoView", () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    vi.mocked(getSettings).mockReset()
  })

  it("renders real settings values across all four panels", async () => {
    vi.mocked(getSettings).mockResolvedValue({ response: sampleSettings })
    const wrapper = await mountConnected()

    expect(wrapper.text()).toContain("dns.villa58.lan")
    expect(wrapper.text()).toContain("15.4")
    expect(wrapper.text()).toContain("Enabled") // DNSSEC validation
    expect(wrapper.text()).toContain("600 qpm UDP")
    expect(wrapper.text()).toContain("3,600s")
  })

  it("shows the update banner only when the shared serverUpdate store has one", async () => {
    vi.mocked(getSettings).mockResolvedValue({ response: sampleSettings })
    const wrapper = await mountConnected()
    expect(wrapper.find("#update-banner").exists()).toBe(false)

    const serverUpdate = useServerUpdateStore()
    serverUpdate.updateAvailable = true
    serverUpdate.updateVersion = "16.0"
    await wrapper.vm.$nextTick()

    expect(wrapper.find("#update-banner").text()).toContain("16.0")
  })

  it("shows a readable inline error, not a raw stack trace, on failure", async () => {
    vi.mocked(getSettings).mockRejectedValue(new TechnitiumApiError("Invalid token or session expired.", 200))
    const wrapper = await mountConnected()

    expect(wrapper.find("#server-info-error").text()).toBe("Invalid token or session expired.")
  })

  it("shows a loading state instead of a blank page while settings are in flight", async () => {
    let resolveFetch: (value: Awaited<ReturnType<typeof getSettings>>) => void = () => {}
    vi.mocked(getSettings).mockReturnValue(new Promise((resolve) => (resolveFetch = resolve)))

    const wrapper = mount(ServerInfoView, { global: { stubs: { RouterLink: true } } })
    const connection = useConnectionStore()
    connection.setConfig("http://10.0.60.60:5380", "secret-token")
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain("Loading")
    expect(wrapper.find("#server-info-error").exists()).toBe(false)

    resolveFetch({ response: sampleSettings })
    await flushPromises()

    expect(wrapper.text()).toContain("dns.villa58.lan")
  })
})
