import { describe, expect, it } from 'vitest';

import type { ControlsConfig } from '../../interfaces/config.interface';
import type { KeyboardInput } from './keyboard';

import { KeyboardSource } from './keyboard-source';

const CONTROLS: ControlsConfig = {
  back: 'KeyS',
  forward: 'KeyW',
  jump: 'Space',
  left: 'KeyA',
  right: 'KeyD',
  run: 'ShiftLeft',
};

/** A KeyboardInput stub holding the given `KeyboardEvent.code`s. */
const keys = (...codes: string[]): KeyboardInput => {
  const down = new Set(codes);

  return { isDown: (code) => down.has(code) };
};

describe('KeyboardSource', () => {
  describe('negative cases', () => {
    it('reports no movement and no active actions when nothing is held', () => {
      const source = new KeyboardSource(keys(), CONTROLS);
      expect(source.move()).toEqual({ x: 0, y: 0 });
      expect(source.isActive('jump')).toBe(false);
      expect(source.isActive('run')).toBe(false);
      expect(source.isActive('enterExit')).toBe(false);
    });

    it('cancels opposite keys to a zero axis', () => {
      const source = new KeyboardSource(keys('KeyW', 'KeyS', 'KeyA', 'KeyD'), CONTROLS);
      expect(source.move()).toEqual({ x: 0, y: 0 });
    });

    it('treats run as inactive when no run key is bound', () => {
      const source = new KeyboardSource(keys('ShiftLeft'), { ...CONTROLS, run: undefined });
      expect(source.isActive('run')).toBe(false);
    });
  });

  describe('positive cases', () => {
    it('maps WASD to the move vector (x = right+, y = forward+)', () => {
      expect(new KeyboardSource(keys('KeyW'), CONTROLS).move()).toEqual({ x: 0, y: 1 });
      expect(new KeyboardSource(keys('KeyS'), CONTROLS).move()).toEqual({ x: 0, y: -1 });
      expect(new KeyboardSource(keys('KeyD'), CONTROLS).move()).toEqual({ x: 1, y: 0 });
      expect(new KeyboardSource(keys('KeyA'), CONTROLS).move()).toEqual({ x: -1, y: 0 });
    });

    it('maps the bound keys to their actions (jump/run/enterExit)', () => {
      expect(new KeyboardSource(keys('Space'), CONTROLS).isActive('jump')).toBe(true);
      expect(new KeyboardSource(keys('ShiftLeft'), CONTROLS).isActive('run')).toBe(true);
      expect(new KeyboardSource(keys('Enter'), CONTROLS).isActive('enterExit')).toBe(true);
    });
  });
});
