import { describe, it, expect } from "vitest"
import { formatRecordValue } from "./formatRecordValue"

describe("formatRecordValue", () => {
  it("uses the value field directly for simple records (A/AAAA/NS)", () => {
    expect(formatRecordValue({ value: "216.58.199.174" })).toBe("216.58.199.174")
  })

  it("joins multiple fields for compound records (SOA)", () => {
    expect(formatRecordValue({ primaryNameServer: "server1", serial: 1 })).toBe(
      "primaryNameServer=server1, serial=1",
    )
  })

  it("returns a placeholder for an empty rData object", () => {
    expect(formatRecordValue({})).toBe("–")
  })
})
