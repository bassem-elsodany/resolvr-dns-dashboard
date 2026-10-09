import { describe, it, expect } from "vitest"
import { mapLimit } from "./async"

describe("mapLimit", () => {
  it("keeps result order and never runs more than the limit at once", async () => {
    let running = 0
    let peak = 0
    const out = await mapLimit([5, 1, 4, 2, 3], 2, async (n) => {
      running++
      peak = Math.max(peak, running)
      await new Promise((r) => setTimeout(r, n))
      running--
      return n * 10
    })
    expect(out).toEqual([50, 10, 40, 20, 30])
    expect(peak).toBe(2)
  })

  it("handles an empty list", async () => {
    expect(await mapLimit([], 3, async (x) => x)).toEqual([])
  })

  it("rejects when one task fails", async () => {
    await expect(mapLimit([1, 2], 2, async (n) => { if (n === 2) throw new Error("boom"); return n })).rejects.toThrow("boom")
  })
})
