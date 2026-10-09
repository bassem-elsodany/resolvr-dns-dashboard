import { ref } from "vue"
import { queryLogs, type QueryLogEntry } from "../api/technitium"
import { useConnectionStore } from "../stores/connection"
import { useTimeRangeStore } from "../stores/timeRange"
import { useQueryLogsAppStore } from "../stores/queryLogsApp"
import { cached } from "../lib/charts"
import { durationToRange } from "../lib/dateRange"

const SAMPLE_SIZE = 5000
const TTL_MS = 60 * 1000

// One sample of the latest logged queries in the selected range, shared by
// the panels that draw from it (response time, resolution flow, client
// activity). It is a single large request, so it is reused for a minute
// (Live refresh included) and only fetched early when `force` is set.
export function useLogSample() {
  const connection = useConnectionStore()
  const timeRange = useTimeRangeStore()
  const queryLogsApp = useQueryLogsAppStore()
  const entries = ref<QueryLogEntry[]>([])
  const state = ref<"loading" | "ready" | "missing" | "error">("loading")

  async function load(force = false): Promise<void> {
    await queryLogsApp.ensure(connection.credentials)
    if (queryLogsApp.missing) {
      state.value = "missing"
      return
    }
    const app = queryLogsApp.app
    if (!app) {
      state.value = "error"
      return
    }
    const duration = timeRange.selected
    try {
      const res = await cached(
        `log-sample-${duration}`,
        TTL_MS,
        () => queryLogs(connection.credentials, app, { ...durationToRange(duration), pageNumber: 1, entriesPerPage: SAMPLE_SIZE, descendingOrder: true }),
        force,
      )
      entries.value = res.response.entries
      state.value = "ready"
    } catch {
      state.value = "error"
    }
  }

  return { entries, state, load }
}
