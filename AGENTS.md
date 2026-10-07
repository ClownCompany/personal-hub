<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project context

Read these before starting work:

- `docs/ARCHITECTURE.md`: stack, structure and decisions. Only items marked "Decided" are confirmed; discuss proposals before implementing them.
- `docs/ROADMAP.md`: current status and next steps.

## Roadmap maintenance

- Keep `docs/ROADMAP.md` up to date with every change: move finished items to "Done", adjust "Next" and "Open decisions".
- With every commit, add a one-line entry (date and what was worked on) at the top of "Recent activity" in `docs/ROADMAP.md`, included in that same commit.
- Keep at most the 5 most recent entries in "Recent activity"; delete older ones.
- Record new decisions in `docs/ARCHITECTURE.md` as well.
