export type Tone = "ok" | "warn" | "crit" | "info" | "cache" | "neutral"

// Matches the wireframe's color coding for the Response column exactly.
export function responseTypeTone(responseType: string): Tone {
  switch (responseType) {
    case "Recursive":
      return "info"
    case "Cached":
      return "cache"
    case "Blocked":
    case "CacheBlocked":
    case "UpstreamBlocked":
      return "crit"
    case "Authoritative":
    default:
      return "neutral"
  }
}

// Matches the wireframe's color coding for the RCODE column exactly.
export function rcodeTone(rcode: string): Tone {
  switch (rcode) {
    case "NoError":
      return "ok"
    case "NxDomain":
      return "warn"
    case "ServerFailure":
    case "Refused":
      return "crit"
    default:
      return "neutral"
  }
}

// "Blocked by" badge tone — kept in sync with the mechanism colors used
// in HostInsightPanel's breakdown bars (crit/cache/info), so the same
// mechanism reads as the same color everywhere on the page.
export function blockedByTone(responseType: string): Tone {
  switch (responseType) {
    case "CacheBlocked":
      return "cache"
    case "UpstreamBlocked":
      return "info"
    case "Blocked":
      return "crit"
    default:
      return "neutral"
  }
}
