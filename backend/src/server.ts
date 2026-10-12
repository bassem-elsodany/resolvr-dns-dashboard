import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { openDb } from "./db.js";
import { loadAddonMode, applyAddonOptions, addonLogEnv } from "./addon.js";
import { logger, parseConfig } from "./logger.js";

const port = Number(process.env.PORT ?? 8787);

const addon = loadAddonMode();
// An add-on keeps its data in /data, which Home Assistant preserves and backs up.
if (addon) process.env.DB_PATH ??= "/data/resolvr.db";

// An add-on's logging options are only known once its options file is read.
if (addon) {
  const config = parseConfig(addonLogEnv(addon.options));
  logger.configure(config);
  for (const problem of config.problems) logger.warn(problem);
}

const db = openDb();
if (addon) {
  const applied = applyAddonOptions(db, addon);
  if (!applied.ok) logger.error(`Add-on configuration problem: ${applied.error}`);
}

// The single-container image ships the built web app next to the server.
const here = path.dirname(fileURLToPath(import.meta.url));
const candidate = process.env.STATIC_DIR ?? path.resolve(here, "..", "public");
const staticDir = fs.existsSync(path.join(candidate, "index.html")) ? candidate : undefined;

const app = createApp({ db, addon, staticDir });

app.listen(port, () => {
  const mode = addon ? "Home Assistant add-on" : "standalone";
  logger.info(`Logging: level=${logger.level}, requests=${logger.requests ? "on" : "off"} (set LOG_LEVEL, LOG_FORMAT, LOG_REQUESTS)`);
  logger.info(`Resolvr backend listening on http://localhost:${port} (${mode}${staticDir ? ", serving the web app" : ""})`);
  if (addon && !addon.managed) logger.info("No Technitium URL and API token in the add-on configuration yet; set them in the Configuration tab.");
});
