import { Client } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getDatabaseName,
  isTestDatabaseName,
  parseTestEnv,
  toMaintenanceUrl,
} from "@/lib/test/test-env";

const DEV = "postgres://user:devsecret@localhost:5432/personal_hub";
const TEST = "postgres://user:testsecret@localhost:5432/personal_hub_test";

function messageOf(source: Record<string, string | undefined>): string {
  try {
    parseTestEnv(source);
  } catch (error) {
    return String(error);
  }
  throw new Error("expected parseTestEnv to throw");
}

interface DriverView {
  user: string;
  password: string;
  host: string;
  port: number;
  database: string;
}

// What the real driver resolves from the URL; construction does not connect.
function driverView(url: string): DriverView {
  return new Client({ connectionString: url }) as unknown as DriverView;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("parseTestEnv", () => {
  it("returns the URL and the database name", () => {
    expect(
      parseTestEnv({ TEST_DATABASE_URL: TEST, DATABASE_URL: DEV }),
    ).toEqual({ TEST_DATABASE_URL: TEST, databaseName: "personal_hub_test" });
  });

  it("accepts a missing DATABASE_URL", () => {
    expect(parseTestEnv({ TEST_DATABASE_URL: TEST }).databaseName).toBe(
      "personal_hub_test",
    );
  });

  it("throws when TEST_DATABASE_URL is missing or empty", () => {
    expect(() => parseTestEnv({ DATABASE_URL: DEV })).toThrow();
    expect(() => parseTestEnv({ TEST_DATABASE_URL: "" })).toThrow();
  });

  it("throws when TEST_DATABASE_URL is not a postgres URL", () => {
    const message = messageOf({
      TEST_DATABASE_URL: "mysql://user:mysecret@host/db_test",
    });
    expect(message).toMatch(/postgres:\/\//);
    expect(message).not.toContain("mysecret");
  });

  it("rejects a URL equal to DATABASE_URL without echoing it", () => {
    const message = messageOf({ TEST_DATABASE_URL: TEST, DATABASE_URL: TEST });
    expect(message).toMatch(/must differ from DATABASE_URL/);
    expect(message).not.toContain("testsecret");
    expect(message).not.toContain("personal_hub_test");
  });

  it("rejects a database name that does not end in _test without echoing it", () => {
    const message = messageOf({ TEST_DATABASE_URL: DEV, DATABASE_URL: TEST });
    expect(message).toMatch(/ends in _test/);
    expect(message).not.toContain("devsecret");
    expect(message).not.toContain("personal_hub");
  });

  it("rejects a URL without a database name", () => {
    const message = messageOf({
      TEST_DATABASE_URL: "postgres://user:nosecret@localhost:5432",
    });
    expect(message).toMatch(/ends in _test/);
    expect(message).not.toContain("nosecret");
  });

  it("rejects an unparsable URL without echoing it", () => {
    const message = messageOf({ TEST_DATABASE_URL: "postgres://[bad:secret" });
    expect(message).toMatch(/ends in _test/);
    expect(message).not.toContain("secret");
  });

  it("requires TEST_DATABASE_URL with a helpful message", () => {
    expect(messageOf({ DATABASE_URL: DEV })).toMatch(/is required/);
    expect(messageOf({ TEST_DATABASE_URL: "" })).toMatch(/is required/);
  });

  it.each([
    ["postgres", "postgres://u:p@localhost:5432/db_test"],
    ["postgresql", "postgresql://u:p@localhost:5432/db_test"],
    ["127.0.0.1", "postgres://u:p@127.0.0.1:5432/db_test"],
    ["an IPv6 loopback host", "postgres://u:p@[::1]:5432/db_test"],
    ["an encoded password", "postgres://u:p%40ss@localhost:5432/db_test"],
    [
      "sslmode=disable",
      "postgres://u:p@localhost:5432/db_test?sslmode=disable",
    ],
    [
      "sslmode=require",
      "postgres://u:p@localhost:5432/db_test?sslmode=require",
    ],
    [
      "a repeated sslmode with valid values",
      "postgres://u:p@localhost:5432/db_test?sslmode=disable&sslmode=require",
    ],
    ["mixed case and digits", "postgres://u:p@localhost:5432/Db_9_test"],
    [
      "a name that is 63 bytes long",
      `postgres://u:p@localhost:5432/${"a".repeat(58)}_test`,
    ],
    [
      "the fully expanded IPv6 loopback with a port",
      "postgres://u:p@[0:0:0:0:0:0:0:1]:5432/db_test",
    ],
    ["a backslash in the userinfo", "postgres://u\\v:p@localhost:5432/db_test"],
    [
      "a backslash before the last @ (still the userinfo)",
      "postgres://u:p@evil.host\\@localhost:5432/db_test",
    ],
    [
      "a dot-segment that resolves to the same name (driver and validator agree)",
      "postgres://u:p@localhost:5432/a/../db_test",
    ],
  ])("accepts %s", (_label, url) => {
    expect(parseTestEnv({ TEST_DATABASE_URL: url }).TEST_DATABASE_URL).toBe(
      url,
    );
  });

  it.each([
    ["an uppercase suffix", "postgres://u:xsecret@localhost/db_TEST"],
    ["a mixed-case suffix", "postgres://u:xsecret@localhost/db_Test"],
    ["a trailing slash", "postgres://u:xsecret@localhost/db_test/"],
    ["a trailing encoded space", "postgres://u:xsecret@localhost/db_test%20"],
    ["a trailing encoded newline", "postgres://u:xsecret@localhost/db_test%0A"],
    ["an encoded underscore", "postgres://u:xsecret@localhost/db%5Ftest"],
    ["an encoded slash", "postgres://u:xsecret@localhost/a%2Fb_test"],
    ["an encoded NUL", "postgres://u:xsecret@localhost/db%00_test"],
    ["a bare percent sign", "postgres://u:xsecret@localhost/db%_test"],
    ["a slash inside the name", "postgres://u:xsecret@localhost/a/b_test"],
    ["a dash", "postgres://u:xsecret@localhost/my-db_test"],
    ["a non-ASCII character", "postgres://u:xsecret@localhost/dä_test"],
    ["a name that is exactly _test", "postgres://u:xsecret@localhost/_test"],
    [
      "a name longer than 63 bytes",
      `postgres://u:xsecret@localhost/${"a".repeat(59)}_test`,
    ],
    [
      "a suffix in the query only",
      "postgres://u:xsecret@localhost/db?sslmode=disable&name=x_test",
    ],
    ["a suffix in the host only", "postgres://u:xsecret@x_test/db"],
    ["a suffix in the password only", "postgres://u:x_test@localhost/db"],
    ["a name without underscore", "postgres://u:xsecret@localhost/dbtest"],
    ["a name ending in _test_", "postgres://u:xsecret@localhost/db_test_"],
    ["a root path only", "postgres://u:xsecret@localhost/"],
    [
      "a malformed percent escape",
      "postgres://u:xsecret@localhost/db%E0%A4%A_test",
    ],
  ])("rejects %s without echoing it", (_label, url) => {
    const message = messageOf({ TEST_DATABASE_URL: url });
    expect(message).toMatch(/ends in _test/);
    expect(message).not.toContain("xsecret");
  });

  it.each([
    ["a remote host", "postgres://u:xsecret@db.example.com:5432/app_test"],
    ["a remote IP", "postgres://u:xsecret@10.0.0.5/app_test"],
    ["an unusual IPv4 spelling", "postgres://u:xsecret@127.1/app_test"],
    ["an uppercase localhost", "postgres://u:xsecret@LOCALHOST/app_test"],
    ["a trailing dot", "postgres://u:xsecret@localhost./app_test"],
    ["another IPv6 host", "postgres://u:xsecret@[2001:db8::1]/app_test"],
    ["an encoded socket host", "postgres://u:xsecret@%2Ftmp/app_test"],
    ["an empty host", "postgres:///app_test"],
    [
      "localhost in the userinfo only",
      "postgres://localhost:xsecret@db.example.com/app_test",
    ],
  ])("rejects %s as a non-local host without echoing it", (_label, url) => {
    const message = messageOf({ TEST_DATABASE_URL: url });
    expect(message).toMatch(/must use a local host/);
    expect(message).not.toContain("xsecret");
    expect(message).not.toContain("example.com");
  });

  it("rejects an empty host with credentials (unparsable URL)", () => {
    const message = messageOf({
      TEST_DATABASE_URL: "postgres://u:xsecret@:5432/app_test",
    });
    expect(message).not.toContain("xsecret");
  });

  it.each([
    ["no port", "postgres://u:xsecret@localhost/app_test"],
    ["an empty port", "postgres://u:xsecret@localhost:/app_test"],
    [
      "no port with sslmode",
      "postgres://u:xsecret@[::1]/app_test?sslmode=disable",
    ],
  ])("rejects %s because PGPORT would apply", (_label, url) => {
    const message = messageOf({ TEST_DATABASE_URL: url });
    expect(message).toMatch(/explicit port/);
    expect(message).not.toContain("xsecret");
    expect(message).not.toContain("app_test");
  });

  it.each([
    ["no userinfo", "postgres://localhost:5432/app_test"],
    ["an empty user", "postgres://:xsecret@localhost:5432/app_test"],
  ])("rejects %s because PGUSER would apply", (_label, url) => {
    const message = messageOf({ TEST_DATABASE_URL: url });
    expect(message).toMatch(/user name/);
    expect(message).not.toContain("xsecret");
  });

  it("documents the fallback: the driver takes PGPORT and PGUSER for empty parts", () => {
    vi.stubEnv("PGPORT", "9999");
    vi.stubEnv("PGUSER", "envuser");
    const open = driverView("postgres://localhost/app_test");
    expect([open.port, open.user]).toEqual([9999, "envuser"]);
    const explicit = driverView("postgres://u:p@localhost:5432/app_test");
    expect([explicit.port, explicit.user]).toEqual([5432, "u"]);
  });

  it("accepts an empty password (PGPASSWORD cannot redirect the connection)", () => {
    expect(() =>
      parseTestEnv({
        TEST_DATABASE_URL: "postgres://u@localhost:5432/app_test",
      }),
    ).not.toThrow();
  });

  it("accepts evil.host in the userinfo; the driver connects to localhost", () => {
    const url = "postgres://u:p@evil.host:5432@localhost:5432/x_test";
    expect(parseTestEnv({ TEST_DATABASE_URL: url }).databaseName).toBe(
      "x_test",
    );
    const driver = driverView(url);
    expect([driver.host, driver.port, driver.user, driver.database]).toEqual([
      "localhost",
      5432,
      "u",
      "x_test",
    ]);
    expect(driver.password).toBe("p@evil.host:5432");
  });

  it("rejects a backslash that moves the host to the real remote host", () => {
    const url = "postgres://u:p@localhost\\@evil.host:5432/x_test";
    expect(driverView(url).host).toBe("evil.host");
    expect(messageOf({ TEST_DATABASE_URL: url })).toMatch(/local host/);
  });

  it("agrees with the driver on a backslash in the userinfo", () => {
    const driver = driverView("postgres://u\\v:p@localhost:5432/x_test");
    expect([driver.user, driver.host]).toEqual(["u\\v", "localhost"]);
  });

  it("agrees with the driver on a dot-segment path that resolves to the test name", () => {
    const url = "postgres://u:p@localhost:5432/a/../x_test";
    expect(getDatabaseName(url)).toBe("x_test");
    expect(driverView(url).database).toBe("x_test");
  });

  it("rejects a dot-segment path that resolves to the root (the driver would use the user name)", () => {
    const url = "postgres://u:p@localhost:5432/x_test/..";
    expect(getDatabaseName(url)).toBeNull();
    expect(driverView(url).database).toBe("u");
    expect(messageOf({ TEST_DATABASE_URL: url })).toMatch(/ends in _test/);
  });

  it("agrees with the driver on an encoded dot-segment (the URL parser resolves it)", () => {
    const url = "postgres://u:p@localhost:5432/a/%2e%2e/x_test";
    expect(parseTestEnv({ TEST_DATABASE_URL: url }).databaseName).toBe(
      "x_test",
    );
    expect(driverView(url).database).toBe("x_test");
  });

  it("agrees with the driver on the expanded IPv6 loopback", () => {
    const url = "postgres://u:p@[0:0:0:0:0:0:0:1]:5432/x_test";
    expect(driverView(url).host).toBe("::1");
    expect(toMaintenanceUrl(url)).toBe("postgres://u:p@[::1]:5432/postgres");
  });

  it("accepts a valid %40 in the password and the driver decodes it", () => {
    const url = "postgres://u:p%40ss@localhost:5432/x_test";
    expect(parseTestEnv({ TEST_DATABASE_URL: url }).TEST_DATABASE_URL).toBe(
      url,
    );
    expect(driverView(url).password).toBe("p@ss");
  });

  it.each([
    ["in the password", "postgres://u:p%zz@localhost:5432/x_test"],
    ["in the user", "postgres://u%zz:p@localhost:5432/x_test"],
    [
      "with a trailing percent sign",
      "postgres://u:xsecret@localhost:5432/x_test%",
    ],
    ["with a single digit", "postgres://u:xsecret@localhost:5432/x_test%4"],
    [
      "in the query",
      "postgres://u:xsecret@localhost:5432/x_test?sslmode=disable&a=%z",
    ],
    [
      "next to a bracketed IPv6 host",
      "postgres://u:xsecret%zz@[::1]:5432/x_test",
    ],
    [
      "in the path next to a bracketed IPv6 host",
      "postgres://u:xsecret@[::1]:5432/x_test%zz",
    ],
  ])("rejects an invalid percent-escape %s", (_label, url) => {
    const message = messageOf({ TEST_DATABASE_URL: url });
    expect(message).toMatch(/invalid percent-escape/);
    expect(message).not.toContain("xsecret");
  });

  it("never lets the driver re-encode a URL that passes validation", () => {
    // The driver only runs encodeURI when it sees a space or an invalid escape.
    const url = "postgres://u:p%40ss@localhost:5432/x_test?sslmode=disable";
    expect(parseTestEnv({ TEST_DATABASE_URL: url })).toBeDefined();
    expect(/ |%[^a-f0-9]|%[a-f0-9][^a-f0-9]/i.test(url)).toBe(false);
  });

  it.each([
    ["an encoded value", "?sslmode=%64isable"],
    [
      "an encoded value after a valid one",
      "?sslmode=disable&sslmode=requir%65",
    ],
    ["an encoded equals sign", "?sslmode%3Ddisable"],
    ["a trailing percent sign", "?sslmode=disable%"],
  ])("rejects a percent sign in the query: %s", (_label, suffix) => {
    const message = messageOf({
      TEST_DATABASE_URL: `postgres://u:xsecret@localhost:5432/db_test${suffix}`,
    });
    expect(message).toMatch(/fragment or query parameters/);
    expect(message).not.toContain("xsecret");
  });

  it.each([
    ["host", "?host=prod.example.com"],
    ["port", "?port=5999"],
    ["user", "?user=admin"],
    ["password", "?password=other"],
    ["dbname", "?dbname=prod"],
    ["options", "?options=-c%20search_path%3Dx"],
    ["sslrootcert", "?sslrootcert=/etc/ssl/ca.pem"],
    ["an unknown sslmode value", "?sslmode=bogus"],
    ["a repeated sslmode with a bad value", "?sslmode=disable&sslmode=bogus"],
    ["sslmode plus another parameter", "?sslmode=disable&host=prod"],
    ["an encoded parameter name", "?h%6Fst=prod.example.com"],
    ["a fragment", "#frag"],
    ["an empty fragment", "#"],
    ["a fragment after sslmode", "?sslmode=disable#frag"],
  ])("rejects %s in the query or fragment", (_label, suffix) => {
    const message = messageOf({
      TEST_DATABASE_URL: `postgres://u:xsecret@localhost:5432/db_test${suffix}`,
    });
    expect(message).toMatch(/fragment or query parameters/);
    expect(message).not.toContain("xsecret");
    expect(message).not.toContain("example.com");
  });

  it("rejects the ?host= redirect to another server", () => {
    expect(
      messageOf({
        TEST_DATABASE_URL:
          "postgres://u:p@localhost/x_test?host=prod.example.com",
      }),
    ).toMatch(/fragment or query parameters/);
  });

  it.each([
    ["a space", "postgres://u:xsecret@localhost/db_test x"],
    ["a newline", "postgres://u:xsecret@localhost/db_test\nx"],
    ["a trailing newline", "postgres://u:xsecret@localhost/db_test\n"],
    ["a tab", "postgres://u:xsecret@localhost/db_test\t"],
    ["a NUL", "postgres://u:xsecret@localhost/db_test\u0000"],
  ])("rejects %s without echoing it", (_label, url) => {
    const message = messageOf({ TEST_DATABASE_URL: url });
    expect(message).toMatch(/whitespace or control characters/);
    expect(message).not.toContain("xsecret");
  });

  it.each([
    ["a leading space", " postgres://h/db_test"],
    ["an uppercase scheme", "POSTGRES://h/db_test"],
    ["another scheme", "http://h/db_test"],
    ["no scheme", "h/db_test"],
    ["only the scheme prefix of another word", "postgresx://h/db_test"],
  ])("rejects %s as not a postgres URL", (_label, url) => {
    expect(messageOf({ TEST_DATABASE_URL: url })).toMatch(/postgres:\/\//);
  });

  it.each([
    [
      "127.0.0.1 instead of localhost",
      "postgres://x:y@127.0.0.1:5432/hub_test",
    ],
    ["[::1] instead of localhost", "postgres://x:y@[::1]:5432/hub_test"],
    [
      "an omitted default port (the clash is reported before the missing port)",
      "postgres://x:y@localhost/hub_test",
    ],
    ["a different user", "postgres://other:pw@localhost:5432/hub_test"],
    [
      "a query string",
      "postgres://x:y@localhost:5432/hub_test?sslmode=disable",
    ],
  ])("rejects the same database as DATABASE_URL via %s", (_label, url) => {
    const message = messageOf({
      TEST_DATABASE_URL: url,
      DATABASE_URL: "postgres://u:dbsecret@localhost:5432/hub_test",
    });
    expect(message).toMatch(/must differ from DATABASE_URL/);
    expect(message).not.toContain("dbsecret");
  });

  it.each([
    ["a trailing slash", "postgres://u:p@localhost:5432/hub_test/"],
    ["an empty host", "postgres:///hub_test"],
    [
      "a host query parameter",
      "postgres://u:p@db.example.com/hub_test?host=localhost",
    ],
    ["an uppercase host", "postgres://u:p@LOCALHOST:5432/hub_test"],
    ["an omitted default port", "postgres://u:p@localhost/hub_test"],
    [
      "an explicit default port in the port parameter",
      "postgres://u:p@localhost/hub_test?port=5432",
    ],
  ])(
    "detects a DATABASE_URL that differs only by %s",
    (_label, databaseUrl) => {
      const message = messageOf({
        TEST_DATABASE_URL: "postgres://x:y@127.0.0.1:5432/hub_test",
        DATABASE_URL: databaseUrl,
      });
      expect(message).toMatch(/must differ from DATABASE_URL/);
    },
  );

  it("accepts a DATABASE_URL on another port, host or database", () => {
    const test = {
      TEST_DATABASE_URL: "postgres://x:y@localhost:5432/hub_test",
    };
    for (const databaseUrl of [
      "postgres://x:y@localhost:5433/hub_test",
      "postgres://x:y@db.example.com:5432/hub_test",
      "postgres://x:y@localhost:5432/hub",
      "not a url",
    ]) {
      expect(() =>
        parseTestEnv({ ...test, DATABASE_URL: databaseUrl }),
      ).not.toThrow();
    }
  });

  it("treats an empty DATABASE_URL as different", () => {
    expect(() =>
      parseTestEnv({ TEST_DATABASE_URL: TEST, DATABASE_URL: "" }),
    ).not.toThrow();
  });

  it("reports the DATABASE_URL clash first when the name is also wrong", () => {
    const message = messageOf({ TEST_DATABASE_URL: DEV, DATABASE_URL: DEV });
    expect(message).toMatch(/must differ from DATABASE_URL/);
    expect(message).not.toMatch(/ends in _test/);
    expect(message).not.toContain("devsecret");
  });

  it("ignores unrelated variables", () => {
    expect(
      parseTestEnv({ TEST_DATABASE_URL: TEST, OTHER: "x" }).databaseName,
    ).toBe("personal_hub_test");
  });
});

describe("isTestDatabaseName", () => {
  it.each(["a_test", "Hub_1_test", `${"a".repeat(58)}_test`])(
    "accepts %s",
    (name) => {
      expect(isTestDatabaseName(name)).toBe(true);
    },
  );

  it.each([
    "",
    "_test",
    "db",
    "db_Test",
    "db_test\n",
    "db\u0000_test",
    "a-b_test",
    "a b_test",
    "dä_test",
    `${"a".repeat(59)}_test`,
  ])("rejects %j", (name) => {
    expect(isTestDatabaseName(name)).toBe(false);
  });
});

describe("getDatabaseName", () => {
  it("returns the validated name", () => {
    expect(getDatabaseName("postgres://h/my_db_test")).toBe("my_db_test");
    expect(getDatabaseName("postgres://h/Db_9_test")).toBe("Db_9_test");
  });

  it("returns null for an invalid URL", () => {
    expect(getDatabaseName("nonsense")).toBeNull();
    expect(getDatabaseName("")).toBeNull();
  });

  it("returns null for any percent sign in the path", () => {
    expect(getDatabaseName("postgres://h/my%20db_test")).toBeNull();
    expect(getDatabaseName("postgres://h/db%5Ftest")).toBeNull();
    expect(getDatabaseName("postgres://h/a%2Fb_test")).toBeNull();
    expect(getDatabaseName("postgres://h/db%00_test")).toBeNull();
    expect(getDatabaseName("postgres://h/db%E0%A4%A_test")).toBeNull();
  });

  it("returns null when there is no database or no _test suffix", () => {
    expect(getDatabaseName("postgres://h")).toBeNull();
    expect(getDatabaseName("postgres://h/")).toBeNull();
    expect(getDatabaseName("postgres://h/db")).toBeNull();
    expect(getDatabaseName("postgres://h/_test")).toBeNull();
  });

  it("ignores query and fragment", () => {
    expect(getDatabaseName("postgres://h/db_test?sslmode=require#x")).toBe(
      "db_test",
    );
  });

  it("is case sensitive and rejects a trailing slash", () => {
    expect(getDatabaseName("postgres://h/db_TEST")).toBeNull();
    expect(getDatabaseName("postgres://h/db_test/")).toBeNull();
  });

  it("rejects names longer than 63 bytes", () => {
    expect(getDatabaseName(`postgres://h/${"a".repeat(58)}_test`)).toHaveLength(
      63,
    );
    expect(getDatabaseName(`postgres://h/${"a".repeat(59)}_test`)).toBeNull();
  });

  it("works with postgresql://, IPv6 hosts and credentials", () => {
    expect(getDatabaseName("postgresql://u:p%40ss@[::1]:5433/x_test")).toBe(
      "x_test",
    );
  });

  it("returns null for a socket-style URL without a host", () => {
    expect(getDatabaseName("postgres://u@/db_test?host=/tmp")).toBeNull();
  });
});

describe("toMaintenanceUrl", () => {
  it("points at the postgres database and keeps credentials and options", () => {
    expect(toMaintenanceUrl(`${TEST}?sslmode=disable`)).toBe(
      "postgres://user:testsecret@localhost:5432/postgres?sslmode=disable",
    );
  });

  it("replaces the database when there is no query", () => {
    expect(toMaintenanceUrl(TEST)).toBe(
      "postgres://user:testsecret@localhost:5432/postgres",
    );
  });

  it("adds the database when the URL has none", () => {
    expect(toMaintenanceUrl("postgres://h")).toBe("postgres://h/postgres");
    expect(toMaintenanceUrl("postgres://h/")).toBe("postgres://h/postgres");
  });

  it("drops a trailing slash after the database name", () => {
    expect(toMaintenanceUrl("postgres://h/db_test/")).toBe(
      "postgres://h/postgres",
    );
  });

  it("keeps the postgresql:// scheme, IPv6 host and encoded password", () => {
    expect(toMaintenanceUrl("postgresql://u:p%40ss@[::1]:5433/x_test")).toBe(
      "postgresql://u:p%40ss@[::1]:5433/postgres",
    );
  });

  it("keeps multiple query parameters", () => {
    expect(toMaintenanceUrl("postgres://h/db_test?a=1&b=2")).toBe(
      "postgres://h/postgres?a=1&b=2",
    );
  });

  it.each([
    "postgres://u:p%40ss@localhost:5432/x_test",
    "postgres://u:p@evil.host:5432@localhost:5432/x_test",
    "postgres://u\\v:p@localhost:5432/x_test",
    "postgres://u:p@[0:0:0:0:0:0:0:1]:5432/x_test",
    "postgres://u:p@localhost:5432/a/../x_test?sslmode=disable",
  ])("keeps host, port and userinfo for %s", (url) => {
    const original = new URL(url);
    const maintenance = new URL(toMaintenanceUrl(url));
    expect(maintenance.hostname).toBe(original.hostname);
    expect(maintenance.port).toBe(original.port);
    expect(maintenance.username).toBe(original.username);
    expect(maintenance.password).toBe(original.password);
    expect(maintenance.pathname).toBe("/postgres");
    const before = driverView(url);
    const after = driverView(toMaintenanceUrl(url));
    expect([after.host, after.port, after.user, after.password]).toEqual([
      before.host,
      before.port,
      before.user,
      before.password,
    ]);
    expect(after.database).toBe("postgres");
  });

  it("does not mutate or depend on the input string", () => {
    const input = "postgres://h/db_test";
    toMaintenanceUrl(input);
    expect(input).toBe("postgres://h/db_test");
  });

  it("throws for an invalid URL", () => {
    expect(() => toMaintenanceUrl("nonsense")).toThrow();
  });
});
