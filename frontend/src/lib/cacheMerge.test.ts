import { describe, it, expect } from "vitest"
import { mergeCaches, matchesPresence } from "./cacheMerge"

const rec = (name: string, type: string, ttl: string | number, rData: Record<string, unknown>) => ({ name, type, ttl, rData })
const A = (ip: string) => ({ ipAddress: ip })

describe("mergeCaches", () => {
  it("puts a record held by both nodes on one row with each node's time left", () => {
    const m = mergeCaches([
      { node: "n1", zones: [], records: [rec("a.test", "A", "283 (4 mins)", A("1.1.1.1"))] },
      { node: "n2", zones: [], records: [rec("a.test", "A", "100 (1 min)", A("1.1.1.1"))] },
    ])

    expect(m.records).toHaveLength(1)
    expect(m.records[0]!.ttl).toEqual({ n1: "283 (4 mins)", n2: "100 (1 min)" })
    expect(m.records[0]!.nodes).toEqual(["n1", "n2"])
  })

  it("keeps a record held by only one node, and says which", () => {
    const m = mergeCaches([
      { node: "n1", zones: [], records: [rec("only1.test", "A", 5, A("2.2.2.2"))] },
      { node: "n2", zones: [], records: [rec("only2.test", "A", 6, A("3.3.3.3"))] },
    ])

    expect(m.records.map((r) => [r.name, r.nodes])).toEqual([
      ["only1.test", ["n1"]],
      ["only2.test", ["n2"]],
    ])
  })

  it("treats a different value for the same name and type as a different record", () => {
    const m = mergeCaches([
      { node: "n1", zones: [], records: [rec("a.test", "A", 5, A("1.1.1.1"))] },
      { node: "n2", zones: [], records: [rec("a.test", "A", 5, A("9.9.9.9"))] },
    ])

    expect(m.records).toHaveLength(2)
  })

  it("unions the cached subdomains, sorted, remembering which nodes hold each", () => {
    const m = mergeCaches([
      { node: "n1", zones: ["com", "net"], records: [] },
      { node: "n2", zones: ["org", "com"], records: [] },
    ])

    expect(m.zones.map((z) => z.name)).toEqual(["com", "net", "org"])
    expect(m.zones.find((z) => z.name === "com")!.nodes).toEqual(["n1", "n2"])
    expect(m.zones.find((z) => z.name === "org")!.nodes).toEqual(["n2"])
  })
})

describe("matchesPresence", () => {
  const both = { name: "a", type: "A", value: "x", ttl: {}, nodes: ["n1", "n2"] }
  const one = { ...both, nodes: ["n1"] }

  it("filters records held on every node or only some", () => {
    expect(matchesPresence(both, 2, "both")).toBe(true)
    expect(matchesPresence(one, 2, "both")).toBe(false)
    expect(matchesPresence(one, 2, "one")).toBe(true)
    expect(matchesPresence(both, 2, "one")).toBe(false)
    expect(matchesPresence(one, 2, "all")).toBe(true)
  })
})
