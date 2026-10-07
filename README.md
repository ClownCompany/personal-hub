# Personal Hub

A personal web hub built with Next.js, React and TypeScript, and part of my web developer portfolio. After signing in, a user gets notes, a weekly planner, image management and a password vault behind one navigation menu.

The project is also an experiment in AI-assisted development: working rules, decisions and progress live in the repository so that any new AI chat session can pick up where the last one stopped.

## Documentation

- [AGENTS.md](AGENTS.md): rules for AI agents working on this repository
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): stack, structure and decisions
- [docs/ROADMAP.md](docs/ROADMAP.md): current status and next steps

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

> Read `AGENTS.md`, `docs/ARCHITECTURE.md` and `docs/ROADMAP.md`. Summarise the current state briefly and continue with the next step of the roadmap.
