import { PostgresRoomStore } from "../src/server/postgres-room-store.js";

const run = async (): Promise<void> => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString)
    throw new Error("執行 migration 需要設定 DATABASE_URL");

  const store = new PostgresRoomStore({ connectionString });
  try {
    await store.initialize();
    console.log(`[${new Date().toISOString()}] PostgreSQL migration 完成`);
  } finally {
    await store.close();
  }
};

try {
  await run();
} catch (error: unknown) {
  console.error(
    `[${new Date().toISOString()}] PostgreSQL migration 失敗`,
    error,
  );
  process.exitCode = 1;
}
