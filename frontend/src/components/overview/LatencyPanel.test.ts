import { describe, it, expect } from "vitest"
import { mount } from "@vue/test-utils"
import LatencyPanel from "./LatencyPanel.vue"

describe("LatencyPanel", () => {
  it("shows percentile bins, the slow share, and one bar per bin", () => {
    const rtts = [...Array(90).fill(3), ...Array(5).fill(30), ...Array(5).fill(150)]
    const wrapper = mount(LatencyPanel, { props: { rtts, sampleSize: 200, state: "ready" } })
    expect(wrapper.get("#latency-p50").text()).toBe("2–5 ms")
    expect(wrapper.get("#latency-p95").text()).toBe("20–50 ms")
    expect(wrapper.get("#latency-slow").text()).toBe("5.0%")
    expect(wrapper.findAll(".latency-bar")).toHaveLength(9)
    expect(wrapper.text()).toContain("100 of 200 sampled queries")
  })

  it("paints only the slow tail orange", () => {
    const wrapper = mount(LatencyPanel, { props: { rtts: [1, 150], sampleSize: 2, state: "ready" } })
    const fills = wrapper.findAll(".latency-bar").map((b) => b.attributes("fill"))
    expect(fills.filter((f) => f?.includes("orange"))).toHaveLength(2) // 100-200 and >200
  })

  it("explains each unavailable state instead of drawing an empty chart", () => {
    const text = (state: "loading" | "missing" | "error", rtts: number[] = []) =>
      mount(LatencyPanel, { props: { rtts, sampleSize: 0, state } }).text()
    expect(text("loading")).toContain("Loading")
    expect(text("missing")).toContain("query-logging app")
    expect(text("error")).toContain("Could not load")
    expect(mount(LatencyPanel, { props: { rtts: [], sampleSize: 10, state: "ready" } }).text()).toContain("No upstream queries")
  })
})
