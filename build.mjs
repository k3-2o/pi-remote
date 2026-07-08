import * as esbuild from "esbuild";
import { copyFileSync, mkdirSync, existsSync, cpSync } from "node:fs";

const production = process.env.NODE_ENV === "production";

// Ensure dist exists
if (!existsSync("dist")) mkdirSync("dist");

await esbuild.build({
  entryPoints: ["src/cli.ts"],
  outfile: "dist/cli.js",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: production ? false : "inline",
  minify: production,
  external: ["ws"],
  banner: {
    js: "#!/usr/bin/env node",
  },
});

console.log("✓ Build complete: dist/cli.js");

// Copy SDKs into dist/ for npm package (importable via pi-remote/client)
copyFileSync("examples/pi_remote_ws.mjs", "dist/pi_remote_ws.mjs");
console.log("✓ SDK copied: dist/pi_remote_ws.mjs");

// Copy UI into dist/
if (existsSync("src/ui")) {
  if (!existsSync("dist/ui")) mkdirSync("dist/ui");
  copyFileSync("src/ui/index.html", "dist/ui/index.html");
  console.log("✓ UI copied: dist/ui/index.html");
}
