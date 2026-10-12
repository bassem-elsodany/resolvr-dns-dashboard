import type { DnsSettings } from "../api/technitium"

// Each cluster node has its own settings, so these lay a few of them side by
// side and mark the ones that differ.

export interface SettingRow {
  section: string
  label: string
  // One value per node, in node order.
  values: string[]
  differs: boolean
}

function describe(s: DnsSettings): [string, string, string][] {
  const onOff = (b: boolean | undefined): string => (b ? "Enabled" : "Disabled")
  const rows: [string, string, string][] = [
    ["Identity", "Server domain", s.dnsServerDomain],
    ["Identity", "Version", s.version],
    ["Identity", "Up since", new Date(s.uptimestamp).toLocaleString()],
    ["Resolution", "Listening on", (s.dnsServerLocalEndPoints ?? []).join(", ")],
    ["Resolution", "IPv6 mode", String(s.ipv6Mode ?? "")],
    ["Resolution", "DNSSEC validation", onOff(s.dnssecValidation)],
    ["Resolution", "EDNS client subnet", onOff(s.eDnsClientSubnet)],
    ["Resolution", "UDP payload size", `${s.udpPayloadSize} bytes`],
    ["Rate limiting", "Sample window", `${s.qpmLimitSampleMinutes} minutes`],
    ["Defaults", "Record TTL", `${s.defaultRecordTtl}s`],
    ["Defaults", "NS record TTL", `${s.defaultNsRecordTtl}s`],
    ["Defaults", "SOA record TTL", `${s.defaultSoaRecordTtl}s`],
  ]
  for (const l of s.qpmPrefixLimitsIPv4 ?? []) {
    rows.push(["Rate limiting", `/${l.prefix}`, `${l.udpLimit} qpm UDP / ${l.tcpLimit} qpm TCP`])
  }
  return rows
}

// Identity rows (domain, version, uptime) are expected to differ per node, so
// only the version counts as a difference worth flagging there.
const EXPECTED_TO_DIFFER = new Set(["Server domain", "Up since"])

export function settingsRows(perNode: Record<string, DnsSettings>, nodeNames: string[]): SettingRow[] {
  const nodes = nodeNames.filter((n) => n in perNode)
  if (nodes.length === 0) return []
  const described = nodes.map((n) => new Map(describe(perNode[n]!).map(([sec, label, v]) => [`${sec}|${label}`, v])))
  const order = describe(perNode[nodes[0]!]!)
  const seen = new Set(order.map(([sec, label]) => `${sec}|${label}`))
  for (const m of described.slice(1)) for (const k of m.keys()) if (!seen.has(k)) { seen.add(k); order.push([k.split("|")[0]!, k.split("|")[1]!, ""]) }
  return order.map(([section, label]) => {
    const values = described.map((m) => m.get(`${section}|${label}`) ?? "–")
    const differs = new Set(values).size > 1 && !EXPECTED_TO_DIFFER.has(label)
    return { section, label, values, differs }
  })
}

export function differingCount(rows: SettingRow[]): number {
  return rows.filter((r) => r.differs).length
}
