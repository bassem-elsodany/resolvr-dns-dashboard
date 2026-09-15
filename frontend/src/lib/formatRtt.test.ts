import { describe, it, expect } from "vitest"
import { formatRtt } from "./formatRtt"

describe("formatRtt", () => {
  it("formats a real RTT to one decimal place with a unit", () => {
    expect(formatRtt(135.86149999999998)).toBe("135.9 ms")
  })

  it("returns a placeholder when RTT is absent (blocked queries never reach upstream)", () => {
    expect(formatRtt(undefined)).toBe("–")
  })
})
