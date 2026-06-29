import { Hono } from "hono";
import { type AppEnv, loadUser } from "./auth/session.js";
import health from "./routes/health.js";
import authRoutes from "./routes/auth.js";
import schedules from "./routes/schedules.js";
import share from "./routes/share.js";
import startgg from "./routes/startgg.js";

export function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", loadUser);
  app.route("/", health);
  app.route("/", authRoutes);
  app.route("/", schedules);
  app.route("/", share);
  app.route("/", startgg);
  app.onError((err, c) => {
    console.error("[backend] unhandled error", err);
    return c.json({ error: "internal error" }, 500);
  });
  return app;
}

// Production entry — imported as a side-effect at boot.
import { serve } from "@hono/node-server";
import { env } from "./env.js";
import "./db.js"; // open DB + run migrations

serve({ fetch: createApp().fetch, port: env.port }, (info) => {
  console.log(`[backend] listening on :${info.port} (data dir ${env.dataDir})`);
});
