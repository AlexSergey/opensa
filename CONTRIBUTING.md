# Contributing to OpenSA

Thanks for your interest! OpenSA is an open-source, from-scratch re-creation of the RenderWare engine
running GTA San Andreas in the browser. It's an **unofficial, non-commercial fan project** — contributions
are welcome.

## Ways to contribute

- **Bugs / ideas** — open an [issue](https://github.com/AlexSergey/opensa/issues) (a repro, screenshot, or
  world coordinates help a lot).
- **Code / docs** — open a pull request (see the workflow below).
- **Write-ups** — dev notes are welcome in [`/blog`](./blog).

## Development setup

You supply the game assets from your own copy of GTA: San Andreas — the build repacks them into compact
archives the app loads. Full steps: **[docs/development/getting-started.md](./docs/development/getting-started.md)**.

```bash
npm install
npm run build:game:original   # pack your game-src/original into static/<version>/ (one-time / on asset change)
npm run serve:static          # serve the built archives (required by the app)
npm run dev                   # Vite dev server — open the printed URL
```

## Quality gates (must pass before a PR)

```bash
npm run lint                  # tsc --noEmit + eslint
npm test                      # Vitest unit suite
npm run e2e                   # Playwright browser lane (needs the built archives)
```

- **Every code change ships with tests** in the same PR. Pure logic → Vitest units; GL/DOM/app-loop code →
  the Playwright `e2e/` lane (see [docs/development/test-coverage.md](./docs/development/test-coverage.md)
  and [docs/development/e2e.md](./docs/development/e2e.md)).
- Test layout convention: negative cases first, then positive, in separate `describe` blocks.

## Coding style

TypeScript strict, functional React + hooks, small focused files, explicit over magic, minimal diffs. The
full house style (also used by the project's AI tooling) lives in [CLAUDE.md](./CLAUDE.md). `eslint`/`tsc`
enforce most of it.

## Commits & pull requests

- **Conventional Commits** (`feat:`, `fix:`, `docs:`, `chore:`, …) — enforced by commitlint.
- Branch off `main`; keep PRs small and focused; don't refactor unrelated code.
- Make sure `npm run lint`, `npm test`, and (where relevant) `npm run e2e` pass.
- Describe what changed and why; link the issue if there is one.

## Where things live

- `src/` — the engine, game, renderware parsers, asset loader/VFS, and UI shell.
- [docs/plans/](./docs/plans/) — numbered design plans (the "why" behind each feature).
- [docs/features/](./docs/features/) — per-feature reference: what's implemented + known gaps.
- [docs/development/](./docs/development/) — build, tests, scripts, and the
- [in-game tools](./docs/development/in-game-tools.md) (F2 debugger + viewers).

## License

By contributing, you agree your contributions are licensed under the project's **CC BY-NC 4.0**
(non-commercial) license. See [LICENSE.md](./LICENSE.md).
