// start.gg tournament queries run as the signed-in user (Bearer access token).
import { GQL_URL } from "../auth/startgg.js";
import type { StartggEvent, Entrant } from "../../../shared/types.js";

// Thrown when start.gg rejects the request (auth/permission). The route layer
// maps this to a 403 so the user knows they lack access to that tournament.
export class StartggApiError extends Error {
  forbidden: boolean;
  constructor(message: string, forbidden = false) {
    super(message);
    this.name = "StartggApiError";
    this.forbidden = forbidden;
  }
}

async function gql<T>(
  accessToken: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(GQL_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (res.status === 401 || res.status === 403) {
    throw new StartggApiError(`start.gg request unauthorized (${res.status})`, true);
  }
  if (!res.ok) {
    throw new StartggApiError(`start.gg request failed (${res.status})`);
  }
  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (json.errors?.length) {
    const msg = json.errors.map((e) => e.message).join("; ");
    const forbidden = /not authorized|permission|unauthor/i.test(msg);
    throw new StartggApiError(`start.gg: ${msg}`, forbidden);
  }
  if (!json.data) throw new StartggApiError("start.gg response missing data");
  return json.data;
}

export interface TournamentEvents {
  name: string;
  events: StartggEvent[];
}

export async function fetchTournamentEvents(
  accessToken: string,
  slug: string,
): Promise<TournamentEvents> {
  const data = await gql<{
    tournament: { name: string; events: { id: number; name: string }[] } | null;
  }>(
    accessToken,
    `query Events($slug: String!) {
       tournament(slug: $slug) { id name events { id name } }
     }`,
    { slug },
  );
  const t = data.tournament;
  if (!t) throw new StartggApiError(`tournament not found: ${slug}`);
  return {
    name: t.name,
    events: (t.events ?? []).map((e) => ({ id: String(e.id), name: e.name })),
  };
}

const PER_PAGE = 64;

// start.gg participants carry no role — the role is assigned/persisted locally.
export type FetchedParticipant = Omit<Entrant, "role">;

export async function fetchTournamentParticipants(
  accessToken: string,
  slug: string,
): Promise<FetchedParticipant[]> {
  const out: FetchedParticipant[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const data = await gql<{
      tournament: {
        participants: {
          pageInfo: { totalPages: number };
          nodes: {
            id: number;
            gamerTag: string | null;
            entrants: { event: { id: number } | null }[] | null;
          }[];
        };
      } | null;
    }>(
      accessToken,
      `query Participants($slug: String!, $page: Int!, $perPage: Int!) {
         tournament(slug: $slug) {
           participants(query: { page: $page, perPage: $perPage }) {
             pageInfo { totalPages }
             nodes { id gamerTag entrants { event { id } } }
           }
         }
       }`,
      { slug, page, perPage: PER_PAGE },
    );
    const t = data.tournament;
    if (!t) throw new StartggApiError(`tournament not found: ${slug}`);
    totalPages = t.participants.pageInfo.totalPages || 1;
    for (const node of t.participants.nodes) {
      const eventIds = Array.from(
        new Set(
          (node.entrants ?? [])
            .map((e) => e.event?.id)
            .filter((id): id is number => id != null)
            .map(String),
        ),
      );
      out.push({
        id: String(node.id),
        gamerTag: node.gamerTag ?? "",
        eventIds,
      });
    }
    page += 1;
  } while (page <= totalPages);
  return out;
}
