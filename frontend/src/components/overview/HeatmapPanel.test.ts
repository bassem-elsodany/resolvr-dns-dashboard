import { describe, it, expect, vi, beforeEach } from "vitest"
import { mount, flushPromises } from "@vue/test-utils"
import { createPinia, setActivePinia } from "pinia"
import { createRouter, createMemoryHistory } from "vue-router"

vi.mock("../../api/technitium", async () => {
  const actual = await vi.importActual<typeof import("../../api/technitium")>("../../api/technitium")
  return { ...actual, getDashboardStats: vi.fn() }
})

import { getDashboardStats } from "../../api/technitium"
import { useConnectionStore } from "../../stores/connection"
import { clearCache } from "../../lib/charts"
import HeatmapPanel from "./HeatmapPanel.vue"

// A Monday 09:00 and a Sunday 23:00, local time.
const mon9 = new Date(2026, 9, 5, 9, 0).toISOString()
const sun23 = new Date(2026, 9, 11, 23, 0).toISOString()

function stats(labels: string[], data: number[]) {
  return { response: { stats: {}, mainChartData: { labelFormat: "", labels, datasets: [{ label: "Total", data }] } } } as never
}

async function mountPanel() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: { template: "<div />" } },
      { path: "/logs", component: { template: "<div />" } },
    ],
  })
  await router.push("/")
  const wrapper = mount(HeatmapPanel, { global: { plugins: [router] } })
  useConnectionStore().isConfigured = true
  await flushPromises()
  return { wrapper, router }
}

describe("HeatmapPanel", () => {
  beforeEach(() => {
    clearCache()
    setActivePinia(createPinia())
    vi.mocked(getDashboardStats).mockReset()
  })

  it("fetches the week as three windows and draws a 7 x 24 grid", async () => {
    vi.mocked(getDashboardStats)
      .mockResolvedValueOnce(stats([mon9], [40]))
      .mockResolvedValueOnce(stats([sun23], [10]))
      .mockResolvedValueOnce(stats([], []))
    const { wrapper } = await mountPanel()

    expect(getDashboardStats).toHaveBeenCalledTimes(3)
    expect(vi.mocked(getDashboardStats).mock.calls.every((c) => c[0] === "Custom")).toBe(true)
    expect(wrapper.findAll(".heat-cell")).toHaveLength(168)
  })

  it("counts a point that appears in two windows only once", async () => {
    vi.mocked(getDashboardStats)
      .mockResolvedValueOnce(stats([mon9], [40]))
      .mockResolvedValueOnce(stats([mon9], [40]))
      .mockResolvedValueOnce(stats([], []))
    const { wrapper } = await mountPanel()

    const cells = wrapper.findAll(".heat-cell")
    await cells[9]!.trigger("pointermove") // Monday 09:00
    const tip = wrapper.get(".chart-tip").text()
    expect(tip).toContain("Mon 09:00")
    // Counted once (40), not twice (80).
    expect(tip).toContain("40")
    expect(tip).not.toContain("80")
  })

  it("opens Query Logs for that hour when a cell is clicked", async () => {
    vi.mocked(getDashboardStats).mockResolvedValue(stats([mon9], [40]))
    const { wrapper, router } = await mountPanel()

    await wrapper.findAll(".heat-cell")[9]!.trigger("click")
    await flushPromises()
    expect(router.currentRoute.value.path).toBe("/logs")
    const { start, end } = router.currentRoute.value.query as Record<string, string>
    expect(new Date(start).getHours()).toBe(9)
    expect(new Date(end).getTime() - new Date(start).getTime()).toBe(3600_000)
  })

  it("says so when the week has no traffic, and when loading fails", async () => {
    vi.mocked(getDashboardStats).mockResolvedValue(stats([], []))
    expect((await mountPanel()).wrapper.text()).toContain("No queries recorded")

    clearCache()
    vi.mocked(getDashboardStats).mockRejectedValue(new Error("boom"))
    expect((await mountPanel()).wrapper.text()).toContain("Could not load")
  })
})
