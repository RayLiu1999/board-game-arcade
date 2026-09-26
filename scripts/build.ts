import { build } from "esbuild";
import { copyFile, rm } from "node:fs/promises";

const browserOptions = {
  bundle: true,
  format: "esm" as const,
  platform: "browser" as const,
  target: "es2022",
  minify: true,
  legalComments: "eof" as const,
};

await build({
  ...browserOptions,
  entryPoints: ["src/shared/shogi.ts"],
  outfile: "public/shogi.js",
});

await build({
  ...browserOptions,
  entryPoints: ["src/shared/engine.ts"],
  outfile: "public/engine.js",
});

await build({
  ...browserOptions,
  entryPoints: ["src/client/ai.ts"],
  outfile: "public/ai.js",
});

await build({
  ...browserOptions,
  entryPoints: ["src/client/ai-worker.ts"],
  outfile: "public/ai-worker.js",
});

await build({
  ...browserOptions,
  entryPoints: ["src/client/riichi-ui.ts"],
  outfile: "public/riichi-ui.js",
});

await rm("public/chunks", { recursive: true, force: true });
await build({
  ...browserOptions,
  entryPoints: {
    "chess-3d": "src/client/chess-3d.ts",
    "go-3d": "src/client/go-3d.ts",
    "reversi-3d": "src/client/reversi-3d.ts",
  },
  outdir: "public",
  entryNames: "[name]",
  chunkNames: "chunks/[name]-[hash]",
  splitting: true,
});

await build({
  ...browserOptions,
  external: ["./chess-3d.js", "./go-3d.js", "./reversi-3d.js"],
  entryPoints: ["src/client/app.ts"],
  outfile: "public/app.js",
});

await build({
  ...browserOptions,
  entryPoints: ["src/riichi-worker.ts"],
  outfile: "public/riichi-worker.js",
});

for (const name of ["majiang-core", "majiang-ai"])
  await copyFile(
    `node_modules/@kobalab/${name}/LICENSE`,
    `public/vendor/${name}-LICENSE`,
  );
await copyFile("node_modules/three/LICENSE", "public/vendor/three-LICENSE");

console.log("共用 TS 引擎、將棋模組、日麻 Worker 與第三方授權已更新");
