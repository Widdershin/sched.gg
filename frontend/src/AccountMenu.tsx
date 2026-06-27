import { useState } from "react";
import { useAuth } from "./AuthContext";
import { api } from "./api";

export default function AccountMenu() {
  const auth = useAuth();
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (auth.loading) return <span className="account-status">…</span>;

  // Backend unreachable (e.g. static build): work offline, hide auth UI.
  if (!auth.online) {
    return (
      <span className="account-status" title="Saved locally only">
        Offline
      </span>
    );
  }

  if (auth.user) {
    return (
      <div className="account-menu">
        <span className="account-status">
          {auth.user.displayName || auth.user.username || "Account"}
        </span>
        <button className="btn ghost" onClick={() => auth.logout()}>
          Log out
        </button>
      </div>
    );
  }

  const run = async (fn: () => Promise<unknown>) => {
    setError("");
    setBusy(true);
    try {
      await fn();
      setOpen(false);
      setUsername("");
      setPassword("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="account-menu">
      <button className="btn ghost" onClick={() => setOpen((o) => !o)}>
        Sign in
      </button>
      {open && (
        <div className="account-panel">
          <input
            className="account-input"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <input
            className="account-input"
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && <p className="account-error">{error}</p>}
          <div className="account-actions">
            <button
              className="btn primary"
              disabled={busy}
              onClick={() => run(() => auth.login(username, password))}
            >
              Log in
            </button>
            <button
              className="btn"
              disabled={busy}
              onClick={() => run(() => auth.register(username, password))}
            >
              Register
            </button>
          </div>
          {auth.methods.startgg && (
            <a className="btn startgg-btn" href={api.startggLoginUrl()}>
              Sign in with start.gg
            </a>
          )}
          {auth.methods.devLogin && (
            <button
              className="btn ghost"
              disabled={busy}
              onClick={() => run(() => auth.devLogin())}
            >
              Dev login
            </button>
          )}
        </div>
      )}
    </div>
  );
}
