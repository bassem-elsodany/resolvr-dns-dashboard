import { describe, it, expect, vi, afterEach } from "vitest"
import { defineComponent, h, ref, nextTick } from "vue"
import { mount } from "@vue/test-utils"
import { useElementWidth } from "./useElementWidth"

let trigger: () => void = () => {}

function stubObserver() {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(cb: () => void) {
        trigger = cb
      }
      observe() {}
      disconnect() {}
    },
  )
}

const Probe = defineComponent({
  props: { fallback: { type: Number, default: 720 } },
  setup(props, { expose }) {
    const el = ref<HTMLElement | null>(null)
    const width = useElementWidth(el, props.fallback, 400, 2000)
    expose({ width })
    return () => h("div", { ref: el }, String(width.value))
  },
})

describe("useElementWidth", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("uses the fallback while the element has no layout width", async () => {
    stubObserver()
    const wrapper = mount(Probe)
    await nextTick()

    expect(wrapper.text()).toBe("720")
  })

  it("follows the element's width, clamped to the allowed range", async () => {
    stubObserver()
    const wrapper = mount(Probe, { attachTo: document.body })
    const el = wrapper.element as HTMLElement

    el.getBoundingClientRect = () => ({ width: 1100 }) as DOMRect
    trigger()
    await nextTick()
    expect(wrapper.text()).toBe("1100")

    el.getBoundingClientRect = () => ({ width: 5000 }) as DOMRect
    trigger()
    await nextTick()
    expect(wrapper.text()).toBe("2000")

    el.getBoundingClientRect = () => ({ width: 100 }) as DOMRect
    trigger()
    await nextTick()
    expect(wrapper.text()).toBe("400")
    wrapper.unmount()
  })
})
