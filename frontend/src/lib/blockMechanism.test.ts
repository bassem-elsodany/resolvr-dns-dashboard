import { describe, it, expect } from "vitest"
import { blockedByLabel } from "./blockMechanism"

describe("blockedByLabel", () => {
  it("labels the three responseType values Technitium actually distinguishes", () => {
    expect(blockedByLabel("Blocked")).toBe("Blocked")
    expect(blockedByLabel("CacheBlocked")).toBe("Cache Block")
    expect(blockedByLabel("UpstreamBlocked")).toBe("Upstream Block")
  })

  it("returns null for non-blocked response types", () => {
    expect(blockedByLabel("Recursive")).toBeNull()
    expect(blockedByLabel("Cached")).toBeNull()
    expect(blockedByLabel("Authoritative")).toBeNull()
  })
})
