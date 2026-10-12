import { describe, it, expect, vi, beforeEach } from "vitest"
import { mount } from "@vue/test-utils"
import { createPinia, setActivePinia } from "pinia"

vi.mock("../../api/technitium", async () => {
  const actual = await vi.importActual<typeof import("../../api/technitium")>("../../api/technitium")
  return { ...actual, listZones: vi.fn(), getZoneRecords: vi.fn(), getClusterState: vi.fn() }
})
vi.mock("../../api/app", async () => {
  const actual = await vi.importActual<typeof import("../../api/app")>("../../api/app")
  return { ...actual, createZone: vi.fn(), addRecord: vi.fn(), deleteZone: vi.fn() }
})

import { listZones, getZoneRecords, getClusterState } from "../../api/technitium"
import { createZone, addRecord, deleteZone } from "../../api/app"
import { useConnectionStore } from "../../stores/connection"
import { useAuthStore } from "../../stores/auth"
import { useStatsScopeStore } from "../../stores/statsScope"
import ZonesView from "./ZonesView.vue"

const NODE1 = "node1.cluster.test"
const NODE2 = "node2.cluster.test"
const flush = () => new Promise((r) => setTimeout(r, 0))

const z = (name: string, type: string, serial = 1) => ({ name, type, dnssecStatus: "Unsigned", soaSerial: serial, disabled: false, lastModified: "" })
const ZONES: Record<string, ReturnType<typeof z>[]> = {
  [NODE1]: [z("shared.lan", "Primary", 5), z("serial.lan", "Primary", 12), z("home.lan", "Primary", 1)],
  [NODE2]: [z("shared.lan", "Secondary", 5), z("serial.lan", "Secondary", 11), z("fallback.lan", "Primary", 1)],
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
  const scope = useStatsScopeStore()
  await vi.waitFor(() => expect(scope.nodes.length).toBe(2))
  if (scopeNode) scope.set("zonesPage", scopeNode)
  useAuthStore().user = { id: 1, username: "admin", role: "admin" }
  const wrapper = mount(ZonesView, { global: { stubs: { RouterLink: true } } })
  connection.isConfigured = true
  await flush()
  await flush()
  return wrapper
}

describe("ZonesView on a cluster", () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    vi.mocked(listZones).mockReset().mockImplementation((async (_c: unknown, o?: { node?: string }) => {
      const zones = ZONES[o?.node ?? NODE1]!
      return { response: { pageNumber: 1, totalPages: 1, totalZones: zones.length, zones } }
    }) as never)
    vi.mocked(getZoneRecords).mockReset().mockResolvedValue({ response: { zone: { name: "x", type: "Primary" }, records: [] } })
    vi.mocked(createZone).mockReset().mockResolvedValue({ status: "ok" })
    vi.mocked(addRecord).mockReset().mockResolvedValue({ status: "ok" })
    vi.mocked(deleteZone).mockReset().mockResolvedValue({ status: "ok" })
    vi.mocked(getClusterState).mockReset()
  })

  it("lines the nodes' zones up by name, with each node's type and 'not on this node' where it is missing", async () => {
    const wrapper = await mountCluster()

    const rows = wrapper.findAll("tbody tr")
    expect(rows).toHaveLength(4)
    const home = rows.find((r) => r.text().includes("home.lan"))!
    expect(home.findAll(".zone-type").map((c) => c.text())).toEqual(["Primary", "not on this node"])
    const shared = rows.find((r) => r.text().includes("shared.lan"))!
    expect(shared.findAll(".zone-type").map((c) => c.text())).toEqual(["Primary", "Secondary"])
  })

  it("flags a zone that is on one node only, and one whose serials differ", async () => {
    const wrapper = await mountCluster()

    const rows = wrapper.findAll("tbody tr")
    expect(rows.find((r) => r.text().includes("home.lan"))!.text()).toContain("Only on one node")
    expect(rows.find((r) => r.text().includes("serial.lan"))!.text()).toContain("Serial differs")
    expect(rows.find((r) => r.text().includes("shared.lan"))!.text()).toContain("Healthy")
  })

  it("filters to zones that are not on every node", async () => {
    const wrapper = await mountCluster()

    await wrapper.get('[data-presence="one"]').trigger("click")

    expect(wrapper.findAll("tbody tr").map((r) => r.text()).join(" ")).toMatch(/home\.lan.*fallback\.lan|fallback\.lan.*home\.lan/)
    expect(wrapper.findAll("tbody tr")).toHaveLength(2)
  })

  it("adds a host mapping on every node by default, node by node", async () => {
    const wrapper = await mountCluster()
    await wrapper.get("#new-mapping-hostname").setValue("nas")
    await wrapper.get("#new-mapping-ip").setValue("10.0.0.9")

    await wrapper.get("form").trigger("submit")
    await flush()
    await flush()

    expect(createZone).toHaveBeenCalledTimes(2)
    const nodes = vi.mocked(createZone).mock.calls.map((c) => c[1])
    expect(nodes).toContain(undefined)
    expect(nodes).toContain(NODE2)
    expect(vi.mocked(addRecord).mock.calls.map((c) => c[0].node)).toContain(NODE2)
  })

  it("applies a mapping to one node only when that node is chosen", async () => {
    const wrapper = await mountCluster()
    await wrapper.get(`[data-apply="${NODE2}"]`).trigger("click")
    await wrapper.get("#new-mapping-hostname").setValue("nas")
    await wrapper.get("#new-mapping-ip").setValue("10.0.0.9")

    await wrapper.get("form").trigger("submit")
    await flush()
    await flush()

    expect(createZone).toHaveBeenCalledTimes(1)
    expect(vi.mocked(createZone).mock.calls[0]![1]).toBe(NODE2)
  })

  it("names the node where a mapping failed", async () => {
    vi.mocked(createZone).mockImplementation((async (_z: string, node?: string) => {
      if (node === NODE2) throw new (await import("../../api/app")).AppApiError("Zone already exists.", 400)
      return { status: "ok" }
    }) as never)
    const wrapper = await mountCluster()
    await wrapper.get("#new-mapping-hostname").setValue("nas")
    await wrapper.get("#new-mapping-ip").setValue("10.0.0.9")

    await wrapper.get("form").trigger("submit")
    await flush()
    await flush()

    expect(wrapper.get("#add-mapping-error").text()).toContain("node2: Zone already exists.")
  })

  it("only deletes a zone from the nodes that hold it", async () => {
    const wrapper = await mountCluster()
    const home = wrapper.findAll("tbody tr").find((r) => r.text().includes("home.lan"))!
    await home.trigger("click")
    await flush()

    await wrapper.get("#delete-zone").trigger("click")
    await wrapper.get("#confirm-delete-zone").trigger("click")
    await flush()
    await flush()

    expect(deleteZone).toHaveBeenCalledTimes(1)
    expect(vi.mocked(deleteZone).mock.calls[0]![1]).toBeUndefined()
  })

  it("scoped to one node it looks like the plain page", async () => {
    const wrapper = await mountCluster(NODE2)

    expect(wrapper.find(".zone-type").exists()).toBe(false)
    expect(wrapper.find("#apply-to").exists()).toBe(false)
    expect(wrapper.text()).toContain("fallback.lan")
    expect(wrapper.text()).not.toContain("home.lan")
  })
})
