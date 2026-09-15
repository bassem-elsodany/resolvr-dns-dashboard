import { describe, it, expect } from "vitest"
import { ENDPOINTS } from "./endpoints"

describe("ENDPOINTS", () => {
  it("every path starts with a single leading slash and has no trailing slash", () => {
    for (const path of Object.values(ENDPOINTS)) {
      expect(path).toMatch(/^\/[^/]/)
      expect(path).not.toMatch(/\/$/)
    }
  })

  it("has no duplicate paths across different keys", () => {
    const paths = Object.values(ENDPOINTS)
    expect(new Set(paths).size).toBe(paths.length)
  })
})
