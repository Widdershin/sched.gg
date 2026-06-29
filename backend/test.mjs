// Bundle the TypeScript tests with esbuild (so `.js` import specifiers resolve
// to `.ts`, matching the build), then run them with node's built-in test runner.
import * as esbuild from "esbuild";
import { readdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const entries = readdirSync("test")
  .filter((f) => f.endsWith(".test.ts"))
  .map((f) => join("test", f));

if (entries.length === 0) {
  console.error("no tests found");
  process.exit(1);
}

const outdir = mkdtempSync(join(tmpdir(), "sgg-test-"));

await esbuild.build({
  entryPoints: entries,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  outdir,
  // Native modules can't be bundled; tests don't use them, but keep it safe.
  external: ["@napi-rs/canvas"],
  banner: {
    js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);',
  },
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
    },
  },
);
process.exit(res.status ?? 1);
