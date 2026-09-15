import express, { type Express, type Request, type Response } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { isAllowedPath } from "./proxyAllowlist.js";
import { openDb, type AppConfigRow } from "./db.js";
import { attachUser, requireAuth, requireAdmin } from "./auth.js";
import { authRoutes } from "./routes/authRoutes.js";
import { userRoutes } from "./routes/userRoutes.js";
import { configRoutes, statusRoute } from "./routes/configRoutes.js";

export interface CreateAppOptions {
  frontendOrigin?: string;
  fetchImpl?: typeof fetch;
  db?: import("better-sqlite3").Database;
}

export function createApp(options: CreateAppOptions = {}): Express {
  const frontendOrigin = options.frontendOrigin ?? process.env.FRONTEND_ORIGIN ?? "http://localhost:5173";
  const fetchImpl = options.fetchImpl ?? fetch;
  const db = options.db ?? openDb();

  const app = express();
  app.use(cors({ origin: frontendOrigin, credentials: true }));
  app.use(express.json());
  app.use(cookieParser());
  app.use(attachUser(db));

  app.get("/healthz", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/api/auth", authRoutes(db));
  app.use("/api/users", requireAdmin, userRoutes(db));
  app.use("/api/config", requireAdmin, configRoutes(db, { fetchImpl }));
  app.get("/api/status", requireAuth, statusRoute(db, { fetchImpl }));

  app.all("/api/technitium/*splat", requireAuth, async (req: Request, res: Response) => {
    const config = db.prepare("SELECT base_url, token FROM app_config WHERE id = 1").get() as AppConfigRow;
    const baseUrl = config.base_url;
    const token = config.token;

    if (!baseUrl || !token) {
      res.status(400).json({ error: "No Technitium server is configured yet — ask an admin to set one up." });
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
      res.status(400).json({ error: `Invalid configured server URL: ${baseUrl}` });
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
