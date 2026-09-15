import express, { type Express, type Request, type Response } from "express";
import cors from "cors";
import { isAllowedPath } from "./proxyAllowlist.js";

const BASE_URL_HEADER = "x-technitium-base-url";
const TOKEN_HEADER = "x-technitium-token";

export interface CreateAppOptions {
  frontendOrigin?: string;
  fetchImpl?: typeof fetch;
}

export function createApp(options: CreateAppOptions = {}): Express {
  const frontendOrigin = options.frontendOrigin ?? process.env.FRONTEND_ORIGIN ?? "http://localhost:5173";
  const fetchImpl = options.fetchImpl ?? fetch;

  const app = express();
  app.use(cors({ origin: frontendOrigin }));

  app.get("/healthz", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.all("/api/technitium/*splat", async (req: Request, res: Response) => {
    const baseUrl = req.header(BASE_URL_HEADER);
    const token = req.header(TOKEN_HEADER);

    if (!baseUrl || !token) {
      res.status(400).json({
        error: `Missing required header(s): ${BASE_URL_HEADER}, ${TOKEN_HEADER}`,
      });
      return;
    }

    if (req.method !== "GET") {
      res.status(403).json({ error: "Only GET requests are allowed through this proxy" });
      return;
    }

    const splat = req.params.splat;
    const path = "/" + (Array.isArray(splat) ? splat.join("/") : (splat ?? ""));
    if (!isAllowedPath(path)) {
      res.status(403).json({ error: `Path not allowed: ${path}` });
      return;
    }

    let target: URL;
    try {
      target = new URL("/api" + path, baseUrl);
    } catch {
      res.status(400).json({ error: `Invalid X-Technitium-Base-Url: ${baseUrl}` });
      return;
    }
    for (const [key, value] of Object.entries(req.query)) {
      if (typeof value === "string") target.searchParams.set(key, value);
    }

    try {
      const upstreamRes = await fetchImpl(target, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await upstreamRes.text();
      const contentType = upstreamRes.headers.get("content-type") ?? "application/json";
      const contentDisposition = upstreamRes.headers.get("content-disposition");
      if (contentDisposition) res.setHeader("content-disposition", contentDisposition);
      res.status(upstreamRes.status).type(contentType).send(body);
    } catch (err) {
      res.status(502).json({ error: `Could not reach Technitium server: ${(err as Error).message}` });
    }
  });

  return app;
}
