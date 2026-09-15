import { describe, it, expect, vi, beforeEach } from "vitest"
import { mount } from "@vue/test-utils"
import { createPinia, setActivePinia } from "pinia"

vi.mock("../../api/technitium", async () => {
  const actual = await vi.importActual<typeof import("../../api/technitium")>("../../api/technitium")
  return { ...actual, listCache: vi.fn() }
})
vi.mock("../../api/app", async () => {
  const actual = await vi.importActual<typeof import("../../api/app")>("../../api/app")
  return { ...actual, flushCache: vi.fn() }
})

import { listCache, TechnitiumApiError } from "../../api/technitium"
import { flushCache, AppApiError } from "../../api/app"
import { useConnectionStore } from "../../stores/connection"
import { useAuthStore } from "../../stores/auth"
import CacheView from "./CacheView.vue"

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

async function mountConnected() {
  const wrapper = mount(CacheView, { global: { stubs: { RouterLink: true } } })
  const connection = useConnectionStore()
  connection.isConfigured = true
  await flushPromises()
  return wrapper
}

describe("CacheView", () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    vi.mocked(listCache).mockReset()
    vi.mocked(flushCache).mockReset()
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

  it("hides the Flush cache control for a viewer", async () => {
    useAuthStore().user = { id: 2, username: "reader", role: "viewer" }
    const wrapper = await mountConnected()

    expect(wrapper.find("#flush-cache").exists()).toBe(false)
  })

  it("requires a two-step confirmation before flushing the cache, then reports success", async () => {
    useAuthStore().user = { id: 1, username: "admin", role: "admin" }
    vi.mocked(flushCache).mockResolvedValue({ status: "ok" })
    const wrapper = await mountConnected()

    await wrapper.get("#flush-cache").trigger("click")
    expect(flushCache).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain("Clear the entire cache?")

    await wrapper.get("#confirm-flush-cache").trigger("click")
    await flushPromises()

    expect(flushCache).toHaveBeenCalled()
    expect(wrapper.text()).toContain("Cache flushed.")
  })

  it("shows a readable error, not a raw stack trace, when flushing the cache fails", async () => {
    useAuthStore().user = { id: 1, username: "admin", role: "admin" }
    vi.mocked(flushCache).mockRejectedValue(new AppApiError("Could not reach Technitium server: timeout", 502))
    const wrapper = await mountConnected()

    await wrapper.get("#flush-cache").trigger("click")
    await wrapper.get("#confirm-flush-cache").trigger("click")
    await flushPromises()

    expect(wrapper.find("#flush-cache-error").text()).toBe("Could not reach Technitium server: timeout")
  })
})
