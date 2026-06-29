import { env } from "../env.js";

// start.gg OAuth 2.0 endpoints. Confirm scopes/paths at developer.start.gg.
const AUTHORIZE_URL = "https://start.gg/oauth/authorize";
const TOKEN_URL = "https://api.start.gg/oauth/access_token";
export const GQL_URL = "https://api.start.gg/gql/alpha";

export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number | null; // seconds until the access token expires
}

export function parseTokenResponse(raw: unknown): TokenSet {
  const json = (raw ?? {}) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!json.access_token) {
    throw new Error("start.gg token response missing access_token");
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresIn: typeof json.expires_in === "number" ? json.expires_in : null,
  };
}

export function buildAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: env.startgg.clientId,
    redirect_uri: env.startgg.redirectUri,
    scope: env.startgg.scope,
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export async function exchangeCode(code: string): Promise<TokenSet> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      client_id: env.startgg.clientId,
      client_secret: env.startgg.clientSecret,
      redirect_uri: env.startgg.redirectUri,
      scope: env.startgg.scope,
    }),
  });
  if (!res.ok) {
    throw new Error(`start.gg token exchange failed: ${res.status}`);
  }
  return parseTokenResponse(await res.json());
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenSet> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: env.startgg.clientId,
      client_secret: env.startgg.clientSecret,
      scope: env.startgg.scope,
    }),
  });
  if (!res.ok) {
    throw new Error(`start.gg token refresh failed: ${res.status}`);
  }
  return parseTokenResponse(await res.json());
}

export interface StartggUser {
  id: string;
  slug: string | null;
  gamerTag: string | null;
}

export async function fetchCurrentUser(accessToken: string): Promise<StartggUser> {
  const res = await fetch(GQL_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      query: `query { currentUser { id slug player { gamerTag } } }`,
    }),
  });
  if (!res.ok) throw new Error(`start.gg currentUser query failed: ${res.status}`);
  const json = (await res.json()) as {
    data?: { currentUser?: { id: number; slug?: string; player?: { gamerTag?: string } } };
  };
  const cu = json.data?.currentUser;
  if (!cu?.id) throw new Error("start.gg currentUser response missing id");
  return {
    id: String(cu.id),
    slug: cu.slug ?? null,
    gamerTag: cu.player?.gamerTag ?? null,
  };
}
