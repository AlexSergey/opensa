import { describe, expect, it } from 'vitest';

import type { BootEvent, BootState } from './boot-machine';

import { bootReducer, initialBootState, MAX_RETRIES } from './boot-machine';

const run = (state: BootState, events: BootEvent[]): BootState => events.reduce(bootReducer, state);

describe('bootReducer', () => {
  describe('negative cases', () => {
    it('ignores out-of-phase events', () => {
      const menu = run(initialBootState(false), [{ type: 'CORE_LOADED' }]);
      expect(bootReducer(menu, { type: 'WORLD_READY' }).phase).toBe('menu'); // no warmup yet
      expect(bootReducer(menu, { type: 'RESUME' }).phase).toBe('menu'); // not paused
      expect(bootReducer(initialBootState(false), { type: 'TEXTURES_LOADED' }).phase).toBe('core');
    });

    it('does not start the game from a degraded menu', () => {
      const degraded: BootState = {
        degraded: true,
        disclaimerAccepted: false,
        failedPhase: null,
        phase: 'menu',
        retries: MAX_RETRIES,
      };
      expect(bootReducer(degraded, { type: 'PLAY' }).phase).toBe('menu'); // Play is inert
    });
  });

  describe('positive cases', () => {
    it('runs the happy path: core → menu → disclaimer → textures → warmup → playing', () => {
      const state = run(initialBootState(false), [
        { type: 'CORE_LOADED' },
        { type: 'PLAY' },
        { type: 'DISCLAIMER_OK' },
        { type: 'TEXTURES_LOADED' },
        { type: 'WORLD_READY' },
      ]);
      expect(state.phase).toBe('playing');
      expect(state.disclaimerAccepted).toBe(true);
    });

    it('skips the disclaimer when already accepted', () => {
      const state = run(initialBootState(true), [{ type: 'CORE_LOADED' }, { type: 'PLAY' }]);
      expect(state.phase).toBe('textures');
    });

    it('pauses and resumes from playing', () => {
      let state = run(initialBootState(true), [
        { type: 'CORE_LOADED' },
        { type: 'PLAY' },
        { type: 'TEXTURES_LOADED' },
        { type: 'WORLD_READY' },
      ]);
      state = bootReducer(state, { type: 'PAUSE' });
      expect(state.phase).toBe('paused');
      expect(bootReducer(state, { type: 'RESUME' }).phase).toBe('playing');
    });

    it('retries the failed phase, then degrades after MAX_RETRIES', () => {
      let state = run(initialBootState(true), [{ type: 'CORE_LOADED' }, { type: 'PLAY' }]); // textures
      state = bootReducer(state, { phase: 'textures', type: 'FAIL' });
      expect(state.phase).toBe('error');

      // each retry re-enters the textures phase, up to the limit
      for (let i = 1; i <= MAX_RETRIES; i += 1) {
        state = bootReducer(state, { type: 'RETRY' });
        expect(state.phase).toBe('textures');
        expect(state.retries).toBe(i);
        state = bootReducer(state, { phase: 'textures', type: 'FAIL' });
      }
      // the next retry exhausts the budget → degraded menu
      state = bootReducer(state, { type: 'RETRY' });
      expect(state.phase).toBe('menu');
      expect(state.degraded).toBe(true);
    });
  });
});
