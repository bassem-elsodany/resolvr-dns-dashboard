import { describe, it, expect, vi, beforeEach } from "vitest"
import { mount } from "@vue/test-utils"
import { createPinia, setActivePinia } from "pinia"

vi.mock("../../api/technitium", async () => {
  const actual = await vi.importActual<typeof import("../../api/technitium")>("../../api/technitium")
  return { ...actual, listApps: vi.fn(), getClusterState: vi.fn() }
})
vi.mock("../../api/app", async () => {
  const actual = await vi.importActual<typeof import("../../api/app")>("../../api/app")
  return { ...actual, uninstallApp: vi.fn() }
})

import { listApps, getClusterState } from "../../api/technitium"
import { uninstallApp } from "../../api/app"
import { useConnectionStore } from "../../stores/connection"
import { useAuthStore } from "../../stores/auth"
import { useStatsScopeStore } from "../../stores/statsScope"
import AppsView from "./AppsView.vue"

const NODE1 = "node1.cluster.test"
const NODE2 = "node2.cluster.test"
const flush = () => new Promise((r) => setTimeout(r, 0))
const app = (name: string, version: string, upd = false) => ({ name, description: `${name} app`, version, updateAvailable: upd, updateVersion: upd ? "9.9" : undefined, dnsApps: [] })

const APPS: Record<string, ReturnType<typeof app>[]> = {
  [NODE1]: [app("Query Logs", "9.1.2"), app("Block Page", "8.2")],
  [NODE2]: [app("Query Logs", "9.1.0", true)],
}

async function mountCluster(scopeNode?: string) {
  const connection = useConnectionStore()
  connection.serverDomain = NODE1
  connection.clusterInitialized = true
  vi.mocked(getClusterState).mockResolvedValue({
    response: {
      clusterInitialized: true,
      clusterNodes: [
        { id: 1, name: NODE1, type: "Primary", state: "Self" },
        { id: 2, name: NODE2, type: "Secondary", state: "Connected" },
      ],
    },
  })
  const s = useStatsScopeStore()
  await vi.waitFor(() => expect(s.nodes.length).toBe(2))
  if (scopeNode) s.set("appsPage", scopeNode)
  useAuthStore().user = { id: 1, username: "admin", role: "admin" }
  const wrapper = mount(AppsView, { global: { stubs: { RouterLink: true } } })
  connection.isConfigured = true
  await flush()
  await flush()
  return wrapper
}

describe("AppsView on a cluster", () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    vi.mocked(getClusterState).mockReset()
    vi.mocked(listApps).mockReset().mockImplementation((async (_c: unknown, o?: { node?: string }) => ({ response: { apps: APPS[o?.node ?? NODE1] } })) as never)
    vi.mocked(uninstallApp).mockReset().mockResolvedValue({ status: "ok" })
  })

  it("shows each app once, with its version on every node and 'not installed' where it is missing", async () => {
    const wrapper = await mountCluster()

    const cards = wrapper.findAll(".app-card")
    expect(cards).toHaveLength(2)
    const logs = cards.find((c) => c.text().includes("Query Logs"))!
    expect(logs.text()).toContain("v9.1.2")
    expect(logs.text()).toContain("Update to v9.9")
    const page = cards.find((c) => c.text().includes("Block Page"))!
    expect(page.text()).toContain("not installed")
  })

  it("filters to apps that are not on every node", async () => {
    const wrapper = await mountCluster()

    await wrapper.get('[data-presence="some"]').trigger("click")

    const cards = wrapper.findAll(".app-card")
    expect(cards).toHaveLength(1)
    expect(cards[0]!.text()).toContain("Block Page")
  })

  it("uninstalls an app from the one node chosen, leaving the other alone", async () => {
    const wrapper = await mountCluster()
    const logs = wrapper.findAll(".app-card").find((c) => c.text().includes("Query Logs"))!
    await logs.get(".uninstall-app").trigger("click")

    await logs.get(`input[value="${NODE2}"]`).setValue(true)
    await logs.findAll("button").find((b) => b.text() === "Confirm")!.trigger("click")
    await flush()
    await flush()

    expect(uninstallApp).toHaveBeenCalledTimes(1)
    expect(vi.mocked(uninstallApp).mock.calls[0]).toEqual(["Query Logs", NODE2])
  })

  it("only asks the nodes that have the app when removing it everywhere", async () => {
    const wrapper = await mountCluster()
    const page = wrapper.findAll(".app-card").find((c) => c.text().includes("Block Page"))!
    await page.get(".uninstall-app").trigger("click")

    await page.findAll("button").find((b) => b.text() === "Confirm")!.trigger("click")
    await flush()
    await flush()

    expect(uninstallApp).toHaveBeenCalledTimes(1)
    expect(vi.mocked(uninstallApp).mock.calls[0]).toEqual(["Block Page"])
  })

  it("scoped to one node it looks like the plain page", async () => {
    const wrapper = await mountCluster(NODE2)

    expect(wrapper.find(".app-nodes").exists()).toBe(false)
    expect(wrapper.findAll(".app-card")).toHaveLength(1)
    expect(wrapper.text()).toContain("Update to v9.9")
  })
})
