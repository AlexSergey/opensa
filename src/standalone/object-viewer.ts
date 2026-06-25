import type { ColModel } from '@opensa/renderware/parsers/binary/col-types';
import type { TextureDictionary } from '@opensa/renderware/three/build-texture';
/**
 * Standalone object viewer (map models) — a dev tool, isolated from the map/streaming/
 * instancing layers. It reuses the real asset path (fetch -> parseTxd -> build-texture,
 * fetch -> parseDff -> build-clump), so what you see here is exactly what the parser +
 * three build layer produce for one model.
 *
 * Purpose: diagnose whether a model's look (e.g. "too dark") comes from the DFF
 * parser/build (this view) or from the map pipeline (instancing/lighting in the
 * main app). Toggles let you separate prelit vertex colours, MODULATE2X and the
 * lit/unlit shading model.
 *
 * Open at /object-viewer.html (run `npm run dev` + `npm run serve:static`).
 */
import type { BufferGeometry, Material } from 'three';

import { parseDff } from '@opensa/renderware/parsers/binary/dff';
import { parseTxd } from '@opensa/renderware/parsers/binary/txd';
import { buildClump } from '@opensa/renderware/three/build-clump';
import { buildCollisionWireframe } from '@opensa/renderware/three/build-col-wireframe';
import { buildTextureMap } from '@opensa/renderware/three/build-texture';
import {
  AmbientLight,
  Box3,
  Color,
  DirectionalLight,
  GridHelper,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/** Serialised COL (baked by scripts/build-viewer-assets.ts) — vertices as a plain array. */
type ColJson = Omit<ColModel, 'vertices'> & { vertices: number[] };

interface ModelEntry {
  dff: string;
  name: string;
  txd: string;
}
type SceneMesh = Mesh<BufferGeometry, Material | Material[]>;
interface ViewOptions {
  lit: boolean;
  modulate2x: boolean;
  prelit: boolean;
}

/** Models extracted from gta3.img into static/viewer/objects/ for this tool. */
const MODELS: readonly ModelEntry[] = [
  { dff: 'wattspark1_lae2.dff', name: 'wattspark1_LAe2 (txd lae2tempshit)', txd: 'lae2tempshit.txd' },
  { dff: 'lae2_ground08.dff', name: 'lae2_ground08 (txd burnsground)', txd: 'burnsground.txd' },
];

const BASE = import.meta.env.VITE_STATIC_URL;
const options: ViewOptions = { lit: true, modulate2x: false, prelit: true };

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new Scene();
scene.background = new Color(0x4a4a4a); // neutral grey so darkness is judged against a known mid-tone

const camera = new PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100000);
const controls = new OrbitControls(camera, renderer.domElement);

// Lights mirror the main app (AmbientLightPlugin 1.5 + DirectionalLightPlugin 1.5).
const ambient = new AmbientLight(0xffffff, 1.5);
const directional = new DirectionalLight(0xffffff, 1.5);
directional.position.set(50, 100, 50);
scene.add(ambient, directional, new GridHelper(200, 20, 0x888888, 0x444444));

let current: Group | null = null;
let collision: null | Object3D = null;
let collisionOn = false;
const txdCache = new Map<string, Promise<TextureDictionary>>();
/** Each geometry's original prelit colour array, so ×2/restore is lossless. */
const originalColors = new WeakMap<BufferGeometry, Float32Array>();

function addToggle(parent: HTMLElement, label: string, initial: boolean, onChange: (on: boolean) => void): void {
  const wrapper = document.createElement('label');
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = initial;
  checkbox.addEventListener('change', () => onChange(checkbox.checked));
  wrapper.append(checkbox, document.createTextNode(` ${label}`));
  parent.appendChild(wrapper);
}

function animate(): void {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

function applyCollision(): void {
  if (collision) {
    collision.visible = collisionOn;
  }
}

function applyOptions(): void {
  if (!current) {
    return;
  }
  for (const mesh of meshesOf(current)) {
    applyToMesh(mesh);
  }
}

function applyToMesh(mesh: SceneMesh): void {
  const original = originalColors.get(mesh.geometry);
  const colour = mesh.geometry.getAttribute('color');
  const hasPrelit = Boolean(original) && Boolean(colour);

  if (original && colour) {
    const scale = options.modulate2x ? 2 : 1;
    const array = colour.array as Float32Array;
    for (let i = 0; i < original.length; i += 1) {
      array[i] = Math.min(1, original[i] * scale);
    }
    colour.needsUpdate = true;
  }

  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  mesh.material = materials.map((material) => rebuildMaterial(material, hasPrelit));
}

function buildControls(): void {
  const panel = document.createElement('div');
  panel.className = 'panel';

  const select = document.createElement('select');
  MODELS.forEach((model, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = model.name;
    select.appendChild(option);
  });
  select.addEventListener('change', () => void loadModel(MODELS[Number(select.value)]));
  panel.appendChild(select);

  addToggle(panel, 'Lit (MeshStandard)', options.lit, (on) => {
    options.lit = on;
    applyOptions();
  });
  addToggle(panel, 'Prelit vertex colours', options.prelit, (on) => {
    options.prelit = on;
    applyOptions();
  });
  addToggle(panel, 'Prelit ×2 (MODULATE2X)', options.modulate2x, (on) => {
    options.modulate2x = on;
    applyOptions();
  });
  addToggle(panel, 'Collision', collisionOn, (on) => {
    collisionOn = on;
    applyCollision();
  });

  document.body.appendChild(panel);
}

function frameObject(object: Group): void {
  const box = new Box3().setFromObject(object);
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  const radius = Math.max(size.x, size.y, size.z) || 10;

  controls.target.copy(center);
  camera.position.set(center.x + radius, center.y + radius * 0.7, center.z + radius);
  camera.far = radius * 100;
  camera.updateProjectionMatrix();
  controls.update();
}

/** Show the model's COL (pre-extracted JSON), wrapped −90°X to match buildClump's Y-up convert. */
async function loadCollision(model: ModelEntry): Promise<void> {
  if (collision) {
    scene.remove(collision);
    collision = null;
  }
  const base = model.dff.replace(/\.dff$/, '');
  const response = await fetch(`${BASE}/viewer/objects/${base}.col.json`);
  if (!response.ok) {
    return; // no extracted COL for this model — re-run scripts/build-viewer-assets.ts
  }
  const json = (await response.json()) as ColJson;
  const col: ColModel = { ...json, vertices: new Float32Array(json.vertices) };
  const wrap = new Group();
  wrap.rotation.x = -Math.PI / 2;
  wrap.add(buildCollisionWireframe([{ col, name: col.name, transforms: [new Matrix4()] }]));
  wrap.visible = collisionOn;
  collision = wrap;
  scene.add(wrap);
}

async function loadModel(model: ModelEntry): Promise<void> {
  const textures = await loadTextures(model.txd);
  const buffer = await fetch(`${BASE}/viewer/objects/${model.dff}`).then((response) => response.arrayBuffer());
  const group = buildClump(parseDff(buffer), textures);

  if (current) {
    scene.remove(current);
  }
  current = group;
  for (const mesh of meshesOf(group)) {
    const colour = mesh.geometry.getAttribute('color');
    if (colour) {
      originalColors.set(mesh.geometry, Float32Array.from(colour.array));
    }
  }
  scene.add(group);
  applyOptions();
  frameObject(group);
  await loadCollision(model);
}

function loadTextures(txd: string): Promise<TextureDictionary> {
  let promise = txdCache.get(txd);
  if (!promise) {
    promise = fetch(`${BASE}/viewer/objects/${txd}`)
      .then((response) => response.arrayBuffer())
      .then((buffer) => buildTextureMap(parseTxd(buffer)));
    txdCache.set(txd, promise);
  }

  return promise;
}

function meshesOf(group: Group): SceneMesh[] {
  const meshes: SceneMesh[] = [];
  group.traverse((object) => {
    if (object instanceof Mesh) {
      meshes.push(object as SceneMesh);
    }
  });

  return meshes;
}

function onResize(): void {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function rebuildMaterial(source: Material, hasPrelit: boolean): MeshBasicMaterial | MeshStandardMaterial {
  const previous = source as MeshStandardMaterial;
  const map = previous.map;
  const shared = {
    alphaTest: previous.alphaTest,
    color: map ? 0xffffff : previous.color.getHex(),
    map,
    side: previous.side,
    transparent: previous.transparent,
    vertexColors: options.prelit && hasPrelit,
  };
  source.dispose();

  return options.lit
    ? new MeshStandardMaterial({ ...shared, metalness: 0, roughness: 1 })
    : new MeshBasicMaterial(shared);
}

window.addEventListener('resize', onResize);
buildControls();
void loadModel(MODELS[0]);
animate();
