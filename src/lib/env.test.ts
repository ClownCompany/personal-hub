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

  it.each([
    ["a leading space", " postgres://localhost/hub"],
    ["an uppercase scheme", "POSTGRES://localhost/hub"],
    ["no scheme", "localhost:5432/hub"],
    ["a prefix lookalike", "postgresx://localhost/hub"],
  ])("rejects %s", (_label, value) => {
    expect(() => parseEnv({ DATABASE_URL: value })).toThrow(/postgres:\/\//);
  });

  it("throws when DATABASE_URL is explicitly undefined", () => {
    expect(() => parseEnv({ DATABASE_URL: undefined })).toThrow();
  });

  it("accepts query parameters and encoded passwords unchanged", () => {
    const url = "postgres://u:p%40ss@h:5432/hub?sslmode=require";
    expect(parseEnv({ DATABASE_URL: url }).DATABASE_URL).toBe(url);
  });

  it("strips unrelated variables", () => {
    const env = parseEnv({
      DATABASE_URL: "postgres://localhost/hub",
      OTHER: "x",
    });
    expect(env).toEqual({ DATABASE_URL: "postgres://localhost/hub" });
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

  it("keeps the cached value when process.env changes later", () => {
    vi.stubEnv("DATABASE_URL", "postgres://localhost:5432/first");
    getEnv();
    vi.stubEnv("DATABASE_URL", "postgres://localhost:5432/second");
    expect(getEnv().DATABASE_URL).toBe("postgres://localhost:5432/first");
  });

  it("re-reads process.env after resetEnvCacheForTesting", () => {
    vi.stubEnv("DATABASE_URL", "postgres://localhost:5432/first");
    getEnv();
    resetEnvCacheForTesting();
    vi.stubEnv("DATABASE_URL", "postgres://localhost:5432/second");
    expect(getEnv().DATABASE_URL).toBe("postgres://localhost:5432/second");
  });

  it("does not cache a failure", () => {
    vi.stubEnv("DATABASE_URL", undefined);
    expect(() => getEnv()).toThrow();
    vi.stubEnv("DATABASE_URL", "postgres://localhost:5432/hub");
    expect(getEnv().DATABASE_URL).toBe("postgres://localhost:5432/hub");
  });

  it("throws for an invalid DATABASE_URL on every call", () => {
    vi.stubEnv("DATABASE_URL", "mysql://localhost/hub");
    expect(() => getEnv()).toThrow(/postgres:\/\//);
    expect(() => getEnv()).toThrow(/postgres:\/\//);
  });
});
