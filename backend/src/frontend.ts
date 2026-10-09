import fs from "node:fs";
import path from "node:path";
import express, { type Express, type Request, type Response } from "express";

// Serves the built web app from the same process as the API, so Resolvr
// can run as one container (and as a Home Assistant add-on). Everything
// the page loads is relative to <base href>, which is the only thing that
// has to change when the page is reached through Home Assistant's ingress
// proxy at /api/hassio_ingress/<token>/ instead of at the site root.

// What the Supervisor sends in X-Ingress-Path. Anything else is ignored,
// because the value ends up inside the page.
const INGRESS_PATH = /^\/api\/hassio_ingress\/[A-Za-z0-9_-]+$/;

export function ingressBase(req: Request): string {
  const header = req.headers["x-ingress-path"];
  const value = Array.isArray(header) ? header[0] : header;
  return value && INGRESS_PATH.test(value) ? `${value}/` : "/";
}

export function serveFrontend(app: Express, dir: string): void {
  const indexFile = path.join(dir, "index.html");
  const template = fs.readFileSync(indexFile, "utf8");

  const render = (base: string): string => template.replace(/<base href="[^"]*"\s*\/?>/i, `<base href="${base}">`);

  // Same file the static nginx image generates at start. Here the app is
  // always reached on its own origin, so the API is simply "next to" the page.
  app.get("/env-config.js", (_req: Request, res: Response) => {
    res.set({ "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-store" });
    res.send('window.__RESOLVR_ENV__ = { BACKEND_URL: "", SAME_ORIGIN: true }\n');
  });

  // Hashed build files never change, so they can be cached for good.
  app.use(
    express.static(dir, {
      index: false,
      setHeaders: (res, file) => {
        if (file.includes(`${path.sep}assets${path.sep}`)) res.set("Cache-Control", "public, max-age=31536000, immutable");
      },
    }),
  );

  // Any other page address is a route inside the single-page app. API and
  // health paths that matched nothing stay real 404s instead of a web page.
  app.use((req: Request, res: Response, next) => {
    if ((req.method !== "GET" && req.method !== "HEAD") || req.path.startsWith("/api/") || req.path === "/healthz") {
      next();
      return;
    }
    res.set({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.send(render(ingressBase(req)));
  });
}
