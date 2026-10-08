import { Client } from "pg";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  inject,
  it,
  vi,
} from "vitest";
import { closePool, getPool } from "@/lib/db";
import { resetEnvCacheForTesting } from "@/lib/env";
import { truncateAllTables } from "@/lib/test/db";
import { toMaintenanceUrl } from "@/lib/test/test-env";

const OTHER_SCHEMA = "tmp_truncate_other_schema";
const TABLES = [
  "tmp_tt_a",
  "tmp_tt_b",
  "tmp_tt_parent",
  "tmp_tt_child",
  "tmp_tt_grandchild",
  "tmp_tt_part",
  "Tmp_Tt_Mixed",
  'tmp_tt_"quoted".name',
  "Pgmigrations",
];
const MIGRATION_MARKER = "tmp_truncate_all_tables_marker";

async function count(table: string): Promise<number> {
  const { rows } = await getPool().query<{ n: number }>(
    `select count(*)::int as n from ${table}`,
  );
  return rows[0].n;
}

async function dropFixtures(): Promise<void> {
  const pool = getPool();
  await pool.query(`drop schema if exists ${OTHER_SCHEMA} cascade`);
  for (const table of TABLES) {
    await pool.query(
      `drop table if exists public."${table.replaceAll('"', '""')}" cascade`,
    );
  }
  await pool.query("delete from pgmigrations where name = $1", [
    MIGRATION_MARKER,
  ]);
}

describe("truncateAllTables", () => {
  beforeEach(async () => {
    await dropFixtures();
  });

  afterEach(async () => {
    await dropFixtures();
  });

  it("resolves when there is nothing but pgmigrations to skip", async () => {
    const pool = getPool();
    await pool.query(
      "insert into pgmigrations (name, run_on) values ($1, now())",
      [MIGRATION_MARKER],
    );
    await expect(truncateAllTables()).resolves.toBeUndefined();
    expect(await count("pgmigrations")).toBeGreaterThanOrEqual(1);
  });

  it("clears several tables at once", async () => {
    const pool = getPool();
    await pool.query("create table tmp_tt_a (id serial primary key, v int)");
    await pool.query("create table tmp_tt_b (id serial primary key, v int)");
    await pool.query("insert into tmp_tt_a (v) values (1), (2), (3)");
    await pool.query("insert into tmp_tt_b (v) values (4), (5)");

    await truncateAllTables();

    expect(await count("tmp_tt_a")).toBe(0);
    expect(await count("tmp_tt_b")).toBe(0);
  });

  it("restarts identity sequences of every table", async () => {
    const pool = getPool();
    await pool.query("create table tmp_tt_a (id serial primary key, v int)");
    await pool.query("create table tmp_tt_b (id serial primary key, v int)");
    await pool.query("insert into tmp_tt_a (v) values (1), (2)");
    await pool.query("insert into tmp_tt_b (v) values (1), (2), (3)");

    await truncateAllTables();

    const a = await pool.query<{ id: number }>(
      "insert into tmp_tt_a (v) values (9) returning id",
    );
    const b = await pool.query<{ id: number }>(
      "insert into tmp_tt_b (v) values (9) returning id",
    );
    expect(a.rows[0].id).toBe(1);
    expect(b.rows[0].id).toBe(1);
  });

  it("clears a table that has no rows", async () => {
    await getPool().query("create table tmp_tt_a (id serial primary key)");
    await expect(truncateAllTables()).resolves.toBeUndefined();
    expect(await count("tmp_tt_a")).toBe(0);
  });

  it("clears tables linked by foreign keys, including chains", async () => {
    const pool = getPool();
    await pool.query("create table tmp_tt_parent (id serial primary key)");
    await pool.query(
      "create table tmp_tt_child (id serial primary key, parent_id int not null references tmp_tt_parent (id))",
    );
    await pool.query(
      "create table tmp_tt_grandchild (id serial primary key, child_id int not null references tmp_tt_child (id) on delete cascade)",
    );
    await pool.query("insert into tmp_tt_parent default values");
    await pool.query("insert into tmp_tt_child (parent_id) values (1)");
    await pool.query("insert into tmp_tt_grandchild (child_id) values (1)");

    await truncateAllTables();

    expect(await count("tmp_tt_parent")).toBe(0);
    expect(await count("tmp_tt_child")).toBe(0);
    expect(await count("tmp_tt_grandchild")).toBe(0);
  });

  it("clears tables with mixed-case and quoted names", async () => {
    const pool = getPool();
    await pool.query(
      'create table public."Tmp_Tt_Mixed" (id serial primary key)',
    );
    await pool.query(
      'create table public."tmp_tt_""quoted"".name" (id serial primary key)',
    );
    await pool.query('insert into public."Tmp_Tt_Mixed" default values');
    await pool.query(
      'insert into public."tmp_tt_""quoted"".name" default values',
    );

    await truncateAllTables();

    expect(await count('public."Tmp_Tt_Mixed"')).toBe(0);
    expect(await count('public."tmp_tt_""quoted"".name"')).toBe(0);
  });

  it("clears a partitioned table together with its partitions", async () => {
    const pool = getPool();
    await pool.query(
      "create table tmp_tt_part (id int not null, v int) partition by range (id)",
    );
    await pool.query(
      "create table tmp_tt_part_1 partition of tmp_tt_part for values from (0) to (100)",
    );
    await pool.query("insert into tmp_tt_part values (1, 1), (2, 2)");

    await truncateAllTables();

    expect(await count("tmp_tt_part")).toBe(0);
    expect(await count("tmp_tt_part_1")).toBe(0);
  });

  it("keeps rows of pgmigrations", async () => {
    await getPool().query(
      "insert into pgmigrations (name, run_on) values ($1, now())",
      [MIGRATION_MARKER],
    );
    await truncateAllTables();
    const { rows } = await getPool().query(
      "select 1 from pgmigrations where name = $1",
      [MIGRATION_MARKER],
    );
    expect(rows).toHaveLength(1);
  });

  it("only skips the exact table name pgmigrations (case-sensitive)", async () => {
    const pool = getPool();
    await pool.query(
      'create table public."Pgmigrations" (id serial primary key)',
    );
    await pool.query('insert into public."Pgmigrations" default values');

    await truncateAllTables();

    expect(await count('public."Pgmigrations"')).toBe(0);
  });

  it("does not touch tables in other schemas", async () => {
    const pool = getPool();
    await pool.query(`create schema ${OTHER_SCHEMA}`);
    await pool.query(
      `create table ${OTHER_SCHEMA}.items (id serial primary key, v int)`,
    );
    await pool.query(`insert into ${OTHER_SCHEMA}.items (v) values (1), (2)`);
    await pool.query("create table tmp_tt_a (id serial primary key)");
    await pool.query("insert into tmp_tt_a default values");

    await truncateAllTables();

    expect(await count("tmp_tt_a")).toBe(0);
    expect(await count(`${OTHER_SCHEMA}.items`)).toBe(2);
  });

  it("does not touch a same-named table in another schema", async () => {
    const pool = getPool();
    await pool.query(`create schema ${OTHER_SCHEMA}`);
    await pool.query(`create table ${OTHER_SCHEMA}.tmp_tt_a (id int)`);
    await pool.query(`insert into ${OTHER_SCHEMA}.tmp_tt_a values (1)`);
    await pool.query("create table tmp_tt_a (id int)");
    await pool.query("insert into tmp_tt_a values (1)");

    await truncateAllTables();

    expect(await count("tmp_tt_a")).toBe(0);
    expect(await count(`${OTHER_SCHEMA}.tmp_tt_a`)).toBe(1);
  });

  it("also clears rows in other schemas that reference a public table (CASCADE)", async () => {
    // Documents current behaviour: CASCADE follows foreign keys across schemas.
    const pool = getPool();
    await pool.query("create table tmp_tt_parent (id serial primary key)");
    await pool.query("insert into tmp_tt_parent default values");
    await pool.query(`create schema ${OTHER_SCHEMA}`);
    await pool.query(
      `create table ${OTHER_SCHEMA}.refs (parent_id int references public.tmp_tt_parent (id))`,
    );
    await pool.query(`insert into ${OTHER_SCHEMA}.refs values (1)`);

    await truncateAllTables();

    expect(await count(`${OTHER_SCHEMA}.refs`)).toBe(0);
  });

  it("can be called repeatedly", async () => {
    await getPool().query("create table tmp_tt_a (id serial primary key)");
    await truncateAllTables();
    await expect(truncateAllTables()).resolves.toBeUndefined();
  });

  it("does not remove the tables themselves", async () => {
    await getPool().query("create table tmp_tt_a (id serial primary key)");
    await truncateAllTables();
    const { rows } = await getPool().query(
      "select 1 from pg_tables where schemaname = 'public' and tablename = 'tmp_tt_a'",
    );
    expect(rows).toHaveLength(1);
  });
});

describe("truncateAllTables database guard", () => {
  // Not a *_test name, so the guard must refuse it; a scratch DB keeps the check non-destructive.
  const scratchName = `hub_guard_${process.pid}_${Date.now()}_scratch`;
  const baseUrl = inject("testDatabaseUrl");

  async function withMaintenanceClient(sql: string): Promise<void> {
    const client = new Client({ connectionString: toMaintenanceUrl(baseUrl) });
    await client.connect();
    try {
      await client.query(sql);
    } finally {
      await client.end();
    }
  }

  function scratchUrl(): string {
    const url = new URL(baseUrl);
    url.pathname = `/${scratchName}`;
    return url.toString();
  }

  beforeAll(async () => {
    await withMaintenanceClient(`create database ${scratchName}`);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    resetEnvCacheForTesting();
    await closePool();
  });

  afterAll(async () => {
    await withMaintenanceClient(
      `drop database if exists ${scratchName} with (force)`,
    );
  });

  it("refuses a database that is not a test database and leaves its data alone", async () => {
    vi.stubEnv("DATABASE_URL", scratchUrl());
    resetEnvCacheForTesting();
    await closePool();
    const pool = getPool();
    await pool.query("create table guard_sentinel (id serial primary key)");
    await pool.query("insert into guard_sentinel default values");

    let message = "";
    try {
      await truncateAllTables();
    } catch (error) {
      message = String(error);
    }

    expect(message).toMatch(/Refusing to truncate/);
    expect(message).not.toContain(scratchName);
    expect(message).not.toContain(new URL(baseUrl).host);
    const { rows } = await pool.query<{ n: number }>(
      "select count(*)::int as n from guard_sentinel",
    );
    expect(rows[0].n).toBe(1);
  });

  it("still truncates the real test database afterwards", async () => {
    await getPool().query(
      "create table tmp_guard_after (id serial primary key)",
    );
    await getPool().query("insert into tmp_guard_after default values");
    await truncateAllTables();
    const { rows } = await getPool().query<{ n: number }>(
      "select count(*)::int as n from tmp_guard_after",
    );
    expect(rows[0].n).toBe(0);
    await getPool().query("drop table tmp_guard_after");
  });
});
