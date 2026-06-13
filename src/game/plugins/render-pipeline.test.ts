import type { PerspectiveCamera, Scene, WebGLRenderer } from 'three';

import { describe, expect, it } from 'vitest';

import type { RenderPass } from './plugin';

import { BasicRenderPipeline } from './render-pipeline';

/** A renderer whose `renders` counter stays live (the object is shared, not destructured). */
function fakeRenderer(): { renderer: WebGLRenderer; renders: number } {
  const state = { renderer: null as unknown as WebGLRenderer, renders: 0 };
  state.renderer = {
    render: (): void => {
      state.renders += 1;
    },
  } as unknown as WebGLRenderer;

  return state;
}

const SCENE = {} as Scene;
const CAMERA = {} as PerspectiveCamera;

/** A pass that appends its label to a shared log when it renders (to assert ordering). */
function pass(label: string, log: string[]): RenderPass {
  return { render: (): void => void log.push(label) };
}

describe('BasicRenderPipeline', () => {
  describe('negative cases', () => {
    it('renders the scene directly when no passes are registered', () => {
      const fake = fakeRenderer();
      const pipeline = new BasicRenderPipeline(fake.renderer, SCENE, CAMERA);
      pipeline.render();
      expect(fake.renders).toBe(1);
    });

    it('does not throw when removing a pass that was never added', () => {
      const fake = fakeRenderer();
      const pipeline = new BasicRenderPipeline(fake.renderer, SCENE, CAMERA);
      expect(() => pipeline.removePass(pass('x', []))).not.toThrow();
    });
  });

  describe('positive cases', () => {
    it('runs registered passes in order instead of the direct render', () => {
      const fake = fakeRenderer();
      const pipeline = new BasicRenderPipeline(fake.renderer, SCENE, CAMERA);
      const log: string[] = [];
      pipeline.addPass(pass('a', log));
      pipeline.addPass(pass('b', log));
      pipeline.render();
      expect(log).toEqual(['a', 'b']);
      expect(fake.renders).toBe(0); // passes own the frame now
    });

    it('reverts to the direct render after the last pass is removed', () => {
      const fake = fakeRenderer();
      const pipeline = new BasicRenderPipeline(fake.renderer, SCENE, CAMERA);
      const only = pass('a', []);
      pipeline.addPass(only);
      pipeline.removePass(only);
      pipeline.render();
      expect(fake.renders).toBe(1);
    });
  });
});
