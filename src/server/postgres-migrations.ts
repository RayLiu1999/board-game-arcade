import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import type { Pool } from "pg";

const migrationDirectory = new URL("./migrations/", import.meta.url);

export const runMigrations = async (pool: Pool): Promise<void> => {
  const files = (await readdir(fileURLToPath(migrationDirectory)))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const migration = await readFile(new URL(file, migrationDirectory), "utf8");
    await pool.query(migration);
  }
};
