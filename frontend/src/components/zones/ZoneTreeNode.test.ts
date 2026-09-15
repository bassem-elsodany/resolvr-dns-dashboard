import { describe, it, expect, vi } from "vitest"
import { mount } from "@vue/test-utils"
import { TechnitiumApiError } from "../../api/technitium"
import ZoneTreeNode from "./ZoneTreeNode.vue"

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe("ZoneTreeNode", () => {
  it("renders collapsed and does not fetch until expanded", async () => {
    const fetchNode = vi.fn()
    const wrapper = mount(ZoneTreeNode, { props: { domain: "com", depth: 0, fetchNode } })

    expect(wrapper.text()).toContain("com")
    expect(fetchNode).not.toHaveBeenCalled()
    expect(wrapper.find("ul").exists()).toBe(false)
  })

  it("fetches and renders children on first expand, and marks a node with real records as Blocked", async () => {
    const fetchNode = vi.fn().mockResolvedValue({
      response: { domain: "xxx", zones: ["rule34.xxx"], records: [] },
    })
    const wrapper = mount(ZoneTreeNode, { props: { domain: "xxx", depth: 0, fetchNode } })

    await wrapper.get("button").trigger("click")
    await flushPromises()

    expect(fetchNode).toHaveBeenCalledWith("xxx")
    const children = wrapper.findAllComponents(ZoneTreeNode)
    expect(children.some((c) => c.props("domain") === "rule34.xxx")).toBe(true)
    expect(wrapper.text()).not.toContain("Blocked")
  })

  it("shows a Blocked badge when the resolved node has its own records (an actual blocked zone)", async () => {
    const fetchNode = vi.fn().mockResolvedValue({
      response: { domain: "rule34.xxx", zones: [], records: [{ name: "rule34.xxx", type: "SOA", ttl: 30, rData: {} }] },
    })
    const wrapper = mount(ZoneTreeNode, { props: { domain: "rule34.xxx", depth: 1, fetchNode } })

    await wrapper.get("button").trigger("click")
    await flushPromises()

    expect(wrapper.text()).toContain("Blocked")
    // A blocked leaf with no further children doesn't need the "No
    // further entries." filler text too — the Blocked badge already
    // says everything there is to say about this node.
    expect(wrapper.text()).not.toContain("No further entries.")
  })

  it("shows 'No further entries.' for an expanded node that is neither blocked nor has children", async () => {
    const fetchNode = vi.fn().mockResolvedValue({ response: { domain: "com", zones: [], records: [] } })
    const wrapper = mount(ZoneTreeNode, { props: { domain: "com", depth: 0, fetchNode } })

    await wrapper.get("button").trigger("click")
    await flushPromises()

    expect(wrapper.text()).toContain("No further entries.")
  })

  it("collapses without re-fetching on a second click after already expanded once", async () => {
    const fetchNode = vi.fn().mockResolvedValue({ response: { domain: "com", zones: ["9gag.com"], records: [] } })
    const wrapper = mount(ZoneTreeNode, { props: { domain: "com", depth: 0, fetchNode } })

    await wrapper.get("button").trigger("click") // expand — fetches
    await flushPromises()
    await wrapper.get("button").trigger("click") // collapse
    await wrapper.get("button").trigger("click") // expand again
    await flushPromises()

    expect(fetchNode).toHaveBeenCalledTimes(1)
    expect(wrapper.find("ul").exists()).toBe(true)
  })

  it("shows a readable inline error, not a raw stack trace, when a branch fails to load", async () => {
    const fetchNode = vi.fn().mockRejectedValue(new TechnitiumApiError("Invalid token or session expired.", 200))
    const wrapper = mount(ZoneTreeNode, { props: { domain: "com", depth: 0, fetchNode } })

    await wrapper.get("button").trigger("click")
    await flushPromises()

    expect(wrapper.text()).toContain("Invalid token or session expired.")
  })
})
