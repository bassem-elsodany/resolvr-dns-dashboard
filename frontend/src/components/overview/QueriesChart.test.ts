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
})
