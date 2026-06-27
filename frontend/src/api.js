// Thin client for the backend API (served by Fantail under /api).
// Uses cookie sessions (credentials: include) and double-submit CSRF.

const BASE = "/api";

function getCookie(name) {
  const m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
  return m ? decodeURIComponent(m[1]) : null;
}

// Ensure a CSRF cookie exists; returns its value.
async function ensureCsrf() {
  let tok = getCookie("sgg_csrf");
  if (!tok) {
    const res = await fetch(`${BASE}/auth/csrf`, { credentials: "include" });
    const json = await res.json();
    tok = json.token || getCookie("sgg_csrf");
  }
  return tok;
}

async function request(method, path, body) {
  const headers = {};
  const opts = { method, credentials: "include", headers };
  if (body !== undefined) {
    headers["content-type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  if (method !== "GET") headers["x-csrf-token"] = await ensureCsrf();

  const res = await fetch(`${BASE}${path}`, opts);
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) {
    const err = new Error(json?.error || `request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return json;
}

export const api = {
  startggLoginUrl: () => `${BASE}/auth/startgg/login`,

  health: () => request("GET", "/health"),
  me: () => request("GET", "/auth/me"),
  register: (username, password) =>
    request("POST", "/auth/register", { username, password }),
  login: (username, password) =>
    request("POST", "/auth/login", { username, password }),
  logout: () => request("POST", "/auth/logout"),
  devLogin: (username) => request("POST", "/auth/dev-login", { username }),

  listSchedules: () => request("GET", "/schedules"),
  getSchedule: (id) => request("GET", `/schedules/${id}`),
  createSchedule: (payload) => request("POST", "/schedules", payload),
  updateSchedule: (id, payload) => request("PUT", `/schedules/${id}`, payload),
  deleteSchedule: (id) => request("DELETE", `/schedules/${id}`),
  createShare: (id) => request("POST", `/schedules/${id}/share`),

  getShared: (token) => request("GET", `/share/${token}`),
};
