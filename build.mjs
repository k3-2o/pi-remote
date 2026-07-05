import * as esbuild from "esbuild";

const production = process.env.NODE_ENV === "production";

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
