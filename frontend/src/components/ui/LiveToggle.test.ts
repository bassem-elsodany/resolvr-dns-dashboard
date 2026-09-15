import { describe, it, expect } from "vitest"
import { mount } from "@vue/test-utils"
import LiveToggle from "./LiveToggle.vue"

describe("LiveToggle", () => {
  it("renders an off switch track and status dot in gray, with aria-checked false", () => {
    const wrapper = mount(LiveToggle, { props: { modelValue: false } })
    expect(wrapper.attributes("aria-checked")).toBe("false")
    expect(wrapper.attributes("role")).toBe("switch")
    // switch track (3rd span: dot, "Live" text, track) should be neutral, not green
    const track = wrapper.findAll("span")[2]!
    expect(track.classes()).toContain("bg-border")
    expect(track.classes()).not.toContain("bg-ok")
  })

  it("renders an on (green) switch track and status dot, with aria-checked true", () => {
    const wrapper = mount(LiveToggle, { props: { modelValue: true } })
    expect(wrapper.attributes("aria-checked")).toBe("true")
    const track = wrapper.findAll("span")[2]!
    expect(track.classes()).toContain("bg-ok")
  })

  it("emits update:modelValue with the flipped value on click", async () => {
    const wrapper = mount(LiveToggle, { props: { modelValue: false } })
    await wrapper.trigger("click")
    expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([true])
  })
})
