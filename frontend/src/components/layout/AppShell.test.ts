import { describe, it, expect, beforeEach, vi } from "vitest"
import { mount } from "@vue/test-utils"
import { createPinia, setActivePinia } from "pinia"
import { createRouter, createMemoryHistory } from "vue-router"
import { navSections } from "./navSections"
import AppShell from "./AppShell.vue"
import { useConnectionStore } from "../../stores/connection"
import { useServerUpdateStore } from "../../stores/serverUpdate"
import { useSidebarCountsStore } from "../../stores/sidebarCounts"
import { useTimeRangeStore } from "../../stores/timeRange"
import { useRefreshStore } from "../../stores/refresh"
import OverviewView from "../../views/overview/OverviewView.vue"
import ClientsView from "../../views/monitoring/ClientsView.vue"

vi.mock("../../api/technitium", async () => {
  const actual = await vi.importActual<typeof import("../../api/technitium")>("../../api/technitium")
  return {
    ...actual,
    checkForUpdate: vi.fn().mockResolvedValue({ response: { updateAvailable: false } }),
    getUserSession: vi.fn(),
  }
})

import { getUserSession } from "../../api/technitium"

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

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
    vi.mocked(getUserSession).mockReset()
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

  it("renders an icon for every nav link, matching the wireframe's line icons", async () => {
    const router = makeRouter()
    const wrapper = mount(AppShell, { global: { plugins: [router] } })
    await router.isReady()

    const navLinkCount = navSections.flatMap((s) => s.items).length + 1 // +1 for Connection Settings
    expect(wrapper.findAll("a svg").length).toBe(navLinkCount)
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

  it("re-validates a saved connection on mount even when landing on a page other than /connect", async () => {
    // Regression test: testConnection() used to only run from
    // ConnectView's own onMounted, so navigating straight to any other
    // route with a valid saved token left the sidebar stuck on "Not
    // connected" forever — confirmed live with a real screenshot before
    // this fix. AppShell is the one component mounted on every route.
    vi.mocked(getUserSession).mockResolvedValue({
      username: "admin",
      info: { version: "15.4", dnsServerDomain: "dns.villa58.lan", uptimestamp: "", clusterInitialized: false },
    })
    const router = makeRouter()
    await router.push("/clients") // not /connect
    const connection = useConnectionStore()
    connection.setConfig("http://10.0.60.60:5380", "secret-token")

    const wrapper = mount(AppShell, { global: { plugins: [router] } })
    await router.isReady()
    await flushPromises()

    expect(getUserSession).toHaveBeenCalled()
    expect(wrapper.text()).toContain("dns.villa58.lan")
    expect(wrapper.text()).not.toContain("Not connected")
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

  it("renders the wireframe's topbar time-range control and refresh button on every page", async () => {
    const router = makeRouter()
    const wrapper = mount(AppShell, { global: { plugins: [router] } })
    await router.isReady()

    const rangeButtons = wrapper.get("#topbar-range-seg").findAll("button").map((b) => b.text())
    expect(rangeButtons).toEqual(["1H", "24H", "7D", "30D", "1Y"])
    expect(wrapper.find("#topbar-refresh").exists()).toBe(true)
  })

  it("clicking a topbar range button updates the shared timeRange store", async () => {
    const router = makeRouter()
    const wrapper = mount(AppShell, { global: { plugins: [router] } })
    await router.isReady()
    const timeRange = useTimeRangeStore()

    await wrapper.get("#topbar-range-seg").findAll("button")[2]!.trigger("click") // 7D

    expect(timeRange.selected).toBe("LastWeek")
  })

  it("clicking the topbar refresh button increments the shared refresh store's tick", async () => {
    const router = makeRouter()
    const wrapper = mount(AppShell, { global: { plugins: [router] } })
    await router.isReady()
    const refresh = useRefreshStore()

    await wrapper.get("#topbar-refresh").trigger("click")

    expect(refresh.tick).toBe(1)
  })

  it("shows sidebar count badges (Zones, Blocked Zones, Apps) from the sidebarCounts store", async () => {
    const router = makeRouter()
    const wrapper = mount(AppShell, { global: { plugins: [router] } })
    await router.isReady()

    const sidebarCounts = useSidebarCountsStore()
    sidebarCounts.zonesTotal = 17
    sidebarCounts.blockedZonesTotal = 13
    sidebarCounts.appsTotal = 4
    await wrapper.vm.$nextTick()

    const zonesLink = wrapper.findAll("a").find((a) => a.text().startsWith("Zones"))!
    const blockedLink = wrapper.findAll("a").find((a) => a.text().startsWith("Blocked Zones"))!
    const appsLink = wrapper.findAll("a").find((a) => a.text().startsWith("Apps"))!
    expect(zonesLink.text()).toContain("17")
    expect(blockedLink.text()).toContain("13")
    expect(appsLink.text()).toContain("4")
  })

  it("hides the Clients badge when no client is rate-limited, shows it when one is", async () => {
    const router = makeRouter()
    const wrapper = mount(AppShell, { global: { plugins: [router] } })
    await router.isReady()
    const clientsLinkFor = () => wrapper.findAll("a").find((a) => a.text().startsWith("Clients"))!

    expect(clientsLinkFor().text()).toBe("Clients")

    const sidebarCounts = useSidebarCountsStore()
    sidebarCounts.rateLimitedClients = 2
    await wrapper.vm.$nextTick()

    expect(clientsLinkFor().text()).toContain("2")
  })
})
