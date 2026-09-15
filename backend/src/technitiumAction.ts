// Backs the three admin-only mutating actions this dashboard exposes
// (flush cache, force a block-list update, revoke a session) — each
// call site hardcodes one specific Technitium path, never a
// caller-supplied one, so this stays a narrow, auditable exception to
// the read-only proxy in app.ts rather than a second general-purpose
// write proxy.
export interface ActionResult {
  ok: boolean;
  error?: string;
}

export async function callTechnitiumAction(
  baseUrl: string,
  token: string,
  path: string,
  params: Record<string, string> = {},
  fetchImpl: typeof fetch = fetch,
): Promise<ActionResult> {
  let target: URL;
  try {
    target = new URL("/api" + path, baseUrl);
  } catch {
    return { ok: false, error: `Invalid configured server URL: ${baseUrl}` };
  }
  for (const [key, value] of Object.entries(params)) target.searchParams.set(key, value);

  try {
    const res = await fetchImpl(target, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    const body = (await res.json().catch(() => null)) as { status?: string; errorMessage?: string } | null;
    if (body?.status && body.status !== "ok") {
      return { ok: false, error: body.errorMessage ?? `Technitium rejected the request (status: ${body.status})` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `Could not reach Technitium server: ${(err as Error).message}` };
  }
}
