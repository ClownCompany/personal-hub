import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { closePool, getPool } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { getDatabaseName } from "@/lib/test/test-env";

const SENTINEL = "tmp_cleanup_check";

describe("integration harness", () => {
  beforeAll(async () => {
    const pool = getPool();
    await pool.query(`drop table if exists ${SENTINEL}`);
    await pool.query(`create table ${SENTINEL} (id serial primary key, v int)`);
    await pool.query(
      "insert into pgmigrations (name, run_on) values ($1, now())",
      [SENTINEL],
    );
  });

  afterAll(async () => {
    const pool = getPool();
    await pool.query(`drop table if exists ${SENTINEL}`);
    await pool.query("delete from pgmigrations where name = $1", [SENTINEL]);
  });

  it("round-trips a parameterised query through getPool", async () => {
    const { rows } = await getPool().query<{ n: number }>(
      "select $1::int as n",
      [42],
    );
    expect(rows[0].n).toBe(42);
  });

  it("is connected to a database whose name ends in _test", async () => {
    const { rows } = await getPool().query<{ name: string }>(
      "select current_database() as name",
    );
    expect(rows[0].name.endsWith("_test")).toBe(true);
  });

  it("inserts a row (cleanup check, part 1)", async () => {
    await getPool().query(`insert into ${SENTINEL} (v) values ($1)`, [1]);
    const { rows } = await getPool().query(`select * from ${SENTINEL}`);
    expect(rows).toHaveLength(1);
  });

  it("starts the next test with an empty table and restarted identity (cleanup check, part 2)", async () => {
    const pool = getPool();
    const { rows } = await pool.query(`select * from ${SENTINEL}`);
    expect(rows).toHaveLength(0);
    const inserted = await pool.query<{ id: number }>(
      `insert into ${SENTINEL} (v) values ($1) returning id`,
      [2],
    );
    expect(inserted.rows[0].id).toBe(1);
  });

  it("does not truncate pgmigrations", async () => {
    const { rows } = await getPool().query(
      "select 1 from pgmigrations where name = $1",
      [SENTINEL],
    );
    expect(rows).toHaveLength(1);
  });

  it("points DATABASE_URL at the injected test database", () => {
    const url = inject("testDatabaseUrl");
    expect(process.env.DATABASE_URL).toBe(url);
    expect(getEnv().DATABASE_URL).toBe(url);
    expect(getDatabaseName(url)?.endsWith("_test")).toBe(true);
  });

  it("has the migration table created by the global setup", async () => {
    const { rows } = await getPool().query(
      "select 1 from pg_tables where schemaname = 'public' and tablename = 'pgmigrations'",
    );
    expect(rows).toHaveLength(1);
  });

  it("closePool ends the pool and getPool then connects again", async () => {
    const first = getPool();
    await first.query("select 1");
    await closePool();
    expect(first.ended).toBe(true);
    await expect(first.query("select 1")).rejects.toThrow();

    const second = getPool();
    expect(second).not.toBe(first);
    const { rows } = await second.query<{ n: number }>("select 1 as n");
    expect(rows[0].n).toBe(1);
  });

  it("keeps the harness working after a pool was closed mid-file", async () => {
    // beforeEach truncated through a fresh pool, so the sentinel table is usable again.
    const { rows } = await getPool().query(`select * from ${SENTINEL}`);
    expect(rows).toHaveLength(0);
  });

  it("closePool during an idle pool does not leave connections open", async () => {
    const pool = getPool();
    await pool.query("select 1");
    expect(pool.totalCount).toBeGreaterThan(0);
    await closePool();
    expect(pool.totalCount).toBe(0);
  });
});
