import type { ZoneRecord } from "../api/technitium"
import { formatRecordValue } from "./formatRecordValue"

// Each cluster node keeps its own cache and they are not synced, so the same
// name can be cached on one node and not the other, with a different time
// left. These helpers lay the nodes' caches side by side.

export interface NodeCache {
  node: string
  zones: string[]
  records: ZoneRecord[]
}

export interface MergedZone {
  name: string
  // The nodes that hold something under this name.
  nodes: string[]
}

export interface MergedRecord {
  name: string
  type: string
  value: string
  // Time left on each node that holds the record (Technitium's own text).
  ttl: Record<string, string | number>
  nodes: string[]
}

export function mergeCaches(perNode: NodeCache[]): { zones: MergedZone[]; records: MergedRecord[] } {
  const zones = new Map<string, MergedZone>()
  const records = new Map<string, MergedRecord>()

  for (const cache of perNode) {
    for (const name of cache.zones) {
      const z = zones.get(name) ?? { name, nodes: [] }
      z.nodes.push(cache.node)
      zones.set(name, z)
    }
    for (const r of cache.records) {
      const value = formatRecordValue(r.rData)
      const key = `${r.name}|${r.type}|${value}`
      const m = records.get(key) ?? { name: r.name, type: r.type, value, ttl: {}, nodes: [] }
      m.ttl[cache.node] = r.ttl
      m.nodes.push(cache.node)
      records.set(key, m)
    }
  }
  return {
    zones: [...zones.values()].sort((a, b) => a.name.localeCompare(b.name)),
    records: [...records.values()],
  }
}

export type PresenceFilter = "all" | "both" | "one"

// "Both" means every node in scope holds it; "one" means only some do.
export function matchesPresence(r: MergedRecord, nodeCount: number, filter: PresenceFilter): boolean {
  if (filter === "all") return true
  return filter === "both" ? r.nodes.length >= nodeCount : r.nodes.length < nodeCount
}
