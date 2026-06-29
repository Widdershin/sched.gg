import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { env } from "./env.js";
import "./db.js"; // open DB + run migrations at boot
import { type AppEnv, loadUser } from "./auth/session.js";
import health from "./routes/health.js";
import authRoutes from "./routes/auth.js";
import schedules from "./routes/schedules.js";
import share from "./routes/share.js";
import startgg from "./routes/startgg.js";

const app = new Hono<AppEnv>();

// Populate c.get("user") on every request.
app.use("*", loadUser);

// Routes are mounted WITHOUT an /api prefix — Fantail strips it before proxying.
app.route("/", health);
app.route("/", authRoutes);
app.route("/", schedules);
app.route("/", share);
app.route("/", startgg);

app.onError((err, c) => {
  console.error("[backend] unhandled error", err);
  return c.json({ error: "internal error" }, 500);
});

serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`[backend] listening on :${info.port} (data dir ${env.dataDir})`);
});
