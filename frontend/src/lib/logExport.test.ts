import { describe, it, expect } from "vitest"
import { mergeCsv } from "./logExport"

const HEAD = "RowNumber,Timestamp,ClientIpAddress,Protocol,ResponseType,ResponseRtt,RCODE,Domain,Type,Class,Answer"

describe("mergeCsv", () => {
  it("adds a Node column and puts both nodes' rows in time order", () => {
    const n1 = `﻿${HEAD}\n1,2026-10-12T06:00:01Z,10.0.0.1,Udp,Cached,,NoError,a.test,A,IN,\n2,2026-10-12T06:00:03Z,10.0.0.1,Udp,Cached,,NoError,c.test,A,IN,\n`
    const n2 = `﻿${HEAD}\n1,2026-10-12T06:00:02Z,10.0.0.2,Udp,Recursive,12,NoError,b.test,A,IN,\n`

    const out = mergeCsv([
      { node: "node1", text: n1 },
      { node: "node2", text: n2 },
    ]).split("\n")

    expect(out[0]).toBe(`﻿Node,${HEAD}`)
    expect(out[1]).toContain("node1,1,2026-10-12T06:00:01Z")
    expect(out[2]).toContain("node2,1,2026-10-12T06:00:02Z")
    expect(out[3]).toContain("node1,2,2026-10-12T06:00:03Z")
  })

  it("keeps quoted answers exactly as exported", () => {
    const n1 = `${HEAD}\n1,2026-10-12T06:00:01Z,10.0.0.1,Udp,Cached,,NoError,a.test,TXT,IN,"v=spf1, include:x"\n`

    const out = mergeCsv([{ node: "node1", text: n1 }])

    expect(out).toContain('"v=spf1, include:x"')
  })

  it("is empty when there is nothing to merge", () => {
    expect(mergeCsv([])).toBe("")
    expect(mergeCsv([{ node: "node1", text: "" }])).toBe("")
  })
})
