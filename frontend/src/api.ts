// Thin client for the backend API (served by Fantail under /api).
// Uses cookie sessions (credentials: include) and double-submit CSRF.

import type {
  FullSchedule,
  HealthInfo,
  OutputSettings,
  Schedule,
  ScheduleMeta,
  SharedSchedule,
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
  me: () => request<{ user: User | null }>("GET", "/auth/me"),
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
};
