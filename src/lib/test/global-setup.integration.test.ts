import { Client } from "pg";
import { afterEach, describe, expect, inject, it, vi } from "vitest";
import type { TestProject } from "vitest/node";
import setup from "@/lib/test/global-setup";
import { toMaintenanceUrl } from "@/lib/test/test-env";

const DEV_URL = "postgres://dev:devsecret@localhost:5432/personal_hub";

function fakeProject(): { project: TestProject; provided: [string, string][] } {
  const provided: [string, string][] = [];
  const project = {
    provide: (key: string, value: string) => provided.push([key, value]),
  } as unknown as TestProject;
  return { project, provided };
}

function withDatabase(url: string, name: string): string {
  const copy = new URL(url);
  copy.pathname = `/${name}`;
  return copy.toString();
}

async function withMaintenanceClient<T>(
  url: string,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({ connectionString: toMaintenanceUrl(url) });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function rejectionOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return String(error);
  }
  throw new Error("expected the promise to reject");
}

describe("global setup", () => {
  const baseUrl = inject("testDatabaseUrl");
  const created: string[] = [];

  afterEach(async () => {
    vi.unstubAllEnvs();
    for (const name of created.splice(0)) {
      await withMaintenanceClient(baseUrl, (client) =>
        client.query(
          `drop database if exists ${client.escapeIdentifier(name)} with (force)`,
        ),
      );
    }
  });

  function useEnv(testUrl: string, databaseUrl: string = DEV_URL): void {
    vi.stubEnv("TEST_DATABASE_URL", testUrl);
    vi.stubEnv("DATABASE_URL", databaseUrl);
  }

  function scratchName(): string {
    const name = `hub_gs_${process.pid}_${Date.now()}_test`;
    created.push(name);
    return name;
  }

  it("provides the test database URL to the tests", async () => {
    useEnv(baseUrl);
    const { project, provided } = fakeProject();
    await setup(project);
    expect(provided).toEqual([["testDatabaseUrl", baseUrl]]);
  });

  it("is idempotent when the database and migrations already exist", async () => {
    useEnv(baseUrl);
    await setup(fakeProject().project);
    await expect(setup(fakeProject().project)).resolves.toBeUndefined();
  });

  it("creates a missing database and applies the migration bookkeeping", async () => {
    const name = scratchName();
    const url = withDatabase(baseUrl, name);
    useEnv(url);

    await setup(fakeProject().project);

    const exists = await withMaintenanceClient(baseUrl, (client) =>
      client.query("select 1 from pg_database where datname = $1", [name]),
    );
    expect(exists.rowCount).toBe(1);
    const scratch = new Client({ connectionString: url });
    await scratch.connect();
    try {
      const { rows } = await scratch.query(
        "select 1 from pg_tables where schemaname = 'public' and tablename = 'pgmigrations'",
      );
      expect(rows).toHaveLength(1);
    } finally {
      await scratch.end();
    }
  });

  it("rejects an invalid environment before connecting", async () => {
    useEnv(withDatabase(baseUrl, "not_a_test_db"));
    const { project, provided } = fakeProject();
    const message = await rejectionOf(setup(project));
    expect(message).toMatch(/ends in _test/);
    expect(provided).toEqual([]);
  });

  it("rejects a TEST_DATABASE_URL equal to DATABASE_URL", async () => {
    useEnv(baseUrl, baseUrl);
    const { project, provided } = fakeProject();
    expect(await rejectionOf(setup(project))).toMatch(
      /must differ from DATABASE_URL/,
    );
    expect(provided).toEqual([]);
  });

  it("fails with a hint when the server is unreachable, without echoing the URL", async () => {
    const url = "postgres://user:unreachsecret@127.0.0.1:1/unreachable_test";
    useEnv(url);
    const { project, provided } = fakeProject();
    const message = await rejectionOf(setup(project));
    expect(message).toMatch(/Cannot connect to the PostgreSQL server/);
    expect(message).toMatch(/npm run db:up/);
    expect(message).not.toContain("unreachsecret");
    expect(message).not.toContain("unreachable_test");
    expect(provided).toEqual([]);
  });

  it("fails with a hint on wrong credentials, without echoing the password", async () => {
    const url = new URL(baseUrl);
    url.password = "wrongsecret";
    useEnv(url.toString());
    const message = await rejectionOf(setup(fakeProject().project));
    expect(message).toMatch(/Cannot connect to the PostgreSQL server/);
    expect(message).not.toContain("wrongsecret");
  });
});
