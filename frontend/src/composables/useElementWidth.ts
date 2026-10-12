import { onBeforeUnmount, onMounted, ref, type Ref } from "vue"

// The rendered width of an element, kept up to date as it resizes, so a chart
// can draw itself at a fixed height and a fluid width (a viewBox scaled to the
// container grows tall on a wide window). Until the element has been measured
// (and in a test environment with no layout) `fallback` is used.
export function useElementWidth(el: Ref<Element | null>, fallback: number, min = 0, max = Number.POSITIVE_INFINITY): Ref<number> {
  const width = ref(fallback)
  let observer: ResizeObserver | null = null

  onMounted(() => {
    const node = el.value
    if (!node) return
    const read = (): void => {
      const w = node.getBoundingClientRect().width
      if (w > 0) width.value = Math.max(min, Math.min(max, Math.round(w)))
    }
    read()
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(read)
      observer.observe(node)
    }
  })
  onBeforeUnmount(() => observer?.disconnect())

  return width
}
