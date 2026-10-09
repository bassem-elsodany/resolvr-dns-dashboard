import type { DomainListResult } from "../api/technitium"
import { mapLimit } from "./async"

export interface WalkResult {
  domains: string[]
  truncated: boolean
}

// Technitium's blocked zone is only browsable as a tree, one level per
// call. To show a flat list the whole tree is walked, breadth first, a few
// requests at a time. Only nodes that hold an actual blocked entry count
// as blocked domains; the rest are just grouping labels.
export async function walkBlockedZones(
  fetchNode: (domain: string) => Promise<DomainListResult>,
  opts: { concurrency?: number; cap?: number; onProgress?: (found: number) => void } = {},
): Promise<WalkResult> {
  const concurrency = opts.concurrency ?? 6
  const cap = opts.cap ?? 2000
  const domains = new Set<string>()
  const seen = new Set<string>()
  let truncated = false

  const root = await fetchNode("")
  // A server that auto-descends at the root returns the entries directly.
  if (root.response.zones.length === 0) {
    for (const r of root.response.records) domains.add(r.name)
    return { domains: [...domains].sort(), truncated: false }
  }
  let level = root.response.zones
  while (level.length > 0) {
    const batch = level.filter((d) => !seen.has(d))
    batch.forEach((d) => seen.add(d))
    if (seen.size > cap) {
      truncated = true
      break
    }
    const results = await mapLimit(batch, concurrency, async (d) => ({ asked: d, res: await fetchNode(d) }))
    const next: string[] = []
    for (const { asked, res } of results) {
      // The server may skip through single-child zones; its own domain
      // name is the node's real identity.
      const identity = res.response.domain || asked
      if (res.response.records.length > 0) domains.add(identity)
      next.push(...res.response.zones)
    }
    opts.onProgress?.(domains.size)
    level = next
  }
  return { domains: [...domains].sort(), truncated }
}
