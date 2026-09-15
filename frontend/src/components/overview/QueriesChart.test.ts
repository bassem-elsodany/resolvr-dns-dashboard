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
})
