import {
  AdditiveBlending,
  AmbientLight,
  BackSide,
  CanvasTexture,
  Color,
  DirectionalLight,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector3,
} from 'three';

import type { Plugin, PluginContext } from './plugin';

/** The timecyc values the sky/sun need (RGB 0–255 + sun floats). Grows as graphics expand. */
export interface SkySample {
  amb: Rgb;
  dir: Rgb;
  skyBot: Rgb;
  skyTop: Rgb;
  spriteBright: number;
  spriteSize: number;
  sunCore: Rgb;
  sunCorona: Rgb;
  sunSize: number;
}

type Rgb = readonly [number, number, number];

/** Sky-dome radius and how far along its direction the sun sprite sits (both < camera.far). */
const RADIUS = 4000;
const SUN_DISTANCE = 3500;

/** Day window (hours): the sun is above the horizon between these, peaking at midday. */
const SUNRISE = 6;
const SUNSET = 20;
const MAX_ELEVATION = MathUtils.degToRad(80); // sun height at midday

/** Light tuning (timecyc dir/dirMult are ~constant for EXTRASUNNY, so day/night rides the sun height). */
const SUN_INTENSITY = 2.2; // directional at peak
const AMBIENT_DAY = 1.0;
const AMBIENT_NIGHT = 0.35;
/** Corona (glow) size relative to the sun core. */
const CORONA_RATIO = 4.5;

const VERTEX = `
  varying float vHeight;
  void main() {
    vHeight = normalize(position).y; // -1 (nadir) .. 0 (horizon) .. 1 (zenith)
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT = `
  uniform vec3 uTop;
  uniform vec3 uBottom;
  varying float vHeight;
  void main() {
    float t = smoothstep(0.0, 1.0, clamp(vHeight, 0.0, 1.0)); // horizon→zenith; below horizon = bottom
    gl_FragColor = vec4(mix(uBottom, uTop, t), 1.0);
  }
`;

/**
 * Sky + sun, driven by timecyc for the time of day (phase 1–2 of the graphics work):
 * a gradient sky dome (`skyBot`→`skyTop`), a sun that rises at the east horizon and
 * sets at the west, a sun-tracking directional light (fades to night with the sun
 * height), and an ambient fill. Camera-following; the dome/sun are unlit + unfogged.
 * Renderware-free — it takes a plain colour sampler so it can live in `game/**`.
 */
export class SkyPlugin implements Plugin {
  /**
   * Dedicated light source for the god-rays effect — a separate Mesh sized independently
   * of the visible disc (`godraysSize`), so rays can stay strong while the disc looks small.
   * Not added to the scene; `GodRaysEffect` renders it into its own internal light scene.
   */
  readonly godraysSource: Mesh;

  readonly name = 'sky';
  /** The visible sun disc (a Mesh, not a Sprite). */
  readonly sunSource: Mesh;

  private readonly ambient = new AmbientLight(0xffffff, 1);
  private readonly corona: Sprite;
  private readonly dome: Mesh;
  private readonly getHour: () => number;
  private readonly material: ShaderMaterial;
  private readonly sample: (hour: number) => SkySample;
  private readonly sun = new DirectionalLight(0xffffff, 1);
  private readonly sunDir = new Vector3();

  constructor(sample: (hour: number) => SkySample, getHour: () => number) {
    this.sample = sample;
    this.getHour = getHour;
    this.material = new ShaderMaterial({
      depthWrite: false,
      fragmentShader: FRAGMENT,
      side: BackSide,
      uniforms: { uBottom: { value: new Color() }, uTop: { value: new Color() } },
      vertexShader: VERTEX,
    });
    this.dome = new Mesh(new SphereGeometry(RADIUS, 32, 16), this.material);
    this.dome.name = 'Sky';
    this.dome.renderOrder = -1;
    this.dome.frustumCulled = false;

    // Sun disc: a Mesh (god-rays needs a transparent, non-depth-writing Mesh light source).
    this.sunSource = new Mesh(
      new SphereGeometry(1, 16, 12),
      new MeshBasicMaterial({ blending: AdditiveBlending, depthWrite: false, fog: false, transparent: true }),
    );
    this.sunSource.name = 'Sun';
    // A second, invisible-in-scene Mesh whose only job is to be the god-rays light source
    // at its own (larger) scale; GodRaysEffect renders it itself, so it stays out of the scene.
    this.godraysSource = new Mesh(
      this.sunSource.geometry,
      new MeshBasicMaterial({ blending: AdditiveBlending, depthWrite: false, fog: false, transparent: true }),
    );
    this.godraysSource.name = 'SunGodrays';
    this.corona = sunSprite(radialTexture());
  }

  dispose(): void {
    for (const object of [this.dome, this.ambient, this.sun, this.sunSource, this.corona]) {
      object.removeFromParent();
    }
    this.dome.geometry.dispose();
    this.material.dispose();
    this.sunSource.geometry.dispose(); // shared with godraysSource
    (this.sunSource.material as MeshBasicMaterial).dispose();
    (this.godraysSource.material as MeshBasicMaterial).dispose();
    this.corona.material.dispose();
    this.corona.material.map?.dispose();
  }

  /** Current sun direction in three world space (unit; points toward the sun). For water glints etc. */
  getSunDirection(): Vector3 {
    return this.sunDir;
  }

  install(context: PluginContext): void {
    context.scene.add(this.dome, this.ambient, this.sun, this.sun.target, this.sunSource, this.corona);
    this.apply(context.config.graphics.sun.sunSize, context.config.graphics.sun.godraysSize);
  }

  update(context: PluginContext): void {
    this.dome.position.copy(context.camera.position); // keep the sky centred on the view
    this.apply(context.config.graphics.sun.sunSize, context.config.graphics.sun.godraysSize);
  }

  /** Push the current time-of-day sky/sun state into the dome, lights and sun sprites. */
  private apply(sunScale: number, godraysScale: number): void {
    const sky = this.sample(this.getHour());
    setColor(this.material.uniforms.uTop.value as Color, sky.skyTop, false);
    setColor(this.material.uniforms.uBottom.value as Color, sky.skyBot, false);

    const elevation = this.sunElevation(this.getHour()); // radians; ≤0 → below horizon
    const above = elevation > 0;
    const height = Math.max(0, Math.sin(elevation));

    setColor(this.sun.color, sky.dir, true);
    this.sun.intensity = above ? SUN_INTENSITY * height : 0;
    this.sun.position.copy(this.sunDir).multiplyScalar(100); // direction only (it's a directional light)
    this.ambient.intensity = AMBIENT_NIGHT + (AMBIENT_DAY - AMBIENT_NIGHT) * (above ? Math.min(1, height + 0.25) : 0);

    this.sunSource.visible = above;
    this.corona.visible = above;
    this.godraysSource.visible = above;
    if (above) {
      this.sunSource.position.copy(this.sunDir).multiplyScalar(SUN_DISTANCE);
      this.corona.position.copy(this.sunSource.position);
      this.godraysSource.position.copy(this.sunSource.position);
      setColor((this.sunSource.material as MeshBasicMaterial).color, sky.sunCore, true);
      setColor((this.godraysSource.material as MeshBasicMaterial).color, sky.sunCore, true);
      setColor(this.corona.material.color, sky.sunCorona, true);
      this.corona.material.opacity = sky.spriteBright;
      const core = sunScale * sky.sunSize;
      this.sunSource.scale.setScalar(core);
      this.corona.scale.setScalar(core * CORONA_RATIO * sky.spriteSize);
      this.godraysSource.scale.setScalar(godraysScale * sky.sunSize);
      // godraysSource isn't in the scene (GodRaysEffect renders it itself with matrixAutoUpdate
      // off), so nothing else refreshes its matrix — bake it here or the source stays at the origin.
      this.godraysSource.updateMatrix();
    }
  }

  /** Sun elevation (radians) for the hour: 0 at sunrise/sunset, peak at midday, negative at night.
   *  Sets {@link sunDir} (three world space: +X east → +Z south → −X west, +Y up). */
  private sunElevation(hour: number): number {
    if (hour <= SUNRISE || hour >= SUNSET) {
      this.sunDir.set(0, -1, 0); // below horizon (sprite hidden, light off)

      return -1;
    }
    const t = (hour - SUNRISE) / (SUNSET - SUNRISE); // 0..1 across the day
    const elevation = Math.sin(t * Math.PI) * MAX_ELEVATION;
    const azimuth = t * Math.PI; // east → west, arcing over the south
    const cosE = Math.cos(elevation);
    this.sunDir.set(Math.cos(azimuth) * cosE, Math.sin(elevation), Math.sin(azimuth) * cosE);

    return elevation;
  }
}

/** A soft radial glow texture (white centre → transparent) for the additive sun sprites. */
function radialTexture(): CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.25, 'rgba(255,255,255,0.85)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  return new CanvasTexture(canvas);
}

/** Set a Color from an 0–255 RGB triple. `managed` converts sRGB→linear (lights/sprites); the
 *  unlit sky shader outputs raw, so it passes its colours through as-is. */
function setColor(color: Color, [r, g, b]: Rgb, managed: boolean): void {
  color.setRGB(r / 255, g / 255, b / 255, managed ? SRGBColorSpace : undefined);
}

function sunSprite(map: CanvasTexture): Sprite {
  return new Sprite(
    new SpriteMaterial({ blending: AdditiveBlending, depthWrite: false, fog: false, map, transparent: true }),
  );
}
