import { describe, it, expect, beforeEach } from "vitest"
import { createPinia, setActivePinia } from "pinia"
import { useTimeRangeStore } from "./timeRange"

describe("timeRange store", () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it("defaults to LastHour", () => {
    expect(useTimeRangeStore().selected).toBe("LastHour")
  })

  it("set() updates the shared selection", () => {
    const store = useTimeRangeStore()
    store.set("LastWeek")
    expect(store.selected).toBe("LastWeek")
  })
})
