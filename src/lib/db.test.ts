import { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { closePool, getPool } from "@/lib/db";
import { resetEnvCacheForTesting } from "@/lib/env";

describe("getPool", () => {
  afterEach(async () => {
    await closePool();
    vi.unstubAllEnvs();
    resetEnvCacheForTesting();
  });

  it("returns the same pool on repeated calls without connecting", () => {
    vi.stubEnv("DATABASE_URL", "postgres://localhost:5432/hub");
    const first = getPool();
    expect(getPool()).toBe(first);
    expect(first.totalCount).toBe(0);
  });

  it("returns a new pool after closePool", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://localhost:5432/hub");
    const first = getPool();
    await closePool();
    expect(getPool()).not.toBe(first);
  });

  it("closePool is a no-op when no pool exists", async () => {
    await expect(closePool()).resolves.toBeUndefined();
  });

  it("closePool can be called repeatedly", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://localhost:5432/hub");
    getPool();
    await closePool();
    await expect(closePool()).resolves.toBeUndefined();
  });

  it("closePool ends the pool it clears", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://localhost:5432/hub");
    const pool = getPool();
    await closePool();
    expect(pool.ended).toBe(true);
  });

  it("closePool clears the global even when ending the pool rejects", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://localhost:5432/hub");
    const pool = getPool();
    await pool.end();
    await expect(closePool()).rejects.toThrow();
    expect(getPool()).not.toBe(pool);
  });

  it("stores the pool on globalThis so hot reloads reuse it", () => {
    vi.stubEnv("DATABASE_URL", "postgres://localhost:5432/hub");
    const pool = getPool();
    expect((globalThis as { dbPool?: unknown }).dbPool).toBe(pool);
  });

  it("reuses a pool that already sits on globalThis, like after a hot reload", () => {
    vi.stubEnv("DATABASE_URL", "postgres://localhost:5432/hub");
    const existing = new Pool({ connectionString: "postgres://other/db" });
    (globalThis as { dbPool?: Pool }).dbPool = existing;
    expect(getPool()).toBe(existing);
  });

  it("configures the pool from DATABASE_URL", () => {
    vi.stubEnv("DATABASE_URL", "postgres://localhost:5432/hub");
    expect(getPool().options.connectionString).toBe(
      "postgres://localhost:5432/hub",
    );
  });

  it("does not keep a pool when creation fails", () => {
    vi.stubEnv("DATABASE_URL", "mysql://localhost/hub");
    expect(() => getPool()).toThrow();
    expect((globalThis as { dbPool?: unknown }).dbPool).toBeUndefined();
  });

  it("throws when DATABASE_URL is missing", () => {
    vi.stubEnv("DATABASE_URL", undefined);
    expect(() => getPool()).toThrow();
  });

  it("throws for an invalid DATABASE_URL without echoing it", () => {
    vi.stubEnv("DATABASE_URL", "mysql://user:supersecret@host/db");
    let thrown: unknown;
    try {
      getPool();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeDefined();
    expect(String(thrown)).toMatch(/postgres:\/\//);
    expect(String(thrown)).not.toContain("supersecret");
  });
});
