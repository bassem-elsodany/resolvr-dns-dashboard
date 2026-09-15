import { describe, it, expect, beforeEach, vi } from "vitest"
import { mount } from "@vue/test-utils"
import { createPinia, setActivePinia } from "pinia"
import { createRouter, createMemoryHistory } from "vue-router"
import { navSections } from "./navSections"
import AppShell from "./AppShell.vue"
import { useConnectionStore } from "../../stores/connection"
import { useServerUpdateStore } from "../../stores/serverUpdate"
import OverviewView from "../../views/overview/OverviewView.vue"
import ClientsView from "../../views/monitoring/ClientsView.vue"

vi.mock("../../api/technitium", async () => {
  const actual = await vi.importActual<typeof import("../../api/technitium")>("../../api/technitium")
  return { ...actual, checkForUpdate: vi.fn().mockResolvedValue({ response: { updateAvailable: false } }) }
})

function makeRouter() {
  const routes = navSections
    .flatMap((s) => s.items)
    .map((item) => ({ path: item.to, component: item.to === "/" ? OverviewView : ClientsView }))
  routes.push({ path: "/connect", component: ClientsView })
  return createRouter({ history: createMemoryHistory(), routes })
}

describe("AppShell", () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it("renders a nav link for every sidebar item in the approved wireframe", async () => {
    const router = makeRouter()
    const wrapper = mount(AppShell, { global: { plugins: [router] } })
    await router.isReady()

    const labels = navSections.flatMap((s) => s.items.map((i) => i.label))
    for (const label of labels) {
      expect(wrapper.text()).toContain(label)
    }
    expect(wrapper.text()).toContain("Connection Settings")
  })

  it("highlights the active route's nav link", async () => {
    const router = makeRouter()
    const wrapper = mount(AppShell, { global: { plugins: [router] } })
    await router.push("/clients")
    await router.isReady()
    await wrapper.vm.$nextTick()

    const clientsLink = wrapper.findAll("a").find((a) => a.text() === "Clients")!
    expect(clientsLink.classes()).toContain("!bg-background-hover")
  })

  it("shows 'Not connected' in the sidebar when the connection store is idle", async () => {
    const router = makeRouter()
    const wrapper = mount(AppShell, { global: { plugins: [router] } })
    await router.isReady()

    expect(wrapper.text()).toContain("Not connected")
  })

  it("shows the server domain and version when the connection store is connected", async () => {
    const router = makeRouter()
    const wrapper = mount(AppShell, { global: { plugins: [router] } })
    await router.isReady()

    const connection = useConnectionStore()
    connection.status = "connected"
    connection.serverDomain = "dns.villa58.lan"
    connection.serverVersion = "15.4"
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain("dns.villa58.lan")
    expect(wrapper.text()).toContain("v15.4")
  })

  it("toggles the mobile sidebar open state when the nav toggle button is clicked", async () => {
    const router = makeRouter()
    const wrapper = mount(AppShell, { global: { plugins: [router] } })
    await router.isReady()

    const sidebar = wrapper.get("#app-sidebar")
    expect(sidebar.classes()).toContain("-translate-x-full")

    await wrapper.get("#mobile-nav-toggle").trigger("click")

    expect(sidebar.classes()).toContain("translate-x-0")
  })

  it("shows the Server Info update badge only when the shared serverUpdate store flags one", async () => {
    const router = makeRouter()
    const wrapper = mount(AppShell, { global: { plugins: [router] } })
    await router.isReady()
    expect(wrapper.find("#server-update-badge").exists()).toBe(false)

    const serverUpdate = useServerUpdateStore()
    serverUpdate.updateAvailable = true
    await wrapper.vm.$nextTick()

    expect(wrapper.find("#server-update-badge").exists()).toBe(true)
  })
})
