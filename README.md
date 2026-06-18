<p align="center">
  <img src="./assets/logo-repo.png" alt="OpenSA - GTA San Andreas in your browser" width="420" />
</p>

<p align="center">
  <a href="https://opensa.cc"><img src="https://img.shields.io/badge/site-opensa.cc-2a7ae2" alt="Website" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-2a7ae2" alt="License: AGPL-3.0" /></a>
</p>

An open-source, from-scratch re-creation of the RenderWare engine — streaming the real San Andreas world, models and
physics, in the browser.

> Unofficial, non-commercial fan project. Not affiliated with Rockstar Games or Take-Two.

<p align="center">
  <a href="https://opensa.cc"><img src="https://img.shields.io/badge/%E2%96%B6%20Play%20the%20Demo-opensa.cc-F55C07?style=for-the-badge" alt="Play the demo" /></a>
</p>

<p align="center">
  <a href="https://www.youtube.com/watch?v=J2P4gQd9NQo" title="Watch the OpenSA launch trailer">
    <img src="https://img.youtube.com/vi/J2P4gQd9NQo/hqdefault.jpg" alt="OpenSA — GTA San Andreas in your browser — launch trailer" width="640" />
  </a>
</p>

## Blog

Dev notes and progress - in [`/blog`](./blog).

- 2026-06-18 - [I built GTA San Andreas in the browser in three weeks - solo, with Claude Code](./2026-06-18-i-built-gta-san-andreas-in-the-browser-in-three-weeks-solo-with-claude-code.md)

## What's inside

A TypeScript / three.js renderer for GTA San Andreas assets (RenderWare DFF/TXD, COL collision, IMG
archives, IPL/IDE world streaming) with a Rapier-physics player and vehicles. See the
[architecture overview](./docs/architecture.md) and the per-feature reference in [docs/features/](./docs/features/).

## Contributing

Contributions are welcome - see **[CONTRIBUTING.md](./CONTRIBUTING.md)** for setup, the dev workflow, and
conventions. First-time asset setup: [docs/development/getting-started.md](./docs/development/getting-started.md).

# License

Copyright (c) 2026 Aleksandrov Sergey

The OpenSA source code is licensed under the **GNU Affero General Public License v3.0**
(AGPL-3.0). You may use, modify and redistribute it under the terms of that license; if
you run a modified version as a network service, you must offer its source to users. See
[LICENSE](./LICENSE) for the full text.

**This license covers only the original OpenSA code.** GTA San Andreas assets, models,
maps, names and trademarks are the property of Rockstar Games / Take-Two Interactive and
are **not** covered by it or distributed with this project. OpenSA is an unofficial,
non-commercial fan project, not affiliated with Rockstar Games or Take-Two.
