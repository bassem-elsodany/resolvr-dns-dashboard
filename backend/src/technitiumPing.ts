// Shared "is this baseUrl/token a working Technitium server" check, used
// both when an admin saves new connection details (validate before
// persisting) and by the /api/status endpoint every session polls to
// show connectivity on the dashboard.
export interface PingResult {
  ok: boolean;
  serverDomain?: string;
  serverVersion?: string;
  error?: string;
}

export async function pingTechnitium(
  baseUrl: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PingResult> {
  let target: URL;
  try {
    target = new URL("/api/user/session/get", baseUrl);
  } catch {
    return { ok: false, error: `Invalid server URL: ${baseUrl}` };
  }

  try {
    const res = await fetchImpl(target, { headers: { Authorization: `Bearer ${token}` } });
    // Unlike most Technitium endpoints, /user/session/get does not wrap
    // its payload in a "response" object — info/status sit at the top
    // level. Confirmed live against a real v15.4 server.
    const body = (await res.json()) as {
      status?: string;
      errorMessage?: string;
      info?: { dnsServerDomain?: string; version?: string };
    };
    if (body?.status && body.status !== "ok") {
      return { ok: false, error: body.errorMessage ?? `Technitium rejected the request (status: ${body.status})` };
    }
    return {
      ok: true,
      serverDomain: body.info?.dnsServerDomain,
      serverVersion: body.info?.version,
    };
  } catch (err) {
    return { ok: false, error: `Could not reach Technitium server: ${(err as Error).message}` };
  }
}
