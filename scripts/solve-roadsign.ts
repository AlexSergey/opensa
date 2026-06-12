/**
 * Brute-force the roadsign plate transform (plan 042 item 5): enumerate Euler application
 * orders × angle signs × base plate triads and keep the combinations where EVERY observed
 * rotation family yields an upright, readable plate: lines run down (L = −Z), the face normal
 * is horizontal, width is horizontal, and W × L = N (no mirroring).
 * Run: `npx tsx scripts/solve-roadsign.ts`.
 */

type Vec = [number, number, number];

// Every rotation family observed in the 2dfx survey (degrees). NB: only families that actually
// occur in the data — the winning convention (order Z→X→Y, base W=+X L=−Y N=−Z) satisfies ALL
// of them; a speculative (90,0,180) family fails it but no sign in the map uses it.
const FAMILIES: Vec[] = [
  [90, 0, 0],
  [-90, 0, 180],
  [-90, -90, -90],
  [90, 90, 90],
  [0, 90, 90],
  [0, -90, -90],
  [180, 90, 90],
  [90, -90, -90],
];

const AXES: Vec[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

const ORDERS = ['xyz', 'xzy', 'yxz', 'yzx', 'zxy', 'zyx'] as const;

/** Which stored angle drives which axis (the file order may not be x,y,z — e.g. right/at/up). */
const ANGLE_MAPS: [number, number, number][] = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
];

function rot(axis: 'x' | 'y' | 'z', deg: number, v: Vec): Vec {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const [x, y, z] = v;
  if (axis === 'x') {
    return [x, y * c - z * s, y * s + z * c];
  }
  if (axis === 'y') {
    return [x * c + z * s, y, -x * s + z * c];
  }

  return [x * c - y * s, x * s + y * c, z];
}

function cross(a: Vec, b: Vec): Vec {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function near(a: Vec, b: Vec): boolean {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1e-6;
}

function apply(order: string, sign: number, map: [number, number, number], angles: Vec, v: Vec): Vec {
  let out = v;
  for (const axis of order) {
    const axisIndex = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
    out = rot(axis as 'x' | 'y' | 'z', angles[map[axisIndex]] * sign, out);
  }

  return out;
}

function familyOk(order: string, sign: number, map: [number, number, number], baseW: Vec, baseL: Vec, baseN: Vec, angles: Vec): boolean {
  const w = apply(order, sign, map, angles, baseW);
  const l = apply(order, sign, map, angles, baseL);
  const n = apply(order, sign, map, angles, baseN);
  const linesDown = near(l, [0, 0, -1]);
  const widthHorizontal = Math.abs(w[2]) < 1e-6;
  const faceHorizontal = Math.abs(n[2]) < 1e-6;
  const readable = near(cross(w, l), n);

  return linesDown && widthHorizontal && faceHorizontal && readable;
}

let best = -1;
for (const order of ORDERS) {
  for (const sign of [1, -1]) {
    for (const map of ANGLE_MAPS) {
      for (const baseW of AXES) {
        for (const baseL of AXES) {
          if (Math.abs(baseW[0] * baseL[0] + baseW[1] * baseL[1] + baseW[2] * baseL[2]) > 1e-6) {
            continue; // not perpendicular
          }
          for (const mirror of [1, -1]) {
            const baseN = cross(baseW, baseL).map((value) => value * mirror) as Vec;
            const passes = FAMILIES.map((angles) => familyOk(order, sign, map, baseW, baseL, baseN, angles));
            const count = passes.filter(Boolean).length;
            if (count > best) {
              best = count;
            }
            if (count >= FAMILIES.length - 1) {
              console.log(
                `order=${order} sign=${sign} map=(${map.join(',')}) W=(${baseW.join(',')}) L=(${baseL.join(',')}) N=(${baseN.join(',')}) passes=${count}/${FAMILIES.length} fails=[${FAMILIES.filter((_, i) => !passes[i])
                  .map((f) => f.join(','))
                  .join(' | ')}]`,
              );
            }
          }
        }
      }
    }
  }
}
console.log(`done (best pass count: ${best}/${FAMILIES.length})`);
