import { afterAll, beforeEach, inject } from "vitest";
import { closePool } from "@/lib/db";
import { resetEnvCacheForTesting } from "@/lib/env";
import { truncateAllTables } from "@/lib/test/db";

// Drop any cached env or pool first so none can still point at another database.
resetEnvCacheForTesting();
await closePool();
// App code reads DATABASE_URL, so pointing it at the test database keeps it off the dev DB.
process.env.DATABASE_URL = inject("testDatabaseUrl");

beforeEach(async () => {
  await truncateAllTables();
});

afterAll(async () => {
  await closePool();
});
