import { describe, it, expect, vi, beforeEach } from "vitest"
import { mount } from "@vue/test-utils"
import { createPinia, setActivePinia } from "pinia"
import { nextTick } from "vue"

vi.mock("../../api/technitium", async () => {
  const actual = await vi.importActual<typeof import("../../api/technitium")>("../../api/technitium")
  return { ...actual, getClusterState: vi.fn() }
})

import { getClusterState } from "../../api/technitium"
import { useConnectionStore } from "../../stores/connection"
import { useStatsScopeStore } from "../../stores/statsScope"
import ScopeChip from "./ScopeChip.vue"

async function clustered(states: [string, string] = ["Self", "Connected"]) {
  vi.mocked(getClusterState).mockResolvedValue({
    response: {
      clusterInitialized: true,
      clusterNodes: [
        { id: 1, name: "node1.cluster.test", type: "Primary", state: states[0] },
        { id: 2, name: "node2.cluster.test", type: "Secondary", state: states[1] },
      ],
    },
  })
  const connection = useConnectionStore()
  connection.serverDomain = "node1.cluster.test"
  connection.clusterInitialized = true
  const scope = useStatsScopeStore()
  await vi.waitFor(() => expect(scope.nodes.length).toBe(2))
  return scope
}

describe("ScopeChip", () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    vi.mocked(getClusterState).mockReset()
  })

  it("renders nothing for a standalone server", () => {
    const wrapper = mount(ScopeChip, { props: { panel: "queries" } })

    expect(wrapper.find("button").exists()).toBe(false)
  })

  it("shows the panel's current scope and lists the whole cluster plus every node for a statistics panel", async () => {
    await clustered()
    const wrapper = mount(ScopeChip, { props: { panel: "queries" } })

    expect(wrapper.get("#scope-chip-queries").text()).toContain("Whole cluster")
    await wrapper.get("#scope-chip-queries").trigger("click")

    const items = wrapper.findAll('[role="menuitemradio"]').map((i) => i.text())
    expect(items).toHaveLength(3)
    expect(items[0]).toContain("Whole cluster")
    expect(items[1]).toContain("node1.cluster.test")
    expect(items[2]).toContain("node2.cluster.test")
  })

  it("choosing a node changes only that panel", async () => {
    const scope = await clustered()
    const wrapper = mount(ScopeChip, { props: { panel: "topClients" } })
    await wrapper.get("#scope-chip-topClients").trigger("click")

    await wrapper.get("#scope-option-topClients-node2\\.cluster\\.test").trigger("click")

    expect(scope.scopeOf("topClients")).toBe("node2.cluster.test")
    expect(scope.scopeOf("topDomains")).toBe("cluster")
    expect(wrapper.find('[role="menu"]').exists()).toBe(false)
    expect(wrapper.get("#scope-chip-topClients").text()).toContain("node2.cluster.test")
  })

  it("a per-node panel offers only nodes, with the reason in the heading", async () => {
    await clustered()
    const wrapper = mount(ScopeChip, { props: { panel: "flow" } })

    await wrapper.get("#scope-chip-flow").trigger("click")

    expect(wrapper.findAll('[role="menuitemradio"]')).toHaveLength(2)
    expect(wrapper.get('[role="menu"]').text()).toContain("Query logs are kept per node")
    expect(wrapper.text()).not.toContain("Whole cluster")
  })

  it("offers Compare nodes on the queries panel only", async () => {
    const scope = await clustered()
    const queries = mount(ScopeChip, { props: { panel: "queries" } })
    const types = mount(ScopeChip, { props: { panel: "types" } })
    await queries.get("#scope-chip-queries").trigger("click")
    await types.get("#scope-chip-types").trigger("click")

    expect(queries.find("#scope-compare").exists()).toBe(true)
    expect(types.find("#scope-compare").exists()).toBe(false)

    await queries.get("#scope-compare").trigger("click")
    expect(scope.compare).toBe(true)
    expect(queries.get("#scope-chip-queries").text()).toContain("Compare nodes")
  })

  it("shows an unreachable node but does not let it be picked", async () => {
    await clustered(["Self", "Unreachable"])
    const wrapper = mount(ScopeChip, { props: { panel: "queries" } })
    await wrapper.get("#scope-chip-queries").trigger("click")

    const node2 = wrapper.get("#scope-option-queries-node2\\.cluster\\.test")

    expect(node2.attributes("disabled")).toBeDefined()
    expect(node2.text()).toContain("unreachable")
  })

  it("closes on Escape", async () => {
    await clustered()
    const wrapper = mount(ScopeChip, { props: { panel: "queries" }, attachTo: document.body })
    await wrapper.get("#scope-chip-queries").trigger("click")
    expect(wrapper.find('[role="menu"]').exists()).toBe(true)

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    await nextTick()

    expect(wrapper.find('[role="menu"]').exists()).toBe(false)
    wrapper.unmount()
  })
})
