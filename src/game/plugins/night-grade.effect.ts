import { Effect } from 'postprocessing';
import { Color, Uniform } from 'three';

/**
 * Night colour grade (screen-space). Turns the "darker day" the lights produce into an actual *night
 * mood* — driven by the sun-height night factor (`uNight`, 0 day → 1 deep night), it:
 *   1. desaturates slightly (rod vision reads less colour in the dark),
 *   2. cool-multiplies toward `uTint` (moonlight is blue; a Purkinje-ish shift), and
 *   3. lifts the blacks to a faint tinted floor, so shadows read as deep moonlit blue, not dead black.
 * Strength rides `uNight` (= the night factor × the `night.grade` config), so it fades in/out with dusk
 * and costs nothing by day (the pass is disabled when `uNight ≈ 0`).
 */
export class NightGradeEffect extends Effect {
  set night(value: number) {
    (this.uniforms.get('uNight') as Uniform<number>).value = value;
  }

  constructor() {
    super('NightGradeEffect', fragmentShader, {
      uniforms: new Map<string, Uniform<Color | number>>([
        ['uNight', new Uniform(0)],
        ['uTint', new Uniform(new Color(0.6, 0.66, 0.85))],
      ]),
    });
  }

  setTint(r: number, g: number, b: number): void {
    (this.uniforms.get('uTint') as Uniform<Color>).value.setRGB(r, g, b);
  }
}

const fragmentShader = /* glsl */ `
  uniform float uNight;
  uniform vec3 uTint;

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec3 color = inputColor.rgb;
    float luma = dot(color, vec3(0.299, 0.587, 0.114));
    // Brightness mask: bright pixels (lamps, lit windows, coronas) keep their warm colour — the grade
    // backs off as luma rises, so only the dark/mid world is cooled. Full grade below ~0.5, off by ~0.9.
    float strength = uNight * (1.0 - smoothstep(0.5, 0.9, luma));
    // 1) desaturate toward luminance, 2) cool-multiply toward the night tint (both masked by strength).
    vec3 graded = mix(color, vec3(luma), 0.35 * strength);
    graded *= mix(vec3(1.0), uTint, strength);
    // 3) tinted shadow floor — blacks become deep moonlit blue instead of pure black (rides the night
    //    factor, not the mask: it only ever lifts darks, so it never touches the bright sources).
    graded = max(graded, uTint * 0.06 * uNight);
    outputColor = vec4(graded, inputColor.a);
  }
`;
