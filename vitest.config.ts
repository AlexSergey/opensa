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
        'src/renderware/test-utils.ts',
        'src/standalone/**', // dev-only viewer entry scripts

        // === COVERED BY THE PLAYWRIGHT E2E LANE (not by headless node units) ===
        // GL / DOM / app-loop glue: WebGL + browser only, so it's verified in `e2e/` (docs/development/e2e.md),
        // not here. RULE: anything excluded below MUST have e2e coverage on the Playwright lane — if you add a
        // file here, add/extend a spec in `e2e/` to exercise it. (See memory: gl-dom-coverage-exclusion.)
        'src/game/game.ts', // the whole frame loop (boots the renderer/canvas)
        'src/game/core/renderer.ts', // WebGLRenderer setup
        'src/game/core/camera-controller.ts', // pointer/keyboard DOM camera rig
        'src/game/input/keyboard.ts', // DOM keyboard listeners
        'src/game/plugins/sky.plugin.ts', // ShaderMaterial sky dome (GL)
        'src/game/plugins/water.plugin.ts', // GL water surface
        'src/game/plugins/postfx.plugin.ts', // EffectComposer / postprocessing (GL)
        'src/game/plugins/ambient-light.plugin.ts', // THREE light wiring
        'src/game/plugins/directional-light.plugin.ts', // THREE light + shadow wiring
        'src/game/plugins/vehicle-reflection/vehicle-reflection.plugin.ts', // env-map/probe shader assembly (GL)
        'src/game/vehicle/vehicle-headlight.system.ts', // canvas-texture lamps (logic unit-tested in build-vehicle)
        'src/game/character/setup-character.ts', // async model load + scene wiring
        'src/ui/**', // DOM/style helpers (locations, debug-styles, hud font loading)
      ],
      include: ['src/**/*.ts'],
      provider: 'v8',
      reporter: ['text', 'text-summary', 'html'],
      // Floors (a small buffer below the achieved 88.8% stmt / 78.4% branch / 87.2% func / 88.8% lines) so an
      // unrelated change can't silently erode coverage. Branches sit lower by nature (error/edge paths).
      thresholds: { branches: 77, functions: 85, lines: 85, statements: 85 },
    },
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.ts', 'timecyc-builder/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
});
