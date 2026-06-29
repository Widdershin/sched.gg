import { Hono } from "hono";
import { type AppEnv, requireAuth } from "../auth/session.js";
import {
  fetchTournamentEvents,
} from "../startgg/tournament.js";
import { userId, requireStartggToken, startggErrorResponse } from "./shared.js";

const startgg = new Hono<AppEnv>();

startgg.use("/startgg/*", requireAuth);

// Look up a tournament's events (for the editor's per-block event dropdowns).
// Runs as the signed-in user via their stored start.gg token.
startgg.get("/startgg/tournament/:slug", async (c) => {
  const accessToken = await requireStartggToken(c);
  if (!accessToken) return c.json({ error: "start.gg account not linked" }, 409);
  const slug = c.req.param("slug");
  try {
    const { name, events } = await fetchTournamentEvents(accessToken, slug);
    return c.json({ name, events });
  } catch (err) {
    return startggErrorResponse(err, "events query failed");
  }
});

export default startgg;
