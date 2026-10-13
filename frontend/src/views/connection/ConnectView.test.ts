import { describe, it, expect, vi, beforeEach } from "vitest"
import { flushPromises, mount } from "@vue/test-utils"
import { createPinia, setActivePinia } from "pinia"

vi.mock("../../api/app", async () => {
  const actual = await vi.importActual<typeof import("../../api/app")>("../../api/app")
  return {
    ...actual,
    getStatus: vi.fn().mockResolvedValue({ configured: true, connected: true, serverDomain: "a.lan", serverVersion: "15.6" }),
    listServers: vi.fn(),
    addServer: vi.fn(),
    removeServer: vi.fn(),
    updateServer: vi.fn(),
    testServer: vi.fn(),
    testSavedServer: vi.fn(),
  }
})

import { listServers, addServer, removeServer, updateServer, testServer, testSavedServer, AppApiError } from "../../api/app"
import { useConnectionStore } from "../../stores/connection"
import { setActiveServerId } from "../../lib/activeServer"
import ConnectView from "./ConnectView.vue"

const FIRST = { id: 0, name: "Segment 128", baseUrl: "http://a:5380", primary: true, configured: true }
const SECOND = { id: 2, name: "Segment 129", baseUrl: "http://b:5380", primary: false, configured: true }

async function mountView() {
  const wrapper = mount(ConnectView)
  await useConnectionStore().loadServers()
  await flushPromises()
  return wrapper
}

describe("ConnectView", () => {
  beforeEach(() => {
    localStorage.clear()
    setActiveServerId(0)
    setActivePinia(createPinia())
    for (const fn of [addServer, removeServer, updateServer, testServer, testSavedServer, listServers]) vi.mocked(fn).mockReset()
    vi.mocked(listServers).mockResolvedValue({ servers: [FIRST, SECOND] })
  })

  it("has no separate form for a primary connection: every server is a row", async () => {
    const wrapper = await mountView()

    expect(wrapper.find("#server-url").exists()).toBe(false)
    expect(wrapper.find("#api-token").exists()).toBe(false)
    expect(wrapper.text()).not.toContain("Test connection")
    const rows = wrapper.findAll("#server-list li")
    expect(rows).toHaveLength(2)
    expect((rows[0]!.find("input").element as HTMLInputElement).value).toBe("Segment 128")
    expect(rows[0]!.text()).toContain("http://a:5380")
    expect(rows[0]!.text()).toContain("Remove")
    expect((rows[1]!.find("input").element as HTMLInputElement).value).toBe("Segment 129")
  })

  it("renames a server in place when the field is left, the first one included", async () => {
    vi.mocked(updateServer).mockResolvedValue({ ...FIRST, name: "Core" })
    const wrapper = await mountView()
    const input = wrapper.findAll("#server-list li")[0]!.find("input")

    await input.setValue("Core")
    await input.trigger("blur")
    await flushPromises()

    expect(updateServer).toHaveBeenCalledWith(0, "Core")
  })

  it("does not save when the name is unchanged or emptied", async () => {
    const wrapper = await mountView()
    const input = wrapper.find("#server-list li input")

    await input.trigger("blur")
    await input.setValue("   ")
    await input.trigger("blur")
    await flushPromises()

    expect(updateServer).not.toHaveBeenCalled()
  })

  it("removes a server from its row", async () => {
    vi.mocked(removeServer).mockResolvedValue({ status: "ok" })
    const wrapper = await mountView()

    await wrapper.findAll("#server-list li")[1]!.findAll("button").find((b) => b.text() === "Remove")!.trigger("click")
    await flushPromises()

    expect(removeServer).toHaveBeenCalledWith(2)
  })

  it("can remove the first server too", async () => {
    vi.mocked(removeServer).mockResolvedValue({ status: "ok" })
    const wrapper = await mountView()

    await wrapper.findAll("#server-list li")[0]!.findAll("button").find((b) => b.text() === "Remove")!.trigger("click")
    await flushPromises()

    expect(removeServer).toHaveBeenCalledWith(0)
  })

  it("leaves a server managed by the Home Assistant add-on without a Remove button", async () => {
    vi.mocked(listServers).mockResolvedValue({ servers: [{ ...FIRST, managed: true }] })
    const wrapper = await mountView()

    const row = wrapper.find("#server-list li")
    expect(row.text()).not.toContain("Remove")
    expect(row.text()).toContain("Configuration tab")
  })

  it("has a Test button on every listed server, the managed one included", async () => {
    vi.mocked(listServers).mockResolvedValue({ servers: [{ ...FIRST, managed: true }, SECOND] })
    const wrapper = await mountView()

    for (const row of wrapper.findAll("#server-list li")) {
      expect(row.findAll("button").some((b) => b.text() === "Test")).toBe(true)
    }
  })

  it("tests a listed server and shows the result on its row", async () => {
    vi.mocked(testSavedServer).mockResolvedValue({ status: "ok", serverDomain: "b.lan", serverVersion: "15.6" })
    const wrapper = await mountView()

    await wrapper.findAll("#server-list li")[1]!.findAll("button").find((b) => b.text() === "Test")!.trigger("click")
    await flushPromises()

    expect(testSavedServer).toHaveBeenCalledWith(2)
    expect(wrapper.find("#server-test-result-2").text()).toContain("b.lan")
    expect(wrapper.find("#server-test-result-0").exists()).toBe(false)
  })

  it("shows why a listed server failed its test", async () => {
    vi.mocked(testSavedServer).mockRejectedValue(new AppApiError("Token expired", 400))
    const wrapper = await mountView()

    await wrapper.findAll("#server-list li")[0]!.findAll("button").find((b) => b.text() === "Test")!.trigger("click")
    await flushPromises()

    expect(wrapper.find("#server-test-result-0").text()).toBe("Token expired")
  })

  it("asks for a first server when there are none", async () => {
    vi.mocked(listServers).mockResolvedValue({ servers: [] })
    const wrapper = await mountView()

    expect(wrapper.find("#server-list").exists()).toBe(false)
    expect(wrapper.find("#no-servers").exists()).toBe(true)
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
    await wrapper.find("form").trigger("submit")
    await flushPromises()

    expect(addServer).toHaveBeenCalledWith("New", "http://c:5380", "tok")
    expect((wrapper.find("#new-server-name").element as HTMLInputElement).value).toBe("")
  })

  it("shows the backend's reason when adding fails", async () => {
    vi.mocked(addServer).mockRejectedValue(new AppApiError("Could not reach the Technitium server", 400))
    const wrapper = await mountView()

    await wrapper.find("#new-server-name").setValue("New")
    await wrapper.find("#new-server-url").setValue("http://c:5380")
    await wrapper.find("#new-server-token").setValue("tok")
    await wrapper.find("form").trigger("submit")
    await flushPromises()

    expect(wrapper.find("#server-error").text()).toContain("Could not reach")
  })
})
