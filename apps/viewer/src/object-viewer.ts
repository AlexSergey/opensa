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
 * Open at /viewer.html (?tab=object) (run `npm run dev` + `npm run serve:static`).
 */
import type { BufferGeometry, Material } from 'three';

import { parseColLibrary } from '@opensa/renderware/parsers/binary/col';
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
  /** Optional shared COL *library* (e.g. LODvegetation.col); collision is looked up inside it by dff name. */
  col?: string;
  dff: string;
  name: string;
  txd: string;
}
type SceneMesh = Mesh<BufferGeometry, Material | Material[]>;
/** TEMP: the tree HD/LOD lists stream in from `trees-manifest.json` (staged by NO_COMMIT/stage.ts). */
interface TreesManifest {
  hd: ModelEntry[];
  lod: ModelEntry[];
}

interface ViewOptions {
  lit: boolean;
  modulate2x: boolean;
  prelit: boolean;
}

/** Anchor models (the e2e fixtures); the HD/LOD tree lists are loaded from the manifest at startup. */
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

/** One overlaid model: its built clump + its (optional) collision wireframe. */
interface LoadedModel {
  collision: null | Object3D;
  group: Group;
}

// Several models overlaid at the origin (keyed by dff) so they can be compared side-by-side.
const loaded = new Map<string, LoadedModel>();
// Every known model (anchors + manifest), keyed by dff — so "Clear all" can resolve loaded entries.
const entriesByDff = new Map<string, ModelEntry>();
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
  for (const entry of loaded.values()) {
    if (entry.collision) {
      entry.collision.visible = collisionOn;
    }
  }
}

function applyOptions(): void {
  for (const entry of loaded.values()) {
    for (const mesh of meshesOf(entry.group)) {
      applyToMesh(mesh);
    }
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

  // Two multi-select lists split by the `lod` prefix — full-detail (HD) vs LOD — overlaid for comparison.
  // Seeded with the anchor MODELS; the tree HD/LOD entries stream in from trees-manifest.json.
  const sections = { hd: makeSection(panel, 'HD'), lod: makeSection(panel, 'LOD') };

  const addRow = (model: ModelEntry): void => {
    entriesByDff.set(model.dff, model);
    const section = model.dff.toLowerCase().startsWith('lod') ? sections.lod : sections.hd;
    const row = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = model === MODELS[0];
    checkbox.addEventListener('change', () => (checkbox.checked ? void addModel(model) : removeModel(model)));
    row.append(checkbox, document.createTextNode(` ${model.name}`));
    section.list.appendChild(row);
    section.heading.textContent = `${section.title} (${section.list.childElementCount})`;
  };

  for (const model of MODELS) {
    addRow(model);
  }

  const frameButton = document.createElement('button');
  frameButton.textContent = 'Frame all';
  frameButton.addEventListener('click', frameAll);
  const clearButton = document.createElement('button');
  clearButton.textContent = 'Clear all';
  clearButton.addEventListener('click', () => {
    for (const dff of [...loaded.keys()]) {
      const model = entriesByDff.get(dff);
      if (model) {
        removeModel(model);
      }
    }
    for (const input of panel.querySelectorAll<HTMLInputElement>('.model-list input')) {
      input.checked = false;
    }
  });
  panel.append(frameButton, clearButton);

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
  void loadManifest(addRow);
}

function frameAll(): void {
  if (!loaded.size) {
    return;
  }
  const box = new Box3();
  for (const entry of loaded.values()) {
    box.expandByObject(entry.group);
  }
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  const radius = Math.max(size.x, size.y, size.z) || 10;

  controls.target.copy(center);
  camera.position.set(center.x + radius, center.y + radius * 0.7, center.z + radius);
  camera.far = radius * 100;
  camera.updateProjectionMatrix();
  controls.update();
}

/** Stream the staged tree HD/LOD entries (trees-manifest.json) into the lists via `addRow`. */
async function loadManifest(addRow: (model: ModelEntry) => void): Promise<void> {
  const response = await fetch(`${BASE}/viewer/objects/trees-manifest.json`);
  if (!response.ok) {
    return; // no manifest staged — anchor models only
  }
  const manifest = (await response.json()) as TreesManifest;
  for (const model of [...manifest.hd, ...manifest.lod]) {
    addRow(model);
  }
}

/** A labelled, scrollable list section appended to the panel. */
function makeSection(
  panel: HTMLElement,
  title: string,
): { heading: HTMLDivElement; list: HTMLDivElement; title: string } {
  const heading = document.createElement('div');
  heading.className = 'list-title';
  heading.textContent = title;
  const list = document.createElement('div');
  list.className = 'model-list';
  panel.append(heading, list);

  return { heading, list, title };
}

/** Parsed COL library (e.g. LODvegetation.col) → ColModel by lowercased name; fetched once per file. */
const colLibCache = new Map<string, Promise<Map<string, ColModel>>>();

async function addModel(model: ModelEntry): Promise<void> {
  if (loaded.has(model.dff)) {
    return;
  }
  const textures = await loadTextures(model.txd);
  const buffer = await fetch(`${BASE}/viewer/objects/${model.dff}`).then((response) => response.arrayBuffer());
  const group = buildClump(parseDff(buffer), textures);
  for (const mesh of meshesOf(group)) {
    const colour = mesh.geometry.getAttribute('color');
    if (colour) {
      originalColors.set(mesh.geometry, Float32Array.from(colour.array));
    }
  }
  scene.add(group);

  const entry: LoadedModel = { collision: null, group };
  loaded.set(model.dff, entry);
  for (const mesh of meshesOf(group)) {
    applyToMesh(mesh);
  }
  entry.collision = await buildCollision(model);
  if (entry.collision) {
    scene.add(entry.collision);
  }
  if (loaded.size === 1) {
    frameAll();
  }
}

/** Show the model's COL, wrapped −90°X to match buildClump's Y-up convert. Source is either a shared COL
 *  library (`model.col`, looked up by dff name) or the pre-extracted per-model `<model>.col.json`. */
async function buildCollision(model: ModelEntry): Promise<null | Object3D> {
  const base = model.dff.replace(/\.dff$/, '');
  let col: ColModel | null = null;

  if (model.col) {
    col = (await loadColLibrary(model.col)).get(base.toLowerCase()) ?? null;
  } else {
    const response = await fetch(`${BASE}/viewer/objects/${base}.col.json`);
    if (response.ok) {
      const json = (await response.json()) as ColJson;
      col = { ...json, vertices: new Float32Array(json.vertices) };
    }
  }
  if (!col) {
    return null; // no collision for this model
  }

  const wrap = new Group();
  wrap.rotation.x = -Math.PI / 2;
  wrap.add(buildCollisionWireframe([{ col, name: col.name, transforms: [new Matrix4()] }]));
  wrap.visible = collisionOn;

  return wrap;
}

function disposeObject(object: Object3D): void {
  object.traverse((node) => {
    if (node instanceof Mesh) {
      const mesh = node as SceneMesh;
      mesh.geometry.dispose();
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        material.dispose();
      }
    }
  });
}

function loadColLibrary(file: string): Promise<Map<string, ColModel>> {
  let promise = colLibCache.get(file);
  if (!promise) {
    promise = fetch(`${BASE}/viewer/objects/${file}`)
      .then((response) => response.arrayBuffer())
      .then((buffer) => new Map(parseColLibrary(buffer).map((col) => [col.name.toLowerCase(), col])));
    colLibCache.set(file, promise);
  }

  return promise;
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

function removeModel(model: ModelEntry): void {
  const entry = loaded.get(model.dff);
  if (!entry) {
    return;
  }
  scene.remove(entry.group);
  disposeObject(entry.group);
  if (entry.collision) {
    scene.remove(entry.collision);
    disposeObject(entry.collision);
  }
  loaded.delete(model.dff);
}

window.addEventListener('resize', onResize);
buildControls();
void addModel(MODELS[0]);
animate();
