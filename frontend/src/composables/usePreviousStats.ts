import { ref } from "vue"
import { getDashboardStats, type DashboardStatsResult } from "../api/technitium"
import { useConnectionStore } from "../stores/connection"
import { useTimeRangeStore } from "../stores/timeRange"
import { previousRange } from "../lib/charts"

type Stats = DashboardStatsResult["response"]["stats"]

const PREV_TTL_MS = 5 * 60 * 1000

// Totals for the window just before the selected one, for "vs previous"
// changes. Cached per range, so a Live refresh every few seconds does not
// double the calls for data that barely moves. The comparison is a
// nicety: if it cannot be loaded the pages simply show no change.
export function usePreviousStats() {
  const connection = useConnectionStore()
  const timeRange = useTimeRangeStore()
  const prevStats = ref<Stats | null>(null)
  let cache: { duration: string; node: string | undefined; at: number; stats: Stats | null } | null = null

  // `node` is Technitium's cluster scope (`cluster`), when the page shows
  // cluster-wide stats; it is part of the cache key so switching scope never
  // shows the other scope's numbers.
  async function loadPrevious(node?: string): Promise<Stats | null> {
    const duration = timeRange.selected
    if (cache && cache.duration === duration && cache.node === node && Date.now() - cache.at < PREV_TTL_MS) {
      prevStats.value = cache.stats
      return cache.stats
    }
    const range = previousRange(duration)
    let result: Stats | null = null
    if (range) {
      try {
        const res = await getDashboardStats("Custom", connection.credentials, { utc: true, node, ...range })
        result = res.response.stats
      } catch {
        // Left as null.
      }
    }
    cache = { duration, node, at: Date.now(), stats: result }
    prevStats.value = result
    return result
  }

  return { prevStats, loadPrevious }
}
