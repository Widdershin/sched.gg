// Thin client for the backend API (served by Fantail under /api).
// Uses cookie sessions (credentials: include) and double-submit CSRF.

import type {
  Entrant,
  FullSchedule,
  HealthInfo,
  OutputSettings,
  Schedule,
  ScheduleMeta,
  SharedSchedule,
  StartggEvent,
  User,
} from "./types";

const BASE = "/api";

function getCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
  return m ? decodeURIComponent(m[1]) : null;
}

// Ensure a CSRF cookie exists; returns its value.
async function ensureCsrf(): Promise<string | null> {
  let tok = getCookie("sgg_csrf");
  if (!tok) {
    const res = await fetch(`${BASE}/auth/csrf`, { credentials: "include" });
    const json = (await res.json()) as { token?: string };
    tok = json.token || getCookie("sgg_csrf");
  }
  return tok;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = {};
  const opts: RequestInit = { method, credentials: "include", headers };
  if (body !== undefined) {
    headers["content-type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  if (method !== "GET") {
    const tok = await ensureCsrf();
    if (tok) headers["x-csrf-token"] = tok;
  }

  const res = await fetch(`${BASE}${path}`, opts);
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) {
    const message =
      (json as { error?: string })?.error || `request failed (${res.status})`;
    const err = new Error(message) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return json as T;
}

export const api = {
  startggLoginUrl: (): string => `${BASE}/auth/startgg/login`,

  health: () => request<HealthInfo>("GET", "/health"),
  me: () =>
    request<{ user: User | null; startggLinked?: boolean }>("GET", "/auth/me"),
  register: (username: string, password: string) =>
    request<{ user: User }>("POST", "/auth/register", { username, password }),
  login: (username: string, password: string) =>
    request<{ user: User }>("POST", "/auth/login", { username, password }),
  logout: () => request<{ ok: true }>("POST", "/auth/logout"),
  devLogin: (username?: string) =>
    request<{ user: User }>("POST", "/auth/dev-login", { username }),

  listSchedules: () =>
    request<{ schedules: ScheduleMeta[] }>("GET", "/schedules"),
  getSchedule: (id: string) => request<FullSchedule>("GET", `/schedules/${id}`),
  createSchedule: (payload: {
    name: string;
    data: Schedule;
    output: OutputSettings;
  }) => request<ScheduleMeta>("POST", "/schedules", payload),
  updateSchedule: (
    id: string,
    payload: { name?: string; data?: Schedule; output?: OutputSettings },
  ) => request<{ ok: true; updated_at: number }>("PUT", `/schedules/${id}`, payload),
  deleteSchedule: (id: string) =>
    request<{ ok: true }>("DELETE", `/schedules/${id}`),
  createShare: (id: string) =>
    request<{ token: string; url: string }>("POST", `/schedules/${id}/share`),

  getShared: (token: string) =>
    request<SharedSchedule>("GET", `/share/${token}`),

  // start.gg tournament + entrants.
  getTournament: (slug: string) =>
    request<{ name: string; events: StartggEvent[] }>(
      "GET",
      `/startgg/tournament/${encodeURIComponent(slug)}`,
    ),
  getEntrants: (scheduleId: string) =>
    request<{ entrants: Entrant[]; syncedAt: number | null }>(
      "GET",
      `/schedules/${scheduleId}/entrants`,
    ),
  syncEntrants: (scheduleId: string) =>
    request<{ entrants: Entrant[]; syncedAt: number }>(
      "POST",
      `/schedules/${scheduleId}/entrants/sync`,
    ),
  setEntrantRole: (scheduleId: string, pid: string, role: string) =>
    request<{ ok: true }>(
      "PUT",
      `/schedules/${scheduleId}/entrants/${encodeURIComponent(pid)}/role`,
      { role },
    ),
  reassignRole: (scheduleId: string, from: string, to: string) =>
    request<{ ok: true }>(
      "POST",
      `/schedules/${scheduleId}/entrants/reassign-role`,
      { from, to },
    ),
  setEntrantName: (scheduleId: string, pid: string, name: string) =>
    request<{ ok: true }>(
      "PUT",
      `/schedules/${scheduleId}/entrants/${encodeURIComponent(pid)}/name`,
      { name },
    ),
  addManualEntrant: (
    scheduleId: string,
    payload: { name: string; role?: string },
  ) =>
    request<{ entrant: Entrant }>(
      "POST",
      `/schedules/${scheduleId}/entrants`,
      payload,
    ),
  deleteEntrant: (scheduleId: string, pid: string) =>
    request<{ ok: true }>(
      "DELETE",
      `/schedules/${scheduleId}/entrants/${encodeURIComponent(pid)}`,
    ),

  // Logo endpoints (binary, not JSON).
  uploadLogo: async (id: string, blob: Blob) => {
    const tok = await ensureCsrf();
    const headers: Record<string, string> = { "content-type": blob.type || "image/png" };
    if (tok) headers["x-csrf-token"] = tok;
    const res = await fetch(`${BASE}/schedules/${id}/logo`, {
      method: "PUT",
      credentials: "include",
      headers,
      body: blob,
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      throw new Error(
        (json as { error?: string }).error || `upload failed (${res.status})`,
      );
    }
    return res.json() as Promise<{ ok: true; updated_at: number }>;
  },

  getLogoBlob: async (id: string): Promise<Blob | null> => {
    const res = await fetch(`${BASE}/schedules/${id}/logo`, {
      credentials: "include",
    });
    if (res.status === 204) return null;
    if (!res.ok) throw new Error(`failed to load logo (${res.status})`);
    return res.blob();
  },

  deleteLogo: async (id: string) => {
    const tok = await ensureCsrf();
    const headers: Record<string, string> = {};
    if (tok) headers["x-csrf-token"] = tok;
    const res = await fetch(`${BASE}/schedules/${id}/logo`, {
      method: "DELETE",
      credentials: "include",
      headers,
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      throw new Error(
        (json as { error?: string }).error || `delete failed (${res.status})`,
      );
    }
    return res.json() as Promise<{ ok: true; updated_at: number }>;
  },

  getSharedLogoBlob: async (token: string): Promise<Blob | null> => {
    const res = await fetch(`${BASE}/share/${token}/logo`);
    if (res.status === 204) return null;
    if (!res.ok) throw new Error(`failed to load logo (${res.status})`);
    return res.blob();
  },
};
