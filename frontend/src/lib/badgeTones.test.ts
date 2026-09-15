import { describe, it, expect } from "vitest"
import { responseTypeTone, rcodeTone, blockedByTone } from "./badgeTones"

describe("responseTypeTone", () => {
  it("matches the wireframe's color coding", () => {
    expect(responseTypeTone("Recursive")).toBe("info")
    expect(responseTypeTone("Cached")).toBe("cache")
    expect(responseTypeTone("Authoritative")).toBe("neutral")
    expect(responseTypeTone("Blocked")).toBe("crit")
    expect(responseTypeTone("CacheBlocked")).toBe("crit")
    expect(responseTypeTone("UpstreamBlocked")).toBe("crit")
  })
})

describe("rcodeTone", () => {
  it("matches the wireframe's color coding", () => {
    expect(rcodeTone("NoError")).toBe("ok")
    expect(rcodeTone("NxDomain")).toBe("warn")
    expect(rcodeTone("ServerFailure")).toBe("crit")
    expect(rcodeTone("Refused")).toBe("crit")
  })
})

describe("blockedByTone", () => {
  it("colors each mechanism distinctly, matching HostInsightPanel's breakdown bars", () => {
    expect(blockedByTone("Blocked")).toBe("crit")
    expect(blockedByTone("CacheBlocked")).toBe("cache")
    expect(blockedByTone("UpstreamBlocked")).toBe("info")
  })
})
