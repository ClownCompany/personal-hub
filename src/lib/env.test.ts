import { afterEach, describe, expect, it, vi } from "vitest";
import { getEnv, parseEnv, resetEnvCacheForTesting } from "@/lib/env";

describe("parseEnv", () => {
  it("returns the validated variables", () => {
    const env = parseEnv({ DATABASE_URL: "postgres://localhost:5432/hub" });
    expect(env.DATABASE_URL).toBe("postgres://localhost:5432/hub");
  });

  it("accepts a postgresql:// URL", () => {
    const env = parseEnv({ DATABASE_URL: "postgresql://localhost:5432/hub" });
    expect(env.DATABASE_URL).toBe("postgresql://localhost:5432/hub");
  });

  it("throws when DATABASE_URL is missing", () => {
    expect(() => parseEnv({})).toThrow();
  });

  it("throws when DATABASE_URL is empty", () => {
    expect(() => parseEnv({ DATABASE_URL: "" })).toThrow();
  });

  it("throws when DATABASE_URL is not a postgres URL", () => {
    expect(() =>
      parseEnv({ DATABASE_URL: "mysql://localhost:3306/hub" }),
    ).toThrow(/postgres:\/\//);
  });

  it("does not leak credentials in validation errors", () => {
    let thrown: unknown;
    try {
      parseEnv({ DATABASE_URL: "mysql://user:supersecret@host/db" });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeDefined();
    expect(String(thrown)).not.toContain("supersecret");
  });
});

describe("getEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvCacheForTesting();
  });

  it("parses process.env and returns the same object on repeated calls", () => {
    vi.stubEnv("DATABASE_URL", "postgres://localhost:5432/hub");
    const first = getEnv();
    expect(first.DATABASE_URL).toBe("postgres://localhost:5432/hub");
    const second = getEnv();
    expect(second).toBe(first);
  });
});
