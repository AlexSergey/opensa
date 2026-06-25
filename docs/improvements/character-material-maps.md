# Character material maps (normal / emissive / spec)

**Status: parked — not doing yet.** The diffuse texture renders correctly; the extra PBR maps a model
ships are simply ignored. Captured while fixing the **T800** ped (see below). No code written for this.

## Idea

`buildMaterial` (`packages/renderware/src/three/build-clump.ts`) resolves **one** texture per material — the RW
material's diffuse (`rw.texture`). Modern ped/vehicle mods ship a texture _set_ per material, conventionally
suffixed: `_D` diffuse, `_N` normal, `_E` emissive (sometimes `_S` spec). We use `_D` and drop the rest, so
those models render flat-lit — visually fine but without surface relief or self-illumination the author
intended.

Example — the **T800 endoskeleton** ped
([gtainside #144069](https://www.gtainside.com/en/sanandreas/skins/144069-endoskeleton-terminator-t800/)),
dropped in at `game-src/original-extend/player/T800.{dff,txd}`. Its TXD carries the full set:

| Texture          | Size  | Format | Role (suffix)                                                           |
| ---------------- | ----- | ------ | ----------------------------------------------------------------------- |
| `TRM_Skeleton_D` | 1024² | DXT1   | diffuse — **used**                                                      |
| `TRM_Skeleton_N` | 1024² | DXT1   | normal — ignored                                                        |
| `TRM_Skeleton_E` | 512²  | DXT5   | emissive — ignored                                                      |
| `ENV`            | 256²  | DXT1   | env/reflection — ignored unless the material's RW env-map effect is set |
| `USF`            | 512²  | DXT1   | (unused by the materials)                                               |

The materials reference `TRM_Skeleton_D` and `TRM_Skeleton_E` by name; only the `_D` lands as `map`.

> Note: the original T800 "all-black" symptom was a **separate** bug (PRELIT flag + no vertex-colour
> attribute → texture × `(0,0,0)`), fixed by `disableVertexColors` in `build-skinned-clump.ts`. That fix
> makes the diffuse show. This improvement is only about the _additional_ maps.

## Approach options

1. **Convention-based sibling lookup.** When resolving `<name>_D` (or any `<name>`), also probe the texture
   dict for `<name>_N` / `<name>_E` / `<name>_S` and wire them as `normalMap` / `emissiveMap` /
   (roughness/metalness from) `spec`. Zero new asset metadata — pure naming heuristic. Risk: false matches;
   suffix conventions vary between authors. Gate it so a missing sibling is just a no-op (today's behaviour).
2. **Read the RW material texture list properly.** A RW material can hold more than one texture chunk; parse
   them and map by role if RW tags them. More correct, more parser work, and many mods still rely on naming
   rather than RW roles.

Likely start: option 1 (sibling-by-suffix), behind the existing `textures` map so it stays a no-op for
models that ship only a diffuse (army/tommy/Shrek).

## Caveats

- Normal maps need tangents — `buildSkinnedGeometry` would have to compute/supply a `tangent` attribute (or
  rely on three's screen-space derivative path).
- Emissive should compose with the night-fill emissive term (`night-fill.ts`), not fight it.
- DXT normal maps decode fine as `CompressedTexture`; just don't apply sRGB to `_N`.
