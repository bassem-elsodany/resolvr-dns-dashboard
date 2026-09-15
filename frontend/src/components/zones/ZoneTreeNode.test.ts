import { describe, it, expect, vi } from "vitest"
import { mount } from "@vue/test-utils"
import { TechnitiumApiError } from "../../api/technitium"
import { AppApiError } from "../../api/app"
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

  it("relabels itself to the resolved domain when the API auto-descends through a single-child chain", async () => {
    // Regression: confirmed live — expanding a root label with only
    // one descendant (e.g. "example") can jump straight to that
    // descendant's own records ("resolvr-e2e-test-domain.example"),
    // skipping the intermediate label entirely. The row must reflect
    // what's actually blocked, both for display and for Remove (see
    // the next test) — showing "example" while acting on a different
    // domain underneath would be actively misleading.
    const fetchNode = vi.fn().mockResolvedValue({
      response: {
        domain: "resolvr-e2e-test-domain.example",
        zones: [],
        records: [{ name: "resolvr-e2e-test-domain.example", type: "SOA", ttl: 30, rData: {} }],
      },
    })
    const wrapper = mount(ZoneTreeNode, { props: { domain: "example", depth: 0, fetchNode } })

    await wrapper.get("button").trigger("click")
    await flushPromises()

    const label = wrapper.get("span.font-mono")
    expect(label.text()).toBe("resolvr-e2e-test-domain.example")
    expect(wrapper.text()).toContain("Blocked")
  })

  it("removes the resolved domain, not the originally-requested label, after an auto-descend", async () => {
    const fetchNode = vi.fn().mockResolvedValue({
      response: {
        domain: "resolvr-e2e-test-domain.example",
        zones: [],
        records: [{ name: "resolvr-e2e-test-domain.example", type: "SOA", ttl: 30, rData: {} }],
      },
    })
    const deleteDomain = vi.fn().mockResolvedValue({ status: "ok" })
    const wrapper = mount(ZoneTreeNode, { props: { domain: "example", depth: 0, fetchNode, deleteDomain } })

    await wrapper.get("button").trigger("click")
    await flushPromises()
    await wrapper.get(".zone-tree-remove").trigger("click")
    await wrapper.get("button.text-crit").trigger("click")
    await flushPromises()

    expect(deleteDomain).toHaveBeenCalledWith("resolvr-e2e-test-domain.example")
    expect(deleteDomain).not.toHaveBeenCalledWith("example")
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

  describe("removal (admin only)", () => {
    async function mountBlockedLeaf(deleteDomain: (domain: string) => Promise<{ status: string }>) {
      const fetchNode = vi.fn().mockResolvedValue({
        response: { domain: "example.com", zones: [], records: [{ name: "example.com", type: "SOA", ttl: 30, rData: {} }] },
      })
      const wrapper = mount(ZoneTreeNode, { props: { domain: "example.com", depth: 0, fetchNode, deleteDomain } })
      await wrapper.get("button").trigger("click") // expand to learn hasOwnRecords
      await flushPromises()
      return wrapper
    }

    it("offers no Remove control without a deleteDomain prop (e.g. a viewer)", async () => {
      const fetchNode = vi.fn().mockResolvedValue({
        response: { domain: "example.com", zones: [], records: [{ name: "example.com", type: "SOA", ttl: 30, rData: {} }] },
      })
      const wrapper = mount(ZoneTreeNode, { props: { domain: "example.com", depth: 0, fetchNode } })
      await wrapper.get("button").trigger("click")
      await flushPromises()

      expect(wrapper.find(".zone-tree-remove").exists()).toBe(false)
    })

    it("offers no Remove control on a pure grouping label (no records of its own)", async () => {
      const fetchNode = vi.fn().mockResolvedValue({ response: { domain: "com", zones: ["example.com"], records: [] } })
      const wrapper = mount(ZoneTreeNode, {
        props: { domain: "com", depth: 0, fetchNode, deleteDomain: vi.fn() },
      })
      await wrapper.get("button").trigger("click")
      await flushPromises()

      expect(wrapper.find(".zone-tree-remove").exists()).toBe(false)
    })

    it("requires a two-step confirmation, then removes the domain and hides the row", async () => {
      const deleteDomain = vi.fn().mockResolvedValue({ status: "ok" })
      const wrapper = await mountBlockedLeaf(deleteDomain)

      await wrapper.get(".zone-tree-remove").trigger("click")
      expect(deleteDomain).not.toHaveBeenCalled()
      expect(wrapper.text()).toContain("Confirm")

      await wrapper.get("button.text-crit").trigger("click")
      await flushPromises()

      expect(deleteDomain).toHaveBeenCalledWith("example.com")
      expect(wrapper.find("li").exists()).toBe(false)
    })

    it("shows a readable error, not a raw stack trace, when removal fails, and keeps the row", async () => {
      const deleteDomain = vi.fn().mockRejectedValue(new AppApiError("Permission denied.", 502))
      const wrapper = await mountBlockedLeaf(deleteDomain)

      await wrapper.get(".zone-tree-remove").trigger("click")
      await wrapper.get("button.text-crit").trigger("click")
      await flushPromises()

      expect(wrapper.text()).toContain("Permission denied.")
      expect(wrapper.find("li").exists()).toBe(true)
    })
  })
})
