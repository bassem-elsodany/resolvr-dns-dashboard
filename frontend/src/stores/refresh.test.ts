import { describe, it, expect, beforeEach } from "vitest"
import { createPinia, setActivePinia } from "pinia"
import { useRefreshStore } from "./refresh"

describe("refresh store", () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it("trigger() increments tick so watchers elsewhere fire", () => {
    const store = useRefreshStore()
    expect(store.tick).toBe(0)
    store.trigger()
    expect(store.tick).toBe(1)
    store.trigger()
    expect(store.tick).toBe(2)
  })
})
