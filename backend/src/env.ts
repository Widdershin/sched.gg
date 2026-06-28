import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Resolve the writable data directory (must live outside the read-only nix store).
function resolveDataDir(): string {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  const xdg = process.env.XDG_DATA_HOME;
  if (xdg) return path.join(xdg, "sched.gg");
  return path.join(os.homedir(), ".local", "share", "sched.gg");
}

// Load KEY=VALUE pairs from `${dataDir}/.env` without overriding existing env.
// This is a belt-and-suspenders fallback so secrets survive even if the process
// env ever stops being inherited.
function loadEnvFile(dataDir: string): void {
  const file = process.env.ENV_FILE || path.join(dataDir, ".env");
  let contents: string;
  try {
    contents = fs.readFileSync(file, "utf8");
  } catch {
    return; // no env file is fine
  }
  for (const rawLine of contents.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

const dataDir = resolveDataDir();
fs.mkdirSync(dataDir, { recursive: true });
loadEnvFile(dataDir);

const nodeEnv = process.env.NODE_ENV || "development";
const isProd = nodeEnv === "production";

export const env = {
  port: Number(process.env.PORT) || 3000,
  dataDir,
  dbPath: path.join(dataDir, "sched.db"),
  nodeEnv,
  isProd,
  // A signing secret is required; fall back to an unstable random one in dev so
  // the server still boots (sessions won't survive a restart in that case).
  sessionSecret:
    process.env.SESSION_SECRET ||
    (isProd ? "" : "dev-insecure-secret-change-me"),
  cookieSecure: process.env.COOKIE_SECURE
    ? process.env.COOKIE_SECURE === "1" || process.env.COOKIE_SECURE === "true"
    : isProd,
  devLogin: process.env.DEV_LOGIN === "1" || process.env.DEV_LOGIN === "true",
  startgg: {
    clientId: process.env.STARTGG_CLIENT_ID || "",
    clientSecret: process.env.STARTGG_CLIENT_SECRET || "",
    redirectUri:
      process.env.STARTGG_REDIRECT_URI ||
      "http://localhost:3095/api/auth/startgg/callback",
    // `tournament.manager` lets the signed-in user read participants of the
    // tournaments they run (needed for lanyard generation).
    scope: process.env.STARTGG_SCOPE || "user.identity tournament.manager",
  },
};

if (env.isProd && !process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET is required in production");
}

export function startggConfigured(): boolean {
  return Boolean(env.startgg.clientId && env.startgg.clientSecret);
}
