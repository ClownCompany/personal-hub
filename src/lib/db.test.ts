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
