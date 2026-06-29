// Bundle the TypeScript tests with esbuild (so `.js` import specifiers resolve
// to `.ts`, matching the build), then run them with node's built-in test runner.
import * as esbuild from "esbuild";
import { readdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const entries = readdirSync("test")
  .filter((f) => f.endsWith(".test.ts"))
  .map((f) => join("test", f));

if (entries.length === 0) {
  console.error("no tests found");
  process.exit(1);
}

const outdir = mkdtempSync(join(tmpdir(), "sgg-test-"));

// Tests need an isolated DATA_DIR so they don't create ~/.local/share/sched.gg
// or open the real sched.db. The in-memory DB is injected via setTestDb().
const testEnvDir = mkdtempSync(join(tmpdir(), "sgg-env-"));
process.env.DATA_DIR = testEnvDir;
process.env.SESSION_SECRET = "test-secret-for-unit-tests";

await esbuild.build({
  entryPoints: entries,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  outdir,
  external: ["@napi-rs/canvas"],
  banner: {
    js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);',
  },
  plugins: [{
    name: "napi-stub",
    setup(build) {
      build.onResolve({ filter: /^@napi-rs\/canvas$/ }, () => ({
        path: join(__dirname, "test", "napi-stub.js"),
      }));
    },
  }],
});

const files = readdirSync(outdir)
  .filter((f) => f.endsWith(".js"))
  .map((f) => join(outdir, f));

const res = spawnSync(
  process.execPath,
  ["--test", "--experimental-sqlite", ...files],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      SESSION_SECRET: "test-secret-for-unit-tests",
      DATA_DIR: testEnvDir,
    },
  },
);
process.exit(res.status ?? 1);
