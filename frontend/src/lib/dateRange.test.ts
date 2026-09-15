import { describe, it, expect } from "vitest"
import { durationToRange } from "./dateRange"

describe("durationToRange", () => {
  const now = new Date("2026-09-15T12:00:00.000Z")

  it("LastHour goes back one hour", () => {
    expect(durationToRange("LastHour", now)).toEqual({
      start: "2026-09-15T11:00:00.000Z",
      end: "2026-09-15T12:00:00.000Z",
    })
  })

  it("LastDay goes back one day", () => {
    expect(durationToRange("LastDay", now).start).toBe("2026-09-14T12:00:00.000Z")
  })

  it("LastWeek goes back seven days", () => {
    expect(durationToRange("LastWeek", now).start).toBe("2026-09-08T12:00:00.000Z")
  })

  it("LastMonth goes back one calendar month", () => {
    expect(durationToRange("LastMonth", now).start).toBe("2026-08-15T12:00:00.000Z")
  })

  it("LastYear goes back one calendar year", () => {
    expect(durationToRange("LastYear", now).start).toBe("2025-09-15T12:00:00.000Z")
  })

  it("end always equals the reference time", () => {
    expect(durationToRange("LastWeek", now).end).toBe(now.toISOString())
  })
})
