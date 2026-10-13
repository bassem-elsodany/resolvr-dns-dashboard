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
import { useAuthStore } from "../../stores/auth"
import OverviewView from "../../views/overview/OverviewView.vue"
import ClientsView from "../../views/monitoring/ClientsView.vue"

vi.mock("../../api/technitium", async () => {
  const actual = await vi.importActual<typeof import("../../api/technitium")>("../../api/technitium")
  return { ...actual, checkForUpdate: vi.fn().mockResolvedValue({ response: { updateAvailable: false } }) }
})

vi.mock("../../api/app", async () => {
  const actual = await vi.importActual<typeof import("../../api/app")>("../../api/app")
  return {
    ...actual,
    getStatus: vi.fn().mockResolvedValue({ configured: false, connected: false, serverDomain: null, serverVersion: null }),
    listServers: vi.fn().mockResolvedValue({ servers: [] }),
  }
})

import { getStatus, listServers } from "../../api/app"
import { setActiveServerId } from "../../lib/activeServer"

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

// Most AppShell chrome (nav list minus admin-only items, sidebar
// status, topbar) is the same for any signed-in role — these tests run
// as an admin unless a test is specifically about role gating, since
// admin is the superset view.
function signInAsAdmin(): void {
  const auth = useAuthStore()
  auth.user = { id: 1, username: "admin", role: "admin" }
  auth.checked = true
}

describe("AppShell", () => {
  beforeEach(() => {
    localStorage.clear()
    setActiveServerId(0)
    document.title = "Resolvr"
    setActivePinia(createPinia())
    vi.mocked(listServers).mockReset().mockResolvedValue({ servers: [] })
    vi.mocked(getStatus)
      .mockReset()
      .mockResolvedValue({ configured: false, connected: false, serverDomain: null, serverVersion: null })
  })

  it("renders a nav link for every sidebar item in the approved wireframe, when signed in as admin", async () => {
    signInAsAdmin()
    const router = makeRouter()
    const wrapper = mount(AppShell, { global: { plugins: [router] } })
    await router.isReady()

    const labels = navSections.flatMap((s) => s.items.map((i) => i.label))
    for (const label of labels) {
      expect(wrapper.text()).toContain(label)
    }
    expect(wrapper.text()).toContain("Connection Settings")
  })

  it("shows the app version as a tag next to the app name", async () => {
    signInAsAdmin()
    const router = makeRouter()
    const wrapper = mount(AppShell, { global: { plugins: [router] } })
    await router.isReady()

    const tag = wrapper.get("#app-version")
    expect(tag.text()).toBe(`v${__APP_VERSION__}`)
    expect(__APP_VERSION__).toMatch(/^\d+\.\d+\.\d+/)
    // Same header block as the name, not somewhere else in the sidebar.
    expect(tag.element.parentElement!.textContent).toContain("Resolvr")
  })

  it("hides Log out and Users when Home Assistant signed the user in", async () => {
    const auth = useAuthStore()
    auth.user = { id: 0, username: "Bassem", role: "admin", external: true }
    auth.checked = true
    const router = makeRouter()
    const wrapper = mount(AppShell, { global: { plugins: [router] } })
    await router.isReady()

    expect(wrapper.text()).toContain("Bassem")
    expect(wrapper.find("#logout-button").exists()).toBe(false)
    const links = wrapper.get("#app-sidebar").findAll("a").map((a) => a.text())
    expect(links).not.toContain("Users")
    // Still the admin they are: the other admin page stays.
    expect(links.some((t) => t.includes("Connection Settings"))).toBe(true)
  })

  it("still shows Log out and Users for an ordinary Resolvr admin", async () => {
    signInAsAdmin()
    const router = makeRouter()
    const wrapper = mount(AppShell, { global: { plugins: [router] } })
    await router.isReady()

    expect(wrapper.find("#logout-button").exists()).toBe(true)
    expect(wrapper.get("#app-sidebar").findAll("a").map((a) => a.text())).toContain("Users")
  })

  it("lets the Overview fill the width next to the sidebar", async () => {
    signInAsAdmin()
    const router = makeRouter()
    const wrapper = mount(AppShell, { global: { plugins: [router] } })
    await router.isReady()
    await router.push("/")
    await flushPromises()

    const content = wrapper.get("header + div")
    expect(content.classes()).not.toContain("max-w-6xl")
    expect(content.classes()).toContain("w-full")
  })

  it("lets the Users page fill the width too", async () => {
    signInAsAdmin()
    const router = makeRouter()
    const wrapper = mount(AppShell, { global: { plugins: [router] } })
    await router.isReady()
    await router.push("/users")
    await flushPromises()

    expect(wrapper.get("header + div").classes()).not.toContain("max-w-6xl")
  })

  it("lets the Clients page fill the width too", async () => {
    signInAsAdmin()
    const router = makeRouter()
    const wrapper = mount(AppShell, { global: { plugins: [router] } })
    await router.isReady()
    await router.push("/clients")
    await flushPromises()

    expect(wrapper.get("header + div").classes()).not.toContain("max-w-6xl")
  })

  it("keeps the other pages left-aligned at a readable width, not centered", async () => {
    signInAsAdmin()
    const router = makeRouter()
    const wrapper = mount(AppShell, { global: { plugins: [router] } })
    await router.isReady()
    // Users and Connection Settings are forms, not data tables, so they keep a readable width.
    await router.push("/connect")
    await flushPromises()

    const content = wrapper.get("header + div")
    expect(content.classes()).toContain("max-w-6xl")
    expect(content.classes()).not.toContain("mx-auto")
  })

  it("hides admin-only nav items (Users, Connection Settings) for a viewer", async () => {
    const auth = useAuthStore()
    auth.user = { id: 2, username: "reader", role: "viewer" }
    auth.checked = true
    const router = makeRouter()
    const wrapper = mount(AppShell, { global: { plugins: [router] } })
    await router.isReady()

    // Scoped to the sidebar, since OverviewView's own "not connected"
    // prompt also links to /connect with the literal text "Connection
    // Settings" — that's unrelated to the admin-only sidebar nav item.
    const sidebarLinks = wrapper.get("#app-sidebar").findAll("a").map((a) => a.text())
    expect(sidebarLinks).not.toContain("Users")
    expect(sidebarLinks.some((t) => t.includes("Connection Settings"))).toBe(false)
    // Non-admin-only items are still all there.
    expect(sidebarLinks).toContain("Clients")
    expect(sidebarLinks.some((t) => t.startsWith("Server Info"))).toBe(true)
  })

  it("renders an icon for every nav link, matching the wireframe's line icons", async () => {
    signInAsAdmin()
    const router = makeRouter()
    const wrapper = mount(AppShell, { global: { plugins: [router] } })
    await router.isReady()

    const navLinkCount = navSections.flatMap((s) => s.items).length + 1 // +1 for Connection Settings
    expect(wrapper.findAll("a svg").length).toBe(navLinkCount)
  })

  it("highlights the active route's nav link", async () => {
    signInAsAdmin()
    const router = makeRouter()
    const wrapper = mount(AppShell, { global: { plugins: [router] } })
    await router.push("/clients")
    await router.isReady()
    await wrapper.vm.$nextTick()

    const clientsLink = wrapper.findAll("a").find((a) => a.text() === "Clients")!
    expect(clientsLink.classes()).toContain("!bg-background-hover")
  })

  it("no longer has a connection card in the sidebar", async () => {
    signInAsAdmin()
    const router = makeRouter()
    const wrapper = mount(AppShell, { global: { plugins: [router] } })
    await router.isReady()
    const connection = useConnectionStore()
    connection.status = "connected"
    connection.serverDomain = "dns.example.lan"
    connection.serverVersion = "15.4"
    await wrapper.vm.$nextTick()

    const sidebar = wrapper.get("#app-sidebar").text()
    expect(sidebar).not.toContain("Connected")
    expect(sidebar).not.toContain("Not connected")
    expect(sidebar).not.toContain("dns.example.lan")
  })

  it("shows the connection state as a dot in the top bar, with the details on hover", async () => {
    signInAsAdmin()
    const router = makeRouter()
    const wrapper = mount(AppShell, { global: { plugins: [router] } })
    await router.isReady()
    const dot = wrapper.get("header #connection-dot")
    expect(dot.attributes("title")).toBe("Not connected")
    expect(dot.classes()).toContain("bg-gray-500")

    const connection = useConnectionStore()
    connection.status = "connected"
    connection.serverDomain = "dns.example.lan"
    connection.serverVersion = "15.4"
    await wrapper.vm.$nextTick()
    expect(dot.attributes("title")).toBe("Connected · dns.example.lan · v15.4")
    expect(dot.classes()).toContain("bg-ok")

    connection.status = "error"
    connection.error = "Could not reach the server"
    await wrapper.vm.$nextTick()
    expect(dot.attributes("title")).toBe("Not connected · Could not reach the server")
    expect(dot.classes()).toContain("bg-crit")
  })

  it("toggles the mobile sidebar open state when the nav toggle button is clicked", async () => {
    signInAsAdmin()
    const router = makeRouter()
    const wrapper = mount(AppShell, { global: { plugins: [router] } })
    await router.isReady()

    const sidebar = wrapper.get("#app-sidebar")
    expect(sidebar.classes()).toContain("-translate-x-full")

    await wrapper.get("#mobile-nav-toggle").trigger("click")

    expect(sidebar.classes()).toContain("translate-x-0")
  })

  it("checks the admin-configured connection status on mount even when landing on a page other than /connect", async () => {
    // Regression test: the connection check used to only run from
    // ConnectView's own onMounted, so navigating straight to any other
    // route left the status stuck on "Not connected" forever —
    // confirmed live with a real screenshot before this fix. AppShell
    // is the one component mounted on every route.
    signInAsAdmin()
    vi.mocked(getStatus).mockResolvedValue({
      configured: true,
      connected: true,
      serverDomain: "dns.example.lan",
      serverVersion: "15.4",
    })
    const router = makeRouter()
    await router.push("/clients") // not /connect

    const wrapper = mount(AppShell, { global: { plugins: [router] } })
    await router.isReady()
    await flushPromises()

    expect(getStatus).toHaveBeenCalled()
    expect(wrapper.get("#connection-dot").attributes("title")).toContain("dns.example.lan")
  })

  it("shows the logged-in username and a logout control", async () => {
    signInAsAdmin()
    const router = makeRouter()
    const wrapper = mount(AppShell, { global: { plugins: [router] } })
    await router.isReady()

    expect(wrapper.text()).toContain("admin")
    expect(wrapper.find("#logout-button").exists()).toBe(true)
  })

  it("shows the Server Info update badge only when the shared serverUpdate store flags one", async () => {
    signInAsAdmin()
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
    signInAsAdmin()
    const router = makeRouter()
    const wrapper = mount(AppShell, { global: { plugins: [router] } })
    await router.isReady()

    const rangeButtons = wrapper.get("#topbar-range-seg").findAll("button").map((b) => b.text())
    expect(rangeButtons).toEqual(["1H", "24H", "7D", "30D", "1Y"])
    expect(wrapper.find("#topbar-refresh").exists()).toBe(true)
  })

  it("clicking a topbar range button updates the shared timeRange store", async () => {
    signInAsAdmin()
    const router = makeRouter()
    const wrapper = mount(AppShell, { global: { plugins: [router] } })
    await router.isReady()
    const timeRange = useTimeRangeStore()

    await wrapper.get("#topbar-range-seg").findAll("button")[2]!.trigger("click") // 7D

    expect(timeRange.selected).toBe("LastWeek")
  })

  it("clicking the topbar refresh button increments the shared refresh store's tick", async () => {
    signInAsAdmin()
    const router = makeRouter()
    const wrapper = mount(AppShell, { global: { plugins: [router] } })
    await router.isReady()
    const refresh = useRefreshStore()

    await wrapper.get("#topbar-refresh").trigger("click")

    expect(refresh.tick).toBe(1)
  })

  it("shows sidebar count badges (Zones, Blocked Zones, Apps) from the sidebarCounts store", async () => {
    signInAsAdmin()
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
    signInAsAdmin()
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
  describe("server switcher", () => {
    const SERVERS = [
      { id: 0, name: "Segment 128", baseUrl: "http://a:5380", primary: true, configured: true },
      { id: 2, name: "Segment 130", baseUrl: "http://b:5380", primary: false, configured: true },
    ]

    it("sits in the top bar, not the sidebar, when there is more than one server", async () => {
      signInAsAdmin()
      vi.mocked(listServers).mockResolvedValue({ servers: SERVERS })
      const router = makeRouter()
      const wrapper = mount(AppShell, { global: { plugins: [router] } })
      await router.isReady()
      await flushPromises()

      const select = wrapper.get("header #server-switcher")
      expect(wrapper.find("#app-sidebar #server-switcher").exists()).toBe(false)
      expect(select.findAll("option").map((o) => o.text())).toEqual(["Segment 128", "Segment 130"])
    })

    it("is not shown for a single server", async () => {
      signInAsAdmin()
      vi.mocked(listServers).mockResolvedValue({ servers: [SERVERS[0]!] })
      const router = makeRouter()
      const wrapper = mount(AppShell, { global: { plugins: [router] } })
      await router.isReady()
      await flushPromises()

      expect(wrapper.find("#server-switcher").exists()).toBe(false)
      expect(document.title).toBe("Resolvr")
    })

    it("puts the selected server's name in the browser tab title", async () => {
      signInAsAdmin()
      setActiveServerId(2)
      setActivePinia(createPinia())
      vi.mocked(listServers).mockResolvedValue({ servers: SERVERS })
      const router = makeRouter()
      mount(AppShell, { global: { plugins: [router] } })
      await router.isReady()
      await flushPromises()

      expect(document.title).toBe("Segment 130 · Resolvr")
    })
  })
})
