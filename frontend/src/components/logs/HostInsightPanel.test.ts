import { describe, it, expect } from "vitest"
import { mount } from "@vue/test-utils"
import HostInsightPanel from "./HostInsightPanel.vue"

describe("HostInsightPanel", () => {
  it("computes allowed % from total minus blocked", () => {
    const wrapper = mount(HostInsightPanel, {
      props: { ip: "10.0.10.30", hostname: "studio.villa58.lan", total: 800, blocked: 200, cacheBlocked: 0, upstreamBlocked: 0 },
    })

    expect(wrapper.text()).toContain("75%")
    expect(wrapper.text()).toContain("studio.villa58.lan")
  })

  it("derives the generic 'Blocked (zone / list)' bucket as blocked minus the two known sub-mechanisms", () => {
    const wrapper = mount(HostInsightPanel, {
      props: { ip: "10.0.10.30", hostname: null, total: 100, blocked: 30, cacheBlocked: 5, upstreamBlocked: 3 },
    })

    // 30 - 5 - 3 = 22
    const panel = wrapper.get("#host-insight")
    expect(panel.text()).toMatch(/Blocked \(zone \/ list\)[\s\S]*22/)
  })

  it("never labels anything as a specific block-list source, only the reported mechanism", () => {
    const wrapper = mount(HostInsightPanel, {
      props: { ip: "10.0.10.30", hostname: null, total: 10, blocked: 5, cacheBlocked: 1, upstreamBlocked: 1 },
    })

    expect(wrapper.text()).not.toMatch(/StevenBlack|hosts file|block list file|\.txt|\.csv/i)
    expect(wrapper.text()).toContain("not the specific list file or rule")
  })
})
