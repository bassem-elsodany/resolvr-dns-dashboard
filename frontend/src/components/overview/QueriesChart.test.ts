import { describe, it, expect, beforeEach } from "vitest"
import { mount } from "@vue/test-utils"
import { createRouter, createMemoryHistory } from "vue-router"
import QueriesChart from "./QueriesChart.vue"

const labels = ["2026-10-09T10:00:00Z", "2026-10-09T11:00:00Z", "2026-10-09T12:00:00Z", "2026-10-09T13:00:00Z"]

function chart(extra: { label: string; data: number[] }[] = []) {
  return {
    labelFormat: "HH:mm",
    labels,
    datasets: [
      { label: "Total", data: [10, 20, 30, 40] },
      { label: "Blocked", data: [2, 5, 8, 10] },
      { label: "NX Domain", data: [1, 1, 2, 2] },
      { label: "Cached", data: [5, 9, 14, 20] },
      { label: "Server Failure", data: [0, 0, 0, 0] },
      ...extra,
    ],
  }
}

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: { template: "<div />" } },
      { path: "/logs", component: { template: "<div />" } },
    ],
  })
}

async function mountChart(c = chart()) {
  const router = makeRouter()
  await router.push("/")
  const wrapper = mount(QueriesChart, { props: { chart: c }, global: { plugins: [router] }, attachTo: document.body })
  const svg = wrapper.get("svg").element as SVGSVGElement
  svg.getBoundingClientRect = () => ({ left: 0, right: 720, width: 720, top: 0, bottom: 250, height: 250, x: 0, y: 0, toJSON: () => {} })
  return { wrapper, router, svg }
}

// jsdom has no PointerEvent: dispatch MouseEvents under the pointer names.
function fire(el: Element, type: string, clientX: number) {
  el.dispatchEvent(new MouseEvent(type, { clientX, clientY: 100, bubbles: true }))
}

// Chart x positions: plot spans 46..708 for 4 points.
const X = [46, 267, 487, 708]

describe("QueriesChart", () => {
  beforeEach(() => {
    document.body.innerHTML = ""
  })

  it("shows an empty state when there are no datasets", () => {
    const wrapper = mount(QueriesChart, {
      props: { chart: { labelFormat: "HH:mm", labels: [], datasets: [] } },
      global: { plugins: [makeRouter()] },
    })
    expect(wrapper.text()).toContain("No query data for this time range yet.")
    expect(wrapper.find("svg").exists()).toBe(false)
  })

  it("offers the four series as chips and starts with Total and Blocked on", async () => {
    const { wrapper } = await mountChart()
    const chips = wrapper.findAll(".series-chip")
    expect(chips.map((c) => c.text())).toEqual(["Total", "Blocked", "NXDomain", "Cached"])
    expect(chips.map((c) => c.attributes("aria-pressed"))).toEqual(["true", "true", "false", "false"])
    expect(wrapper.text()).not.toContain("Server Failure")
  })

  it("draws a line only for the series that are switched on, and adds one when a chip is toggled", async () => {
    const { wrapper } = await mountChart()
    // Total: area + line, Blocked: line.
    expect(wrapper.findAll("svg path").length).toBe(3)
    await wrapper.get('[data-series="cached"]').trigger("click")
    expect(wrapper.findAll("svg path").length).toBe(4)
  })

  it("keeps at least one series on", async () => {
    const { wrapper } = await mountChart()
    await wrapper.get('[data-series="blocked"]').trigger("click")
    await wrapper.get('[data-series="total"]').trigger("click")
    expect(wrapper.findAll(".series-chip").some((c) => c.attributes("aria-pressed") === "true")).toBe(true)
  })

  it("switches to a stacked allowed-vs-blocked view that disables the series chips", async () => {
    const { wrapper } = await mountChart()
    await wrapper.get("#mode-stack").trigger("click")
    expect(wrapper.findAll("svg path").length).toBe(2)
    expect(wrapper.get('[data-series="total"]').attributes("disabled")).toBeDefined()
  })

  it("hides the mode switch when there is no Blocked series to stack", async () => {
    const { wrapper } = await mountChart({
      labelFormat: "HH:mm",
      labels,
      datasets: [{ label: "Total", data: [1, 2, 3, 4] }],
    })
    expect(wrapper.find("#mode-stack").exists()).toBe(false)
  })

  describe("hover tooltip", () => {
    it("shows the nearest point's time and each visible series' value", async () => {
      const { svg } = await mountChart()
      fire(svg, "pointermove", X[0]!)
      await new Promise((r) => setTimeout(r, 0))
      const tip = document.querySelector(".chart-tip")!
      expect(tip.textContent).toContain("Total")
      expect(tip.textContent).toContain("10")
      expect(tip.textContent).toContain("Blocked")
      expect(tip.textContent).toContain("2")
    })

    it("tracks a different point further along and hides on leave", async () => {
      const { svg } = await mountChart()
      fire(svg, "pointermove", X[3]!)
      await new Promise((r) => setTimeout(r, 0))
      expect(document.querySelector(".chart-tip")!.textContent).toContain("40")
      fire(svg, "pointerleave", X[3]!)
      await new Promise((r) => setTimeout(r, 0))
      expect(document.querySelector(".chart-tip")).toBeNull()
    })
  })

  describe("selecting a time window", () => {
    async function select(svg: Element, from: number, to: number) {
      fire(svg, "pointerdown", X[from]!)
      fire(svg, "pointermove", X[to]!)
      fire(svg, "pointerup", X[to]!)
      await new Promise((r) => setTimeout(r, 0))
    }

    it("summarises the dragged window", async () => {
      const { wrapper, svg } = await mountChart()
      await select(svg, 1, 2)
      const sel = wrapper.get("#chart-selection").text()
      expect(sel).toContain("50 queries") // 20 + 30
      expect(sel).toContain("13 blocked") // 5 + 8
      expect(wrapper.find("#chart-brush").exists()).toBe(true)
    })

    it("opens Query Logs for exactly that window", async () => {
      const { wrapper, router, svg } = await mountChart()
      await select(svg, 1, 2)
      await wrapper.get("#selection-open").trigger("click")
      await new Promise((r) => setTimeout(r, 0))
      expect(router.currentRoute.value.path).toBe("/logs")
      expect(router.currentRoute.value.query.start).toBe("2026-10-09T11:00:00.000Z")
      // The window ends where the bucket of the last selected point ends.
      expect(router.currentRoute.value.query.end).toBe("2026-10-09T13:00:00.000Z")
    })

    it("zooms into the window and can reset", async () => {
      const { wrapper, svg } = await mountChart()
      await select(svg, 1, 3)
      await wrapper.get("#selection-zoom").trigger("click")
      expect(wrapper.find("#zoom-reset").exists()).toBe(true)
      await wrapper.get("#zoom-reset").trigger("click")
      expect(wrapper.find("#zoom-reset").exists()).toBe(false)
    })

    it("clears the selection on Clear and ignores a plain click", async () => {
      const { wrapper, svg } = await mountChart()
      await select(svg, 0, 2)
      await wrapper.get("#selection-clear").trigger("click")
      expect(wrapper.find("#chart-brush").exists()).toBe(false)

      await select(svg, 1, 1)
      expect(wrapper.find("#chart-brush").exists()).toBe(false)
      expect(wrapper.find("#selection-open").exists()).toBe(false)
    })
  })
})
