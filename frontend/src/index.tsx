import { createRoot } from "react-dom/client";
import App from "./App";
import ShareView from "./ShareView";
import { AuthProvider } from "./AuthContext";
import "./styles.css";

// `/?share=TOKEN` opens a read-only shared schedule (served by the existing
// `get "/"` route, so no Fantail routing change is needed). Otherwise the full
// editor, wrapped in the auth provider.
function Root() {
  const token = new URLSearchParams(window.location.search).get("share");
  if (token) return <ShareView token={token} />;
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
