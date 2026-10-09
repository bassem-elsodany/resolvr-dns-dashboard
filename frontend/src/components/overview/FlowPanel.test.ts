import { describe, it, expect } from "vitest"
import { mount } from "@vue/test-utils"
import { createRouter, createMemoryHistory } from "vue-router"
import FlowPanel from "./FlowPanel.vue"
import { buildFlows } from "../../lib/charts"

const flows = buildFlows([
  ...Array(6).fill({ responseType: "Cached", rcode: "NoError" }),
  ...Array(2).fill({ responseType: "Recursive", rcode: "NxDomain" }),
  { responseType: "Blocked", rcode: "NoError" },
])

async function mountPanel(f = flows, state: "ready" | "loading" | "missing" | "error" = "ready") {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: { template: "<div />" } },
      { path: "/logs", component: { template: "<div />" } },
    ],
  })
  await router.push("/")
  return { wrapper: mount(FlowPanel, { props: { flows: f, state }, global: { plugins: [router] } }), router }
}

describe("FlowPanel", () => {
  it("draws a node per path and outcome, and a link per hop", async () => {
    const { wrapper } = await mountPanel()
    // 1 query node + 3 paths + 3 outcomes
    expect(wrapper.findAll("rect")).toHaveLength(7)
    // 3 query->path links + 3 path->outcome links
    expect(wrapper.findAll(".flow-link")).toHaveLength(6)
    expect(wrapper.text()).toContain("Cached · 6")
    expect(wrapper.text()).toContain("Blocked reply · 1")
    expect(wrapper.text()).toContain("latest 9 logged queries")
  })

  it("filters Query Logs when a path or outcome node is clicked", async () => {
    const { wrapper, router } = await mountPanel()
    const nodes = wrapper.findAll(".flow-node")
    await nodes[0]!.trigger("click") // Cached
    await new Promise((r) => setTimeout(r, 0))
    expect(router.currentRoute.value.query).toEqual({ responseType: "Cached" })

    await router.push("/")
    await nodes[nodes.length - 1]!.trigger("click") // Blocked reply
    await new Promise((r) => setTimeout(r, 0))
    expect(router.currentRoute.value.query).toEqual({ responseType: "Blocked" })
  })

  it("dims other flows while one is hovered", async () => {
    const { wrapper } = await mountPanel()
    const links = wrapper.findAll(".flow-link")
    await links[0]!.trigger("pointerenter")
    expect(links[0]!.attributes("stroke-opacity")).toBe("0.75")
    expect(links[1]!.attributes("stroke-opacity")).toBe("0.12")
  })

  it("shows a message instead of a diagram when there is nothing to draw", async () => {
    expect((await mountPanel(buildFlows([]))).wrapper.text()).toContain("No logged queries yet")
    expect((await mountPanel(null as never, "missing")).wrapper.text()).toContain("query-logging app")
    expect((await mountPanel(null as never, "error")).wrapper.text()).toContain("Could not load")
  })
})
