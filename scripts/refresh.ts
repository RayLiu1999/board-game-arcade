import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import { Pool } from "pg";

import { refreshDatabase } from "../src/server/postgres-migrations.js";

const usage = (): void => {
  console.log(`用法：
  npm run refresh              互動確認後重建 qiju_* 資料表
  npm run refresh -- --yes     非互動模式，明確確認後重建資料表

選項：
  --yes                 跳過互動確認
  --allow-production    允許 NODE_ENV=production 執行（仍需 --yes）`);
};

const run = async (): Promise<void> => {
  const args = new Set(process.argv.slice(2));
  if (args.has("--help") || args.has("-h")) {
    usage();
    return;
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("執行 refresh 需要設定 DATABASE_URL");
  if (process.env.NODE_ENV === "production") {
    if (!args.has("--allow-production"))
      throw new Error(
        "NODE_ENV=production 已禁止 refresh；若確定要執行，請加上 --allow-production",
      );
    if (!args.has("--yes"))
      throw new Error("NODE_ENV=production 執行 refresh 必須同時加上 --yes");
  }

  const confirmed = args.has("--yes");
  if (!confirmed) {
    if (!stdin.isTTY || !stdout.isTTY)
      throw new Error("非互動環境請使用 npm run refresh -- --yes");
    const prompt = createInterface({ input: stdin, output: stdout });
    try {
      const answer = await prompt.question(
        "這會刪除 DATABASE_URL 中所有 qiju_* 資料表與資料。請輸入 REFRESH 繼續：",
      );
      if (answer.trim() !== "REFRESH")
        throw new Error("未輸入 REFRESH，已取消 refresh");
    } finally {
      prompt.close();
    }
  }

  const pool = new Pool({ connectionString });
  try {
    await refreshDatabase(pool);
    console.log(`[${new Date().toISOString()}] PostgreSQL refresh 完成`);
  } finally {
    await pool.end();
  }
};

try {
  await run();
} catch (error: unknown) {
  console.error(`[${new Date().toISOString()}] PostgreSQL refresh 失敗`, error);
  process.exitCode = 1;
}
