import { PerspectiveCamera, Scene, WebGLRenderer } from 'three';

export interface RenderContext {
  camera: PerspectiveCamera;
  renderer: WebGLRenderer;
  scene: Scene;
}

/** Create the renderer/scene/camera the engine owns, bound to a canvas element. */
export function createRenderContext(canvas: HTMLCanvasElement): RenderContext {
  const renderer = new WebGLRenderer({ antialias: true, canvas });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const width = canvas.clientWidth || canvas.width;
  const height = canvas.clientHeight || canvas.height;
  renderer.setSize(width, height, false);

  const camera = new PerspectiveCamera(60, width / height, 0.1, 100000);
  camera.position.set(0, 50, 100);

  return { camera, renderer, scene: new Scene() };
}
