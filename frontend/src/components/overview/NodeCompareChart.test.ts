import { describe, it, expect, vi, afterEach } from "vitest"
import { nextTick } from "vue"
import { mount } from "@vue/test-utils"
import NodeCompareChart from "./NodeCompareChart.vue"

const labels = ["2026-10-12T08:00:00Z", "2026-10-12T09:00:00Z", "2026-10-12T10:00:00Z"]

describe("NodeCompareChart", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("keeps its height when the page is wide, and only the width follows the container", async () => {
    let resize: () => void = () => {}
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(cb: () => void) {
          resize = cb
        }
        observe() {}
        disconnect() {}
      },
    )
    const wrapper = mount(NodeCompareChart, {
      attachTo: document.body,
      props: { labels, series: [{ name: "a", color: "#2a78d6", data: [1, 2, 3] }] },
    })
    const root = wrapper.element as HTMLElement
    const svg = () => wrapper.get("svg")

    root.getBoundingClientRect = () => ({ width: 700 }) as DOMRect
    resize()
    await nextTick()
    const narrowHeight = (svg().element as SVGElement).style.height
    expect(svg().attributes("viewBox")).toBe("0 0 700 224")

    root.getBoundingClientRect = () => ({ width: 1500 }) as DOMRect
    resize()
    await nextTick()
    expect(svg().attributes("viewBox")).toBe("0 0 1500 224")
    expect((svg().element as SVGElement).style.height).toBe(narrowHeight)
    expect(narrowHeight).toBe("224px")
    wrapper.unmount()
  })

  it("draws one line per node and names each in a legend", () => {
    const wrapper = mount(NodeCompareChart, {
      props: {
        labels,
        series: [
          { name: "node1.cluster.test", color: "#2a78d6", data: [10, 40, 20] },
          { name: "node2.cluster.test", color: "#eb6834", dashed: true, data: [5, 30, 25] },
        ],
      },
    })

    expect(wrapper.findAll("polyline.compare-line")).toHaveLength(2)
    expect(wrapper.text()).toContain("node1.cluster.test")
    expect(wrapper.text()).toContain("node2.cluster.test")
  })

  it("keeps the outer axis labels inside the drawing", () => {
    const wrapper = mount(NodeCompareChart, {
      props: { labels, series: [{ name: "a", color: "#2a78d6", data: [1, 2, 3] }] },
    })

    const anchors = wrapper.findAll("svg text").filter((t) => t.attributes("y") === "214").map((t) => t.attributes("text-anchor"))
    expect(anchors).toEqual(["start", "middle", "end"])
  })

  it("tells the two lines apart by dash as well as colour", () => {
    const wrapper = mount(NodeCompareChart, {
      props: {
        labels,
        series: [
          { name: "a", color: "#2a78d6", data: [1, 2, 3] },
          { name: "b", color: "#eb6834", dashed: true, data: [3, 2, 1] },
        ],
      },
    })

    const dashes = wrapper.findAll("polyline.compare-line").map((l) => l.attributes("stroke-dasharray") ?? "")
    expect(dashes[0]).toBe("")
    expect(dashes[1]).not.toBe("")
  })

  it("says so when there is no data for the range", () => {
    const wrapper = mount(NodeCompareChart, { props: { labels: [], series: [] } })

    expect(wrapper.text()).toContain("No query data")
  })
})
