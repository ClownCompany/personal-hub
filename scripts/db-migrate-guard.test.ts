import { Client } from "pg";
import { parse } from "pg-connection-string";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkDatabaseUrl,
  checkDownArgs,
  MESSAGES,
} from "./db-migrate-guard.mjs";

const SECRET = "s3cr3t-pa55";
const DRIVER_KEYS = new Set([
  "host",
  "port",
  "database",
  "user",
  "password",
  "ssl",
  "sslmode",
]);
const FIXED_MESSAGES = Object.values(MESSAGES);

function url(host: string, database: string, suffix = ""): string {
  return `postgres://admin:${SECRET}@${host}/${database}${suffix}`;
}

function refusal(value: string | undefined): string {
  const result = checkDatabaseUrl(value);
  if (result.ok) throw new Error("Expected the URL to be refused");
  return result.message;
}

// What the real driver resolves from the URL; construction does not connect.
function driverView(value: string): { user: string; port: number } {
  return new Client({ connectionString: value }) as unknown as {
    user: string;
    port: number;
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("checkDatabaseUrl", () => {
  it.each([
    ["the dev database", url("localhost:5432", "personal_hub")],
    ["a test database", url("localhost:5432", "personal_hub_test")],
    ["another _test database", url("127.0.0.1:5433", "scratch_ab12_test")],
    ["an IPv6 loopback host", url("[::1]:5432", "personal_hub")],
    [
      "a postgresql:// scheme",
      url("localhost:5432", "personal_hub").replace("postgres", "postgresql"),
    ],
    ["an empty password", "postgres://admin@localhost:5432/personal_hub"],
    [
      "a valid sslmode",
      url("localhost:5432", "personal_hub", "?sslmode=disable"),
    ],
    [
      "an escaped password",
      "postgres://admin:p%40ss@localhost:5432/personal_hub",
    ],
  ])("allows %s", (_label, value) => {
    expect(checkDatabaseUrl(value)).toEqual({ ok: true });
  });

  it("refuses a missing or empty DATABASE_URL", () => {
    expect(refusal(undefined)).toBe(MESSAGES.missing);
    expect(refusal("")).toBe(MESSAGES.missing);
  });

  it.each([
    ["a remote host", url("db.example.com:5432", "personal_hub")],
    [
      "a remote host with a _test database",
      url("db.example.com:5432", "personal_hub_test"),
    ],
    ["a remote IP address", url("10.0.0.5:5432", "personal_hub")],
    ["no host (socket fallback)", `postgres:///personal_hub`],
    [
      "a host spoofed through userinfo",
      `postgres://admin:${SECRET}@localhost:5432@evil.example.com/personal_hub`,
    ],
    [
      "a local-looking subdomain",
      url("localhost.evil.example.com:5432", "personal_hub"),
    ],
    ["an escaped host", url("%6Cocalhost:5432", "personal_hub")],
    ["0.0.0.0", url("0.0.0.0:5432", "personal_hub")],
    ["an uppercase local host", url("LOCALHOST:5432", "personal_hub")],
  ])("refuses %s", (_label, value) => {
    expect(refusal(value)).toBe(MESSAGES.remote);
  });

  it.each([
    ["another database name", url("localhost:5432", "other")],
    ["the postgres database", url("localhost:5432", "postgres")],
    ["a prefix of the dev name", url("localhost:5432", "personal_hub2")],
    [
      "a name that only contains _test",
      url("localhost:5432", "personal_hub_testing"),
    ],
    ["a bare _test", url("localhost:5432", "_test")],
    ["no database name", url("localhost:5432", "")],
    ["a trailing slash", url("localhost:5432", "personal_hub/")],
    ["an escaped name", url("localhost:5432", "personal%5Fhub")],
    ["a name over 63 bytes", url("localhost:5432", `${"a".repeat(60)}_test`)],
    ["an uppercase dev name", url("localhost:5432", "Personal_Hub")],
  ])("refuses %s", (_label, value) => {
    expect(refusal(value)).toBe(MESSAGES.database);
  });

  it.each([
    ["a host parameter", "?host=db.example.com"],
    ["a socket host parameter", "?host=/var/run/postgresql"],
    ["a port parameter", "?port=6543"],
    ["a user parameter", "?user=other"],
    ["an options parameter", "?options=-c%20search_path%3Dx"],
    ["an ssl parameter", "?ssl=true"],
    ["an invalid sslmode", "?sslmode=bogus"],
    ["an escaped sslmode", "?sslmode=requ%69re"],
    [
      "a second parameter next to sslmode",
      "?sslmode=require&host=db.example.com",
    ],
    ["a fragment", "#x"],
    ["a fragment with a parameter", "#?host=db.example.com"],
  ])("refuses %s", (_label, suffix) => {
    expect(refusal(url("localhost:5432", "personal_hub", suffix))).toBe(
      MESSAGES.invalid,
    );
  });

  it.each([
    ["a non-postgres scheme", "http://localhost:5432/personal_hub"],
    ["no scheme", "localhost:5432/personal_hub"],
    ["not a URL", "not a url"],
    ["whitespace", " postgres://localhost:5432/personal_hub"],
    ["a newline", "postgres://localhost:5432/personal_hub\n"],
    ["a control character", "postgres://localhost:5432/personal_hub\u0000"],
    ["an invalid escape", `postgres://admin:100%@localhost:5432/personal_hub`],
    ["a truncated escape", `postgres://admin:%4@localhost:5432/personal_hub`],
    [
      "an empty host with a port",
      `postgres://admin:${SECRET}@:5432/personal_hub`,
    ],
    [
      "an invalid port",
      `postgres://admin:${SECRET}@localhost:abc/personal_hub`,
    ],
  ])("refuses %s as malformed", (_label, value) => {
    expect(refusal(value)).toBe(MESSAGES.invalid);
  });

  it("never echoes the URL, host, database or credentials in a message", () => {
    const refused = [
      url("db.example.com:5432", "personal_hub"),
      url("localhost:5432", "forbidden_db"),
      url("localhost:5432", "personal_hub", "?host=db.example.com"),
      `postgres://admin:${SECRET}@localhost:abc/personal_hub`,
    ].map(refusal);
    for (const message of refused) {
      expect(FIXED_MESSAGES).toContain(message);
      for (const secret of [
        SECRET,
        "admin",
        "db.example.com",
        "forbidden_db",
      ]) {
        expect(message).not.toContain(secret);
      }
    }
  });
});

describe("checkDownArgs", () => {
  it.each([
    [[]],
    [["2"]],
    [["--dry-run"]],
    [["3", "--dry-run"]],
    [["--dry-run", "3"]],
  ])("allows %j", (args) => {
    expect(checkDownArgs(args)).toEqual({ ok: true });
  });

  it.each([
    [["-d", "OTHER_URL"]],
    [["--database-url-var=OTHER_URL"]],
    [["-f", "other.json"]],
    [["--config-file", "other.json"]],
    [["--envPath", "other.env"]],
    [["-m", "other"]],
    [["--fake"]],
    [["0"]],
    [["-1"]],
    [["1.5"]],
    [["1", "2"]],
    [["--dry-run", "--dry-run"]],
    [[""]],
  ])("refuses %j", (args) => {
    expect(checkDownArgs(args)).toEqual({ ok: false, message: MESSAGES.args });
  });
});

describe("checkDatabaseUrl: edge cases", () => {
  const base = (host: string, database: string, suffix = "") =>
    `postgres://u:p@${host}/${database}${suffix}`;

  it.each([
    ["the shortest _test name", base("localhost:5432", "x_test")],
    ["a 63-byte _test name", base("localhost:5432", `${"a".repeat(58)}_test`)],
    ["mixed case before _test", base("localhost:5432", "Personal_Hub_test")],
    ["digits in a _test name", base("localhost:5432", "run_42_test")],
    [
      "postgresql:// with a _test database",
      base("localhost:5432", "x_test").replace("postgres", "postgresql"),
    ],
    ["the long IPv6 form of ::1", base("[0:0:0:0:0:0:0:1]:5432", "x_test")],
    ["an IPv6 host with a _test database", base("[::1]:5432", "x_test")],
    [
      "a valid escape in the password",
      "postgres://u:p%2540@localhost:5432/x_test",
    ],
    ["an empty query", base("localhost:5432", "x_test", "?")],
    [
      "sslmode=no-verify",
      base("localhost:5432", "x_test", "?sslmode=no-verify"),
    ],
    [
      "sslmode=verify-full",
      base("localhost:5432", "x_test", "?sslmode=verify-full"),
    ],
    [
      "a second @ in the userinfo (the host is the part after the last @)",
      base("localhost:5432", "personal_hub").replace(
        "u:p@localhost:5432",
        "u:p@evil.host:5432@localhost:5432",
      ),
    ],
    [
      "the user's host:port@localhost userinfo trick",
      "postgres://u:p@evil.host:5432@localhost:5432/personal_hub",
    ],
  ])(
    "allows %s, and the driver resolves it to the same local target",
    (_label, value) => {
      expect(checkDatabaseUrl(value)).toEqual({ ok: true });
      const config = parse(value);
      expect(["localhost", "127.0.0.1", "::1"]).toContain(config.host);
      // An empty user or port would make the driver fall back to PGUSER or PGPORT.
      expect(config.user).toBeTruthy();
      expect(config.port).toBeTruthy();
      // Any other key (options, ...) would be a connection setting the guard did not check.
      expect(
        Object.keys(config).filter((key) => !DRIVER_KEYS.has(key)),
      ).toEqual([]);
      const name = new URL(value).pathname.slice(1);
      expect(config.database).toBe(name);
    },
  );

  it.each([
    [
      "an IPv4-mapped IPv6 loopback",
      base("[::ffff:127.0.0.1]:5432", "personal_hub"),
    ],
    ["another IPv6 address", base("[::2]:5432", "personal_hub")],
    ["the unspecified IPv6 address", base("[::]:5432", "personal_hub")],
    ["a shortened IPv4 loopback", base("127.1:5432", "personal_hub")],
    ["a hex IPv4 loopback", base("0x7f.0.0.1:5432", "personal_hub")],
    ["another 127.x address", base("127.0.0.2:5432", "personal_hub")],
    ["a trailing dot", base("localhost.:5432", "personal_hub")],
    ["a mixed-case host", base("LocalHost:5432", "personal_hub")],
    [
      "a host with a suffix",
      base("localhost.localdomain:5432", "personal_hub"),
    ],
    ["a host with a prefix", base("evil-localhost:5432", "personal_hub")],
    [
      "a backslash before the real host",
      base("localhost\\@evil.host:5432", "personal_hub"),
    ],
    [
      "a backslash after the port",
      base("localhost:5432\\@evil.host", "personal_hub"),
    ],
    [
      "a trailing @host in the userinfo",
      base("localhost@evil.host", "personal_hub"),
    ],
    [
      "a remote host with sslmode",
      base("db.example.com:5432", "x_test", "?sslmode=require"),
    ],
    [
      "a remote postgresql:// host",
      base("db.example.com:5432", "x_test").replace("postgres", "postgresql"),
    ],
    ["a remote IPv6 host", base("[2001:db8::1]:5432", "x_test")],
  ])("refuses %s as remote", (_label, value) => {
    expect(checkDatabaseUrl(value)).toEqual({
      ok: false,
      message: MESSAGES.remote,
    });
  });

  it.each([
    ["a 64-byte _test name", `${"a".repeat(59)}_test`],
    ["an uppercase _TEST suffix", "personal_hub_TEST"],
    ["a hyphen in the name", "personal-hub_test"],
    ["a dot in the name", "personal.hub_test"],
    ["a non-ASCII name", "\u00E4_test"],
    ["the dev name with a suffix", "personal_hub_dev"],
    ["the dev name with a prefix", "my_personal_hub"],
    ["the dev name in uppercase", "PERSONAL_HUB"],
    ["a name with a semicolon", "personal_hub;x"],
    ["a name with a leading slash", "/personal_hub"],
    ["a name with a double trailing slash", "personal_hub//"],
    ["an escaped digit", "personal_hub%32"],
    ["an escaped NUL", "personal_hub%00"],
    ["an escaped slash", "personal_hub%2F"],
    ["a name that is only _test_", "_test_"],
  ])("refuses a database name with %s", (_label, database) => {
    expect(checkDatabaseUrl(base("localhost:5432", database))).toEqual({
      ok: false,
      message: MESSAGES.database,
    });
  });

  it("refuses a URL without a path", () => {
    expect(refusal("postgres://u:p@localhost:5432")).toBe(MESSAGES.database);
  });

  it.each([
    ["a host parameter with an empty value", "?host="],
    [
      "a leading host parameter before sslmode",
      "?host=evil.host&sslmode=disable",
    ],
    ["a host parameter naming localhost", "?host=localhost"],
    ["an escaped key", "?%68ost=evil.host"],
    ["an uppercase sslmode key", "?SSLMODE=disable"],
    ["an uppercase sslmode value", "?sslmode=DISABLE"],
    ["an empty sslmode", "?sslmode="],
    ["a bare sslmode key", "?sslmode"],
    ["a legacy sslmode", "?sslmode=allow"],
    ["a semicolon-separated parameter", "?sslmode=disable;host=evil.host"],
    ["a second question mark", "?sslmode=disable?host=evil.host"],
    ["an ssl certificate parameter", "?sslcert=/tmp/x"],
    ["a libpq compatibility parameter", "?uselibpqcompat=true"],
    ["an application name", "?application_name=x"],
    ["an empty fragment", "?sslmode=disable#"],
  ])("refuses %s", (_label, suffix) => {
    expect(refusal(base("localhost:5432", "x_test", suffix))).toBe(
      MESSAGES.invalid,
    );
  });

  it.each([
    ["a non-breaking space", "postgres://u:p@localhost:5432/x_test\u00A0"],
    ["a line separator", "postgres://u:p@localhost:5432/x_test\u2028"],
    ["a byte order mark", "postgres://u:p@localhost:5432/x_test\uFEFF"],
    ["a tab inside the host", "postgres://u:p@local\thost:5432/x_test"],
    ["a newline inside the host", "postgres://u:p@local\nhost:5432/x_test"],
    ["a carriage return", "postgres://u:p@localhost:5432/x_test\r"],
    ["a DEL character", "postgres://u:p@localhost:5432/x_test\u007F"],
    ["a trailing percent sign", "postgres://u:p@localhost:5432/x_test%"],
    ["a non-hex escape", "postgres://u:p%ZZ@localhost:5432/x_test"],
    [
      "a one-digit escape in the user",
      "postgres://u%2:p@localhost:5432/x_test",
    ],
    [
      "a one-digit escape in the query",
      "postgres://u:p@localhost:5432/x_test?sslmode=disable%",
    ],
    ["a single slash after the scheme", "postgres:/localhost:5432/x_test"],
    ["no slashes after the scheme", "postgres:localhost:5432/x_test"],
    [
      "an unknown postgres-like scheme",
      "postgresql+x://u:p@localhost:5432/x_test",
    ],
    ["an uppercase scheme", "POSTGRES://u:p@localhost:5432/x_test"],
    ["a port above 65535", "postgres://u:p@localhost:99999/x_test"],
    ["text after the port", "postgres://u:p@localhost:5432x_test"],
    [
      "a question mark before the path",
      "postgres://u:p@localhost:5432?/x_test",
    ],
  ])("refuses %s as malformed", (_label, value) => {
    expect(refusal(value)).toBe(MESSAGES.invalid);
  });

  it("never echoes any part of a refused URL in the message", () => {
    const hostile: [string, string[]][] = [
      [
        "postgres://usr9:pw9@db9.example.com:6543/data9",
        ["usr9", "pw9", "db9.example.com", "6543", "data9"],
      ],
      [
        "postgres://usr9:pw9@localhost:6543/data9",
        ["usr9", "pw9", "6543", "data9"],
      ],
      [
        "postgres://usr9:pw9@localhost:6543/x_test?host=evil9.host",
        ["usr9", "pw9", "6543", "evil9.host"],
      ],
      [
        "postgres://usr9:pw9@localhost:6543/x_test#frag9",
        ["usr9", "pw9", "6543", "frag9"],
      ],
      [
        "postgres://usr9:p%9w9@localhost:6543/x_test",
        ["usr9", "p%9w9", "6543"],
      ],
      ["usr9:pw9@host9/data9", ["usr9", "pw9", "host9", "data9"]],
      ["postgres://usr9:pw9@localhost:6543/x_test\n", ["usr9", "pw9", "6543"]],
    ];
    for (const [value, secrets] of hostile) {
      const message = refusal(value);
      expect(FIXED_MESSAGES).toContain(message);
      for (const secret of secrets) expect(message).not.toContain(secret);
    }
  });

  it("uses static messages only", () => {
    for (const message of FIXED_MESSAGES) {
      expect(message).not.toMatch(/\$\{|%s|undefined|postgres(ql)?:\/\/.+@/);
    }
  });
});

describe("checkDatabaseUrl: explicit user and port", () => {
  it.each([
    ["no userinfo", "postgres://localhost:5432/personal_hub"],
    ["an empty userinfo", "postgres://@localhost:5432/personal_hub"],
    ["an empty user with a password", "postgres://:pw9@localhost:5432/x_test"],
    ["an empty user in a _test URL", "postgres://@127.0.0.1:5432/x_test"],
  ])("refuses %s because PGUSER would apply", (_label, value) => {
    expect(refusal(value)).toBe(MESSAGES.user);
  });

  it.each([
    ["no port", "postgres://u:p@localhost/personal_hub"],
    ["an empty port", "postgres://u:p@localhost:/personal_hub"],
    ["no port with an IPv6 host", "postgres://u:p@[::1]/x_test"],
    ["no port with sslmode", "postgres://u:p@localhost/x_test?sslmode=disable"],
    ["no userinfo and no port", "postgres://localhost/personal_hub"],
  ])("refuses %s because PGPORT would apply", (_label, value) => {
    expect([MESSAGES.port, MESSAGES.user]).toContain(refusal(value));
  });

  it("reports the port when only the port is missing", () => {
    expect(refusal("postgres://u:p@localhost/personal_hub")).toBe(
      MESSAGES.port,
    );
    expect(refusal("postgres://u:p@localhost:/personal_hub")).toBe(
      MESSAGES.port,
    );
  });

  it("still reports a remote host or a wrong database before the user and port", () => {
    expect(refusal("postgres://db.example.com/personal_hub")).toBe(
      MESSAGES.remote,
    );
    expect(refusal("postgres://localhost/other")).toBe(MESSAGES.database);
  });

  it("allows an empty password, as the test guard does", () => {
    expect(
      checkDatabaseUrl("postgres://admin@localhost:5432/personal_hub"),
    ).toEqual({ ok: true });
    expect(
      checkDatabaseUrl("postgres://admin:@localhost:5432/personal_hub"),
    ).toEqual({ ok: true });
  });

  it("documents the fallback: the driver takes PGPORT and PGUSER for empty parts", () => {
    vi.stubEnv("PGPORT", "9999");
    vi.stubEnv("PGUSER", "envuser");
    const open = driverView("postgres://localhost/personal_hub");
    expect([open.port, open.user]).toEqual([9999, "envuser"]);
    const emptyUser = driverView("postgres://@localhost:5432/personal_hub");
    expect([emptyUser.port, emptyUser.user]).toEqual([5432, "envuser"]);
    const emptyPort = driverView("postgres://u:p@localhost:/personal_hub");
    expect([emptyPort.port, emptyPort.user]).toEqual([9999, "u"]);
    const explicit = driverView("postgres://u:p@localhost:5432/personal_hub");
    expect([explicit.port, explicit.user]).toEqual([5432, "u"]);
  });

  it("refuses every URL for which the driver would use PGUSER or PGPORT", () => {
    vi.stubEnv("PGPORT", "9999");
    vi.stubEnv("PGUSER", "envuser");
    for (const value of [
      "postgres://localhost/personal_hub",
      "postgres://@localhost/personal_hub",
      "postgres://@localhost:5432/personal_hub",
      "postgres://u:p@localhost:/personal_hub",
      "postgres://u:p@[::1]/x_test",
    ]) {
      const view = driverView(value);
      expect(view.port === 9999 || view.user === "envuser").toBe(true);
      expect(checkDatabaseUrl(value).ok).toBe(false);
    }
  });

  it("never echoes any part of the refused URL", () => {
    for (const value of [
      "postgres://pw9:@host9.example.com/data9",
      "postgres://:pw9@localhost:6543/x_test",
      "postgres://usr9:pw9@localhost/x_test",
    ]) {
      const message = refusal(value);
      expect(FIXED_MESSAGES).toContain(message);
      for (const secret of [
        "usr9",
        "pw9",
        "host9",
        "6543",
        "data9",
        "x_test",
      ]) {
        expect(message).not.toContain(secret);
      }
    }
  });
});

describe("checkDownArgs: edge cases", () => {
  it.each([
    [["1"]],
    [["9999"]],
    [["--dry-run", "10"]],
    [["9999", "--dry-run"]],
  ])("allows %j", (args) => {
    expect(checkDownArgs(args)).toEqual({ ok: true });
  });

  it.each([
    [["10000"]],
    [["09"]],
    [["+1"]],
    [["1e3"]],
    [["0x1"]],
    [["\u0661"]],
    [[" 1"]],
    [["1 "]],
    [["1\n"]],
    [["--dry-run\n"]],
    [["--"]],
    [["--", "1"]],
    [["1", "--", "--dry-run"]],
    [["--dry-run=true"]],
    [["--DRY-RUN"]],
    [["-dry-run"]],
    [["--dry-run", "--dry-run", "1"]],
    [["--dry-run", "1", "2"]],
    [["-d"]],
    [["-f", "other.json"]],
    [["--envPath=other.env"]],
    [["--database-url-var", "OTHER_URL"]],
    [["--migrations-dir", "other"]],
    [["--help"]],
    [["-h"]],
    [["--version"]],
    [["all"]],
  ])("refuses %j", (args) => {
    expect(checkDownArgs(args)).toEqual({ ok: false, message: MESSAGES.args });
  });

  it("never echoes the refused arguments", () => {
    const result = checkDownArgs(["-d", "SECRET_VAR", "--envPath=secret.env"]);
    expect(result).toEqual({ ok: false, message: MESSAGES.args });
    if (!result.ok) {
      expect(result.message).not.toContain("SECRET_VAR");
      expect(result.message).not.toContain("secret.env");
    }
  });
});
