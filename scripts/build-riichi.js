import { build } from "esbuild";
import { copyFile } from "node:fs/promises";
await build({
  entryPoints: ["src/riichi-worker.js"],
  outfile: "public/riichi-worker.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  legalComments: "eof",
});
for (const name of ["majiang-core", "majiang-ai"])
  await copyFile(
    `node_modules/@kobalab/${name}/LICENSE`,
    `public/vendor/${name}-LICENSE`,
  );
console.log("日麻 Worker 與第三方授權已更新");
