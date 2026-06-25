import { Object3D } from 'three';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Config } from '../interfaces/config.interface';
import type { AnimationController } from './animation-controller';

import { Velocity } from '../ecs/components';
import { CharacterAnimationSystem } from './character-animation.system';

const EID = 1;

function character(): Object3D {
  const wrapper = new Object3D();
  wrapper.add(new Object3D()); // children[0] = inner model carrying the bob

  return wrapper;
}

/** A controller that records the clips it was told to play and reports fixed clip durations. */
function fakeController(): { controller: AnimationController; lastClip: () => string | undefined } {
  const plays: string[] = [];
  const durations = new Map([
    ['jump_land', 0.3],
    ['jump_launch', 0.3],
  ]);
  const controller = {
    duration: (name: string): number => durations.get(name.toLowerCase()) ?? 0,
    play: (name: string): void => {
      plays.push(name);
    },
    setSpeed: (): void => undefined,
    update: (): void => undefined,
  } as unknown as AnimationController;

  return { controller, lastClip: (): string | undefined => plays[plays.length - 1] };
}

function setVelocity(x: number, y: number, z: number, grounded: boolean): void {
  Velocity.x[EID] = x;
  Velocity.y[EID] = y;
  Velocity.z[EID] = z;
  Velocity.grounded[EID] = grounded ? 1 : 0;
}

describe('CharacterAnimationSystem', () => {
  let config: Config;
  let fake: ReturnType<typeof fakeController>;
  let system: CharacterAnimationSystem;

  beforeEach(() => {
    // idleMax = 2 * 0.35 = 0.7 ; runMin = (2 + 6) / 2 = 4
    config = { gameState: 'play', movement: { runSpeed: 6, walkSpeed: 2 } } as unknown as Config;
    fake = fakeController();
    system = new CharacterAnimationSystem(fake.controller, EID, character(), config);
    setVelocity(0, 0, 0, true);
  });

  describe('negative cases', () => {
    it('freezes the pose while paused (no clip played)', () => {
      config.gameState = 'pause';
      setVelocity(0, 5, 0, true);
      system.update(0.1);
      expect(fake.lastClip()).toBeUndefined();
    });
  });

  describe('positive cases', () => {
    it('plays idle below the idle threshold', () => {
      setVelocity(0, 0.3, 0, true); // 0.3 < idleMax 0.7
      system.update(0.1);
      expect(fake.lastClip()).toBe('idle_stance');
    });

    it('plays walk between idle and run thresholds', () => {
      setVelocity(0, 2, 0, true); // 0.7 < 2 < 4
      system.update(0.1);
      expect(fake.lastClip()).toBe('walk_civi');
    });

    it('plays run past the run threshold', () => {
      setVelocity(0, 5, 0, true); // > runMin 4
      system.update(0.1);
      expect(fake.lastClip()).toBe('run_civi');
    });

    it('enters the launch clip when it leaves the ground rising', () => {
      setVelocity(0, 0, 5, false); // airborne, moving up
      system.update(0.1);
      expect(fake.lastClip()).toBe('jump_launch');
    });

    it('plays a scripted clip instead of locomotion, then returns on null', () => {
      setVelocity(0, 5, 0, true); // would otherwise run
      system.setScripted('car_sit', { facing: 1 });
      system.update(0.1);
      expect(fake.lastClip()).toBe('car_sit');

      system.setScripted(null);
      system.update(0.1);
      expect(fake.lastClip()).toBe('run_civi');
    });

    it('exposes and snaps the locomotion facing', () => {
      system.faceTo(1.2);
      expect(system.getFacing()).toBeCloseTo(1.2, 5);
    });
  });
});
