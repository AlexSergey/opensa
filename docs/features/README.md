# Feature reference

Per-feature state of the engine: what is implemented (supported formats/cases), key files and
known gaps. Maintained for three purposes: finding unimplemented cases, writing tests for the
implemented ones, and assembling the release changelog.

| Feature                                | Doc                                                |
| -------------------------------------- | -------------------------------------------------- |
| DFF parser (models)                    | [dff-parser.md](dff-parser.md)                     |
| TXD parser + textures                  | [txd-textures.md](txd-textures.md)                 |
| IMG archive + asset cache              | [img-archive.md](img-archive.md)                   |
| Asset loader (chunk download/cache)    | [asset-loader.md](asset-loader.md)                 |
| Map pipeline (DAT/IDE/IPL → streaming) | [map-pipeline.md](map-pipeline.md)                 |
| Collision + physics                    | [collision-physics.md](collision-physics.md)       |
| World lighting (SA prelit)             | [world-lighting.md](world-lighting.md)             |
| Time, night content, light sources     | [night-and-time.md](night-and-time.md)             |
| Weather + environment (sky/water/fog)  | [weather-environment.md](weather-environment.md)   |
| Vehicles                               | [vehicles.md](vehicles.md)                         |
| Character                              | [character.md](character.md)                       |
| Animated map objects (UV + IFP)        | [animated-map-objects.md](animated-map-objects.md) |
| Procedural ground clutter (procobj)    | [procobj.md](procobj.md)                           |
| Road-sign text (2dfx type 7)           | [roadsign-text.md](roadsign-text.md)               |
| World effects (2dfx particles)         | [world-effects.md](world-effects.md)               |
| Breakable objects                      | [breakable-objects.md](breakable-objects.md)       |
| Game mods (WorldMod) + wind            | [mods.md](mods.md)                                 |
| Zones, HUD, debug tooling              | [zones-hud-debug.md](zones-hud-debug.md)           |
| UI shell (boot/menu/loading/pause)     | [ui-shell.md](ui-shell.md)                         |
