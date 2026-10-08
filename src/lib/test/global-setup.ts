import { Client } from "pg";
import { runner } from "node-pg-migrate";
import type { TestProject } from "vitest/node";
import { parseTestEnv, toMaintenanceUrl } from "@/lib/test/test-env";

declare module "vitest" {
  interface ProvidedContext {
    testDatabaseUrl: string;
  }
}

// Existing variables (CI) win over .env.
function loadDotEnv(): void {
  try {
    process.loadEnvFile(".env");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

// Only a short error code is forwarded; driver and runner errors can describe the connection.
function codeSuffix(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[A-Za-z0-9_]{1,32}$/.test(code)
    ? ` (${code})`
    : "";
}

// Construction parses the URL and can throw (e.g. URIError), so it is sanitised like connect().
async function connectMaintenanceClient(url: string): Promise<Client> {
  try {
    const client = new Client({
      connectionString: toMaintenanceUrl(url),
      connectionTimeoutMillis: 5000,
    });
    await client.connect();
    return client;
  } catch (error) {
    throw new Error(
      `Cannot connect to the PostgreSQL server${codeSuffix(error)}. ` +
        "Start it with `npm run db:up` and check TEST_DATABASE_URL.",
    );
  }
}

async function ensureTestDatabase(
  url: string,
  databaseName: string,
): Promise<void> {
  const client = await connectMaintenanceClient(url);
  try {
    const { rowCount } = await client.query(
      "select 1 from pg_database where datname = $1",
      [databaseName],
    );
    if (rowCount === 0) {
      await client.query(
        `create database ${client.escapeIdentifier(databaseName)}`,
      );
    }
  } catch (error) {
    throw new Error(
      `Cannot create the test database${codeSuffix(error)}. ` +
        "Check that the TEST_DATABASE_URL user may create databases.",
    );
  } finally {
    await client.end();
  }
}

export default async function setup(project: TestProject): Promise<void> {
  loadDotEnv();
  const { TEST_DATABASE_URL, databaseName } = parseTestEnv(process.env);
  await ensureTestDatabase(TEST_DATABASE_URL, databaseName);
  try {
    await runner({
      databaseUrl: TEST_DATABASE_URL,
      dir: "db/migrations",
      migrationsTable: "pgmigrations",
      direction: "up",
      log: () => {},
    });
  } catch (error) {
    throw new Error(
      `Cannot apply the migrations to the test database${codeSuffix(error)}. ` +
        "Check the files in db/migrations.",
    );
  }
  project.provide("testDatabaseUrl", TEST_DATABASE_URL);
}
