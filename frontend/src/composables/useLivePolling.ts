import { ref, onUnmounted } from "vue"

// Backs the Live toggle the wireframe shows on Query Logs — extended to
// every page that displays query/live server data, not just that one.
// Each page owns its own polling (rather than a global "live" switch)
// so turning Live on for Zones doesn't also start polling Sessions.
export function useLivePolling(load: () => void, intervalMs = 5000) {
  const liveOn = ref(false)
  let timer: ReturnType<typeof setInterval> | null = null

  function toggle(): void {
    liveOn.value = !liveOn.value
    if (liveOn.value) {
      timer = setInterval(load, intervalMs)
    } else if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  onUnmounted(() => {
    if (timer) clearInterval(timer)
  })

  return { liveOn, toggle }
}
