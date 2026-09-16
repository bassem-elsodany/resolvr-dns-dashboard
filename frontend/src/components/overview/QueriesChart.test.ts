import { describe, it, expect } from "vitest"
import { mount } from "@vue/test-utils"
import QueriesChart from "./QueriesChart.vue"

describe("QueriesChart", () => {
  it("shows an empty state when there are no datasets", () => {
    const wrapper = mount(QueriesChart, {
      props: { chart: { labelFormat: "HH:mm", labels: [], datasets: [] } },
    })

    expect(wrapper.text()).toContain("No query data for this time range yet.")
    expect(wrapper.find("svg").exists()).toBe(false)
  })

  it("draws one path per dataset using the API-provided colors", () => {
    const wrapper = mount(QueriesChart, {
      props: {
        chart: {
          labelFormat: "HH:mm",
          labels: ["10:00", "10:01"],
          datasets: [
            { label: "Total", data: [4, 6], borderColor: "rgb(102, 153, 255)", backgroundColor: "rgba(102,153,255,0.1)", fill: true },
            { label: "Blocked", data: [1, 2], borderColor: "rgb(255, 0, 0)" },
          ],
        },
      },
    })

    // Every dataset gets an area path (fill:none when not filled) plus a
    // stroked line path — 2 datasets => 4 paths total.
    const paths = wrapper.findAll("path")
    expect(paths.length).toBe(4)
    expect(wrapper.html()).toContain("rgb(102, 153, 255)")
    expect(wrapper.html()).toContain("rgb(255, 0, 0)")
    expect(wrapper.text()).toContain("Total")
    expect(wrapper.text()).toContain("Blocked")
  })

  it("only draws the wireframe's 3 series (Total/No Error/Blocked), filtering out the other 8 real Technitium returns", () => {
    // mainChartData actually carries 11 series — confirmed live against
    // dns.villa58.lan. Rendering all of them produced a cluttered chart
    // nobody approved; the wireframe's "Queries over time" card scoped
    // it to exactly these 3.
    const wrapper = mount(QueriesChart, {
      props: {
        chart: {
          labelFormat: "HH:mm",
          labels: ["10:00"],
          datasets: [
            { label: "Total", data: [10] },
            { label: "No Error", data: [7] },
            { label: "Server Failure", data: [1] },
            { label: "NX Domain", data: [2] },
            { label: "Refused", data: [0] },
            { label: "Authoritative", data: [3] },
            { label: "Recursive", data: [4] },
            { label: "Cached", data: [5] },
            { label: "Blocked", data: [3] },
            { label: "Dropped", data: [0] },
            { label: "Clients", data: [6] },
          ],
        },
      },
    })

    expect(wrapper.text()).toContain("Total")
    expect(wrapper.text()).toContain("No Error")
    expect(wrapper.text()).toContain("Blocked")
    expect(wrapper.text()).not.toContain("Server Failure")
    expect(wrapper.text()).not.toContain("NX Domain")
    expect(wrapper.text()).not.toContain("Authoritative")
    expect(wrapper.text()).not.toContain("Recursive")
    expect(wrapper.text()).not.toContain("Cached")
    expect(wrapper.text()).not.toContain("Dropped")
    expect(wrapper.text()).not.toContain("Clients")
  })

  describe("hover tooltip", () => {
    function mountWithChart() {
      const wrapper = mount(QueriesChart, {
        props: {
          chart: {
            labelFormat: "HH:mm",
            labels: ["10:00", "10:01", "10:02", "10:03"],
            datasets: [
              { label: "Total", data: [10, 20, 30, 40], borderColor: "rgb(1, 1, 1)" },
              { label: "No Error", data: [8, 15, 22, 30], borderColor: "rgb(2, 2, 2)" },
              { label: "Blocked", data: [2, 5, 8, 10], borderColor: "rgb(3, 3, 3)" },
            ],
          },
        },
      })
      const chartEl = wrapper.get(".relative").element as HTMLElement
      chartEl.getBoundingClientRect = () => ({ left: 0, right: 400, width: 400, top: 0, bottom: 190, height: 190, x: 0, y: 0, toJSON: () => {} })
      return { wrapper, chartEl }
    }

    // jsdom's MouseEvent.clientX is a read-only getter — @vue/test-utils'
    // trigger() tries to Object.assign it onto the event and throws, so
    // dispatch a real PointerEvent (with clientX set via the constructor,
    // which jsdom does allow) directly instead.
    async function pointerMoveAt(el: HTMLElement, clientX: number) {
      el.dispatchEvent(new MouseEvent("pointermove", { clientX, bubbles: true }))
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    it("shows no tooltip until the pointer moves over the chart", () => {
      const { wrapper } = mountWithChart()

      expect(wrapper.find("#queries-chart-tooltip").exists()).toBe(false)
    })

    it("shows the nearest point's label and each series' value on pointer move", async () => {
      const { wrapper, chartEl } = mountWithChart()

      await pointerMoveAt(chartEl, 10) // near the left edge → index 0

      const tooltip = wrapper.get("#queries-chart-tooltip")
      expect(tooltip.text()).toContain("10:00")
      expect(tooltip.text()).toContain("Total")
      expect(tooltip.text()).toContain("10")
      expect(tooltip.text()).toContain("Blocked")
      expect(tooltip.text()).toContain("2")
    })

    it("tracks a different point as the pointer moves further along the chart", async () => {
      const { wrapper, chartEl } = mountWithChart()

      await pointerMoveAt(chartEl, 395) // near the right edge → last index

      const tooltip = wrapper.get("#queries-chart-tooltip")
      expect(tooltip.text()).toContain("10:03")
      expect(tooltip.text()).toContain("40")
    })

    it("hides the tooltip again once the pointer leaves the chart", async () => {
      const { wrapper, chartEl } = mountWithChart()

      await pointerMoveAt(chartEl, 10)
      expect(wrapper.find("#queries-chart-tooltip").exists()).toBe(true)

      chartEl.dispatchEvent(new MouseEvent("pointerleave", { bubbles: true }))
      await wrapper.vm.$nextTick()

      expect(wrapper.find("#queries-chart-tooltip").exists()).toBe(false)
    })
  })
})
