import { describe, it, expect } from "vitest"
import { mount } from "@vue/test-utils"
import TypeBars from "./TypeBars.vue"

describe("TypeBars", () => {
  const props = { labels: ["A", "AAAA", "PTR"], values: [50, 30, 20] }

  it("renders a row per type with its count", () => {
    const wrapper = mount(TypeBars, { props })
    expect(wrapper.findAll(".type-row")).toHaveLength(3)
    expect(wrapper.text()).toContain("AAAA")
    expect(wrapper.text()).toContain("30")
  })

  it("scales bars against the largest value", () => {
    const wrapper = mount(TypeBars, { props })
    const widths = wrapper.findAll(".type-row .bg-chart-blue").map((b) => b.attributes("style"))
    expect(widths[0]).toContain("100%")
    expect(widths[2]).toContain("40%")
  })

  it("emits the type when a row is clicked", async () => {
    const wrapper = mount(TypeBars, { props })
    await wrapper.findAll(".type-row")[1]!.trigger("click")
    expect(wrapper.emitted("select")![0]).toEqual(["AAAA"])
  })
})
