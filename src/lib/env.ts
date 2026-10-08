import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required")
    .refine(
      (value) =>
        value.startsWith("postgres://") || value.startsWith("postgresql://"),
      "DATABASE_URL must be a postgres:// URL",
    ),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  return envSchema.parse(source);
}

let cached: Env | null = null;

// Lazy so `next build` doesn't require env vars at import time.
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}

// Test-only: clears the cache so getEnv tests are isolated.
export function resetEnvCacheForTesting(): void {
  cached = null;
}
