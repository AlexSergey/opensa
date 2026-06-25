import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      // Project-wide logic coverage (.ts). The .tsx UI is R3F/DOM glue, integration-tested in-browser, not here.
      exclude: [
        // --- Not logic (never counted anywhere) ---
        'src/**/*.test.ts',
        'src/**/index.ts',
        'src/**/*.interface.ts',
        'packages/**/*.test.ts',
        'packages/**/index.ts',
        'packages/**/*.interface.ts',
        'packages/renderware/test-utils.ts',
        'src/standalone/**', // dev-only viewer entry scripts

        // === COVERED BY THE PLAYWRIGHT E2E LANE (not by headless node units) ===
        // GL / DOM / app-loop glue: WebGL + browser only, so it's verified in `e2e/` (docs/development/e2e.md),
        // not here. RULE: anything excluded below MUST have e2e coverage on the Playwright lane — if you add a
        // file here, add/extend a spec in `e2e/` to exercise it. (See memory: gl-dom-coverage-exclusion.)
        'packages/game/game.ts', // the whole frame loop (boots the renderer/canvas)
        'packages/game/core/renderer.ts', // WebGLRenderer setup
        'packages/game/core/camera-controller.ts', // pointer/keyboard DOM camera rig
        'packages/game/input/keyboard.ts', // DOM keyboard listeners
        'packages/game/plugins/sky.plugin.ts', // ShaderMaterial sky dome (GL)
        'packages/game/plugins/water.plugin.ts', // GL water surface
        'packages/game/plugins/postfx.plugin.ts', // EffectComposer / postprocessing (GL)
        'packages/game/plugins/ambient-light.plugin.ts', // THREE light wiring
        'packages/game/plugins/directional-light.plugin.ts', // THREE light + shadow wiring
        'packages/game/plugins/vehicle-reflection/vehicle-reflection.plugin.ts', // env-map/probe shader assembly (GL)
        'packages/game/vehicle/vehicle-headlight.system.ts', // canvas-texture lamps (logic unit-tested in build-vehicle)
        'packages/game/character/setup-character.ts', // async model load + scene wiring
        'src/ui/**', // DOM/style helpers (locations, debug-styles, hud font loading)
        'src/asset-loader/asset-loader.ts', // fetch streaming + Cache Storage orchestration (e2e: asset-loader.spec.ts)
        'src/asset-loader/cache-store.ts', // Cache Storage API wrapper (e2e: asset-loader.spec.ts)
      ],
      include: ['src/**/*.ts', 'packages/**/*.ts'],
      provider: 'v8',
      reporter: ['text', 'text-summary', 'html'],
      // Floors (a small buffer below the achieved 88.8% stmt / 78.4% branch / 87.2% func / 88.8% lines) so an
      // unrelated change can't silently erode coverage. Branches sit lower by nature (error/edge paths).
      thresholds: { branches: 77, functions: 85, lines: 85, statements: 85 },
    },
    environment: 'node',
    globals: false,
    include: [
      'src/**/*.test.ts',
      'packages/**/*.test.ts',
      'tools/timecyc-builder/**/*.test.ts',
      'scripts/**/*.test.ts',
      'tools/map-optimizer/**/*.test.ts',
      'tools/lod-generator/**/*.test.ts',
      'tools/vehicle-optimizer/**/*.test.ts',
      'tools/tool-kit/**/*.test.ts',
      'tools/rw-codec/**/*.test.ts',
    ],
  },
});
