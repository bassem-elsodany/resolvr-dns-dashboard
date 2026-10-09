import { describe, it, expect } from "vitest"
import { mount } from "@vue/test-utils"
import DonutChart from "./DonutChart.vue"

const items = [
  { label: "Cached", value: 75, color: "red", filter: "Cached" },
  { label: "Recursive", value: 25, color: "blue", filter: "Recursive" },
  { label: "Dropped", value: 0, color: "gray", filter: "" },
]

describe("DonutChart", () => {
  it("lists every item with its count and share, even when zero", () => {
    const text = mount(DonutChart, { props: { items, centerSub: "queries" } }).text()
    expect(text).toContain("Cached")
    expect(text).toContain("75.0%")
    expect(text).toContain("Dropped")
    expect(text).toContain("0.0%")
  })

  it("shows the total in the centre, and a slice's share while hovering it", async () => {
    const wrapper = mount(DonutChart, { props: { items, centerSub: "queries" } })
    expect(wrapper.get(".donut-center").text()).toBe("100")
    await wrapper.findAll(".donut-slice")[1]!.trigger("pointerenter")
    expect(wrapper.get(".donut-center").text()).toBe("25.0%")
    expect(wrapper.text()).toContain("Recursive")
    await wrapper.findAll(".donut-slice")[1]!.trigger("pointerleave")
    expect(wrapper.get(".donut-center").text()).toBe("100")
  })

  it("draws no arc for an empty slice", () => {
    const wrapper = mount(DonutChart, { props: { items, centerSub: "queries" } })
    expect(wrapper.findAll(".donut-slice").filter((p) => p.attributes("style")?.includes("display: none"))).toHaveLength(1)
  })

  it("emits the item when a slice, a legend row, or Enter on a focused slice is used", async () => {
    const wrapper = mount(DonutChart, { props: { items, centerSub: "queries" } })
    await wrapper.findAll(".donut-slice")[0]!.trigger("click")
    await wrapper.findAll(".donut-row")[1]!.trigger("click")
    await wrapper.findAll(".donut-slice")[0]!.trigger("keydown", { key: "Enter" })
    const events = wrapper.emitted("select")!.map((e) => (e[0] as { filter: string }).filter)
    expect(events).toEqual(["Cached", "Recursive", "Cached"])
  })

  it("does not break with all-zero data", () => {
    const wrapper = mount(DonutChart, { props: { items: items.map((i) => ({ ...i, value: 0 })), centerSub: "queries" } })
    expect(wrapper.get(".donut-center").text()).toBe("0")
  })
})
