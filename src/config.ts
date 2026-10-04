import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Every environment variable this server reads, in one place. Scattering `process.env`
 * across modules is how the table in the README drifts out of date.
 */

interface PackageJson {
  name: string;
  version: string;
}

/** Single source of truth for the version the MCP handshake reports. */
const pkg = createRequire(import.meta.url)("../package.json") as PackageJson;

export const PKG_NAME = pkg.name;
export const PKG_VERSION = pkg.version;

const num = (value: string | undefined, fallback: number): number => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/** Where pi keeps auth.json, settings.json and extensions. */
export const AGENT_DIR = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");

/**
 * Opt-in escape hatches. Without one, the delegate can never write, edit, or run shell.
 *
 * Neither is a sandbox. pi has no permission system, so granting `bash` grants every
 * capability the user running this server has, writes included.
 */
export const ALLOW_ALL = process.env.PI_DELEGATE_ALLOW_WRITE === "1";
export const ALLOW_EXTRA = (process.env.PI_DELEGATE_ALLOW_TOOLS || "")
  .split(",")
  .map((t) => t.trim())
  .filter(Boolean);

/** Model used when a call omits `model`. Undefined means pi's own configured default. */
export const DEFAULT_MODEL = process.env.PI_DELEGATE_MODEL || undefined;

/** Ignore pi's enabledModels scope entirely. */
export const IGNORE_SCOPE = process.env.PI_DELEGATE_IGNORE_SCOPE === "1";

/**
 * Honour enabledModels exactly. Off by default, which lets every model of a custom
 * provider through on the grounds that declaring one by hand is already an intent to use
 * it. Turn this on when you want the offered list to match enabledModels and nothing more.
 */
export const STRICT_SCOPE = process.env.PI_DELEGATE_STRICT_SCOPE === "1";

/** Finished sessions stay readable for later review; oldest are evicted first. */
export const HISTORY_LIMIT = num(process.env.PI_DELEGATE_HISTORY, 50);

/** Ceiling on one `spawn_batch` call. A fan-out this wide is usually a planning mistake. */
export const BATCH_MAX = num(process.env.PI_DELEGATE_BATCH_MAX, 10);

/** Above this, `init` summarises models by provider instead of dumping every ref. */
export const LIST_CAP = num(process.env.PI_DELEGATE_LIST_CAP, 60);

/** Progress notification interval during `run`, which resets the host's request timeout. */
export const PROGRESS_MS = num(process.env.PI_DELEGATE_PROGRESS_MS, 15_000);

/**
 * Hard ceiling for one pi turn. A provider or tool can fail before pi emits its
 * terminal event; without this guard the delegate would remain `running` forever.
 */
export const TURN_TIMEOUT_MS = num(process.env.PI_DELEGATE_TURN_TIMEOUT_MS, 5 * 60 * 1000);

/** Tool arguments and results are clipped before entering the trace. */
export const TRACE_ARGS = num(process.env.PI_DELEGATE_TRACE_ARGS, 400);
export const TRACE_RESULT = num(process.env.PI_DELEGATE_TRACE_RESULT, 600);

/** Where the status line reads live session state from. */
export const STATE_DIR =
  process.env.PI_DELEGATE_STATE_DIR ||
  join(process.env.XDG_STATE_HOME || join(homedir(), ".local", "state"), "pi-delegate-mcp");

/** MCP Events subscription persistence and webhook delivery policy. */
export const EVENTS_STORE_FILE =
  process.env.PI_DELEGATE_EVENTS_STORE || join(STATE_DIR, "event-subscriptions.json");
export const EVENTS_PRINCIPAL = process.env.PI_DELEGATE_EVENTS_PRINCIPAL || "local";
export const EVENTS_DEFAULT_TTL_MS = num(
  process.env.PI_DELEGATE_EVENTS_TTL_MS,
  7 * 24 * 60 * 60 * 1000,
);
export const EVENTS_MAX_TTL_MS = num(
  process.env.PI_DELEGATE_EVENTS_MAX_TTL_MS,
  7 * 24 * 60 * 60 * 1000,
);
export const EVENTS_VERIFY_CACHE_MS = num(
  process.env.PI_DELEGATE_EVENTS_VERIFY_CACHE_MS,
  10 * 60 * 1000,
);
export const EVENTS_SECRET_ROTATION_MS = num(
  process.env.PI_DELEGATE_EVENTS_SECRET_ROTATION_MS,
  5 * 60 * 1000,
);
export const EVENTS_TIMEOUT_MS = num(process.env.PI_DELEGATE_EVENTS_TIMEOUT_MS, 10_000);
export const EVENTS_MAX_ATTEMPTS = Math.max(
  1,
  Math.floor(num(process.env.PI_DELEGATE_EVENTS_MAX_ATTEMPTS, 4)),
);

/** Optional Streamable HTTP serving face. It is loopback-only and authenticated by default. */
export const HTTP_HOST = process.env.PI_DELEGATE_HTTP_HOST || "127.0.0.1";
export const HTTP_PORT = Math.floor(num(process.env.PI_DELEGATE_HTTP_PORT, 18_082));
export const HTTP_PATH = process.env.PI_DELEGATE_HTTP_PATH || "/mcp";
export const HTTP_BEARER_TOKEN = process.env.PI_DELEGATE_HTTP_BEARER_TOKEN || undefined;
export const HTTP_ALLOWED_HOSTS = (process.env.PI_DELEGATE_HTTP_ALLOWED_HOSTS || "127.0.0.1,localhost")
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);
export const HTTP_ALLOWED_ORIGINS = (process.env.PI_DELEGATE_HTTP_ALLOWED_ORIGINS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
