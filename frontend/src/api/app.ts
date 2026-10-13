// Client for this dashboard's own backend endpoints — auth, user
// management, and the admin-managed Technitium connection config. These
// are entirely separate from the Technitium proxy in technitium.ts:
// nothing here ever talks to the DNS server directly.
import { resolveBackendUrl } from "../lib/backendUrl"
import { serverHeaders } from "../lib/activeServer"

const BACKEND_URL = resolveBackendUrl()

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
      ...init,
      headers: { "Content-Type": "application/json", ...serverHeaders(), ...(init.headers as Record<string, string> | undefined) },
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
  // Home Assistant signed this user in (add-on mode): no Resolvr account.
  external?: boolean
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
  // True when the server is part of a Technitium cluster.
  clusterInitialized?: boolean
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

export function getServerConfig(): Promise<{ baseUrl: string; token: string; managed?: boolean }> {
  return call("/api/config")
}

export function setServerConfig(
  baseUrl: string,
  token: string,
): Promise<{ status: string; serverDomain: string; serverVersion: string; clusterInitialized?: boolean }> {
  return call("/api/config", { method: "PUT", body: JSON.stringify({ baseUrl, token }) })
}

// A Technitium server Resolvr observes. id 0 is the primary connection
// (edited on the form above); the rest are added here and never carry a
// token to the browser.
export interface ObservedServer {
  id: number
  name: string
  baseUrl: string
  primary: boolean
  configured: boolean
}

export function listServers(): Promise<{ servers: ObservedServer[] }> {
  return call("/api/servers")
}

export function addServer(name: string, baseUrl: string, token: string): Promise<ObservedServer> {
  return call("/api/servers", { method: "POST", body: JSON.stringify({ name, baseUrl, token }) })
}

export function updateServer(id: number, name: string, baseUrl: string, token: string): Promise<ObservedServer> {
  return call(`/api/servers/${id}`, { method: "PUT", body: JSON.stringify({ name, baseUrl, token }) })
}

export function removeServer(id: number): Promise<{ status: string }> {
  return call(`/api/servers/${id}`, { method: "DELETE" })
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
// `node` flushes one node of a cluster (each keeps its own cache); left out,
// the connected node is flushed.
export function flushCache(node?: string): Promise<{ status: string }> {
  return call("/api/actions/flush-cache", { method: "POST", ...(node ? { body: JSON.stringify({ node }) } : {}) })
}

// `node` aims the action at one node of a cluster; left out, the connected
// node is used. The same goes for the other node-aware actions below.
export function forceUpdateBlockLists(node?: string): Promise<{ status: string }> {
  return call("/api/actions/update-block-lists", { method: "POST", ...(node ? { body: JSON.stringify({ node }) } : {}) })
}

export function revokeSession(partialToken: string, node?: string): Promise<{ status: string }> {
  return call("/api/actions/revoke-session", { method: "POST", body: JSON.stringify(node ? { partialToken, node } : { partialToken }) })
}

export function updateBlockListUrls(urls: string[], node?: string): Promise<{ status: string }> {
  return call("/api/actions/block-list-urls", { method: "PUT", body: JSON.stringify(node ? { urls, node } : { urls }) })
}

export function blockDomain(domain: string): Promise<{ status: string }> {
  return call("/api/actions/block-domain", { method: "POST", body: JSON.stringify({ domain }) })
}

export function unblockDomain(domain: string): Promise<{ status: string }> {
  return call("/api/actions/unblock-domain", { method: "POST", body: JSON.stringify({ domain }) })
}

export function uninstallApp(name: string, node?: string): Promise<{ status: string }> {
  return call("/api/actions/uninstall-app", { method: "POST", body: JSON.stringify(node ? { name, node } : { name }) })
}

// Host-to-IP mapping (the AdGuard "DNS rewrites" equivalent) — see
// backend/src/routes/actionRoutes.ts for why this is a zone create
// followed by a record add, mirroring the one-zone-per-hostname
// pattern already used on this server.
export function createZone(zone: string, node?: string): Promise<{ status: string }> {
  return call("/api/actions/create-zone", { method: "POST", body: JSON.stringify(node ? { zone, node } : { zone }) })
}

export function addRecord(params: {
  domain: string
  zone?: string
  type: "A" | "AAAA"
  ipAddress: string
  ttl?: number
  node?: string
}): Promise<{ status: string }> {
  return call("/api/actions/add-record", { method: "POST", body: JSON.stringify(params) })
}

export function deleteZone(zone: string, node?: string): Promise<{ status: string }> {
  return call("/api/actions/delete-zone", { method: "POST", body: JSON.stringify(node ? { zone, node } : { zone }) })
}
