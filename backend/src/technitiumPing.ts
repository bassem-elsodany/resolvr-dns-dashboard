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
    // Read as text first: whatever answers on this URL is not always
    // Technitium's JSON (an HTTPS-only port, a reverse proxy, a login wall),
    // and a JSON parser error would hide what it actually said.
    const raw = await res.text();
    let body: {
      server?: string;
      status?: string;
      errorMessage?: string;
      info?: { dnsServerDomain?: string; version?: string };
    };
    try {
      // Unlike most Technitium endpoints, /user/session/get does not wrap
      // its payload in a "response" object — info/status sit at the top
      // level. Confirmed live against a real v15.4 server.
      body = JSON.parse(raw);
    } catch {
      const said = raw.trim().slice(0, 200);
      return {
        ok: false,
        error: said
          ? `The server at ${baseUrl} answered HTTP ${res.status}, not Technitium's API response: "${said}"`
          : `The server at ${baseUrl} answered HTTP ${res.status} with an empty body, not Technitium's API response`,
      };
    }
    if (body?.status && body.status !== "ok") {
      const said = body.errorMessage ?? `status: ${body.status}`;
      // Technitium names itself in the reply: reaching it proves the URL is
      // right, so the admin knows only the token needs fixing.
      const who = body.server ? `Technitium server "${body.server}" at ${baseUrl}` : `The Technitium server at ${baseUrl}`;
      const hint =
        body.status === "invalid-token"
          ? " Create a non-expiring token in Technitium under Administration > Sessions > Create API Token, then paste it here."
          : "";
      return { ok: false, error: `${who} rejected the request: ${said}${hint}` };
    }
    return {
      ok: true,
      serverDomain: body.info?.dnsServerDomain,
      serverVersion: body.info?.version,
    };
  } catch (err) {
    // Node's fetch reports just "fetch failed"; the real reason (refused,
    // unknown host, TLS/protocol mismatch) is on `cause`.
    const cause = (err as { cause?: { code?: string; message?: string } }).cause;
    const reason = cause?.message ?? cause?.code ?? (err as Error).message;
    return { ok: false, error: `Could not reach the Technitium server at ${baseUrl}: ${reason}` };
  }
}
