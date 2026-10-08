# Architecture

Personal Hub is a single Next.js application (App Router) organised as a modular monolith.
Each feature (notes, planner, images, vault) is an isolated module behind a shared navigation shell.

## Stack

| Concern                | Choice                                                                                                                                                 | Status                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- |
| Framework              | Next.js 16 (App Router), React 19, TypeScript                                                                                                          | Decided                    |
| Styling                | Tailwind CSS 4                                                                                                                                         | Decided (scaffold default) |
| Database               | PostgreSQL (runs locally in Docker, self-hosted, and in the cloud)                                                                                     | Decided                    |
| ORM                    | None for now; plain SQL with a PostgreSQL driver                                                                                                       | Decided                    |
| DB driver / migrations | `pg` + `node-pg-migrate` (SQL migration files)                                                                                                         | Decided                    |
| Auth                   | Custom: argon2id password hashes, DB sessions, HttpOnly cookie                                                                                         | Decided                    |
| Mutations              | Server Actions (REST only where needed, e.g. image upload/serving)                                                                                     | Decided                    |
| Validation             | Zod at every boundary                                                                                                                                  | Decided                    |
| Image storage          | Storage adapter, metadata in DB                                                                                                                        | Proposed                   |
| Vault                  | Client-side encryption (Web Crypto); key derivation Argon2id via WASM, PBKDF2 fallback                                                                 | Proposed                   |
| Tests                  | Vitest (unit, integration against a real test database), Playwright (few end-to-end flows, added with the first UI flows); test files next to the code | Decided                    |
| UI language            | English                                                                                                                                                | Decided                    |

Only items marked "Decided" are confirmed. Everything else is a proposal and is discussed one by one before implementation.

## Deployment

One codebase, three ways to run it. All differences are configured through environment variables.

| Mode        | Where                                                       | Purpose                         | Data                                   |
| ----------- | ----------------------------------------------------------- | ------------------------------- | -------------------------------------- |
| Development | `npm run dev` + PostgreSQL in Docker                        | building and presenting locally | seed / demo data                       |
| Private     | Docker Compose (app + PostgreSQL) on the owner's computer   | real daily use                  | real data, persisted in Docker volumes |
| Public demo | Cloud (hosted Next.js + hosted PostgreSQL + object storage) | live link for applications      | demo data only                         |

Consequences:

- PostgreSQL everywhere; SQLite is not used because serverless hosting has no persistent file system.
- The hosted demo database must run PostgreSQL 18 or newer (`uuidv7()`, see "Users and sessions schema"); otherwise the id default falls back to `gen_random_uuid()`.
- Image storage goes through a storage adapter: local volume (development, private) or object storage (public demo).
- The app ships a `Dockerfile` and `docker-compose.yml` for the private mode.
- Secrets and connection strings live in `.env`; `.env.example` documents all variables.
- The vault must not hold real credentials on the public demo.

### Demo account

- A seeded demo user with fake notes, planner entries and images, created by a seed script.
- A "Try demo" login on the public demo; the demo user cannot change the password or delete the account.
- The public demo resets its data on a schedule and applies rate limits and upload size limits.
- The same demo user can be seeded locally to present the app without exposing real data.

## Database foundation

Status: Decided (database foundation). Open points are listed under "Open decisions".

### Local PostgreSQL (part a)

- One PostgreSQL instance with two databases: `personal_hub` (development) and `personal_hub_test` (integration tests).
- Only PostgreSQL is containerised during development; the app runs on the host. The `Dockerfile` and the app service belong to the demo deployment step.
- The development file is `docker-compose.dev.yml`. `docker-compose.yml` is reserved for the self-hosting setup in the demo deployment step (required secrets, no weak defaults). npm scripts wrap `-f docker-compose.dev.yml`.
- Image `postgres:18` (Debian variant, floating minor); the data volume is mounted at `/var/lib/postgresql`.
- Development credentials come from `.env` via `${VAR:-default}`; the port is bound to `127.0.0.1` and overridable with `POSTGRES_PORT`.
- `.env` stays plain `KEY=value`. `.env.example` states that `DATABASE_URL` duplicates the Compose user, password and port.
- The migration CLI loads `.env` via `node --env-file-if-exists=.env`; there is no `dotenv` dependency.

### Pool and migrations (part b)

- The pool is a lazy singleton stored on `globalThis` and configured through `getEnv()`. There is no top-level pool, so `next build` needs no environment variables. An `end()`/reset hook is exposed for tests.
- Migrations live in `db/migrations`, one `.sql` file per migration with `-- Up Migration` and `-- Down Migration` markers. Shared options are in a JSON config file.
- Scripts: `db:migrate`, `db:migrate:down`, `db:migrate:create`, plus `db:up` and `db:down` for the Compose file.
- Guard for the destructive down migration (Decided, security review):
  - `npm run db:migrate:down` refuses to run unless `DATABASE_URL` points to a local host (`localhost`, `127.0.0.1`, `[::1]`) and the database name is `personal_hub` or ends in `_test`. Otherwise it exits with a static message that does not echo the URL or credentials. There is no override flag. Like the `TEST_DATABASE_URL` guard, it also requires an explicit user name and port, because an empty user or port would fall back to `PGUSER` or `PGPORT`.
  - It is a small Node script (location chosen by the developer, for example `scripts/db-migrate-down.mjs`) that loads `DATABASE_URL` like the other db scripts (`.env`, existing environment variables win), validates it and then calls the `node-pg-migrate` CLI. `db:migrate` (up) and `db:migrate:create` stay unchanged.
  - Limitation: a private-mode database named `personal_hub` that is reachable on localhost is not protected. Deployment steps use their own tooling.

### Integration tests (part c)

- `TEST_DATABASE_URL` has its own test-only Zod schema, not part of the app `envSchema`.
- Guards: the URL differs from `DATABASE_URL`, the database name ends in `_test`, and error messages never echo URLs. Decided extension (security review):
  - Differs from `DATABASE_URL` by normalised host, port and database name (`localhost`, `127.0.0.1` and `[::1]` count as one server; trailing slash and query are ignored), besides the plain string comparison.
  - The name matches `^[A-Za-z0-9_]+_test$` and is at most 63 bytes; any `%` in the path is rejected, so the validated name is exactly the one the driver connects to.
  - Local host only (`localhost`, `127.0.0.1`, `[::1]`) and never empty (an empty host falls back to `PG*` environment variables).
  - No query parameters except a valid `sslmode`, and no fragment; the driver turns other parameters (`host`, `port`, `user`, `options`, ...) into connection options that bypass the checks. A `%` in the query is rejected too (sslmode values never need escapes).
  - Any `%` not followed by two hex digits is rejected anywhere in the URL: the driver re-encodes the whole URL when it sees one, which could make it parse differently from the validator. Valid escapes such as `%40` in the password keep working.
  - An explicit port and a non-empty user name are required. For an empty port, user, password or `sslmode` the driver falls back to `PGPORT`, `PGUSER`, `PGPASSWORD` and `PGSSLMODE` (and `PGOPTIONS`), so `PG*` variables are not a supported way to configure the test connection. An empty password is still allowed (a trusted local server needs none, and `PGPASSWORD` cannot redirect the connection); `sslmode` and `PGOPTIONS` do not change the target. The default port is only assumed for `DATABASE_URL` in the same-database comparison.
  - `globalSetup` builds every driver client inside its error sanitiser, so a URL the driver cannot parse (for example `%FF` in the password) never leaks through a raw error.
  - A remote opt-in (for example `ALLOW_REMOTE_TEST_DB`) was deliberately not added.
- `truncateAllTables` checks `current_database()` and refuses to run unless the name is a valid `_test` name. The integration setup resets the env cache and closes the pool before setting `DATABASE_URL`.
- `globalSetup` forwards only a short error code and a hint, never the raw driver or migration runner error.
- The integration setup injects the test URL into `process.env.DATABASE_URL`, so app code stays unchanged.
- Migrations run once in Vitest `globalSetup` through the `node-pg-migrate` `runner()` API with an explicit URL. `globalSetup` also creates the test database if it is missing.
- Before each test, all tables except `pgmigrations` are cleared with `TRUNCATE ... RESTART IDENTITY CASCADE`. Integration files run serially.
- Upgrade path if the suite gets slow: one database per test file (template database).
- Integration tests run in the default `npm test` through two Vitest projects, `unit` and `integration`. Integration files are named `*.integration.test.ts` and sit next to the code.
- If the database is unreachable, `globalSetup` fails loudly with a hint (`npm run db:up`); it never skips silently.

### CI

- GitHub Actions uses `services: postgres` with a `pg_isready` health check, on the same major version as Compose. A comment in `ci.yml` points to the Compose tag.
- `npm run build` stays in a step without database variables.

## Folder structure

```
src/
  app/                     # routing only: thin pages and layouts
    (auth)/                # no menu
      layout.tsx
      login/page.tsx
      register/page.tsx
    (hub)/                 # shell with navigation + auth check
      layout.tsx
      dashboard/page.tsx
      notes/page.tsx
      planner/page.tsx
      images/page.tsx
      vault/page.tsx
    api/                   # only where Server Actions do not fit
  features/                # one folder per module
    auth/ notes/ planner/ images/ vault/
      components/
      actions.ts           # writes (Server Actions)
      queries.ts           # reads
      schemas.ts           # Zod schemas
      *.test.ts
  components/
    layout/                # Sidebar, Topbar, MobileNav, UserMenu
    ui/                    # reusable primitives
  lib/                     # cross-cutting: db, auth, session, crypto, storage, navigation
db/migrations/           # SQL migration files
docs/
```

Rules:

- Feature modules never import from each other; shared code goes into `lib/` or `components/`.
- Pages in `app/` only compose feature components and queries.

## Layouts and navigation

```mermaid
flowchart TD
  Root[Root layout] --> Auth["(auth) layout"]
  Root --> Hub["(hub) layout: shell"]
  Hub --> Nav[Sidebar / menu]
  Hub --> Content[Page content]
  Nav -.-> D[Dashboard]
  Nav -.-> N[Notes]
  Nav -.-> P[Planner]
  Nav -.-> I[Images]
  Nav -.-> V[Vault]
```

- The `(hub)` layout renders the shell once; navigating between features keeps the menu mounted.
- Menu entries live in one list, `src/lib/navigation.ts` (label, route, icon). A new module is one folder plus one entry.
- The active item is highlighted by a small client component using `usePathname()`; the shell stays a Server Component.
- Responsive: fixed sidebar on desktop, collapsible menu on mobile.
- Each module has `loading.tsx` and `error.tsx` so the menu stays visible while content loads or fails.

## Request flow

```mermaid
flowchart LR
  UI[Server / Client Components] --> A[Server Action]
  A --> V[Zod validation]
  V --> S[Session + ownership check]
  S --> Q[SQL queries]
  Q --> DB[(PostgreSQL)]
```

- Reads happen in Server Components via `queries.ts`; writes go through `actions.ts`.
- Every action and query verifies the session and filters by `user_id`.

## Access control

1. `proxy.ts` redirects unauthenticated requests to `/login` (first gate, optimistic only).
2. The `(hub)` layout checks the session again.
3. Every Server Action and query re-checks the session and ownership. This is the authoritative check.

## Data model (rough)

```
users ─┬─< notes            (title, content, tags)
       ├─< planner_entries  (title, start, end, recurrence)
       ├─< images           (filename, storage_key, mime, size, album)
       └─< vault_items      (encrypted_blob, iv)      users.vault_salt
```

The database uses `snake_case` for tables and columns; the sketch is rough and only `users` and `sessions` are fixed (see below). Every module table carries `user_id` and is always queried by it.

## Users and sessions schema

Status: Decided (first migration: `users`, `sessions`).

### Conventions

- Names: `snake_case`, plural table names, `id`, `user_id`, `created_at timestamptz not null default now()`.
- Ids: `uuid` with default `uuidv7()` (native in PostgreSQL 18, see "Deployment"). Tests never assert concrete ids. Every later table references `users.id` as `uuid`.
- Constraint and index names are explicit and PostgreSQL-style: `<table>_pkey`, `<table>_<column>_key`, `<table>_<column>_fkey`, `<table>_<column>_idx`, `<table>_<column>_<rule>_check`.
- No PostgreSQL extensions (no `citext`, no `pg_cron`).
- One migration file `<utc>_create-users-and-sessions.sql`. Down drops `sessions`, then `users`, without `CASCADE`. No `CONCURRENTLY`.
- Not part of this migration: the demo flag (`is_demo`, demo account step) and `vault_salt` (vault step); both arrive as later migrations.

### `users`

- Columns: `id uuid` primary key (`users_pkey`), `email text not null`, `username text not null`, `password_hash text not null`, `created_at`.
- Usernames (Decided, supersedes the earlier casing-preserving rule): stored lowercase, like `email`, and at most 32 characters. The app lowercases input with a Zod transform before every query and insert, so users may type uppercase letters in the form and at login; the stored value and everything shown later is lowercase. The database enforces this with `CHECK (username = lower(username))` (`users_username_lower_check`) and plain `UNIQUE` on `username` (`users_username_key`). Case-insensitive uniqueness ('Alice' versus 'alice') follows from the lowercase invariant. No `citext`, no extension, no `lower()` index. The generated `username_key` column was rejected because the owner does not want an extra column.
- Usernames are ASCII (`[a-z0-9._-]`), and the database now guarantees it (`users_username_charset_check`, Decided, security review). `lower()` is therefore an identity on every valid stored value in any locale, and the lowercase check cannot reject what the app produces. The charset check also rejects zero-width characters and homoglyphs (for example Cyrillic letters) that would otherwise create look-alike usernames.
- Email works the same way: the app lowercases it (Zod transform) before every query and insert, and the database enforces `CHECK (email = lower(email))` plus plain `UNIQUE` (`users_email_key`).
- Email is printable ASCII without spaces (`users_email_charset_check`, Decided). Internationalised addresses are not supported; the domain is entered in punycode. Zod enforces the same rule. This resolves the former open item on non-ASCII email normalisation: for ASCII input, JavaScript `toLowerCase()` and PostgreSQL `lower()` agree in every locale, so `users_email_lower_check` cannot reject what the app produces.
- DB-side format rules are invariants, so a username can never equal an email and the `@` split at login is unambiguous. The character classes use explicit ASCII ranges, which are locale-independent:
  - `username`: lowercase (`users_username_lower_check`), no `@` (`users_username_no_at_check`), 1 to 32 characters, which also means non-empty (`users_username_length_check`), and `[a-z0-9._-]` only (`users_username_charset_check`). The lowercase and no-`@` checks are redundant with the charset check but stay, and are tested.
  - `email`: lowercase (`users_email_lower_check`), contains `@` (`users_email_has_at_check`), non-empty and at most 254 characters (`users_email_length_check`), printable ASCII without spaces (`users_email_charset_check`).
  - Everything else stays in Zod: full email format, minimum username length, reserved names, and the same charset rules as the database (for readable form errors).
- Lookups (auth story): by username with `username = $1`, by email with `email = $1`. The value is the Zod-normalised one (one normaliser, in one place); there is no `lower($1)` on raw input. Both stay parameterised.
- Unique violations (`23505`) are mapped through `error.constraint`: `users_username_key` to the username field, `users_email_key` to the email field.
- `password_hash`: `CHECK (password_hash like '$argon2id$%')` (`users_password_hash_prefix_check`, Decided, replaces the earlier decision of no prefix check) and the non-empty CHECK (`users_password_hash_not_empty_check`), which is redundant with the prefix check but stays and is tested. Reason: `argon2id` is Decided and every library emits the PHC prefix; changing the algorithm later is a migration. No length cap.
- No `updated_at` for now. Trigger versus application code is decided once, when `notes` (the first table that needs it) arrives.

### `sessions`

- Token: 32 random bytes from `crypto.randomBytes`, base64url in the HttpOnly cookie. The database stores only `SHA-256(token)`. argon2 is deliberately not used for high-entropy tokens; HMAC with a server secret was rejected for now.
- Columns: `id uuid` primary key (`sessions_pkey`), `user_id uuid not null references users(id) on delete cascade` (`sessions_user_id_fkey`), `token_hash bytea not null`, `created_at`, `expires_at timestamptz not null`.
- `token_hash` is separate from `id`, with `CHECK (octet_length(token_hash) = 32)` (`sessions_token_hash_length_check`) and `UNIQUE` (`sessions_token_hash_key`).
- Expiry: only `created_at` and `expires_at`, with `CHECK (expires_at > created_at)` (`sessions_expires_at_check`). Auth checks `expires_at > now()` in SQL, using the database clock. A nullable `last_used_at` can be added later by migration.
- Indexes: unique `token_hash`, plus `sessions_user_id_idx` and `sessions_expires_at_idx`.
- Cleanup: the migration only adds the `expires_at` index. Expired sessions are deleted in the auth story (on login and logout) and in the demo reset; no `pg_cron`.
- No session metadata (no user agent, no IP).

### Consequences

- The auth story normalises email and username in Zod before every query and insert; lookups use `username = $1` and `email = $1` with the normalised value. Unique violations (`23505`, `error.constraint`) are mapped to field errors as listed under "`users`".
- Tests for the first migration: inserting 'alice' and then 'Alice' directly fails with `users_username_lower_check`; the app path normalises 'Alice' to 'alice', which collides with 'alice' and fails with `23505` and `error.constraint = 'users_username_key'`; a username with `@`, an empty one and one longer than 32 characters are rejected by `users_username_no_at_check` and `users_username_length_check`; uppercase letters in a username or an email are rejected by `users_username_lower_check` and `users_email_lower_check`.
- Tests for the charset and hash checks: a username with a zero-width character or a Cyrillic homoglyph is rejected by `users_username_charset_check`; an email with non-ASCII, whitespace or control characters is rejected by `users_email_charset_check`; a `password_hash` without the `$argon2id$` prefix is rejected by `users_password_hash_prefix_check`, an empty one by `users_password_hash_not_empty_check`.
- Test for the guard script: `db:migrate:down` refuses a non-local host and a database name other than `personal_hub` or `*_test`, prints a static message without the URL or credentials, and does not call the migration CLI; it passes for a local `personal_hub_test` URL.
- Roadmap impact: the users-and-sessions migration (new checks `users_username_charset_check`, `users_email_charset_check`, `users_password_hash_prefix_check`), its integration tests and the guard script with its test are added to the migration work. The auth story's Zod schemas normalise the username and email, accept `[a-z0-9._-]` (32 characters at most) and printable ASCII without spaces respectively, and cap the plaintext password length (see "Auth: password hashing").
- Later module tables get `user_id uuid not null references users(id) on delete cascade` plus a `user_id` index.
- Stored files of images and the vault do not cascade: the app deletes them on account deletion. The demo reset can be `delete from users`.

## Vault

- A separate master password derives the encryption key in the browser and encrypts with AES-GCM. It is never sent to the server.
- Key derivation (Proposed, decided when the vault step comes up): Argon2id in the browser, which needs WASM (for example `hash-wasm`) because Web Crypto has no Argon2, with PBKDF2 (high iteration count) via Web Crypto as fallback when WASM is unavailable.
  - Open: Argon2id and PBKDF2 parameters, bundle size of the WASM library, and whether the fallback is automatic or opt-in.
- The vault is locked by default, unlocked only in client memory, and locks again on leaving the page or after a timeout.
- The server only stores ciphertext, IV and salt.
- Treat it as a portfolio demo until reviewed; do not store real credentials.

## Security principles

- Authorisation is enforced on the server, never only in the UI.
- Uploads: validate type and size, never trust client file names.
- Secrets live in `.env`, never in the repository.
- Database error handling (Decided, security review): database errors are never logged or returned wholesale, because `error.detail` and `error.message` contain the failing row (including the password hash or token hash) and the server log would keep it. Only `code` and `constraint` are used, through one central mapper in `lib/db` (built in the auth story, with a unit test that a mapped error does not contain the hash).
- Dependency audit: Decided. CI has no `npm audit` step. The `braces` advisory (CVE-2026-93687, no patched version yet) reaches us only through the dev dependency chain `eslint-config-next` → `fast-glob` → `micromatch`; `npm audit --omit=dev` reports 0. It is accepted until `braces` is patched; Dependabot reports updates. Do not use `npm audit fix --force`, which would downgrade `eslint-config-next` to 14.

## Auth: password hashing

Status: Decided. Passwords are hashed with `argon2id`, not `bcrypt`: it is the first OWASP recommendation and has no 72-byte input limit. Hash values are never logged or returned.

Zod rule for the auth story (Decided): a maximum plaintext password length (for example 128 characters; the exact value is fixed in the auth story) protects against denial of service through very long inputs.

## Auth story: proposals

Status: Proposed / Open, none of these is Decided. They are discussed one by one with the auth story.

- Session expiry:
  - Compute `expires_at` in SQL with the database clock (`now() + interval`).
  - Optional upper-bound CHECK on `expires_at` (for example 90 days after `created_at`).
  - Open: idle timeout through `last_used_at`.
- One helper `getSessionByTokenHash` that always joins `users` and filters `expires_at > now()`. Tests for expired sessions and for cleanup on login.
- Auth-story test that the stored value equals `sha256(token)`.
- Cookie: `Secure`, `SameSite`, `__Host-` prefix, `Max-Age` matching `expires_at`, a fresh token on every login, and all sessions revoked on password change.
- Login and registration:
  - Generic login error, plus a dummy-hash verification when the user is not found (timing).
  - Open: how to handle the disclosure of "email already taken" at registration.
  - Rate limiting on login and registration before the demo goes public.
- Optional composite foreign keys for child resources of later modules: `unique (id, user_id)` on the parent so the child can reference `(parent_id, user_id)`.
- Images and vault: on account deletion, delete the stored files first or record a deletion job, since files do not cascade.

## Open decisions

- Auth details (options are prepared by the architect with the auth story):
  - Node library for `argon2id`: native `argon2`, `@node-rs/argon2` or WASM such as `hash-wasm`. Consider Docker self-hosting, the hosted demo platform and Next.js `serverExternalPackages`.
  - `argon2id` parameters (memory, iterations, parallelism).
  - Session lifetime and idle timeout (token format and storage are decided, see "Users and sessions schema"; options under "Auth story: proposals").
  - Rate limiting.
  - Cookie attributes, login error handling and the other proposals under "Auth story: proposals".
- Vault key derivation (Proposed, see "Vault"): parameters, bundle size, automatic or opt-in PBKDF2 fallback.
- Separate E2E database `personal_hub_e2e` for Playwright (decide with the auth step).
- Least-privilege database roles: separate roles for migrations and the app, to be decided before the self-hosting and demo step. Reason: the runtime role currently owns the tables, so it can alter or drop them.
- SSL mode for the hosted demo database (decide with the demo deployment).
- Whether Dependabot should also cover the `docker-compose` ecosystem.
