import { describe, it, expect, vi, beforeEach } from "vitest"
import { flushPromises, mount } from "@vue/test-utils"
import { createPinia, setActivePinia } from "pinia"

vi.mock("../../api/app", async () => {
  const actual = await vi.importActual<typeof import("../../api/app")>("../../api/app")
  return {
    ...actual,
    getServerConfig: vi.fn(),
    listServers: vi.fn(),
    addServer: vi.fn(),
    removeServer: vi.fn(),
    updateServer: vi.fn(),
    testServer: vi.fn(),
    setServerConfig: vi.fn(),
  }
})

import { getServerConfig, listServers, addServer, removeServer, updateServer, testServer, AppApiError } from "../../api/app"
import { useConnectionStore } from "../../stores/connection"
import ConnectView from "./ConnectView.vue"

const PRIMARY = { id: 0, name: "", baseUrl: "http://a:5380", primary: true, configured: true }
const SECOND = { id: 2, name: "Segment 129", baseUrl: "http://b:5380", primary: false, configured: true }

async function mountView() {
  const wrapper = mount(ConnectView)
  await useConnectionStore().loadServers()
  await flushPromises()
  return wrapper
}

describe("ConnectView: servers", () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    for (const fn of [addServer, removeServer, updateServer, testServer, listServers, getServerConfig]) vi.mocked(fn).mockReset()
    vi.mocked(getServerConfig).mockResolvedValue({ baseUrl: "http://a:5380", token: "t" })
    vi.mocked(listServers).mockResolvedValue({ servers: [PRIMARY, SECOND] })
  })

  it("lists the existing connections, with the primary not editable or removable", async () => {
    const wrapper = await mountView()

    const rows = wrapper.findAll("#server-list li")
    expect(rows).toHaveLength(2)
    expect(rows[0]!.text()).toContain("Primary")
    expect(rows[0]!.find("input").exists()).toBe(false)
    expect(rows[0]!.text()).not.toContain("Remove")
    expect((rows[1]!.find("input").element as HTMLInputElement).value).toBe("Segment 129")
    expect(rows[1]!.text()).toContain("http://b:5380")
  })

  it("renames a server from its row, only offering Save once the name changed", async () => {
    vi.mocked(updateServer).mockResolvedValue({ ...SECOND, name: "DMZ" })
    const wrapper = await mountView()
    const row = wrapper.findAll("#server-list li")[1]!
    expect(row.text()).not.toContain("Save")

    await row.find("input").setValue("DMZ")
    expect(row.text()).toContain("Save")
    await row.findAll("button").find((b) => b.text() === "Save")!.trigger("click")
    await flushPromises()

    expect(updateServer).toHaveBeenCalledWith(2, "DMZ")
  })

  it("removes a server from its row", async () => {
    vi.mocked(removeServer).mockResolvedValue({ status: "ok" })
    const wrapper = await mountView()

    await wrapper.findAll("#server-list li")[1]!.findAll("button").find((b) => b.text() === "Remove")!.trigger("click")
    await flushPromises()

    expect(removeServer).toHaveBeenCalledWith(2)
  })

  it("tests a new server without adding it", async () => {
    vi.mocked(testServer).mockResolvedValue({ status: "ok", serverDomain: "dns.example.lan", serverVersion: "15.6" })
    const wrapper = await mountView()

    await wrapper.find("#new-server-url").setValue("http://c:5380")
    await wrapper.find("#new-server-token").setValue("tok")
    await wrapper.find("#test-new-server").trigger("click")
    await flushPromises()

    expect(testServer).toHaveBeenCalledWith("http://c:5380", "tok")
    expect(addServer).not.toHaveBeenCalled()
    expect(wrapper.find("#test-result").text()).toContain("dns.example.lan")
  })

  it("shows why a test failed", async () => {
    vi.mocked(testServer).mockRejectedValue(new AppApiError("Invalid token", 400))
    const wrapper = await mountView()

    await wrapper.find("#new-server-url").setValue("http://c:5380")
    await wrapper.find("#new-server-token").setValue("bad")
    await wrapper.find("#test-new-server").trigger("click")
    await flushPromises()

    expect(wrapper.find("#server-error").text()).toBe("Invalid token")
  })

  it("keeps Add disabled until there is a name, URL and token, then adds and clears the form", async () => {
    vi.mocked(addServer).mockResolvedValue({ id: 3, name: "New", baseUrl: "http://c:5380", primary: false, configured: true })
    const wrapper = await mountView()
    const add = wrapper.find("#add-server")
    expect(add.attributes("disabled")).toBeDefined()

    await wrapper.find("#new-server-name").setValue("New")
    await wrapper.find("#new-server-url").setValue("http://c:5380")
    await wrapper.find("#new-server-token").setValue("tok")
    expect(add.attributes("disabled")).toBeUndefined()
    await wrapper.findAll("form")[1]!.trigger("submit")
    await flushPromises()

    expect(addServer).toHaveBeenCalledWith("New", "http://c:5380", "tok")
    expect((wrapper.find("#new-server-name").element as HTMLInputElement).value).toBe("")
  })
})

describe("ConnectView: primary badge", () => {
  it("names the primary after a save, not the server the sidebar has selected", async () => {
    setActivePinia(createPinia())
    vi.mocked(getServerConfig).mockResolvedValue({ baseUrl: "http://a:5380", token: "t" })
    vi.mocked(listServers).mockResolvedValue({ servers: [PRIMARY, SECOND] })
    const { setServerConfig } = await import("../../api/app")
    vi.mocked(setServerConfig).mockResolvedValue({ status: "ok", serverDomain: "primary.lan", serverVersion: "15.6" })
    const store = useConnectionStore()
    // The sidebar is looking at another server.
    store.activeServerId = 2
    store.serverDomain = "segment-129.lan"
    store.status = "connected"
    const wrapper = mount(ConnectView)
    await flushPromises()
    expect(wrapper.text()).not.toContain("segment-129.lan")

    await wrapper.find("#server-url").setValue("http://a:5380")
    await wrapper.find("#api-token").setValue("t")
    await wrapper.find("form").trigger("submit")
    await flushPromises()

    expect(wrapper.text()).toContain("primary.lan")
    expect(wrapper.text()).not.toContain("segment-129.lan")
  })
})
