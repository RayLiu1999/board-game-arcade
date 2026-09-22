import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import type { Pool, PoolClient } from "pg";

const migrationDirectory = new URL("./migrations/", import.meta.url);

type MigrationQueryable = Pick<PoolClient, "query">;

const migrationSql = async (): Promise<string[]> => {
  const files = (await readdir(fileURLToPath(migrationDirectory)))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  return Promise.all(
    files.map((file) => readFile(new URL(file, migrationDirectory), "utf8")),
  );
};

const runMigrationsWith = async (
  queryable: MigrationQueryable,
): Promise<void> => {
  for (const migration of await migrationSql())
    await queryable.query(migration);
};

export const runMigrations = (pool: Pool): Promise<void> =>
  runMigrationsWith(pool);

export const refreshDatabase = async (pool: Pool): Promise<void> => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`
      DROP TABLE IF EXISTS
        qiju_user_preferences,
        qiju_match_events,
        qiju_match_participants,
        qiju_audit_log,
        qiju_sessions,
        qiju_room_players,
        qiju_rooms,
        qiju_matches,
        qiju_users
      CASCADE
    `);
    await runMigrationsWith(client);
    await client.query("COMMIT");
  } catch (error: unknown) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};
