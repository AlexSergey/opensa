/**
 * Standalone character viewer — a dev tool to inspect a skinned ped in isolation:
 * see its skeleton and collision capsule and play any `ped.ifp` animation (looped).
 *
 * It reuses the real path (`parseDff` -> `buildSkinnedClump`, `orientCharacter`,
 * `parseIfp` -> `buildAnimationClip` -> `AnimationController`), so the rig and
 * animations behave exactly as in the game.
 *
 * Open at /character-viewer.html (run `npm run dev` + `npm run serve:static`).
 */
import type { AnimationClip, Object3D } from 'three';

import { AnimationController } from '@opensa/game/character/animation-controller';
import { orientCharacter } from '@opensa/game/character/orient-character';
import { parseDff } from '@opensa/renderware/parsers/binary/dff';
import { parseIfp } from '@opensa/renderware/parsers/binary/ifp';
import { parseTxd } from '@opensa/renderware/parsers/binary/txd';
import { buildAnimationClip } from '@opensa/renderware/three/build-anim-clip';
import { buildSkinnedClump } from '@opensa/renderware/three/build-skinned-clump';
import { buildTextureMap } from '@opensa/renderware/three/build-texture';
import {
  AmbientLight,
  Box3,
  Box3Helper,
  Clock,
  Color,
  DirectionalLight,
  GridHelper,
  Group,
  PerspectiveCamera,
  Scene,
  SkeletonHelper,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/** Player ped (bmypol1) + the locomotion IFP (loaded directly, like the game). */
const DFF = 'bmypol1.dff';
const TXD = 'bmypol1.txd';
const IFP = 'ped.ifp';
const DEFAULT_CLIP = 'idle_stance';
/** Stand the SA bind pose up (matches canvas-host's PLAYER_PLACEMENT). */
const PLACEMENT = {
  offset: [0, 0, 0.04] as [number, number, number],
  rotation: [0, 0, 0] as [number, number, number],
  scale: 1,
};
/** Player collision half-extents (Z-up) from the game (canvas-host PLAYER_HALF_EXTENTS). */
const HALF = new Vector3(0.3, 0.3, 0.9);

const BASE = import.meta.env.VITE_STATIC_URL;

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new Scene();
scene.background = new Color(0x4a4a4a);

const camera = new PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100000);
const controls = new OrbitControls(camera, renderer.domElement);
const clock = new Clock();

const ambient = new AmbientLight(0xffffff, 1.5);
const directional = new DirectionalLight(0xffffff, 1.5);
directional.position.set(50, 100, 50);
scene.add(ambient, directional, new GridHelper(8, 8, 0x888888, 0x444444));

// Native GTA Z-up content shown Y-up (matches the game's entity root −90°X).
const content = new Group();
content.rotation.x = -Math.PI / 2;
scene.add(content);

const clipSelect = document.createElement('select');
const loopToggle = document.createElement('input');
const skeletonToggle = document.createElement('input');
const collisionToggle = document.createElement('input');

let controller: AnimationController | null = null;
let skeletonHelper: null | SkeletonHelper = null;
let collisionBox: Box3Helper | null = null;

function addToggle(parent: HTMLElement, label: string, input: HTMLInputElement, onChange: () => void): void {
  const wrapper = document.createElement('label');
  input.type = 'checkbox';
  input.addEventListener('change', onChange);
  wrapper.append(input, document.createTextNode(` ${label}`));
  parent.appendChild(wrapper);
}

function animate(): void {
  requestAnimationFrame(animate);
  controller?.update(clock.getDelta());
  controls.update();
  renderer.render(scene, camera);
}

function applyCollision(): void {
  if (collisionBox) {
    collisionBox.visible = collisionToggle.checked;
  }
}

function applySkeleton(): void {
  if (skeletonHelper) {
    skeletonHelper.visible = skeletonToggle.checked;
  }
}

function buildControls(): void {
  const panel = document.createElement('div');
  panel.className = 'panel';

  clipSelect.addEventListener('change', playSelected);
  panel.appendChild(clipSelect);

  loopToggle.checked = true;
  addToggle(panel, 'Loop', loopToggle, playSelected);
  skeletonToggle.checked = true;
  addToggle(panel, 'Skeleton', skeletonToggle, applySkeleton);
  addToggle(panel, 'Collision (capsule)', collisionToggle, applyCollision);

  const hint = document.createElement('span');
  hint.className = 'hint';
  hint.textContent = 'click scene to replay';
  panel.appendChild(hint);

  document.body.appendChild(panel);
}

async function fetchBuffer(path: string): Promise<ArrayBuffer> {
  const response = await fetch(`${BASE}/viewer/character/${path}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${path}: ${response.status}`);
  }

  return response.arrayBuffer();
}

function frameObject(object: Object3D): void {
  const box = new Box3().setFromObject(object);
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  const radius = Math.max(size.x, size.y, size.z) || 2;
  controls.target.copy(center);
  camera.position.set(center.x + radius, center.y + radius * 0.5, center.z + radius);
  controls.update();
}

async function loadAnimations(): Promise<Map<string, AnimationClip>> {
  const clips = new Map<string, AnimationClip>();
  for (const anim of parseIfp(await fetchBuffer(IFP))) {
    clips.set(anim.name.toLowerCase(), buildAnimationClip(anim));
  }

  return clips;
}

async function loadCharacter(): Promise<void> {
  const [dffBuffer, txdBuffer] = await Promise.all([fetchBuffer(DFF), fetchBuffer(TXD)]);
  const skinned = buildSkinnedClump(parseDff(dffBuffer), buildTextureMap(parseTxd(txdBuffer)));
  if (!skinned) {
    throw new Error('bmypol1.dff is not skinned (no skeleton)');
  }
  const player = orientCharacter(skinned.root, PLACEMENT);
  content.add(player);

  skeletonHelper = new SkeletonHelper(skinned.root);
  scene.add(skeletonHelper);
  // Capsule footprint as a box: feet at z=0, ±half on x/y, full height on z (Z-up).
  const bounds = new Box3(new Vector3(-HALF.x, -HALF.y, 0), new Vector3(HALF.x, HALF.y, HALF.z * 2));
  collisionBox = new Box3Helper(bounds, 0x00ff88);
  collisionBox.visible = false;
  content.add(collisionBox);

  const clips = await loadAnimations();
  controller = new AnimationController(player, clips, skinned.bonesByName);
  [...clips.keys()].sort().forEach((name) => clipSelect.append(new Option(name, name)));
  clipSelect.value = clips.has(DEFAULT_CLIP) ? DEFAULT_CLIP : (clipSelect.options[0]?.value ?? '');
  playSelected();
  frameObject(player);
}

function onResize(): void {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function playSelected(): void {
  if (controller && clipSelect.value) {
    controller.play(clipSelect.value, 0.2, loopToggle.checked);
  }
}

window.addEventListener('resize', onResize);
renderer.domElement.addEventListener('click', playSelected);
buildControls();
void loadCharacter();
animate();
