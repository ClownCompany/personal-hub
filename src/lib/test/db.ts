import { escapeIdentifier } from "pg";
import { getPool } from "@/lib/db";
import { isTestDatabaseName } from "@/lib/test/test-env";

// Clears every table in `public` except the migration bookkeeping table.
export async function truncateAllTables(): Promise<void> {
  const pool = getPool();
  const current = await pool.query<{ name: string }>(
    "select current_database() as name",
  );
  if (!isTestDatabaseName(current.rows[0].name)) {
    throw new Error(
      "Refusing to truncate: the connected database is not a test database (name must end in _test)",
    );
  }
  const { rows } = await pool.query<{ tablename: string }>(
    "select tablename from pg_tables where schemaname = 'public' and tablename <> 'pgmigrations'",
  );
  if (rows.length === 0) return;
  const tables = rows.map((row) => `public.${escapeIdentifier(row.tablename)}`);
  await pool.query(
    `truncate table ${tables.join(", ")} restart identity cascade`,
  );
}
