# Roadmap

Living status document. Decisions and structure are in [ARCHITECTURE.md](ARCHITECTURE.md).

## Done

- Next.js 16, React 19, TypeScript, Tailwind scaffold
- Architecture document with decisions (stack, deployment modes, navigation, data model draft)
- README, `/continue` prompt and agent rules in `AGENTS.md` (workflow, conventions, security, testing)
- Basic setup: `typecheck`, `test`, `check` scripts, Vitest, Zod, `.env.example`, env validation with a first test
- Agent team (product-owner, architect, developer, security-reviewer, tester) in `.github/agents/` with handoffs, documented in `docs/AGENT-TEAM.md`
- CI with GitHub Actions (`.github/workflows/ci.yml`): `npm run check` and `npm run build` on Node 24 LTS (`.nvmrc`), README status badge

## Next

1. Try the agent team on the first real feature and record learnings in `docs/AGENT-TEAM.md`; adjust the agents where needed
2. Docker Compose with PostgreSQL, `pg` and `node-pg-migrate`; integration tests against a test database (add a PostgreSQL service to CI)
3. First migration (`users`, `sessions`)
4. Custom auth: register, login, logout, protected routes; Playwright for the first end-to-end flows
5. Hub shell: layout, sidebar navigation, dashboard
6. Modules in order: notes, planner, images, vault
7. Demo account seed script, Dockerfile and `docker-compose.yml` for self-hosting, public demo deployment

## Open decisions

- Auth details: `argon2` vs `bcrypt`, session lifetime, rate limiting
- Image storage adapter details
- Vault key derivation (PBKDF2 vs Argon2)
- Agent team: orchestration with subagents instead of manual handoffs (deferred, maybe later)

## Recent activity

Newest first.

- 2026-10-08: Added CI with GitHub Actions (`check` and `build` on Node 24 LTS) and made `typecheck` run `next typegen` first
- 2026-10-08: Made the `/continue` prompt agent-aware and confirmation-first; added CI to the roadmap
- 2026-10-08: Added the agent team (5 custom agents with handoffs) and `docs/AGENT-TEAM.md`
- 2026-10-08: Added basic test setup (Vitest, Zod, `typecheck`/`test`/`check` scripts, `.env.example`) and the agent team step to the roadmap
- 2026-10-08: Defined agent workflow, conventions, security and testing rules in `AGENTS.md`; removed the entry limit for this list
- 2026-10-07: Added README, ROADMAP, agent rules and the `/continue` prompt for continuing work across chat sessions
- 2026-10-07: Re-authored commits with the private email and force-pushed
- 2026-10-07: Added `docs/ARCHITECTURE.md`
- 2026-10-07: Scaffolded the Next.js app
