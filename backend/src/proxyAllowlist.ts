// Every Technitium API path this app is allowed to reach, exactly as it
// appears after `/api` in the upstream URL. Derived from ENDPOINTS
// (./endpoints.ts) — that single keyed file is the source of truth; add
// a path there (and add the matching key to the frontend's copy) only
// when a page actually needs it, never here directly.
import { ENDPOINTS } from "./endpoints.js";

export const ALLOWED_PATHS: ReadonlySet<string> = new Set(Object.values(ENDPOINTS));

export function isAllowedPath(path: string): boolean {
  return ALLOWED_PATHS.has(path);
}
