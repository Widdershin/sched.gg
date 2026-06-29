import { createRoot } from "react-dom/client";
import App from "./App";
import ShareView from "./ShareView";
import LanyardsPage from "./LanyardsPage";
import { AuthProvider } from "./AuthContext";
import "./styles.css";

// Client-side routing (Fantail serves index.html for every path via the
// wildcard route):
//   /?share=TOKEN     → read-only shared schedule
//   /lanyards/<id>    → per-entrant lanyard generator
//   otherwise         → the editor
function Root() {
  const token = new URLSearchParams(window.location.search).get("share");
  if (token) return <ShareView token={token} />;

  const path = window.location.pathname;
  if (path === "/lanyards" || path.startsWith("/lanyards/")) {
    const scheduleId = path.slice("/lanyards/".length) || null;
    return (
      <AuthProvider>
        <LanyardsPage scheduleId={scheduleId} />
      </AuthProvider>
    );
  }

  return (
    <AuthProvider>
      <App />
    </AuthProvider>
  );
}

// Mount the app and return a teardown function.
function startApp(): () => void {
  const root = createRoot(document.getElementById("root")!);
  root.render(<Root />);
  return () => root.unmount();
}

// Fantail hot reload: when the bundle changes, the reloader re-executes this
// file and then fires the accept callback. Tear down the existing React root
// and remount with the fresh code rather than stacking a second root on #root.
// (In-progress edits survive the remount because App persists to localStorage.)
if (window.module?.hot) {
  window.module.hot.accept("/js/bundle.js", () => {
    if (window.__disposeApp) window.__disposeApp();
    window.__disposeApp = startApp();
  });
}

// Initial mount, guarded so the re-executed bundle doesn't double-mount before
// the accept callback above swaps it out.
if (!window.__disposeApp) {
  window.__disposeApp = startApp();
}
