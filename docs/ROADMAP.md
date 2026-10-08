# Roadmap

Living status document. Decisions and structure are in [ARCHITECTURE.md](ARCHITECTURE.md).

## Done

- Next.js 16, React 19, TypeScript, Tailwind scaffold
- Architecture document with decisions (stack, deployment modes, navigation, data model draft)
- README, `/continue` prompt and agent rules in `AGENTS.md` (workflow, conventions, security, testing)
- Basic setup: `typecheck`, `test`, `check` scripts, Vitest, Zod, `.env.example`, env validation with a first test

## Next

1. Agent team setup (learning goal, to be presented in applications): custom agents in `.github/agents/`, starting with Developer and Security Reviewer, later Product Owner, Architect and Tester; handoffs between roles; document the concept and workflow in the repo
2. Docker Compose with PostgreSQL, `pg` and `node-pg-migrate`; integration tests against a test database
3. First migration (`users`, `sessions`)
4. Custom auth: register, login, logout, protected routes; Playwright for the first end-to-end flows
5. Hub shell: layout, sidebar navigation, dashboard
6. Modules in order: notes, planner, images, vault
7. Demo account seed script, Dockerfile and `docker-compose.yml` for self-hosting, public demo deployment

## Open decisions

- Auth details: `argon2` vs `bcrypt`, session lifetime, rate limiting
- Image storage adapter details
- Vault key derivation (PBKDF2 vs Argon2)

## Recent activity

Newest first.

- 2026-10-08: Added basic test setup (Vitest, Zod, `typecheck`/`test`/`check` scripts, `.env.example`) and the agent team step to the roadmap
- 2026-10-08: Defined agent workflow, conventions, security and testing rules in `AGENTS.md`; removed the entry limit for this list
- 2026-10-07: Added README, ROADMAP, agent rules and the `/continue` prompt for continuing work across chat sessions
- 2026-10-07: Re-authored commits with the private email and force-pushed
- 2026-10-07: Added `docs/ARCHITECTURE.md`
- 2026-10-07: Scaffolded the Next.js app
