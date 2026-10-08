<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Overview

Personal Hub: a web app where a signed-in user manages notes, a weekly planner, images and a password vault behind one navigation menu. Built with Next.js, React and TypeScript as a portfolio project. It runs locally, self-hosted via Docker, and as a public demo.

## Commands

- `npm run dev`: start the dev server
- `npm run lint`: ESLint
- `npm run build`: production build
- `npm run typecheck`: TypeScript check
- `npm test`: run all tests once (`npm run test:watch` for watch mode)
- `npm run check`: lint, typecheck and tests in one go

## Workflow

- Always ask before making architecture or design decisions, and before implementing anything marked "Proposed" or "Open" in `docs/ARCHITECTURE.md`.
- For each task, propose which agents of the team (`.github/agents/`) should be involved and in what order, and wait for confirmation. Never skip or add agents on your own.
- Always ask before committing. Never push without explicit confirmation.
- Commit messages use Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`).
- Work in small steps; briefly state the plan before larger changes.
- Chat with the user in German. Code, comments, docs, commit messages and UI text are in English.

## Conventions

- TypeScript strict; no `any` without a reason.
- Feature code lives in `src/features/<module>`; modules do not import from each other. Shared code goes into `src/lib` or `src/components`.
- Pages in `src/app` stay thin and only compose feature code.
- Validate all external input with Zod (forms, Server Actions, database rows).
- Database access uses plain SQL via `pg`; no ORM. Migrations with `node-pg-migrate`.

## Security rules

- Every query and Server Action checks the session and filters by `user_id`.
- Use parameterised SQL only; never build queries from strings.
- Never log or return password hashes, session tokens or vault data.
- No secrets in code or in the repository; use `.env` and keep `.env.example` current.

## Testing

- Everything that gets implemented comes with tests (Vitest for logic, Playwright for core user flows).
- Test files live next to the code as `*.test.ts`.
- Database code is tested with integration tests against a real test database, not mocks.
- Write or update tests in the same change as the code, not afterwards.

## Definition of done

- `npm run check` passes (lint, typecheck, tests).
- Tests exist for the new or changed code.
- `docs/ROADMAP.md` and, if decisions changed, `docs/ARCHITECTURE.md` are updated.

## Project context

Read these before starting work:

- `docs/ARCHITECTURE.md`: stack, structure and decisions. Only items marked "Decided" are confirmed; discuss proposals before implementing them.
- `docs/ROADMAP.md`: current status and next steps.

## Roadmap maintenance

- Keep `docs/ROADMAP.md` up to date with every change: move finished items to "Done", adjust "Next" and "Open decisions".
- With every commit, add a one-line entry (date and what was worked on) at the top of "Recent activity" in `docs/ROADMAP.md`, included in that same commit.
- Record new decisions in `docs/ARCHITECTURE.md` as well.
