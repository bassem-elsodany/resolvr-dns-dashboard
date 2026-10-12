import { describe, it, expect } from "vitest"
import { settingsRows, differingCount } from "./serverCompare"
import type { DnsSettings } from "../api/technitium"

const base = {
  dnsServerDomain: "n1.test",
  version: "15.6",
  uptimestamp: "2026-10-12T05:00:00Z",
  dnsServerLocalEndPoints: ["0.0.0.0:53"],
  ipv6Mode: "Enabled",
  dnssecValidation: true,
  eDnsClientSubnet: false,
  udpPayloadSize: 1232,
  qpmPrefixLimitsIPv4: [{ prefix: 24, udpLimit: 6000, tcpLimit: 1000 }],
  qpmLimitSampleMinutes: 5,
  defaultRecordTtl: 3600,
  defaultNsRecordTtl: 3600,
  defaultSoaRecordTtl: 900,
} as unknown as DnsSettings

describe("settingsRows", () => {
  it("does not count the server domain or uptime as differences, since they differ per node", () => {
    const rows = settingsRows(
      { a: base, b: { ...base, dnsServerDomain: "n2.test", uptimestamp: "2026-10-12T06:00:00Z" } },
      ["a", "b"],
    )

    expect(differingCount(rows)).toBe(0)
  })

  it("flags a setting that differs, with each node's value", () => {
    const rows = settingsRows({ a: base, b: { ...base, dnssecValidation: false, version: "15.4" } }, ["a", "b"])

    const dnssec = rows.find((r) => r.label === "DNSSEC validation")!
    expect(dnssec.values).toEqual(["Enabled", "Disabled"])
    expect(dnssec.differs).toBe(true)
    expect(rows.find((r) => r.label === "Version")!.differs).toBe(true)
    expect(differingCount(rows)).toBe(2)
  })

  it("ignores a node that could not be read", () => {
    const rows = settingsRows({ a: base }, ["a", "b"])

    expect(rows[0]!.values).toHaveLength(1)
    expect(differingCount(rows)).toBe(0)
  })
})
