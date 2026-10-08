import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { runner } from "node-pg-migrate";
import { Client } from "pg";
import { describe, expect, inject, it } from "vitest";
import { toMaintenanceUrl } from "@/lib/test/test-env";

// The script runs against its own scratch database, never the shared test or the dev database.
async function withScratchDatabase(
  body: (scratch: { url: string; client: Client }) => Promise<void>,
): Promise<void> {
  const name = `scratch_${randomBytes(6).toString("hex")}_test`;
  const sharedUrl = inject("testDatabaseUrl");
  const scratch = new URL(sharedUrl);
  scratch.pathname = `/${name}`;
  const url = scratch.toString();

  const admin = new Client({ connectionString: toMaintenanceUrl(sharedUrl) });
  await admin.connect();
  let client: Client | null = null;
  let created = false;
  try {
    await admin.query(`create database ${admin.escapeIdentifier(name)}`);
    created = true;
    await runner({
      databaseUrl: url,
      dir: "db/migrations",
      migrationsTable: "pgmigrations",
      direction: "up",
      log: () => {},
    });
    client = new Client({ connectionString: url });
    await client.connect();
    await body({ url, client });
  } finally {
    await client?.end();
    if (created) {
      await admin.query(
        `drop database if exists ${admin.escapeIdentifier(name)} with (force)`,
      );
    }
    await admin.end();
  }
}

function runDown(databaseUrl: string, ...args: string[]) {
  return spawnSync(process.execPath, ["scripts/db-migrate-down.mjs", ...args], {
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: databaseUrl },
    timeout: 30_000,
  });
}

async function tableNames(client: Client): Promise<string[]> {
  const { rows } = await client.query<{ tablename: string }>(
    "select tablename from pg_tables where schemaname = 'public' and tablename <> 'pgmigrations' order by tablename",
  );
  return rows.map((row) => row.tablename);
}

async function migrationCount(client: Client): Promise<number> {
  const { rows } = await client.query<{ n: number }>(
    "select count(*)::int as n from pgmigrations",
  );
  return rows[0].n;
}

describe("scripts/db-migrate-down.mjs against a local _test database", () => {
  it(
    "changes nothing with --dry-run, then drops the tables with a count",
    {
      timeout: 90_000,
    },
    async () => {
      await withScratchDatabase(async ({ url, client }) => {
        expect(await tableNames(client)).toEqual(["sessions", "users"]);

        const dry = runDown(url, "--dry-run");
        expect(dry.status).toBe(0);
        expect(dry.stderr).not.toMatch(/db:migrate:down refused/);
        expect(await tableNames(client)).toEqual(["sessions", "users"]);
        expect(await migrationCount(client)).toBe(1);

        const down = runDown(url, "1");
        expect(down.status).toBe(0);
        expect(down.stderr).not.toMatch(/db:migrate:down refused/);
        expect(await tableNames(client)).toEqual([]);
        expect(await migrationCount(client)).toBe(0);
      });
    },
  );

  it(
    "drops tables that still hold rows, and succeeds when nothing is left to undo",
    {
      timeout: 90_000,
    },
    async () => {
      await withScratchDatabase(async ({ url, client }) => {
        const { rows } = await client.query<{ id: string }>(
          "insert into users (email, username, password_hash) values ('a@example.com', 'a', '$argon2id$x') returning id",
        );
        await client.query(
          "insert into sessions (user_id, token_hash, expires_at) values ($1, $2, now() + interval '1 hour')",
          [rows[0].id, Buffer.alloc(32, 1)],
        );

        expect(runDown(url).status).toBe(0);
        expect(await tableNames(client)).toEqual([]);

        expect(runDown(url).status).toBe(0);
        expect(await tableNames(client)).toEqual([]);
      });
    },
  );

  it(
    "does not run the migration when an argument is refused",
    {
      timeout: 90_000,
    },
    async () => {
      await withScratchDatabase(async ({ url, client }) => {
        const result = runDown(url, "--dry-run", "--dry-run");
        expect(result.status).toBe(1);
        expect(result.stderr).toMatch(/^db:migrate:down refused: [^\n]+\n$/);
        expect(await tableNames(client)).toEqual(["sessions", "users"]);
        expect(await migrationCount(client)).toBe(1);
      });
    },
  );
});
