# Personal Hub

[![CI](https://github.com/ClownCompany/personal-hub/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/ClownCompany/personal-hub/actions/workflows/ci.yml)

A personal web hub built with Next.js, React and TypeScript, and part of my web developer portfolio. After signing in, a user gets notes, a weekly planner, image management and a password vault behind one navigation menu.

The project is also an experiment in AI-assisted development: working rules, decisions and progress live in the repository so that any new AI chat session can pick up where the last one stopped.

## Documentation

- [AGENTS.md](AGENTS.md): rules for AI agents working on this repository
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): stack, structure and decisions
- [docs/ROADMAP.md](docs/ROADMAP.md): current status and next steps
- [docs/AGENT-TEAM.md](docs/AGENT-TEAM.md): the custom AI agent team and its workflow

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Run the database locally

Requires Docker. PostgreSQL runs in a container; the app runs on the host.

```bash
cp .env.example .env   # adjust values if needed
npm run db:up          # start PostgreSQL and wait until it is healthy
npm run db:down        # stop it; data stays in the Docker volume
```

Migrations are single `.sql` files in `db/migrations` with `-- Up Migration` and `-- Down Migration` markers. The scripts read `DATABASE_URL` from `.env`; variables already set in the environment take precedence.

```bash
npm run db:migrate                     # apply all pending migrations
npm run db:migrate:down                # revert the last migration
npm run db:migrate:create -- add-notes # create a new migration file
```

`db:migrate:down` is guarded: it refuses unless `DATABASE_URL` points to a local host and the database is `personal_hub` or ends in `_test`, and it accepts only a migration count and `--dry-run`.

## Run the tests

```bash
npm run db:up           # integration tests need PostgreSQL
npm test                # unit and integration tests
npm run test:unit       # unit tests only, no database needed
npm run test:integration
```

Integration tests (`*.integration.test.ts`) run against a separate database, `personal_hub_test`, on the same server. `TEST_DATABASE_URL` in `.env` points to it; it must differ from `DATABASE_URL`, use a local host (`localhost`, `127.0.0.1` or `[::1]`), include a user name and an explicit port (for example `localhost:5432`), have no query parameters except `sslmode`, and the database name must match `[A-Za-z0-9_]+_test`. `PG*` environment variables (`PGPORT`, `PGUSER`, ...) are not a supported way to configure the test connection. The database is created and migrated automatically, and all tables are cleared before each test. Without a running database the integration run fails with a hint instead of being skipped.

## Continuing with an AI chat

Open this folder (`personal-hub`) as the VS Code workspace, start a new chat and run the saved prompt:

```
/continue
```

It is defined in [.github/prompts/continue.prompt.md](.github/prompts/continue.prompt.md) and expands to:

> Read `AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md` and `docs/AGENT-TEAM.md`. Summarise the current state, name the next roadmap step, recommend which agent should handle it and ask for confirmation before starting.
