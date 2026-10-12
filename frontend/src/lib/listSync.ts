// Allowed and blocked domains are synced between the nodes of a Technitium
// cluster, but a node can lag behind. These helpers compare each node's copy.

export interface ListDiff {
  // Every domain held by at least one node, sorted.
  union: string[]
  // For each domain, the nodes that do not hold it yet.
  missingOn: Record<string, string[]>
  inSync: boolean
}

export function diffLists(perNode: Record<string, string[]>, nodeNames: string[]): ListDiff {
  const read = nodeNames.filter((n) => n in perNode)
  const sets = new Map(read.map((n) => [n, new Set(perNode[n])]))
  const union = [...new Set(read.flatMap((n) => perNode[n]!))].sort((a, b) => a.localeCompare(b))
  const missingOn: Record<string, string[]> = {}
  for (const d of union) {
    const missing = read.filter((n) => !sets.get(n)!.has(d))
    if (missing.length > 0) missingOn[d] = missing
  }
  return { union, missingOn, inSync: Object.keys(missingOn).length === 0 }
}
