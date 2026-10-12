import { describe, it, expect } from "vitest"
import { diffLists } from "./listSync"

describe("diffLists", () => {
  it("is in sync when every node holds the same domains", () => {
    const d = diffLists({ n1: ["a.test", "b.test"], n2: ["b.test", "a.test"] }, ["n1", "n2"])

    expect(d.inSync).toBe(true)
    expect(d.union).toEqual(["a.test", "b.test"])
    expect(d.missingOn).toEqual({})
  })

  it("names the node a domain has not reached yet", () => {
    const d = diffLists({ n1: ["a.test", "new.test"], n2: ["a.test"] }, ["n1", "n2"])

    expect(d.inSync).toBe(false)
    expect(d.missingOn).toEqual({ "new.test": ["n2"] })
    expect(d.union).toEqual(["a.test", "new.test"])
  })

  it("ignores a node that could not be read instead of calling everything missing", () => {
    const d = diffLists({ n1: ["a.test"] }, ["n1", "n2"])

    expect(d.inSync).toBe(true)
    expect(d.missingOn).toEqual({})
  })
})
