import { ref, onUnmounted } from "vue"

// Backs the Live toggle the wireframe shows on Query Logs — extended to
// every page that displays query/live server data, not just that one.
// Each page owns its own polling (rather than a global "live" switch)
// so turning Live on for Zones doesn't also start polling Sessions.
//
// Pass a `storageKey` to remember the choice across navigation: the page
// component is torn down when you leave it, so without this the toggle
// would silently reset to off every time you came back.
const STORAGE_PREFIX = "resolvr.live."

function readStored(key: string | undefined): boolean {
  if (!key) return false
  try {
    return localStorage.getItem(STORAGE_PREFIX + key) === "1"
  } catch {
    return false
  }
}

function writeStored(key: string | undefined, on: boolean): void {
  if (!key) return
  try {
    localStorage.setItem(STORAGE_PREFIX + key, on ? "1" : "0")
  } catch {
    // Private mode / blocked storage: the toggle still works, it just
    // won't be remembered.
  }
}

export function useLivePolling(load: () => void, intervalMs = 5000, storageKey?: string) {
  const liveOn = ref(readStored(storageKey))
  let timer: ReturnType<typeof setInterval> | null = null

  function start(): void {
    if (!timer) timer = setInterval(load, intervalMs)
  }

  function stop(): void {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  function toggle(): void {
    liveOn.value = !liveOn.value
    writeStored(storageKey, liveOn.value)
    if (liveOn.value) start()
    else stop()
  }

  // Resume polling when the page is re-entered with Live remembered as on.
  // The page's own onMounted already does the first load.
  if (liveOn.value) start()

  onUnmounted(stop)

  return { liveOn, toggle }
}
