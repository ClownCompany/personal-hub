# Roadmap

Living status document. Decisions and structure are in [ARCHITECTURE.md](ARCHITECTURE.md).

## Done

- Next.js 16, React 19, TypeScript, Tailwind scaffold
- Architecture document with decisions (stack, deployment modes, navigation, data model draft)
- README, `/continue` prompt and agent rules in `AGENTS.md` (workflow, conventions, security, testing)
- Basic setup: `typecheck`, `test`, `check` scripts, Vitest, Zod, `.env.example`, env validation with a first test
- Agent team (product-owner, architect, developer, security-reviewer, tester) in `.github/agents/` with handoffs, documented in `docs/AGENT-TEAM.md`
- CI with GitHub Actions (`.github/workflows/ci.yml`): `npm run check` and `npm run build` on Node 24 LTS (`.nvmrc`), README status badge
- Database foundation, part a: PostgreSQL 18 in `docker-compose.dev.yml` (`db:up`, `db:down`), `POSTGRES_*` variables in `.env.example`, README section
- Database foundation, part b: lazy `pg` pool singleton (`src/lib/db.ts`) with tests, `node-pg-migrate` scripts (`db:migrate`, `db:migrate:down`, `db:migrate:create`) and config in `db/node-pg-migrate.json`
- Database foundation, part c: integration-test harness (Vitest projects `unit` and `integration`, `globalSetup` creates and migrates `personal_hub_test`, tables truncated before each test, guarded `TEST_DATABASE_URL`) and a PostgreSQL service in CI; database foundation complete
- Agent team: first real feature built with it (database foundation); learnings in `docs/AGENT-TEAM.md`, agents adjusted

## Next

1. First migration (`users`, `sessions`)
   - Scope: one migration file with `uuidv7()` ids; schema as decided in "Users and sessions schema" in `docs/ARCHITECTURE.md`
   - `users`: lowercase unique `email` and `username` (username up to 32 characters, no `@`)
   - `sessions`: SHA-256 token hash as `bytea`, `expires_at`, cascade on user delete
   - Integration tests for the constraints; no data inserted
   - Deliberately NOT included: demo-user flag and vault salt (see steps 4 and 5)
2. Custom auth: register, login, logout, protected routes; Playwright for the first end-to-end flows
   - Login accepts email or username, distinguished by `@`; usernames may not contain `@`
3. Hub shell: layout, sidebar navigation, dashboard
4. Modules in order: notes, planner, images, vault
   - Vault: add the vault salt column on `users` (migration)
5. Demo account seed script, Dockerfile and `docker-compose.yml` for self-hosting, public demo deployment
   - Demo account: add the demo-user flag on `users` (migration)
   - The hosted demo database must run PostgreSQL 18 or newer, because the id default is `uuidv7()`

## Open decisions

- Auth details (`argon2id` is decided; session token format and storage are decided):
  - Node library for `argon2id` and its parameters (memory, iterations, parallelism)
  - Session lifetime
  - Rate limiting
- Email normalisation for non-ASCII characters (JavaScript `toLowerCase()` vs PostgreSQL `lower()`; decide with the auth story)
- Separate E2E database `personal_hub_e2e` for Playwright (decide with the auth step)
- Least-privilege database roles: separate roles for migrations and the app
- SSL mode for the hosted demo database (decide with the demo deployment)
- Whether Dependabot should also cover the `docker-compose` ecosystem
- Image storage adapter details
- Vault key derivation (Proposed: Argon2id via WASM with PBKDF2 fallback; open: parameters, bundle size, automatic or opt-in fallback)
- Agent team: orchestration with subagents instead of manual handoffs (deferred, maybe later)

## Known risks

- `npm audit` reports 5 high findings, all from one dev-only chain (`eslint-config-next` → `braces`, CVE-2026-93687, no patch available). Accepted; revisit when `braces` is patched. See "Security principles" in `docs/ARCHITECTURE.md`.

## Recent activity

Newest first.

- 2026-10-08: Recorded the users and sessions schema decisions (uuidv7 ids, lowercase email and username, hashed session tokens) and the argon2id decision; synced open decisions
- 2026-10-08: Recorded the agent team learnings, adjusted the developer, tester and product-owner agents and renamed numbered steps in the docs to topic names
- 2026-10-08: Added the integration-test harness (Vitest projects, test database with strict guards, truncate per test) and a PostgreSQL service in CI (database foundation, part c)
- 2026-10-08: Accepted the dev-only `braces` advisory (no patch available) and decided against a CI audit step
- 2026-10-08: Added the lazy `pg` pool (`src/lib/db.ts`) and `node-pg-migrate` setup with `db:migrate*` scripts (database foundation, part b)
- 2026-10-08: Added local PostgreSQL via `docker-compose.dev.yml` with `db:up`/`db:down` scripts and `.env.example` variables (database foundation, part a)
- 2026-10-08: Recorded the database foundation decisions (test DB, isolation, Compose, migrations, CI) in `docs/ARCHITECTURE.md` and split the database foundation step into parts a, b and c
- 2026-10-08: Documented the format check in the `check` scope and made the developer agent run `npm run format` before handover
- 2026-10-08: Ignored TypeScript major updates in Dependabot (typescript-eslint does not support TS 7 yet)
- 2026-10-08: CI hardening: concurrency, action SHA pinning, checkout without persisted credentials, job timeout, Dependabot for actions and npm
- 2026-10-08: Review cleanup: scaffold leftovers removed, stricter env validation with lazy getEnv and credential-leak test, ES2022 target, Prettier added
- 2026-10-08: Bumped the CI actions to v7 (Node 24 runtime)
- 2026-10-08: Documented that the agent chain per task is proposed and confirmed by the owner
- 2026-10-08: Added CI with GitHub Actions (`check` and `build` on Node 24 LTS) and made `typecheck` run `next typegen` first
- 2026-10-08: Made the `/continue` prompt agent-aware and confirmation-first; added CI to the roadmap
- 2026-10-08: Added the agent team (5 custom agents with handoffs) and `docs/AGENT-TEAM.md`
- 2026-10-08: Added basic test setup (Vitest, Zod, `typecheck`/`test`/`check` scripts, `.env.example`) and the agent team step to the roadmap
- 2026-10-08: Defined agent workflow, conventions, security and testing rules in `AGENTS.md`; removed the entry limit for this list
- 2026-10-07: Added README, ROADMAP, agent rules and the `/continue` prompt for continuing work across chat sessions
- 2026-10-07: Re-authored commits with the private email and force-pushed
- 2026-10-07: Added `docs/ARCHITECTURE.md`
- 2026-10-07: Scaffolded the Next.js app
