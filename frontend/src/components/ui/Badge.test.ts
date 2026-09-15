import { describe, it, expect } from "vitest"
import { mount } from "@vue/test-utils"
import Badge from "./Badge.vue"

describe("Badge", () => {
  it("renders the slot content with the tone's color classes", () => {
    const wrapper = mount(Badge, { props: { tone: "ok" }, slots: { default: "NoError" } })
    expect(wrapper.text()).toBe("NoError")
    expect(wrapper.classes()).toContain("text-ok")
    expect(wrapper.classes()).toContain("bg-ok/12")
  })

  it("uses distinct classes per tone", () => {
    const tones = ["ok", "warn", "crit", "info", "cache", "neutral"] as const
    const seen = new Set<string>()
    for (const tone of tones) {
      const wrapper = mount(Badge, { props: { tone } })
      seen.add(wrapper.classes().join(" "))
    }
    expect(seen.size).toBe(tones.length)
  })
})
