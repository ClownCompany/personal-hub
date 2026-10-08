import { createHash, randomBytes, randomUUID } from "node:crypto";
import { runner } from "node-pg-migrate";
import { Client } from "pg";
import { describe, expect, inject, it } from "vitest";
import { getPool } from "@/lib/db";
import {
  getDatabaseName,
  isTestDatabaseName,
  toMaintenanceUrl,
} from "@/lib/test/test-env";

const UUID_V7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// Looks like an argon2id PHC string; not a real hash.
const PHC_HASH = "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$aGFzaGhhc2hoYXNo";

type UserValues = { email?: string; username?: string; password_hash?: string };

const INSERT_USER =
  "insert into users (email, username, password_hash) values ($1, $2, $3) returning id";

function userParams(values: UserValues): string[] {
  return [
    values.email ?? "alice@example.com",
    values.username ?? "alice",
    values.password_hash ?? PHC_HASH,
  ];
}

async function insertUser(values: UserValues = {}): Promise<string> {
  const { rows } = await getPool().query<{ id: string }>(
    INSERT_USER,
    userParams(values),
  );
  return rows[0].id;
}

// PostgreSQL checks CHECK constraints in name order and reports only the first failure, so a
// redundant check is shadowed by its stricter sibling. This drops the sibling inside a
// transaction that is always rolled back, so the redundant check is exercised on its own.
async function rejectionWithoutConstraint(
  dropped: string,
  values: UserValues,
): Promise<unknown> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    await client.query(
      `alter table users drop constraint ${client.escapeIdentifier(dropped)}`,
    );
    return await rejection(client.query(INSERT_USER, userParams(values)));
  } finally {
    await client.query("rollback");
    client.release();
  }
}

// token_hash is 32 identical bytes, so `seed` makes it unique per session.
function token(seed: number, length = 32): Buffer {
  return Buffer.alloc(length, seed);
}

async function insertSession(userId: string, seed = 1): Promise<string> {
  const { rows } = await getPool().query<{ id: string }>(
    "insert into sessions (user_id, token_hash, expires_at) values ($1, $2, now() + interval '1 hour') returning id",
    [userId, token(seed)],
  );
  return rows[0].id;
}

// Resolves with the rejection so tests can assert on code, constraint and column.
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected the statement to be rejected");
}

async function expectViolation(
  promise: Promise<unknown>,
  code: string,
  detail: { constraint?: string; column?: string },
): Promise<void> {
  expect(await rejection(promise)).toMatchObject({ code, ...detail });
}

// For values that violate several checks: the code is pinned, the name may be any of `names`.
async function expectCheckViolationOneOf(
  promise: Promise<unknown>,
  names: string[],
): Promise<void> {
  const error = await rejection(promise);
  expect(error).toMatchObject({ code: CHECK });
  expect(names).toContain((error as { constraint?: string }).constraint);
}

const CHECK = "23514";
const UNIQUE = "23505";
const NOT_NULL = "23502";
const FOREIGN_KEY = "23503";

describe("users and sessions: catalog", () => {
  async function columns(table: string) {
    const { rows } = await getPool().query<{
      name: string;
      type: string;
      nullable: string;
      default: string | null;
    }>(
      `select column_name as name, data_type as type, is_nullable as nullable, column_default as default
       from information_schema.columns
       where table_schema = 'public' and table_name = $1
       order by ordinal_position`,
      [table],
    );
    return rows;
  }

  async function constraints(table: string) {
    const { rows } = await getPool().query<{
      name: string;
      type: string;
      definition: string;
    }>(
      `select conname as name, contype as type, pg_get_constraintdef(oid) as definition
       from pg_constraint
       where conrelid = ('public.' || $1)::regclass
         and contype <> 'n' -- PostgreSQL 18 lists NOT NULL as constraints; the column tests cover them
       order by conname`,
      [table],
    );
    return rows;
  }

  async function indexes(table: string) {
    const { rows } = await getPool().query<{
      name: string;
      definition: string;
    }>(
      `select indexname as name, indexdef as definition
       from pg_indexes
       where schemaname = 'public' and tablename = $1
       order by indexname`,
      [table],
    );
    return rows;
  }

  it("creates both tables", async () => {
    const { rows } = await getPool().query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public' and tablename in ('users', 'sessions') order by tablename",
    );
    expect(rows.map((row) => row.tablename)).toEqual(["sessions", "users"]);
  });

  it("defines the users columns", async () => {
    expect(await columns("users")).toEqual([
      { name: "id", type: "uuid", nullable: "NO", default: "uuidv7()" },
      { name: "email", type: "text", nullable: "NO", default: null },
      { name: "username", type: "text", nullable: "NO", default: null },
      { name: "password_hash", type: "text", nullable: "NO", default: null },
      {
        name: "created_at",
        type: "timestamp with time zone",
        nullable: "NO",
        default: "now()",
      },
    ]);
  });

  it("defines the sessions columns", async () => {
    expect(await columns("sessions")).toEqual([
      { name: "id", type: "uuid", nullable: "NO", default: "uuidv7()" },
      { name: "user_id", type: "uuid", nullable: "NO", default: null },
      { name: "token_hash", type: "bytea", nullable: "NO", default: null },
      {
        name: "expires_at",
        type: "timestamp with time zone",
        nullable: "NO",
        default: null,
      },
      {
        name: "created_at",
        type: "timestamp with time zone",
        nullable: "NO",
        default: "now()",
      },
    ]);
  });

  it("names every users constraint", async () => {
    const found = await constraints("users");
    expect(found.map((row) => [row.name, row.type])).toEqual([
      ["users_email_charset_check", "c"],
      ["users_email_has_at_check", "c"],
      ["users_email_key", "u"],
      ["users_email_length_check", "c"],
      ["users_email_lower_check", "c"],
      ["users_password_hash_not_empty_check", "c"],
      ["users_password_hash_prefix_check", "c"],
      ["users_pkey", "p"],
      ["users_username_charset_check", "c"],
      ["users_username_key", "u"],
      ["users_username_length_check", "c"],
      ["users_username_lower_check", "c"],
      ["users_username_no_at_check", "c"],
    ]);
    const byName = Object.fromEntries(
      found.map((row) => [row.name, row.definition]),
    );
    expect(byName.users_pkey).toBe("PRIMARY KEY (id)");
    expect(byName.users_email_key).toBe("UNIQUE (email)");
    expect(byName.users_username_key).toBe("UNIQUE (username)");
  });

  // The stored definitions show that `$` in the migration file reached PostgreSQL unchanged.
  it("stores the charset and hash prefix checks as specified", async () => {
    const byName = Object.fromEntries(
      (await constraints("users")).map((row) => [row.name, row.definition]),
    );
    expect(byName.users_email_charset_check).toBe(
      "CHECK ((email ~ '^[!-~]+$'::text))",
    );
    expect(byName.users_username_charset_check).toBe(
      "CHECK ((username ~ '^[a-z0-9._-]+$'::text))",
    );
    expect(byName.users_password_hash_prefix_check).toBe(
      "CHECK ((password_hash ~~ '$argon2id$%'::text))",
    );
  });

  it("names every sessions constraint", async () => {
    const found = await constraints("sessions");
    expect(found.map((row) => [row.name, row.type])).toEqual([
      ["sessions_expires_at_check", "c"],
      ["sessions_pkey", "p"],
      ["sessions_token_hash_key", "u"],
      ["sessions_token_hash_length_check", "c"],
      ["sessions_user_id_fkey", "f"],
    ]);
    const byName = Object.fromEntries(
      found.map((row) => [row.name, row.definition]),
    );
    expect(byName.sessions_pkey).toBe("PRIMARY KEY (id)");
    expect(byName.sessions_token_hash_key).toBe("UNIQUE (token_hash)");
    expect(byName.sessions_user_id_fkey).toBe(
      "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE",
    );
  });

  it("names every users index", async () => {
    expect((await indexes("users")).map((row) => row.name)).toEqual([
      "users_email_key",
      "users_pkey",
      "users_username_key",
    ]);
  });

  it("names every sessions index", async () => {
    const found = await indexes("sessions");
    expect(found.map((row) => row.name)).toEqual([
      "sessions_expires_at_idx",
      "sessions_pkey",
      "sessions_token_hash_key",
      "sessions_user_id_idx",
    ]);
    const byName = Object.fromEntries(
      found.map((row) => [row.name, row.definition]),
    );
    expect(byName.sessions_user_id_idx).toBe(
      "CREATE INDEX sessions_user_id_idx ON public.sessions USING btree (user_id)",
    );
    expect(byName.sessions_expires_at_idx).toBe(
      "CREATE INDEX sessions_expires_at_idx ON public.sessions USING btree (expires_at)",
    );
  });
});

describe("users", () => {
  it("fills id and created_at with defaults; the id is a UUID v7", async () => {
    const { rows } = await getPool().query<{ id: string; created_at: Date }>(
      "insert into users (email, username, password_hash) values ($1, $2, $3) returning id, created_at",
      ["alice@example.com", "alice", PHC_HASH],
    );
    expect(rows[0].id).toMatch(UUID_V7);
    expect(Math.abs(Date.now() - rows[0].created_at.getTime())).toBeLessThan(
      60_000,
    );
  });

  it("rejects a duplicate email", async () => {
    await insertUser({ email: "a@example.com", username: "first" });
    await expectViolation(
      insertUser({ email: "a@example.com", username: "second" }),
      UNIQUE,
      { constraint: "users_email_key" },
    );
  });

  it("rejects a duplicate username", async () => {
    await insertUser({ email: "a@example.com", username: "alice" });
    await expectViolation(
      insertUser({ email: "b@example.com", username: "alice" }),
      UNIQUE,
      { constraint: "users_username_key" },
    );
  });

  it("rejects 'Alice' after 'alice' as a check violation, not uniqueness", async () => {
    await insertUser({ email: "a@example.com", username: "alice" });
    // The charset check fails as well and is reported first.
    await expectCheckViolationOneOf(
      insertUser({ email: "b@example.com", username: "Alice" }),
      ["users_username_lower_check", "users_username_charset_check"],
    );
  });

  it("enforces the username lowercase check on its own", async () => {
    const error = await rejectionWithoutConstraint(
      "users_username_charset_check",
      { username: "Alice" },
    );
    expect(error).toMatchObject({
      code: CHECK,
      constraint: "users_username_lower_check",
    });
  });

  it("reports the unique violation when the app lowercases the username first", async () => {
    await insertUser({ email: "a@example.com", username: "alice" });
    await expectViolation(
      insertUser({ email: "b@example.com", username: "Alice".toLowerCase() }),
      UNIQUE,
      { constraint: "users_username_key" },
    );
  });

  it("rejects an uppercase email", async () => {
    await expectViolation(insertUser({ email: "Alice@example.com" }), CHECK, {
      constraint: "users_email_lower_check",
    });
  });

  it("rejects a username containing @", async () => {
    await expectCheckViolationOneOf(insertUser({ username: "a@b" }), [
      "users_username_no_at_check",
      "users_username_charset_check",
    ]);
  });

  it("enforces the username no-@ check on its own", async () => {
    const error = await rejectionWithoutConstraint(
      "users_username_charset_check",
      { username: "a@b" },
    );
    expect(error).toMatchObject({
      code: CHECK,
      constraint: "users_username_no_at_check",
    });
  });

  it("rejects an empty username", async () => {
    await expectCheckViolationOneOf(insertUser({ username: "" }), [
      "users_username_length_check",
      "users_username_charset_check",
    ]);
  });

  it("enforces the username length check on its own for an empty value", async () => {
    const error = await rejectionWithoutConstraint(
      "users_username_charset_check",
      { username: "" },
    );
    expect(error).toMatchObject({
      code: CHECK,
      constraint: "users_username_length_check",
    });
  });

  it("rejects a 33-character username and accepts 32", async () => {
    await expectViolation(insertUser({ username: "a".repeat(33) }), CHECK, {
      constraint: "users_username_length_check",
    });
    await expect(insertUser({ username: "a".repeat(32) })).resolves.toMatch(
      UUID_V7,
    );
  });

  it.each([
    ["a zero-width space", "ali\u200Bce"],
    ["a Cyrillic homoglyph (U+0430)", "\u0430lice"],
    ["a fullwidth letter (U+FF41)", "\uFF41lice"],
    ["a non-ASCII letter", "\u00E4lice"],
    ["leading whitespace", " alice"],
    ["trailing whitespace", "alice "],
    ["an inner space", "ali ce"],
    ["a trailing newline", "alice\n"],
    ["a tab", "ali\tce"],
    ["a control character", "ali\u0001ce"],
    ["DEL", "ali\u007Fce"],
    ["a character outside the set", "ali/ce"],
  ])("rejects a username with %s", async (_label, username) => {
    await expectViolation(insertUser({ username }), CHECK, {
      constraint: "users_username_charset_check",
    });
  });

  it.each(["a", "a.b-c_9", "0", "_", "-."])(
    "accepts the username %j",
    async (username) => {
      await expect(insertUser({ username })).resolves.toMatch(UUID_V7);
    },
  );

  it("rejects an email without @", async () => {
    await expectViolation(insertUser({ email: "alice.example.com" }), CHECK, {
      constraint: "users_email_has_at_check",
    });
  });

  it("rejects an empty email", async () => {
    // Several checks fail here; PostgreSQL reports the first one by name, so only the code is pinned.
    await expectCheckViolationOneOf(insertUser({ email: "" }), [
      "users_email_charset_check",
      "users_email_has_at_check",
      "users_email_length_check",
    ]);
  });

  it("rejects a 255-character email and accepts 254", async () => {
    const domain = "@example.com";
    await expectViolation(
      insertUser({ email: "a".repeat(255 - domain.length) + domain }),
      CHECK,
      { constraint: "users_email_length_check" },
    );
    await expect(
      insertUser({ email: "a".repeat(254 - domain.length) + domain }),
    ).resolves.toMatch(UUID_V7);
  });

  it.each([
    ["a non-ASCII local part", "\u00E4lice@example.com"],
    ["a non-ASCII domain", "alice@ex\u00E4mple.com"],
    ["a fullwidth letter (U+FF41)", "\uFF41lice@example.com"],
    ["a zero-width space", "ali\u200Bce@example.com"],
    ["a space", "ali ce@example.com"],
    ["leading whitespace", " alice@example.com"],
    ["a tab", "ali\tce@example.com"],
    ["a trailing newline", "alice@example.com\n"],
    ["a control character", "ali\u0001ce@example.com"],
    ["DEL", "ali\u007Fce@example.com"],
  ])("rejects an email with %s", async (_label, email) => {
    await expectViolation(insertUser({ email }), CHECK, {
      constraint: "users_email_charset_check",
    });
  });

  it.each([
    "alice@example.com",
    "first.last+tag!#$%&'*=?^_`{|}~@sub.example.com",
  ])("accepts the printable ASCII email %j", async (email) => {
    await expect(insertUser({ email })).resolves.toMatch(UUID_V7);
  });

  it("rejects an empty password_hash", async () => {
    await expectCheckViolationOneOf(insertUser({ password_hash: "" }), [
      "users_password_hash_not_empty_check",
      "users_password_hash_prefix_check",
    ]);
  });

  it("enforces the password_hash non-empty check on its own", async () => {
    const error = await rejectionWithoutConstraint(
      "users_password_hash_prefix_check",
      { password_hash: "" },
    );
    expect(error).toMatchObject({
      code: CHECK,
      constraint: "users_password_hash_not_empty_check",
    });
  });

  it.each([
    ["plaintext", "plaintext"],
    [
      "a bcrypt hash",
      "$2b$12$abcdefghijklmnopqrstuuAbCdEfGhIjKlMnOpQrStUvWxYz01234",
    ],
    [
      "an argon2i hash",
      "$argon2i$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$aGFzaGhhc2hoYXNo",
    ],
    [
      "an uppercase prefix",
      "$ARGON2ID$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$aGFzaGhhc2hoYXNo",
    ],
    ["a prefix without the closing $", "$argon2id"],
    ["leading whitespace", ` ${PHC_HASH}`],
    ["text before the prefix", `x${PHC_HASH}`],
    ["the prefix not at the start", `hash${PHC_HASH}`],
  ])("rejects a password_hash with %s", async (_label, password_hash) => {
    await expectViolation(insertUser({ password_hash }), CHECK, {
      constraint: "users_password_hash_prefix_check",
    });
  });

  it("accepts a PHC-formatted argon2id password_hash", async () => {
    await expect(insertUser({ password_hash: PHC_HASH })).resolves.toMatch(
      UUID_V7,
    );
  });

  it.each([
    [
      "email",
      `insert into users (username, password_hash) values ('alice', '${PHC_HASH}')`,
    ],
    [
      "username",
      `insert into users (email, password_hash) values ('alice@example.com', '${PHC_HASH}')`,
    ],
    [
      "password_hash",
      "insert into users (email, username) values ('alice@example.com', 'alice')",
    ],
  ])("rejects a row without %s", async (column, sql) => {
    await expectViolation(getPool().query(sql), NOT_NULL, { column });
  });
});

describe("sessions", () => {
  it("fills id and created_at with defaults; the id is a UUID v7", async () => {
    const userId = await insertUser();
    const { rows } = await getPool().query<{ id: string; created_at: Date }>(
      "insert into sessions (user_id, token_hash, expires_at) values ($1, $2, now() + interval '1 hour') returning id, created_at",
      [userId, token(1)],
    );
    expect(rows[0].id).toMatch(UUID_V7);
    expect(Math.abs(Date.now() - rows[0].created_at.getTime())).toBeLessThan(
      60_000,
    );
  });

  it("rejects a user_id that does not exist", async () => {
    await expectViolation(insertSession(randomUUID()), FOREIGN_KEY, {
      constraint: "sessions_user_id_fkey",
    });
  });

  it.each([0, 31, 33])("rejects a token_hash of %i bytes", async (length) => {
    const userId = await insertUser();
    await expectViolation(
      getPool().query(
        "insert into sessions (user_id, token_hash, expires_at) values ($1, $2, now() + interval '1 hour')",
        [userId, token(1, length)],
      ),
      CHECK,
      { constraint: "sessions_token_hash_length_check" },
    );
  });

  it("rejects a duplicate token_hash", async () => {
    const userId = await insertUser();
    await insertSession(userId, 7);
    await expectViolation(insertSession(userId, 7), UNIQUE, {
      constraint: "sessions_token_hash_key",
    });
  });

  it.each([
    ["equal to created_at", "now()"],
    ["before created_at", "now() - interval '1 second'"],
  ])("rejects expires_at %s", async (_label, expiresAt) => {
    const userId = await insertUser();
    // expiresAt is a constant from the table above, not user input.
    await expectViolation(
      getPool().query(
        `insert into sessions (user_id, token_hash, expires_at) values ($1, $2, ${expiresAt})`,
        [userId, token(1)],
      ),
      CHECK,
      { constraint: "sessions_expires_at_check" },
    );
  });

  it("rejects a session without expires_at", async () => {
    const userId = await insertUser();
    await expectViolation(
      getPool().query(
        "insert into sessions (user_id, token_hash) values ($1, $2)",
        [userId, token(1)],
      ),
      NOT_NULL,
      { column: "expires_at" },
    );
  });

  it("rejects a session without user_id or token_hash", async () => {
    const userId = await insertUser();
    await expectViolation(
      getPool().query(
        "insert into sessions (token_hash, expires_at) values ($1, now() + interval '1 hour')",
        [token(1)],
      ),
      NOT_NULL,
      { column: "user_id" },
    );
    await expectViolation(
      getPool().query(
        "insert into sessions (user_id, expires_at) values ($1, now() + interval '1 hour')",
        [userId],
      ),
      NOT_NULL,
      { column: "token_hash" },
    );
  });

  it("deletes only the sessions of a deleted user", async () => {
    const alice = await insertUser({
      email: "alice@example.com",
      username: "alice",
    });
    const bob = await insertUser({ email: "bob@example.com", username: "bob" });
    await insertSession(alice, 1);
    await insertSession(alice, 2);
    await insertSession(bob, 3);

    await getPool().query("delete from users where id = $1", [alice]);

    const count = async (userId: string) => {
      const { rows } = await getPool().query<{ n: number }>(
        "select count(*)::int as n from sessions where user_id = $1",
        [userId],
      );
      return rows[0].n;
    };
    expect(await count(alice)).toBe(0);
    expect(await count(bob)).toBe(1);
  });
});

describe("ids", () => {
  const uuidTimestamp = (id: string) =>
    Number.parseInt(id.replaceAll("-", "").slice(0, 12), 16);

  it("embeds the current time in the UUID v7 of users and sessions", async () => {
    const userId = await insertUser();
    const sessionId = await insertSession(userId);
    for (const id of [userId, sessionId]) {
      expect(id).toMatch(UUID_V7);
      expect(Math.abs(Date.now() - uuidTimestamp(id))).toBeLessThan(60_000);
    }
  });

  it("generates distinct ids that sort in insertion order on one connection", async () => {
    const client = await getPool().connect();
    try {
      const ids: string[] = [];
      for (let i = 0; i < 25; i++) {
        const { rows } = await client.query<{ id: string }>(INSERT_USER, [
          `user${i}@example.com`,
          `user${i}`,
          PHC_HASH,
        ]);
        ids.push(rows[0].id);
      }
      expect(new Set(ids).size).toBe(ids.length);
      expect([...ids].sort()).toEqual(ids);
    } finally {
      client.release();
    }
  });

  it.each(["id", "created_at"])(
    "rejects an explicit NULL %s for users instead of using the default",
    async (column) => {
      await expectViolation(
        getPool().query(
          `insert into users (${column}, email, username, password_hash) values (null, 'a@example.com', 'a', $1)`,
          [PHC_HASH],
        ),
        NOT_NULL,
        { column },
      );
    },
  );

  it("rejects an explicit NULL id and created_at for sessions", async () => {
    const userId = await insertUser();
    for (const column of ["id", "created_at"]) {
      await expectViolation(
        getPool().query(
          `insert into sessions (${column}, user_id, token_hash, expires_at) values (null, $1, $2, now() + interval '1 hour')`,
          [userId, token(1)],
        ),
        NOT_NULL,
        { column },
      );
    }
  });

  it("rejects an explicit id that already exists", async () => {
    const userId = await insertUser();
    await expectViolation(
      getPool().query(
        "insert into users (id, email, username, password_hash) values ($1, 'b@example.com', 'b', $2)",
        [userId, PHC_HASH],
      ),
      UNIQUE,
      { constraint: "users_pkey" },
    );
    const sessionId = await insertSession(userId, 1);
    await expectViolation(
      getPool().query(
        "insert into sessions (id, user_id, token_hash, expires_at) values ($1, $2, $3, now() + interval '1 hour')",
        [sessionId, userId, token(2)],
      ),
      UNIQUE,
      { constraint: "sessions_pkey" },
    );
  });
});

describe("users: updates and unusual input", () => {
  async function update(id: string, set: string, params: unknown[] = []) {
    // `set` is a constant from the tables in this file, not user input.
    return getPool().query(`update users set ${set} where id = $1`, [
      id,
      ...params,
    ]);
  }

  it("accepts a valid update", async () => {
    const id = await insertUser();
    await update(id, "username = $2, email = $3", ["bob", "bob@example.com"]);
    const { rows } = await getPool().query(
      "select username, email from users where id = $1",
      [id],
    );
    expect(rows[0]).toEqual({ username: "bob", email: "bob@example.com" });
  });

  it.each([
    [
      "an uppercase username",
      "username = 'ALICE'",
      ["users_username_lower_check", "users_username_charset_check"],
    ],
    [
      "a 33-character username",
      "username = repeat('a', 33)",
      ["users_username_length_check"],
    ],
    [
      "a username with @",
      "username = 'a@b'",
      ["users_username_no_at_check", "users_username_charset_check"],
    ],
    [
      "an uppercase email",
      "email = 'Alice@example.com'",
      ["users_email_lower_check"],
    ],
    [
      "an email without @",
      "email = 'alice.example.com'",
      ["users_email_has_at_check"],
    ],
    [
      "a 255-character email",
      "email = repeat('a', 243) || '@example.com'",
      ["users_email_length_check"],
    ],
    [
      "a plaintext password_hash",
      "password_hash = 'plaintext'",
      ["users_password_hash_prefix_check"],
    ],
  ])("rejects an update to %s", async (_label, set, names) => {
    const id = await insertUser();
    await expectCheckViolationOneOf(update(id, set), names);
  });

  it("rejects an update that sets a NOT NULL column to NULL", async () => {
    const id = await insertUser();
    for (const column of ["email", "username", "password_hash"]) {
      await expectViolation(update(id, `${column} = null`), NOT_NULL, {
        column,
      });
    }
  });

  it("rejects an update to the email or username of another user", async () => {
    await insertUser({ email: "a@example.com", username: "a" });
    const b = await insertUser({ email: "b@example.com", username: "b" });
    await expectViolation(update(b, "email = 'a@example.com'"), UNIQUE, {
      constraint: "users_email_key",
    });
    await expectViolation(update(b, "username = 'a'"), UNIQUE, {
      constraint: "users_username_key",
    });
  });

  it("accepts a password_hash of 10,000 characters (no length cap)", async () => {
    await expect(
      insertUser({ password_hash: `$argon2id$${"a".repeat(10_000)}` }),
    ).resolves.toMatch(UUID_V7);
  });

  it.each(["username", "email", "password_hash"])(
    "rejects a NUL byte in %s",
    async (column) => {
      const values: UserValues = { [column]: "x\u0000y" };
      // PostgreSQL text cannot hold NUL, so this is an encoding error, not a CHECK.
      await expectViolation(insertUser(values), "22021", {});
    },
  );

  it("keeps the whole row out of the table when one value is invalid", async () => {
    await expect(insertUser({ username: "a".repeat(33) })).rejects.toThrow();
    const { rows } = await getPool().query<{ n: number }>(
      "select count(*)::int as n from users",
    );
    expect(rows[0].n).toBe(0);
  });
});

describe("sessions: more cases", () => {
  it("stores a SHA-256 digest and returns it unchanged", async () => {
    const userId = await insertUser();
    const digest = createHash("sha256")
      .update(randomBytes(32).toString("base64url"))
      .digest();
    expect(digest.length).toBe(32);
    await getPool().query(
      "insert into sessions (user_id, token_hash, expires_at) values ($1, $2, now() + interval '1 hour')",
      [userId, digest],
    );
    const { rows } = await getPool().query<{ token_hash: Buffer }>(
      "select token_hash from sessions where token_hash = $1",
      [digest],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash.equals(digest)).toBe(true);
  });

  it("rejects the same token_hash for a different user", async () => {
    const alice = await insertUser({
      email: "alice@example.com",
      username: "alice",
    });
    const bob = await insertUser({ email: "bob@example.com", username: "bob" });
    await insertSession(alice, 9);
    await expectViolation(insertSession(bob, 9), UNIQUE, {
      constraint: "sessions_token_hash_key",
    });
  });

  it("accepts expires_at one microsecond after created_at and rejects an equal value", async () => {
    const userId = await insertUser();
    const insert = (expiresAt: string, seed: number) =>
      getPool().query(
        "insert into sessions (user_id, token_hash, created_at, expires_at) values ($1, $2, '2026-01-01T00:00:00Z', $3)",
        [userId, token(seed), expiresAt],
      );
    await expect(
      insert("2026-01-01T00:00:00.000001Z", 1),
    ).resolves.toBeDefined();
    await expectViolation(insert("2026-01-01T00:00:00Z", 2), CHECK, {
      constraint: "sessions_expires_at_check",
    });
    await expectViolation(insert("2025-12-31T23:59:59.999999Z", 3), CHECK, {
      constraint: "sessions_expires_at_check",
    });
  });

  it.each([
    [
      "an expires_at before created_at",
      "expires_at = created_at - interval '1 second'",
    ],
    ["an expires_at equal to created_at", "expires_at = created_at"],
    [
      "a 31-byte token_hash",
      "token_hash = substring(token_hash from 1 for 31)",
    ],
  ])("rejects an update to %s", async (_label, set) => {
    const userId = await insertUser();
    const sessionId = await insertSession(userId);
    // `set` is a constant from this table, not user input.
    await expectViolation(
      getPool().query(`update sessions set ${set} where id = $1`, [sessionId]),
      CHECK,
      {},
    );
  });

  it("rejects an update to a user_id that does not exist or a token_hash that is taken", async () => {
    const userId = await insertUser();
    const first = await insertSession(userId, 1);
    await insertSession(userId, 2);
    await expectViolation(
      getPool().query("update sessions set user_id = $2 where id = $1", [
        first,
        randomUUID(),
      ]),
      FOREIGN_KEY,
      { constraint: "sessions_user_id_fkey" },
    );
    await expectViolation(
      getPool().query("update sessions set token_hash = $2 where id = $1", [
        first,
        token(2),
      ]),
      UNIQUE,
      { constraint: "sessions_token_hash_key" },
    );
  });

  it("keeps the user when one of its sessions is deleted", async () => {
    const userId = await insertUser();
    const sessionId = await insertSession(userId);
    await getPool().query("delete from sessions where id = $1", [sessionId]);
    const { rows } = await getPool().query<{ n: number }>(
      "select count(*)::int as n from users where id = $1",
      [userId],
    );
    expect(rows[0].n).toBe(1);
  });

  it("removes every session with `delete from users` (demo reset)", async () => {
    const alice = await insertUser({
      email: "alice@example.com",
      username: "alice",
    });
    const bob = await insertUser({ email: "bob@example.com", username: "bob" });
    await insertSession(alice, 1);
    await insertSession(bob, 2);
    await getPool().query("delete from users");
    const { rows } = await getPool().query<{ n: number }>(
      "select count(*)::int as n from sessions",
    );
    expect(rows[0].n).toBe(0);
  });

  it("deletes expired sessions without touching valid ones", async () => {
    const userId = await insertUser();
    await insertSession(userId, 1);
    await getPool().query(
      "insert into sessions (user_id, token_hash, created_at, expires_at) values ($1, $2, now() - interval '2 hours', now() - interval '1 hour')",
      [userId, token(2)],
    );
    const { rowCount } = await getPool().query(
      "delete from sessions where expires_at <= now()",
    );
    expect(rowCount).toBe(1);
    const { rows } = await getPool().query<{ n: number }>(
      "select count(*)::int as n from sessions",
    );
    expect(rows[0].n).toBe(1);
  });
});

describe("indexes", () => {
  async function indexDefinitions(table: string): Promise<string[]> {
    const { rows } = await getPool().query<{ indexdef: string }>(
      "select indexdef from pg_indexes where schemaname = 'public' and tablename = $1 order by indexname",
      [table],
    );
    return rows.map((row) => row.indexdef);
  }

  it("defines unique and primary key indexes on the expected columns", async () => {
    expect(await indexDefinitions("users")).toEqual([
      "CREATE UNIQUE INDEX users_email_key ON public.users USING btree (email)",
      "CREATE UNIQUE INDEX users_pkey ON public.users USING btree (id)",
      "CREATE UNIQUE INDEX users_username_key ON public.users USING btree (username)",
    ]);
    expect(await indexDefinitions("sessions")).toEqual([
      "CREATE INDEX sessions_expires_at_idx ON public.sessions USING btree (expires_at)",
      "CREATE UNIQUE INDEX sessions_pkey ON public.sessions USING btree (id)",
      "CREATE UNIQUE INDEX sessions_token_hash_key ON public.sessions USING btree (token_hash)",
      "CREATE INDEX sessions_user_id_idx ON public.sessions USING btree (user_id)",
    ]);
  });

  // Sequential scans are switched off so the planner has to pick an index if one fits.
  async function plan(query: string): Promise<string> {
    const client = await getPool().connect();
    try {
      await client.query("begin");
      await client.query("set local enable_seqscan = off");
      const { rows } = await client.query<Record<string, string>>(
        `explain ${query}`,
      );
      return rows.map((row) => row["QUERY PLAN"]).join("\n");
    } finally {
      await client.query("rollback");
      client.release();
    }
  }

  it.each([
    [
      "the sessions of a user",
      "select * from sessions where user_id = '00000000-0000-7000-8000-000000000000'",
      "sessions_user_id_idx",
    ],
    [
      "expired sessions",
      "delete from sessions where expires_at < now()",
      "sessions_expires_at_idx",
    ],
    [
      "a session by token hash",
      `select * from sessions where token_hash = '\\x${"00".repeat(32)}'`,
      "sessions_token_hash_key",
    ],
    [
      "a user by username",
      "select * from users where username = 'alice'",
      "users_username_key",
    ],
    [
      "a user by email",
      "select * from users where email = 'a@example.com'",
      "users_email_key",
    ],
  ])(
    "serves the lookup for %s from its index",
    async (_label, query, index) => {
      expect(await plan(query)).toContain(index);
    },
  );
});

describe("migrations: down and up again", () => {
  type Rows = Record<string, unknown>[];

  async function snapshot(client: Client): Promise<{
    columns: Rows;
    constraints: Rows;
    indexes: Rows;
  }> {
    const columns = await client.query(
      `select table_name, column_name, ordinal_position, data_type, is_nullable, column_default
       from information_schema.columns
       where table_schema = 'public' and table_name <> 'pgmigrations'
       order by table_name, ordinal_position`,
    );
    const constraints = await client.query(
      `select c.relname as table_name, k.conname, k.contype, pg_get_constraintdef(k.oid) as definition
       from pg_constraint k
       join pg_class c on c.oid = k.conrelid
       where k.connamespace = 'public'::regnamespace and c.relname <> 'pgmigrations'
       order by c.relname, k.conname`,
    );
    const indexes = await client.query(
      `select tablename, indexname, indexdef
       from pg_indexes
       where schemaname = 'public' and tablename <> 'pgmigrations'
       order by tablename, indexname`,
    );
    return {
      columns: columns.rows,
      constraints: constraints.rows,
      indexes: indexes.rows,
    };
  }

  // Own database, so the shared test schema stays untouched.
  async function withScratchDatabase(
    body: (scratch: {
      client: Client;
      migrate: (direction: "up" | "down") => Promise<unknown>;
    }) => Promise<void>,
  ): Promise<void> {
    const sharedUrl = inject("testDatabaseUrl");
    const scratchName = `scratch_${randomBytes(6).toString("hex")}_test`;
    const scratch = new URL(sharedUrl);
    scratch.pathname = `/${scratchName}`;
    const scratchUrl = scratch.toString();

    expect(isTestDatabaseName(scratchName)).toBe(true);
    expect(getDatabaseName(scratchUrl)).toBe(scratchName);
    expect(getDatabaseName(sharedUrl)).not.toBe(scratchName);

    const admin = new Client({ connectionString: toMaintenanceUrl(sharedUrl) });
    await admin.connect();
    let scratchClient: Client | null = null;
    let created = false;
    try {
      await admin.query(
        `create database ${admin.escapeIdentifier(scratchName)}`,
      );
      created = true;
      const migrate = (direction: "up" | "down") =>
        runner({
          databaseUrl: scratchUrl,
          dir: "db/migrations",
          migrationsTable: "pgmigrations",
          direction,
          log: () => {},
        });
      scratchClient = new Client({ connectionString: scratchUrl });
      await scratchClient.connect();
      await body({ client: scratchClient, migrate });
    } finally {
      await scratchClient?.end();
      if (created) {
        await admin.query(
          `drop database if exists ${admin.escapeIdentifier(scratchName)} with (force)`,
        );
      }
      await admin.end();
    }
  }

  it("restores the same schema", { timeout: 60_000 }, async () => {
    await withScratchDatabase(async ({ client, migrate }) => {
      await migrate("up");
      const first = await snapshot(client);
      expect(first.columns.length).toBeGreaterThan(0);

      await migrate("down");
      const afterDown = await snapshot(client);
      expect(afterDown).toEqual({ columns: [], constraints: [], indexes: [] });

      await migrate("up");
      expect(await snapshot(client)).toEqual(first);
    });
  });

  it(
    "records and removes the migration, and drops tables that hold rows",
    { timeout: 60_000 },
    async () => {
      await withScratchDatabase(async ({ client, migrate }) => {
        const recorded = async () =>
          (
            await client.query<{ name: string }>(
              "select name from pgmigrations order by name",
            )
          ).rows.map((row) => row.name);

        await migrate("up");
        expect(await recorded()).toEqual([
          expect.stringMatching(/^\d+_create-users-and-sessions$/),
        ]);

        const { rows } = await client.query<{ id: string }>(
          `insert into users (email, username, password_hash) values ('a@example.com', 'a', '${PHC_HASH}') returning id`,
        );
        await client.query(
          "insert into sessions (user_id, token_hash, expires_at) values ($1, $2, now() + interval '1 hour')",
          [rows[0].id, token(1)],
        );

        // Down drops sessions first, so it works without CASCADE even with child rows.
        await migrate("down");
        expect(await recorded()).toEqual([]);

        await migrate("up");
        for (const table of ["users", "sessions"]) {
          const { rows: count } = await client.query<{ n: number }>(
            `select count(*)::int as n from ${table}`,
          );
          expect(count[0].n).toBe(0);
        }
        // The defaults and checks work again after the round trip.
        const again = await client.query<{ id: string }>(INSERT_USER, [
          "a@example.com",
          "a",
          PHC_HASH,
        ]);
        expect(again.rows[0].id).toMatch(UUID_V7);
      });
    },
  );
});
