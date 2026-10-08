# Personal Hub

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

## Continuing with an AI chat

Open this folder (`personal-hub`) as the VS Code workspace, start a new chat and run the saved prompt:

```
/continue
```

It is defined in [.github/prompts/continue.prompt.md](.github/prompts/continue.prompt.md) and expands to:

> Read `AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md` and `docs/AGENT-TEAM.md`. Summarise the current state, name the next roadmap step, recommend which agent should handle it and ask for confirmation before starting.
