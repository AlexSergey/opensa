# Open issues

Known unsolved problems that have been investigated but **deliberately shelved** — no shipped fix
yet. Each file records the symptom, the root cause we found, the approaches we tried (and why each
fell short), and pointers for whoever picks it up later. Same spirit as `docs/features/*`, but for
problems rather than implemented features.

These are NOT plans (`docs/plans/*` are for work we intend to do soon) and NOT features
(`docs/features/*` are for things that work). When an open issue gets a real fix, promote it to a
plan/feature and delete the entry here.

| Issue                                                       | Doc                                                      | Status                                                                                                                 |
| ----------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Alpha cutout black edge (foliage/fences)                    | [alpha-edge.md](alpha-edge.md)                           | shelved — best partial fixes leave a residual artifact                                                                 |
| "Locked" (anti-rip protected) DFF/TXD models                | [locked-dff.md](locked-dff.md)                           | ✅ solved — all 3 lock variants recover (inflated item/struct sizes + hidden TexDictionary wrapper); kept as reference |
| Crash entering a freshly-spawned car (`readBody` null body) | [vehicle-enter-null-body.md](vehicle-enter-null-body.md) | shelved — narrowed to a streaming/physics handle-pool race (teleport-triggered); needs a runtime trace to pin          |
