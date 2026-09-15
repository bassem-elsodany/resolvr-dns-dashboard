import type { StatsDuration } from "../api/technitium"

export interface DateRange {
  start: string
  end: string
}

// Query Logs has no "type" duration shorthand like the stats endpoints do
// (only optional start/end ISO bounds), so callers that want a client's
// activity over "the last week" etc. need to convert here first.
export function durationToRange(duration: StatsDuration, now: Date = new Date()): DateRange {
  const end = new Date(now)
  const start = new Date(now)

  switch (duration) {
    case "LastHour":
      start.setHours(start.getHours() - 1)
      break
    case "LastDay":
      start.setDate(start.getDate() - 1)
      break
    case "LastWeek":
      start.setDate(start.getDate() - 7)
      break
    case "LastMonth":
      start.setMonth(start.getMonth() - 1)
      break
    case "LastYear":
      start.setFullYear(start.getFullYear() - 1)
      break
    default:
      start.setHours(start.getHours() - 1)
  }

  return { start: start.toISOString(), end: end.toISOString() }
}
