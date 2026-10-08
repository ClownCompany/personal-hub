import { Pool } from "pg";
import { getEnv } from "@/lib/env";

// On globalThis so dev hot reloads reuse one pool instead of leaking connections.
const globalForDb = globalThis as typeof globalThis & { dbPool?: Pool };

// Lazy so `next build` doesn't require env vars or a database.
export function getPool(): Pool {
  globalForDb.dbPool ??= new Pool({ connectionString: getEnv().DATABASE_URL });
  return globalForDb.dbPool;
}

// Test-only: ends the pool and clears the global so tests are isolated.
export async function closePool(): Promise<void> {
  const pool = globalForDb.dbPool;
  globalForDb.dbPool = undefined;
  await pool?.end();
}
