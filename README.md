<p align="center">
  <img src="./assets/logo-repo.png" alt="OpenSA — an open-source game engine compatible with RenderWare, in the browser" width="420" />
</p>

<p align="center">
  <a href="https://opensa.cc"><img src="https://img.shields.io/badge/site-opensa.cc-2a7ae2" alt="Website" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-2a7ae2" alt="License: AGPL-3.0" /></a>
</p>

An open-source, from-scratch **game engine, built compatible with RenderWare** — the engine behind GTA San
Andreas. Bring your own game files (or a total-conversion mod) and it streams the real world, models and
physics straight into the browser, with no install.

> Unofficial, non-commercial fan project. Not affiliated with Rockstar Games or Take-Two.

<p align="center">
  <a href="https://opensa.cc"><img src="https://img.shields.io/badge/%E2%96%B6%20Play%20the%20Demo-opensa.cc-F55C07?style=for-the-badge" alt="Play the demo" /></a>
</p>

<p align="center">
  <a href="https://www.youtube.com/watch?v=J2P4gQd9NQo" title="Watch the OpenSA launch trailer">
    <img src="https://img.youtube.com/vi/J2P4gQd9NQo/hqdefault.jpg" alt="OpenSA — an open-source game engine compatible with RenderWare, in the browser — launch trailer" width="640" />
  </a>
</p>

## Blog

Dev notes and progress - in [`/blog`](./blog).

- 2026-06-18 - [I built a RenderWare-compatible game engine in the browser that runs GTA San Andreas - solo, in three weeks, with Claude Code](./blog/2026-06-18-i-built-a-renderware-compatible-game-engine-in-the-browser-that-runs-gta-san-andreas.md)

## What's inside

A TypeScript / three.js engine for RenderWare assets (DFF/TXD models, COL collision, IMG archives, IPL/IDE
world streaming) with a Rapier-physics player and vehicles — compatible with GTA San Andreas and its mods /
total conversions. See the [architecture overview](./docs/architecture.md) and the per-feature reference in
[docs/features/](./docs/features/).

## Contributing

Contributions are welcome - see **[CONTRIBUTING.md](./CONTRIBUTING.md)** for setup, the dev workflow, and
conventions. First-time asset setup: [docs/development/getting-started.md](./docs/development/getting-started.md).

## License

Copyright (c) 2026 Aleksandrov Sergey

The OpenSA source code is licensed under the **GNU Affero General Public License v3.0**
(AGPL-3.0). You may use, modify and redistribute it under the terms of that license; if
you run a modified version as a network service, you must offer its source to users. See
[LICENSE](./LICENSE) for the full text.

**This license covers only the original OpenSA code.** GTA San Andreas assets, models,
maps, names and trademarks are the property of Rockstar Games / Take-Two Interactive and
are **not** covered by it or distributed with this project. OpenSA is an unofficial,
non-commercial fan project, not affiliated with Rockstar Games or Take-Two.

## Legal & takedowns

OpenSA is an **experiment** and an unofficial, **non-commercial fan project**. It is **not affiliated with,
endorsed by, or sponsored by Rockstar Games or Take-Two Interactive**, and it is **not** a way to obtain,
copy, or redistribute their games — it's an alternative way to run a copy you already own.

- **No game assets are included or distributed in this repository.** To run the engine you must supply files
  from your own legitimate copy of the game (or a community mod you have the right to use).
- "Grand Theft Auto", "GTA", "San Andreas", RenderWare, and related names, logos and trademarks belong to
  their respective owners. They are used here **only descriptively**, to state what the engine is compatible
  with — not as branding.
- The public demo at [opensa.cc](https://opensa.cc) may load community **mod** content; all such content
  remains the property of its respective authors.

If you are a rights holder and believe anything here infringes your rights, please open an issue at
<https://github.com/AlexSergey/opensa/issues> or email the maintainer, Aleksandrov Sergey, at
<gooddev.sergey@gmail.com>, and we will review it in good faith and, where appropriate, **remove the material
promptly**.
