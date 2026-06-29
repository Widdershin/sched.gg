import { Hono, type Context } from "hono";
import { type AppEnv, requireAuth } from "../auth/session.js";
import { getStartggAccessToken } from "../auth/startgg-token.js";
import {
  fetchTournamentEvents,
  StartggApiError,
} from "../startgg/tournament.js";

const startgg = new Hono<AppEnv>();

startgg.use("/startgg/*", requireAuth);

function userId(c: Context<AppEnv>): string {
  return c.get("user")!.id;
}

// Look up a tournament's events (for the editor's per-block event dropdowns).
// Runs as the signed-in user via their stored start.gg token.
startgg.get("/startgg/tournament/:slug", async (c) => {
  const accessToken = await getStartggAccessToken(userId(c));
  if (!accessToken) {
    return c.json({ error: "start.gg account not linked" }, 409);
  }
  const slug = c.req.param("slug");
  try {
    const { name, events } = await fetchTournamentEvents(accessToken, slug);
    return c.json({ name, events });
  } catch (err) {
    if (err instanceof StartggApiError && err.forbidden) {
      return c.json({ error: "no access to this tournament" }, 403);
    }
    console.error("[startgg] events query failed", err);
    return c.json({ error: "start.gg query failed" }, 502);
  }
});

export default startgg;
