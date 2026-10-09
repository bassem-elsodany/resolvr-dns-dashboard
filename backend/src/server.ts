import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { openDb } from "./db.js";
import { loadAddonMode, applyAddonOptions } from "./addon.js";

const port = Number(process.env.PORT ?? 8787);

const addon = loadAddonMode();
// An add-on keeps its data in /data, which Home Assistant preserves and backs up.
if (addon) process.env.DB_PATH ??= "/data/resolvr.db";

const db = openDb();
if (addon) {
  const applied = applyAddonOptions(db, addon);
  if (!applied.ok) console.error(`Add-on configuration problem: ${applied.error}`);
}

// The single-container image ships the built web app next to the server.
const here = path.dirname(fileURLToPath(import.meta.url));
const candidate = process.env.STATIC_DIR ?? path.resolve(here, "..", "public");
const staticDir = fs.existsSync(path.join(candidate, "index.html")) ? candidate : undefined;

const app = createApp({ db, addon, staticDir });

app.listen(port, () => {
  const mode = addon ? "Home Assistant add-on" : "standalone";
  console.log(`Resolvr backend listening on http://localhost:${port} (${mode}${staticDir ? ", serving the web app" : ""})`);
  if (addon && !addon.managed) console.log("No Technitium URL and API token in the add-on configuration yet; set them in the Configuration tab.");
});
