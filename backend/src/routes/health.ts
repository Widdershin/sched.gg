import { Hono } from "hono";
import type { AppEnv } from "../auth/session.js";
import { env, startggConfigured } from "../env.js";

const health = new Hono<AppEnv>();

// Liveness + which auth methods are available (so the UI can show the right buttons).
health.get("/health", (c) =>
  c.json({
    ok: true,
    devLogin: env.devLogin,
    startgg: startggConfigured(),
  }),
);

export default health;
