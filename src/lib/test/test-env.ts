import { z } from "zod";

const NAME_PATTERN = /^[A-Za-z0-9_]+_test$/;
const MAX_NAME_BYTES = 63;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
// pg-connection-string turns every other query parameter into a driver option (host, port, user, ...).
const SSL_MODES = new Set([
  "disable",
  "prefer",
  "require",
  "verify-ca",
  "verify-full",
  "no-verify",
]);
// Only used for DATABASE_URL, which may omit the port; TEST_DATABASE_URL must state it.
const DEFAULT_PORT = "5432";
// The driver re-encodes the whole URL when it sees a `%` that is not a valid escape.
const INVALID_ESCAPE = /%(?![0-9A-Fa-f]{2})/;

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export function isTestDatabaseName(name: string): boolean {
  return NAME_PATTERN.test(name) && Buffer.byteLength(name) <= MAX_NAME_BYTES;
}

// Host, port and database as the driver would resolve them; local hosts count as one server.
function connectionTarget(url: URL): string {
  const rawHost = url.searchParams.get("host") || url.hostname;
  const host = rawHost.replace(/^\[(.+)\]$/, "$1").toLowerCase();
  const isLocal =
    host === "" ||
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.startsWith("/");
  const port = url.searchParams.get("port") || url.port || DEFAULT_PORT;
  let name = url.pathname.slice(1);
  try {
    name = decodeURI(name);
  } catch {
    // Keep the raw name; it can only make the comparison stricter.
  }
  return [isLocal ? "local" : host, port, name.replace(/\/+$/, "")].join("|");
}

function isSameDatabase(testUrl: string, databaseUrl: string): boolean {
  if (testUrl === databaseUrl) return true;
  const test = parseUrl(testUrl);
  const database = parseUrl(databaseUrl);
  if (test === null || database === null) return false;
  return connectionTarget(test) === connectionTarget(database);
}

function hasOnlyAllowedQuery(url: URL): boolean {
  // Valid sslmode values never need escapes.
  if (url.search.includes("%")) return false;
  for (const [key, value] of url.searchParams) {
    if (key !== "sslmode" || !SSL_MODES.has(value)) return false;
  }
  return true;
}

// Test-only; kept out of the app envSchema. Messages must never echo a URL.
const testEnvSchema = z
  .object({
    TEST_DATABASE_URL: z
      .string({ error: "TEST_DATABASE_URL is required (see .env.example)" })
      .min(1, "TEST_DATABASE_URL is required (see .env.example)")
      .refine(
        (value) =>
          value.startsWith("postgres://") || value.startsWith("postgresql://"),
        "TEST_DATABASE_URL must be a postgres:// URL",
      )
      .refine(
        (value) => !/[\s\u0000-\u001f\u007f]/.test(value),
        "TEST_DATABASE_URL must not contain whitespace or control characters",
      ),
    DATABASE_URL: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    const issue = (message: string) =>
      ctx.addIssue({ code: "custom", path: ["TEST_DATABASE_URL"], message });

    if (
      env.DATABASE_URL !== undefined &&
      isSameDatabase(env.TEST_DATABASE_URL, env.DATABASE_URL)
    ) {
      issue("TEST_DATABASE_URL must differ from DATABASE_URL");
      return;
    }
    if (INVALID_ESCAPE.test(env.TEST_DATABASE_URL)) {
      issue("TEST_DATABASE_URL must not contain an invalid percent-escape");
    }
    const url = parseUrl(env.TEST_DATABASE_URL);
    if (url === null || getDatabaseName(env.TEST_DATABASE_URL) === null) {
      issue(
        "TEST_DATABASE_URL must point to a database whose name ends in _test " +
          `(letters, digits and underscores only, at most ${MAX_NAME_BYTES} bytes)`,
      );
    }
    if (url === null) return;
    // An empty port or user would silently fall back to PGPORT/PGUSER in the driver.
    if (url.port === "") {
      issue(
        "TEST_DATABASE_URL must include an explicit port (PG* environment variables are not supported)",
      );
    }
    if (url.username === "") {
      issue(
        "TEST_DATABASE_URL must include a user name (PG* environment variables are not supported)",
      );
    }
    if (!LOCAL_HOSTS.has(url.hostname)) {
      issue(
        "TEST_DATABASE_URL must use a local host (localhost, 127.0.0.1 or [::1])",
      );
    }
    if (env.TEST_DATABASE_URL.includes("#") || !hasOnlyAllowedQuery(url)) {
      issue(
        "TEST_DATABASE_URL must not contain a fragment or query parameters other than a plain sslmode (valid value, no percent-escapes)",
      );
    }
  });

// Returns the name only if it is a valid test database name; it is not decoded,
// so the validated name is exactly the one the driver connects to.
export function getDatabaseName(url: string): string | null {
  const parsed = parseUrl(url);
  if (parsed === null || parsed.pathname.includes("%")) return null;
  const name = parsed.pathname.slice(1);
  return isTestDatabaseName(name) ? name : null;
}

// Same server, maintenance database; used to check reachability and create the test DB.
export function toMaintenanceUrl(url: string): string {
  const maintenance = new URL(url);
  maintenance.pathname = "/postgres";
  return maintenance.toString();
}

export function parseTestEnv(source: Record<string, string | undefined>): {
  TEST_DATABASE_URL: string;
  databaseName: string;
} {
  const { TEST_DATABASE_URL } = testEnvSchema.parse(source);
  // The schema guarantees a valid name.
  return {
    TEST_DATABASE_URL,
    databaseName: getDatabaseName(TEST_DATABASE_URL) as string,
  };
}
