import * as esbuild from "esbuild";

// Bundle the server to a single ESM file with no runtime node_modules.
// `platform: "node"` keeps node:* builtins (node:sqlite, node:crypto, …) external.
await esbuild.build({
  entryPoints: ["src/server.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  outfile: "dist/server.js",
  minify: true,
  // Some transitive deps may call require() under ESM; provide a shim.
  banner: {
    js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);',
  },
});

console.log("backend build complete: dist/server.js");
