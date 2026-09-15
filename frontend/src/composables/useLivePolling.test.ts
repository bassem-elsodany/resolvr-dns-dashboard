import { describe, it, expect, vi, afterEach } from "vitest"
import { mount } from "@vue/test-utils"
import { defineComponent, h } from "vue"
import { useLivePolling } from "./useLivePolling"

// useLivePolling calls onUnmounted, which requires an active component
// instance — exercise it through a minimal host component rather than
// calling the composable bare.
function withHost(load: () => void, intervalMs?: number) {
  let api!: ReturnType<typeof useLivePolling>
  const Host = defineComponent({
    setup() {
      api = useLivePolling(load, intervalMs)
      return () => h("div")
    },
  })
  const wrapper = mount(Host)
  return { wrapper, api: api! }
}

describe("useLivePolling", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("starts idle", () => {
    const { api } = withHost(vi.fn())
    expect(api.liveOn.value).toBe(false)
  })

  it("polls load() every interval while on, and stops when toggled off", async () => {
    vi.useFakeTimers()
    const load = vi.fn()
    const { api } = withHost(load, 5000)

    api.toggle()
    expect(api.liveOn.value).toBe(true)
    await vi.advanceTimersByTimeAsync(5000)
    await vi.advanceTimersByTimeAsync(5000)
    expect(load).toHaveBeenCalledTimes(2)

    api.toggle()
    expect(api.liveOn.value).toBe(false)
    load.mockClear()
    await vi.advanceTimersByTimeAsync(15000)
    expect(load).not.toHaveBeenCalled()
  })

  it("stops polling when the host component unmounts", async () => {
    vi.useFakeTimers()
    const load = vi.fn()
    const { wrapper, api } = withHost(load, 5000)

    api.toggle()
    wrapper.unmount()
    await vi.advanceTimersByTimeAsync(15000)

    expect(load).not.toHaveBeenCalled()
  })
})
