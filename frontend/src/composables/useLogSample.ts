import { ref } from "vue"
import { queryLogs, type QueryLogEntry } from "../api/technitium"
import { useConnectionStore } from "../stores/connection"
import { useTimeRangeStore } from "../stores/timeRange"
import { useQueryLogsAppStore } from "../stores/queryLogsApp"
import { cached } from "../lib/charts"
import { mergeEntries } from "../lib/clients"
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

  // `node` aims the sample at one node of a cluster (query logs are kept
  // per node); left out, the connected node is sampled.
  async function load(force = false, node?: string): Promise<void> {
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
        `log-sample-${duration}-${node ?? "self"}`,
        TTL_MS,
        () =>
          queryLogs(connection.credentials, app, {
            ...durationToRange(duration),
            pageNumber: 1,
            entriesPerPage: SAMPLE_SIZE,
            descendingOrder: true,
            node,
          }),
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

export interface SampleTarget {
  // Technitium's `node` parameter (undefined for the connected node).
  node: string | undefined
  // The node's name, stamped on each entry so the page can tell them apart.
  name: string
}

// The same shared sample, taken from several nodes and merged (latest first),
// each entry marked with the node it came from. A node that cannot be read is
// skipped, so one unreachable node does not blank the page.
export function useMergedLogSample() {
  const connection = useConnectionStore()
  const timeRange = useTimeRangeStore()
  const queryLogsApp = useQueryLogsAppStore()
  const entries = ref<QueryLogEntry[]>([])
  const state = ref<"loading" | "ready" | "missing" | "error">("loading")

  async function load(force: boolean, targets: SampleTarget[]): Promise<void> {
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
    const settled = await Promise.allSettled(
      targets.map(async (t) => {
        const res = await cached(
          // Same key as the single-node sample, so the Overview and this
          // page share requests.
          `log-sample-${duration}-${t.node ?? "self"}`,
          TTL_MS,
          () =>
            queryLogs(connection.credentials, app, {
              ...durationToRange(duration),
              pageNumber: 1,
              entriesPerPage: SAMPLE_SIZE,
              descendingOrder: true,
              node: t.node,
            }),
          force,
        )
        return res.response.entries.map((e) => ({ ...e, node: t.name }))
      }),
    )
    const lists = settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []))
    if (lists.length === 0) {
      state.value = "error"
      return
    }
    entries.value = mergeEntries(lists, SAMPLE_SIZE * targets.length)
    state.value = "ready"
  }

  return { entries, state, load }
}
