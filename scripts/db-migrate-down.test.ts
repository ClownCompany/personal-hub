import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { MESSAGES } from "./db-migrate-guard.mjs";

const SECRET = "s3cr3t-pa55";

// DATABASE_URL comes from the test's env, so no `--env-file-if-exists` here: without a .env file Node prints a notice to stderr that would break the exact-output assertions.
function runDown(databaseUrl: string, ...args: string[]) {
  const result = spawnSync(
    process.execPath,
    ["scripts/db-migrate-down.mjs", ...args],
    {
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: databaseUrl },
      timeout: 15_000,
    },
  );
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

// Any output from the migration CLI would differ from this single static line.
function expectRefusedOnly(
  result: ReturnType<typeof runDown>,
  secrets: string[],
) {
  expect(result.status).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toMatch(/^db:migrate:down refused: [^\n]+\n$/);
  for (const secret of secrets) expect(result.stderr).not.toContain(secret);
}

describe("scripts/db-migrate-down.mjs", () => {
  it("refuses a remote host without running the migration CLI", () => {
    const url = `postgres://admin:${SECRET}@db.example.com:5432/personal_hub_test`;
    expectRefusedOnly(runDown(url), [SECRET, "admin", "db.example.com"]);
  });

  it("refuses another database name on a local host", () => {
    const url = `postgres://admin:${SECRET}@localhost:5432/forbidden_db`;
    expectRefusedOnly(runDown(url), [SECRET, "admin", "forbidden_db"]);
  });

  it("refuses an empty DATABASE_URL", () => {
    expectRefusedOnly(runDown(""), []);
  });

  it("refuses CLI options that could redirect it, even for a local URL", () => {
    const url = `postgres://admin:${SECRET}@localhost:5432/personal_hub`;
    expectRefusedOnly(runDown(url, "-d", "OTHER_URL"), [SECRET, "OTHER_URL"]);
  });
});

// A local port nothing listens on: if a case slips past the guard, the CLI cannot reach any database.
const UNREACHABLE = `postgres://admin:${SECRET}@127.0.0.1:1/x_test`;

function expectStaticRefusal(
  result: ReturnType<typeof runDown>,
  message: string,
) {
  expect(result.status).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toBe(`db:migrate:down refused: ${message}\n`);
}

describe("scripts/db-migrate-down.mjs: refusals", () => {
  it("refuses when DATABASE_URL is not set at all", () => {
    const env = { ...process.env };
    delete env.DATABASE_URL;
    // A developer's .env must not supply a URL here either.
    const result = spawnSync(
      process.execPath,
      ["scripts/db-migrate-down.mjs"],
      { encoding: "utf8", env, timeout: 15_000 },
    );
    expectStaticRefusal(result, MESSAGES.missing);
  });

  it.each([
    [
      "a query parameter that redirects the connection",
      `postgres://admin:${SECRET}@localhost:1/x_test?host=db.example.com`,
      MESSAGES.invalid,
    ],
    [
      "a fragment",
      `postgres://admin:${SECRET}@localhost:1/x_test#x`,
      MESSAGES.invalid,
    ],
    [
      "an invalid escape",
      `postgres://admin:100%@localhost:1/x_test`,
      MESSAGES.invalid,
    ],
    [
      "a userinfo trick that ends on a remote host",
      `postgres://admin:${SECRET}@localhost:1@db.example.com/x_test`,
      MESSAGES.remote,
    ],
    [
      "a remote postgresql:// URL",
      `postgresql://admin:${SECRET}@db.example.com:1/x_test`,
      MESSAGES.remote,
    ],
    [
      "a database name that only resembles the dev name",
      `postgres://admin:${SECRET}@127.0.0.1:1/personal_hub2`,
      MESSAGES.database,
    ],
    [
      "an uppercase dev database name",
      `postgres://admin:${SECRET}@127.0.0.1:1/Personal_Hub`,
      MESSAGES.database,
    ],
    [
      "a bare _test database name",
      `postgres://admin:${SECRET}@127.0.0.1:1/_test`,
      MESSAGES.database,
    ],
    [
      "no user (PGUSER would apply)",
      `postgres://127.0.0.1:1/x_test`,
      MESSAGES.user,
    ],
    [
      "an empty user (PGUSER would apply)",
      `postgres://:${SECRET}@127.0.0.1:1/x_test`,
      MESSAGES.user,
    ],
    [
      "no port (PGPORT would apply)",
      `postgres://admin:${SECRET}@127.0.0.1/x_test`,
      MESSAGES.port,
    ],
    [
      "an empty port (PGPORT would apply)",
      `postgres://admin:${SECRET}@127.0.0.1:/x_test`,
      MESSAGES.port,
    ],
  ])("refuses %s with a static message", (_label, url, message) => {
    const result = runDown(url);
    expectStaticRefusal(result, message);
    expect(result.stderr).not.toContain(SECRET);
    expect(result.stderr).not.toContain("db.example.com");
  });

  it.each([
    [["--dry-run", "--dry-run"]],
    [["--"]],
    [["-d", "OTHER_URL"]],
    [["-f", "other.json"]],
    [["--envPath", "other.env"]],
    [["--envPath=other.env"]],
    [["0"]],
    [["-1"]],
    [["1.5"]],
    [["1", "2"]],
  ])("refuses the arguments %j for a valid URL", (args) => {
    const result = runDown(UNREACHABLE, ...args);
    // The exact-line check also rules out any echo of the arguments.
    expectStaticRefusal(result, MESSAGES.args);
  });

  it("reports the URL problem first when both the URL and the arguments are bad", () => {
    const url = `postgres://admin:${SECRET}@db.example.com:1/x_test`;
    expectStaticRefusal(runDown(url, "-d", "OTHER_URL"), MESSAGES.remote);
  });
});

describe("scripts/db-migrate-down.mjs: accepted input", () => {
  it.each([[[]], [["1"]], [["--dry-run"]], [["2", "--dry-run"]]])(
    "hands %j over to the migration CLI for a local _test URL",
    (args) => {
      const result = runDown(UNREACHABLE, ...args);
      // The CLI fails to connect, which proves it was called; it must not fail the guard.
      expect(result.stderr).not.toMatch(/db:migrate:down refused/);
      expect(result.status).not.toBe(0);
      expect(result.stdout + result.stderr).not.toContain(SECRET);
    },
  );
});
