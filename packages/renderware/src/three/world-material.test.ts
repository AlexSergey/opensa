import type { MeshBasicMaterial } from 'three';

import { readFileSync } from 'node:fs';
import { DoubleSide, FrontSide, Texture } from 'three';
import { describe, expect, it } from 'vitest';

import type { RWGeometry, RWMaterial } from '../parsers/binary/types';

import { GeometryFlag } from '../parsers/binary/constants';
import { parseDff } from '../parsers/binary/dff';
import { toArrayBuffer } from '../test-utils';
import {
  applyWorldWindowGlow,
  buildWorldMaterial,
  dnBalanceUniform,
  isVertexAlphaBeam,
  windowGlowUniform,
  worldDayTintUniform,
  worldShadowUniforms,
  worldTintUniform,
} from './world-material';

/** The onBeforeCompile parameter type (three renamed the old `Shader` type). */
type CompileShader = Parameters<MeshBasicMaterial['onBeforeCompile']>[0];

function geometry(partial: Partial<RWGeometry> = {}): RWGeometry {
  return {
    flags: GeometryFlag.POSITIONS | GeometryFlag.PRELIT | GeometryFlag.TEXTURED,
    lights: [],
    materials: [],
    nightColors: null,
    normals: null,
    numUVLayers: 1,
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    prelitColors: new Uint8Array(12),
    triangles: [{ a: 0, b: 1, c: 2, materialIndex: 0 }],
    uvLayers: [new Float32Array(6)],
    ...partial,
  };
}

function material(partial: Partial<RWMaterial> = {}): RWMaterial {
  return { color: [255, 255, 255, 255], texture: null, textured: false, ...partial };
}

/** Minimal shader stub holding the three.js chunk anchors the material injects around. */
function shaderStub(): CompileShader {
  return {
    fragmentShader: '#include <color_fragment>\n#include <opaque_fragment>',
    uniforms: {},
    vertexShader: '#include <begin_vertex>\n#include <project_vertex>',
  } as unknown as CompileShader;
}

function textureMap(hasAlpha = false): Map<string, Texture> {
  const tex = new Texture();
  tex.name = 'wall';
  tex.userData.hasAlpha = hasAlpha;

  return new Map([['wall', tex]]);
}

describe('buildWorldMaterial', () => {
  describe('negative cases', () => {
    it('keeps the RW colour and opaque front-side rendering when untextured', () => {
      const built = buildWorldMaterial(material({ color: [200, 100, 50, 255] }), geometry());
      expect(built.color.getHex()).toBe((200 << 16) | (100 << 8) | 50);
      expect(built.map).toBeNull();
      expect(built.transparent).toBe(false);
      expect(built.side).toBe(FrontSide);
    });

    it('skips the night blend when the geometry has no night colours', () => {
      const built = buildWorldMaterial(material(), geometry());
      expect(built.customProgramCacheKey()).toBe('saWorld');
      const shader = shaderStub();
      built.onBeforeCompile(shader, undefined as never);
      expect(shader.uniforms.uDnBalance).toBeUndefined();
      expect(shader.fragmentShader).toContain('#include <color_fragment>'); // stock day prelit multiply
      expect(shader.uniforms.uWorldTint).toBe(worldTintUniform); // tint still applies
    });

    it('does not treat a white-textured part with opaque prelit (alpha 255) as a beam', () => {
      const built = buildWorldMaterial(
        material({ texture: { maskName: '', name: 'white' } }),
        geometry({ prelitColors: new Uint8Array(12).fill(255) }),
      );
      expect(built.transparent).toBe(false);
      expect(built.customProgramCacheKey()).not.toContain('beam');
    });
  });

  describe('positive cases', () => {
    it('uses the texture (forced white) with alpha-driven transparency settings', () => {
      const built = buildWorldMaterial(
        material({ texture: { maskName: '', name: 'wall' } }),
        geometry(),
        textureMap(true),
      );
      expect(built.map?.name).toBe('wall');
      expect(built.color.getHex()).toBe(0xffffff);
      expect(built.transparent).toBe(true);
      expect(built.alphaTest).toBe(0.5);
      expect(built.side).toBe(DoubleSide);
      expect(built.vertexColors).toBe(true);
    });

    it('blends day prelit toward night colours, tinted by the DAY-ONLY tint (relaxes to white at night)', () => {
      const built = buildWorldMaterial(material(), geometry({ nightColors: new Uint8Array(12) }));
      expect(built.customProgramCacheKey()).toBe('saWorld|night');
      const shader = shaderStub();
      built.onBeforeCompile(shader, undefined as never);
      expect(shader.uniforms.uDnBalance).toBe(dnBalanceUniform);
      expect(shader.vertexShader).toContain('vNightColor = nightColor');
      expect(shader.fragmentShader).toContain('mix( vColor.rgb, vNightColor, uDnBalance )');
      // The night prelit set already encodes the night look, so this variant rides the day-only tint
      // (driven to white as dnBalance → 1) — NOT the no-night tint that darkens into the night ambient.
      expect(shader.uniforms.uWorldTint).toBe(worldDayTintUniform);
      expect(shader.fragmentShader).toContain('outgoingLight *= uWorldTint');
    });

    it('applyWorldWindowGlow adds the additive map glow after the (no-night) tint', () => {
      const built = buildWorldMaterial(material({ texture: { maskName: '', name: 'wall' } }), geometry(), textureMap());
      applyWorldWindowGlow(built);
      expect(built.customProgramCacheKey()).toBe('saWorld|windowGlow');
      const shader = shaderStub();
      built.onBeforeCompile(shader, undefined as never);
      expect(shader.uniforms.uWindowGlow).toBe(windowGlowUniform);
      expect(shader.uniforms.uWorldTint).toBe(worldTintUniform); // composed, not clobbered
      const glowAt = shader.fragmentShader.indexOf('uWindowGlow;\n#endif');
      const tintAt = shader.fragmentShader.indexOf('outgoingLight *= uWorldTint');
      expect(glowAt).toBeGreaterThan(-1);
      expect(tintAt).toBeGreaterThan(-1);
      expect(glowAt).toBeGreaterThan(tintAt); // glow injected after the tint → not dimmed by it
    });

    it('receives the dynamic-only sun shadow in both variants (manual sampling)', () => {
      for (const nightColors of [null, new Uint8Array(12)]) {
        const built = buildWorldMaterial(material(), geometry({ nightColors }));
        const shader = shaderStub();
        built.onBeforeCompile(shader, undefined as never);
        expect(shader.uniforms.uWorldShadowMap).toBe(worldShadowUniforms.uWorldShadowMap);
        expect(shader.uniforms.uWorldShadowMatrix).toBe(worldShadowUniforms.uWorldShadowMatrix);
        expect(shader.uniforms.uWorldShadowStrength).toBe(worldShadowUniforms.uWorldShadowStrength);
        expect(shader.vertexShader).toContain('vWorldShadowCoord = uWorldShadowMatrix * wsWorldPos');
        expect(shader.fragmentShader).toContain('mix( 1.0, wsShadow, uWorldShadowStrength )');
      }
    });

    it('applyWorldWindowGlow composes with the night blend variant too', () => {
      const built = buildWorldMaterial(
        material({ texture: { maskName: '', name: 'wall' } }),
        geometry({ nightColors: new Uint8Array(12) }),
        textureMap(),
      );
      applyWorldWindowGlow(built);
      expect(built.customProgramCacheKey()).toBe('saWorld|night|windowGlow');
      const shader = shaderStub();
      built.onBeforeCompile(shader, undefined as never);
      expect(shader.uniforms.uWindowGlow).toBe(windowGlowUniform);
      expect(shader.uniforms.uDnBalance).toBe(dnBalanceUniform); // composed, not clobbered
      expect(shader.fragmentShader).toContain('uWindowGlow');
    });

    it('renders a floodlight beam (white texture + prelit vertex alpha) alpha-blended with the cone alpha', () => {
      const built = buildWorldMaterial(
        material({ texture: { maskName: '', name: 'white' } }),
        geometry({ nightColors: new Uint8Array(12) }), // real floodbeams carry night colours
      );
      expect(built.transparent).toBe(true);
      expect(built.alphaTest).toBe(0); // NOT 0.5 — the cone alpha (~0.2) would be clipped away
      expect(built.depthWrite).toBe(false);
      expect(built.side).toBe(DoubleSide);
      expect(built.customProgramCacheKey()).toBe('saWorld|night|beam');
      const shader = shaderStub();
      built.onBeforeCompile(shader, undefined as never);
      expect(shader.fragmentShader).toContain('diffuseColor.a *= vColor.a'); // cone alpha → blended alpha
    });

    it('detects + alpha-blends the real SF stadium floodbeam DFF', () => {
      // Real model (SF stadium floodlights) — its lamp material uses the `white` placeholder texture with the
      // beam cone baked into the prelit vertex alpha. See tests/dff/floodbeams/ws_floodbeams.dff.
      const clump = parseDff(
        toArrayBuffer(new Uint8Array(readFileSync('tests/original/dff/floodbeams/ws_floodbeams.dff'))),
      );
      const geom = clump.geometries[0];
      const beamMaterial = geom.materials.find((m) => isVertexAlphaBeam(m, geom));
      if (!beamMaterial) {
        throw new Error('expected a vertex-alpha beam material in ws_floodbeams.dff');
      }
      const built = buildWorldMaterial(beamMaterial, geom);
      expect(built.transparent).toBe(true);
      expect(built.alphaTest).toBe(0);
      expect(built.depthWrite).toBe(false);
      expect(built.side).toBe(DoubleSide);
    });
  });
});
