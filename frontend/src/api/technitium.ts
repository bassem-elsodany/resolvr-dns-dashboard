// Typed client for the Technitium DNS Server API, called through the
// backend proxy (backend/src/app.ts) — never directly, since Technitium
// sends no CORS headers. See tasks/plan.md for why the proxy exists.
//
// Every path below comes from ENDPOINTS (./endpoints.ts) by key — never
// a literal string — so an API path only ever needs to change in one
// place.

import { ENDPOINTS } from "./endpoints"

export interface TechnitiumCredentials {
  baseUrl: string
  token: string
}

export class TechnitiumApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = "TechnitiumApiError"
    this.status = status
  }
}

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? "http://localhost:8787"

async function technitiumGet<T>(
  path: string,
  params: Record<string, string | number | boolean | undefined>,
  _credentials: TechnitiumCredentials,
): Promise<T> {
  const url = new URL(`${BACKEND_URL}/api/technitium${path}`)
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }

  let res: Response
  try {
    // The backend now sources the Technitium base URL/token itself from
    // its admin-managed config (see backend/src/routes/configRoutes.ts) —
    // all this call needs to prove is who's asking, via the session
    // cookie. `credentials` (the parameter) is kept only so existing call
    // sites don't all need to change; it's no longer sent anywhere.
    res = await fetch(url, { credentials: "include" })
  } catch (err) {
    throw new TechnitiumApiError(`Could not reach the backend proxy: ${(err as Error).message}`, 0)
  }

  const body = await res.json().catch(() => null)

  if (!res.ok) {
    throw new TechnitiumApiError(body?.error ?? `Request failed with status ${res.status}`, res.status)
  }
  // Technitium reports failures with HTTP 200 and a non-"ok" status —
  // confirmed live: an invalid token returns status "invalid-token", not
  // "error". Treat anything other than "ok" as a failure rather than
  // enumerating specific failure strings, since more may exist.
  if (body?.status && body.status !== "ok") {
    throw new TechnitiumApiError(body.errorMessage ?? `Technitium API returned status: ${body.status}`, res.status)
  }

  return body as T
}

// ---------- User ----------

export interface UserSessionInfo {
  username: string
  info: {
    version: string
    dnsServerDomain: string
    uptimestamp: string
    clusterInitialized: boolean
  }
}

export function getUserSession(credentials: TechnitiumCredentials): Promise<UserSessionInfo> {
  return technitiumGet(ENDPOINTS.userSession, {}, credentials)
}

export interface CheckForUpdateResult {
  response: {
    updateAvailable: boolean
    updateVersion?: string
    updateTitle?: string
  }
}

export function checkForUpdate(credentials: TechnitiumCredentials): Promise<CheckForUpdateResult> {
  return technitiumGet(ENDPOINTS.checkForUpdate, {}, credentials)
}

// ---------- Dashboard ----------

export type StatsDuration = "LastHour" | "LastDay" | "LastWeek" | "LastMonth" | "LastYear" | "Custom"

export interface DashboardStatsResult {
  response: {
    stats: {
      totalQueries: number
      totalNoError: number
      totalServerFailure: number
      totalNxDomain: number
      totalRefused: number
      totalAuthoritative: number
      totalRecursive: number
      totalCached: number
      totalBlocked: number
      totalDropped: number
      totalClients: number
      zones: number
      cachedEntries: number
      allowedZones: number
      blockedZones: number
      allowListZones: number
      blockListZones: number
    }
    mainChartData: {
      labelFormat: string
      labels: string[]
      datasets: {
        label: string
        data: number[]
        borderColor?: string
        backgroundColor?: string
        fill?: boolean
      }[]
    }
    queryTypeChartData?: { labels: string[]; datasets: { data: number[] }[] }
    queryResponseChartData?: { labels: string[]; datasets: { data: number[] }[] }
    // Present directly on stats/get, not just on getTop — one call covers both.
    topClients?: TopClientEntry[]
    topDomains?: TopDomainEntry[]
    topBlockedDomains?: TopDomainEntry[]
  }
}

export function getDashboardStats(
  type: StatsDuration,
  credentials: TechnitiumCredentials,
  opts: { utc?: boolean; start?: string; end?: string } = {},
): Promise<DashboardStatsResult> {
  return technitiumGet(ENDPOINTS.dashboardStats, { type, ...opts }, credentials)
}

export type TopStatsType = "TopClients" | "TopDomains" | "TopBlockedDomains"

export interface TopClientEntry {
  name: string
  domain?: string
  hits: number
  rateLimited: boolean
}
export interface TopDomainEntry {
  name: string
  hits: number
}

export interface TopStatsResult {
  response: {
    topClients?: TopClientEntry[]
    topDomains?: TopDomainEntry[]
    topBlockedDomains?: TopDomainEntry[]
  }
}

export function getTopStats(
  statsType: TopStatsType,
  type: StatsDuration,
  credentials: TechnitiumCredentials,
  opts: { limit?: number; noReverseLookup?: boolean; onlyRateLimitedClients?: boolean } = {},
): Promise<TopStatsResult> {
  return technitiumGet(ENDPOINTS.dashboardTopStats, { statsType, type, ...opts }, credentials)
}

// ---------- Zones ----------

export interface ZoneSummary {
  name: string
  type: string
  internal?: boolean
  dnssecStatus: string
  soaSerial: number
  disabled: boolean
  lastModified: string
  isExpired?: boolean
  syncFailed?: boolean
  notifyFailed?: boolean
}

export interface ZonesListResult {
  response: {
    pageNumber: number
    totalPages: number
    totalZones: number
    zones: ZoneSummary[]
  }
}

export function listZones(
  credentials: TechnitiumCredentials,
  opts: { pageNumber?: number; zonesPerPage?: number; filterName?: string; filterType?: string } = {},
): Promise<ZonesListResult> {
  return technitiumGet(ENDPOINTS.zonesList, opts, credentials)
}

export interface ZoneRecord {
  name: string
  type: string
  // zones/records/get returns a plain number of seconds; cache/list
  // returns a pre-formatted string like "283 (4 mins 43 sec)" — the API
  // is not consistent between the two endpoints.
  ttl: string | number
  rData: Record<string, unknown>
  disabled?: boolean
}

export interface ZoneRecordsResult {
  response: { zone: { name: string; type: string }; records: ZoneRecord[] }
}

export function getZoneRecords(
  domain: string,
  credentials: TechnitiumCredentials,
): Promise<ZoneRecordsResult> {
  return technitiumGet(ENDPOINTS.zoneRecords, { domain, listZone: true }, credentials)
}

// ---------- Cache ----------

export interface CacheListResult {
  response: { domain: string; zones: string[]; records: ZoneRecord[] }
}

export function listCache(domain: string, credentials: TechnitiumCredentials): Promise<CacheListResult> {
  return technitiumGet(ENDPOINTS.cacheList, { domain }, credentials)
}

// ---------- Allowed / Blocked zones ----------

export interface DomainListResult {
  response: { domain: string; zones: string[]; records: ZoneRecord[] }
}

export function listAllowedZones(
  credentials: TechnitiumCredentials,
  domain = "",
): Promise<DomainListResult> {
  return technitiumGet(ENDPOINTS.allowedList, { domain }, credentials)
}

export function exportAllowedZones(credentials: TechnitiumCredentials): Promise<DownloadedFile> {
  return technitiumGetBlob(ENDPOINTS.allowedExport, {}, credentials)
}

export function listBlockedZones(
  credentials: TechnitiumCredentials,
  domain = "",
): Promise<DomainListResult> {
  return technitiumGet(ENDPOINTS.blockedList, { domain }, credentials)
}

export function exportBlockedZones(credentials: TechnitiumCredentials): Promise<DownloadedFile> {
  return technitiumGetBlob(ENDPOINTS.blockedExport, {}, credentials)
}

// ---------- DHCP ----------

export interface DhcpScope {
  name: string
  enabled: boolean
  startingAddress: string
  endingAddress: string
  subnetMask: string
}

export interface DhcpScopesResult {
  response: { scopes: DhcpScope[] }
}

export function listDhcpScopes(credentials: TechnitiumCredentials): Promise<DhcpScopesResult> {
  return technitiumGet(ENDPOINTS.dhcpScopesList, {}, credentials)
}

export interface DhcpLease {
  scope: string
  hardwareAddress: string
  address: string
  hostName: string | null
  leaseObtained: string
  leaseExpires: string
}

export interface DhcpLeasesResult {
  response: { leases: DhcpLease[] }
}

export function listDhcpLeases(credentials: TechnitiumCredentials): Promise<DhcpLeasesResult> {
  return technitiumGet(ENDPOINTS.dhcpLeasesList, {}, credentials)
}

// ---------- Query logs ----------

export interface QueryLogEntry {
  rowNumber: number
  timestamp: string
  clientIpAddress: string
  protocol: string
  responseType: string
  responseRtt?: number
  rcode: string
  qname: string
  qtype: string
  qclass: string
  answer: string | null
}

export interface QueryLogsResult {
  response: {
    pageNumber: number
    totalPages: number
    totalEntries: number
    entries: QueryLogEntry[]
  }
}

export interface QueryLogFilters {
  pageNumber?: number
  entriesPerPage?: number
  descendingOrder?: boolean
  start?: string
  end?: string
  clientIpAddress?: string
  protocol?: string
  responseType?: string
  rcode?: string
  qname?: string
  qtype?: string
  qclass?: string
}

const QUERY_LOGS_APP = { name: "Query Logs (Sqlite)", classPath: "QueryLogsSqlite.App" }

export function queryLogs(
  credentials: TechnitiumCredentials,
  filters: QueryLogFilters = {},
): Promise<QueryLogsResult> {
  return technitiumGet(
    ENDPOINTS.logsQuery,
    { name: QUERY_LOGS_APP.name, classPath: QUERY_LOGS_APP.classPath, ...filters },
    credentials,
  )
}

export function exportLogs(
  credentials: TechnitiumCredentials,
  filters: QueryLogFilters = {},
): Promise<DownloadedFile> {
  return technitiumGetBlob(
    ENDPOINTS.logsExport,
    { name: QUERY_LOGS_APP.name, classPath: QUERY_LOGS_APP.classPath, ...filters },
    credentials,
  )
}

// ---------- Apps ----------

export interface DnsAppSummary {
  name: string
  description: string
  version: string
  updateVersion?: string
  updateAvailable: boolean
}

export interface AppsListResult {
  response: { apps: DnsAppSummary[] }
}

export function listApps(credentials: TechnitiumCredentials): Promise<AppsListResult> {
  return technitiumGet(ENDPOINTS.appsList, {}, credentials)
}

// ---------- Settings ----------

export interface DnsSettings {
  version: string
  uptimestamp: string
  dnsServerDomain: string
  dnsServerLocalEndPoints: string[]
  ipv6Mode: string
  dnssecValidation: boolean
  eDnsClientSubnet: boolean
  udpPayloadSize: number
  defaultRecordTtl: number
  defaultNsRecordTtl: number
  defaultSoaRecordTtl: number
  qpmPrefixLimitsIPv4: { prefix: number; udpLimit: number; tcpLimit: number }[]
  qpmLimitSampleMinutes: number
  blockListNextUpdatedOn?: string
  blockListUpdateIntervalHours?: number
}

export interface SettingsResult {
  response: DnsSettings
}

export function getSettings(credentials: TechnitiumCredentials): Promise<SettingsResult> {
  return technitiumGet(ENDPOINTS.settingsGet, {}, credentials)
}

// ---------- DNS Client (resolver tool) ----------

export interface DnsResolveRecord {
  Name: string
  Type: string
  Class: string
  TTL?: string
  RDATA?: Record<string, unknown>
  DnssecStatus?: string
}

export interface ResolveResult {
  response: {
    result: {
      Metadata: { NameServer: string; Protocol: string; DatagramSize: string; RoundTripTime: string }
      RCODE: string
      Question: { Name: string; Type: string; Class: string }[]
      Answer: DnsResolveRecord[]
      Authority: DnsResolveRecord[]
      Additional: DnsResolveRecord[]
    }
  }
}

export function resolveDnsQuery(
  domain: string,
  type: string,
  credentials: TechnitiumCredentials,
  opts: { server?: string; protocol?: string; dnssec?: boolean } = {},
): Promise<ResolveResult> {
  return technitiumGet(
    ENDPOINTS.dnsClientResolve,
    { domain, type, server: opts.server ?? "recursive-resolver", protocol: opts.protocol, dnssec: opts.dnssec },
    credentials,
  )
}

// ---------- Admin sessions ----------

export interface AdminSession {
  username: string
  isCurrentSession: boolean
  partialToken: string
  type: string
  tokenName: string | null
  lastSeen: string
  lastSeenRemoteAddress: string
  lastSeenUserAgent: string
}

export interface AdminSessionsResult {
  response: { sessions: AdminSession[] }
}

export function listAdminSessions(credentials: TechnitiumCredentials): Promise<AdminSessionsResult> {
  return technitiumGet(ENDPOINTS.adminSessionsList, {}, credentials)
}

// ---------- helpers ----------

export interface DownloadedFile {
  blob: Blob
  filename: string
}

// Export endpoints return CSV, not JSON, and the proxy requires auth as
// headers (not query params — see backend/src/app.ts), which a plain
// <a href> download link can't send. So exports go through fetch() here
// and the caller triggers the browser download from the returned Blob
// (URL.createObjectURL + a temporary <a download>).
async function technitiumGetBlob(
  path: string,
  params: Record<string, string | number | boolean | undefined>,
  _credentials: TechnitiumCredentials,
): Promise<DownloadedFile> {
  const url = new URL(`${BACKEND_URL}/api/technitium${path}`)
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }

  let res: Response
  try {
    res = await fetch(url, { credentials: "include" })
  } catch (err) {
    throw new TechnitiumApiError(`Could not reach the backend proxy: ${(err as Error).message}`, 0)
  }

  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new TechnitiumApiError(body?.error ?? `Request failed with status ${res.status}`, res.status)
  }

  const disposition = res.headers.get("content-disposition") ?? ""
  const filenameMatch = /filename="?([^";]+)"?/.exec(disposition)
  const filename = filenameMatch?.[1] ?? "export.csv"

  return { blob: await res.blob(), filename }
}
