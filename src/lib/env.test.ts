import { describe, expect, it } from "vitest";
import { parseEnv } from "@/lib/env";

describe("parseEnv", () => {
  it("returns the validated variables", () => {
    const env = parseEnv({ DATABASE_URL: "postgres://localhost:5432/hub" });
    expect(env.DATABASE_URL).toBe("postgres://localhost:5432/hub");
  });

  it("throws when DATABASE_URL is missing", () => {
    expect(() => parseEnv({})).toThrow();
  });

  it("throws when DATABASE_URL is empty", () => {
    expect(() => parseEnv({ DATABASE_URL: "" })).toThrow();
  });
});
