// Client for this dashboard's own backend endpoints — auth, user
// management, and the admin-managed Technitium connection config. These
// are entirely separate from the Technitium proxy in technitium.ts:
// nothing here ever talks to the DNS server directly.

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? "http://localhost:8787"

export class AppApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = "AppApiError"
    this.status = status
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${BACKEND_URL}${path}`, {
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      ...init,
    })
  } catch (err) {
    throw new AppApiError(`Could not reach the backend: ${(err as Error).message}`, 0)
  }
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    throw new AppApiError(body?.error ?? `Request failed with status ${res.status}`, res.status)
  }
  return body as T
}

export type UserRole = "admin" | "viewer"

export interface CurrentUser {
  id: number
  username: string
  role: UserRole
}

export interface AppUser {
  id: number
  username: string
  role: UserRole
  createdAt: string
}

export interface ServerStatus {
  configured: boolean
  connected: boolean
  serverDomain: string | null
  serverVersion: string | null
  error?: string | null
}

export function login(username: string, password: string): Promise<CurrentUser> {
  return call("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) })
}

export function logout(): Promise<{ status: string }> {
  return call("/api/auth/logout", { method: "POST" })
}

export function fetchMe(): Promise<CurrentUser> {
  return call("/api/auth/me")
}

export function getStatus(): Promise<ServerStatus> {
  return call("/api/status")
}

export function getServerConfig(): Promise<{ baseUrl: string; token: string }> {
  return call("/api/config")
}

export function setServerConfig(
  baseUrl: string,
  token: string,
): Promise<{ status: string; serverDomain: string; serverVersion: string }> {
  return call("/api/config", { method: "PUT", body: JSON.stringify({ baseUrl, token }) })
}

export function listUsers(): Promise<{ users: AppUser[] }> {
  return call("/api/users")
}

export function createUser(username: string, password: string, role: UserRole): Promise<AppUser> {
  return call("/api/users", { method: "POST", body: JSON.stringify({ username, password, role }) })
}

export function deleteUser(id: number): Promise<{ status: string }> {
  return call(`/api/users/${id}`, { method: "DELETE" })
}

export function changeUserPassword(id: number, password: string): Promise<{ status: string }> {
  return call(`/api/users/${id}/password`, { method: "PUT", body: JSON.stringify({ password }) })
}

// Admin-only mutating actions — the one deliberate exception to this
// dashboard's read-only design (see backend/src/routes/actionRoutes.ts).
export function flushCache(): Promise<{ status: string }> {
  return call("/api/actions/flush-cache", { method: "POST" })
}

export function forceUpdateBlockLists(): Promise<{ status: string }> {
  return call("/api/actions/update-block-lists", { method: "POST" })
}

export function revokeSession(partialToken: string): Promise<{ status: string }> {
  return call("/api/actions/revoke-session", { method: "POST", body: JSON.stringify({ partialToken }) })
}

export function updateBlockListUrls(urls: string[]): Promise<{ status: string }> {
  return call("/api/actions/block-list-urls", { method: "PUT", body: JSON.stringify({ urls }) })
}

export function blockDomain(domain: string): Promise<{ status: string }> {
  return call("/api/actions/block-domain", { method: "POST", body: JSON.stringify({ domain }) })
}

export function unblockDomain(domain: string): Promise<{ status: string }> {
  return call("/api/actions/unblock-domain", { method: "POST", body: JSON.stringify({ domain }) })
}

export function uninstallApp(name: string): Promise<{ status: string }> {
  return call("/api/actions/uninstall-app", { method: "POST", body: JSON.stringify({ name }) })
}
