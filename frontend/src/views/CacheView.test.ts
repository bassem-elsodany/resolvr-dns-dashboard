import { describe, it, expect, vi, beforeEach } from "vitest"
import { mount } from "@vue/test-utils"
import { createPinia, setActivePinia } from "pinia"

vi.mock("../api/technitium", async () => {
  const actual = await vi.importActual<typeof import("../api/technitium")>("../api/technitium")
  return { ...actual, listCache: vi.fn() }
})

import { listCache, TechnitiumApiError } from "../api/technitium"
import { useConnectionStore } from "../stores/connection"
import CacheView from "./CacheView.vue"

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

async function mountConnected() {
  const wrapper = mount(CacheView, { global: { stubs: { RouterLink: true } } })
  const connection = useConnectionStore()
  connection.setConfig("http://10.0.60.60:5380", "secret-token")
  await flushPromises()
  return wrapper
}

describe("CacheView", () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    vi.mocked(listCache).mockReset()
  })

  it("renders cached records for a domain the user browses to", async () => {
    vi.mocked(listCache).mockResolvedValue({
      response: {
        domain: "google.com",
        zones: [],
        records: [
          { name: "google.com", type: "A", ttl: "283 (4 mins 43 sec)", rData: { value: "216.58.199.174" } },
        ],
      },
    })
    const wrapper = await mountConnected()

    await wrapper.get("#cache-domain").setValue("google.com")
    await wrapper.get("form").trigger("submit")
    await flushPromises()

    expect(listCache).toHaveBeenCalledWith("google.com", expect.anything())
    expect(wrapper.text()).toContain("216.58.199.174")
    expect(wrapper.text()).toContain("283 (4 mins 43 sec)")
  })

  it("shows a clear empty state, not an error, when nothing is cached for the domain", async () => {
    vi.mocked(listCache).mockResolvedValue({ response: { domain: "unknown.example", zones: [], records: [] } })
    const wrapper = await mountConnected()

    await wrapper.get("#cache-domain").setValue("unknown.example")
    await wrapper.get("form").trigger("submit")
    await flushPromises()

    expect(wrapper.find("#cache-empty").exists()).toBe(true)
    expect(wrapper.find("#cache-error").exists()).toBe(false)
  })

  it("shows a readable inline error, not a raw stack trace, on failure", async () => {
    vi.mocked(listCache).mockRejectedValue(new TechnitiumApiError("Invalid domain name.", 200))
    const wrapper = await mountConnected()

    await wrapper.get("#cache-domain").setValue("bad domain")
    await wrapper.get("form").trigger("submit")
    await flushPromises()

    expect(wrapper.find("#cache-error").text()).toBe("Invalid domain name.")
  })

  it("disables the Browse button and shows a loading label while the fetch is in flight", async () => {
    let resolveFetch: (value: Awaited<ReturnType<typeof listCache>>) => void = () => {}
    vi.mocked(listCache).mockReturnValue(new Promise((resolve) => (resolveFetch = resolve)))
    const wrapper = await mountConnected()

    await wrapper.get("#cache-domain").setValue("google.com")
    await wrapper.get("form").trigger("submit")
    await wrapper.vm.$nextTick()

    const button = wrapper.get("#browse-cache")
    expect(button.attributes("disabled")).toBeDefined()
    expect(button.text()).toBe("Browsing…")

    resolveFetch({ response: { domain: "google.com", zones: [], records: [] } })
    await flushPromises()

    expect(wrapper.get("#browse-cache").text()).toBe("Browse")
  })
})
