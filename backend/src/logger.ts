// Levelled logging for the backend, configured from the environment so it can
// be set in the container's settings:
//
//   LOG_LEVEL     silent | error | warn | info (default) | debug
//   LOG_FORMAT    text (default) | json   one JSON object per line
//   LOG_REQUESTS  true (default) | false  the one-line-per-request access log
//
// What each level prints:
//   error  failures only
//   warn   + warnings (for example a failed Technitium connection check)
//   info   + startup lines and, unless LOG_REQUESTS=false, one line per request
//   debug  + the container healthcheck (/healthz), which is silent below this
//   silent nothing at all
export const LEVELS = ["silent", "error", "warn", "info", "debug"] as const;
export type LogLevel = (typeof LEVELS)[number];
export type LogFormat = "text" | "json";

export const DEFAULT_LEVEL: LogLevel = "info";

export interface LogConfig {
  level: LogLevel;
  format: LogFormat;
  requests: boolean;
  // Values that were set but not understood, so startup can say so.
  problems: string[];
}

export function parseConfig(env: Record<string, string | undefined>): LogConfig {
  const problems: string[] = [];

  const rawLevel = env.LOG_LEVEL?.trim().toLowerCase();
  let level: LogLevel = DEFAULT_LEVEL;
  if (rawLevel) {
    if ((LEVELS as readonly string[]).includes(rawLevel)) level = rawLevel as LogLevel;
    else problems.push(`Unknown LOG_LEVEL "${env.LOG_LEVEL}"; using "${DEFAULT_LEVEL}". Use one of: ${LEVELS.join(", ")}.`);
  }

  const rawFormat = env.LOG_FORMAT?.trim().toLowerCase();
  let format: LogFormat = "text";
  if (rawFormat) {
    if (rawFormat === "text" || rawFormat === "json") format = rawFormat;
    else problems.push(`Unknown LOG_FORMAT "${env.LOG_FORMAT}"; using "text". Use "text" or "json".`);
  }

  const rawRequests = env.LOG_REQUESTS?.trim().toLowerCase();
  let requests = true;
  if (rawRequests) {
    if (["true", "1", "yes", "on"].includes(rawRequests)) requests = true;
    else if (["false", "0", "no", "off"].includes(rawRequests)) requests = false;
    else problems.push(`Unknown LOG_REQUESTS "${env.LOG_REQUESTS}"; using "true". Use "true" or "false".`);
  }

  return { level, format, requests, problems };
}

export type Fields = Record<string, string | number | boolean | undefined>;

export interface Logger {
  readonly level: LogLevel;
  // True when per-request lines should be written at all.
  readonly requests: boolean;
  // Replaces the settings in place, for values that are only known after
  // start-up (the Home Assistant add-on's options).
  configure(config: Pick<LogConfig, "level"> & Partial<Pick<LogConfig, "format" | "requests">>): void;
  error(message: string, fields?: Fields): void;
  warn(message: string, fields?: Fields): void;
  info(message: string, fields?: Fields): void;
  debug(message: string, fields?: Fields): void;
}

type Sink = Pick<Console, "log" | "warn" | "error">;

export function createLogger(
  config: Pick<LogConfig, "level"> & Partial<Pick<LogConfig, "format" | "requests">> = { level: DEFAULT_LEVEL },
  sink: Sink = console,
  now: () => Date = () => new Date(),
): Logger {
  let level = config.level;
  let format: LogFormat = config.format ?? "text";
  let requests = config.requests ?? true;
  const enabled = (l: LogLevel): boolean => LEVELS.indexOf(level) >= LEVELS.indexOf(l);

  const emit = (l: Exclude<LogLevel, "silent">, out: (line: string) => void, message: string, fields?: Fields): void => {
    if (!enabled(l)) return;
    out(format === "json" ? JSON.stringify({ time: now().toISOString(), level: l, msg: message, ...fields }) : message);
  };

  return {
    get level() {
      return level;
    },
    get requests() {
      return requests;
    },
    configure(next) {
      level = next.level;
      format = next.format ?? "text";
      requests = next.requests ?? true;
    },
    error: (m, f) => emit("error", (s) => sink.error(s), m, f),
    warn: (m, f) => emit("warn", (s) => sink.warn(s), m, f),
    info: (m, f) => emit("info", (s) => sink.log(s), m, f),
    debug: (m, f) => emit("debug", (s) => sink.log(s), m, f),
  };
}

// The process-wide logger, configured once from the environment.
const config = parseConfig(process.env);
export const logger = createLogger(config);
for (const problem of config.problems) logger.warn(problem);

// User-supplied text (a username, a node name) made safe for a log line: no
// control characters, so it cannot forge extra lines, and bounded in length.
export function clean(value: unknown, max = 80): string {
  const text = String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
