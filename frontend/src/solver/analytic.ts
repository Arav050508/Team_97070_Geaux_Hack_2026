// The textbook formulas the app uses to check a part. Each one is a plain function: numbers
// in, numbers out. Nothing here touches the screen or the network, so the Python solver
// owner can port the formulas line by line, and scripts/check_formulas.py can check them.
//
// Everything is in SI units: meters, newtons, pascals, kilograms.
//
// Where the formulas come from (cite these in the README):
//   - Cantilever beam bending: any strength-of-materials text (Euler-Bernoulli beam theory).
//   - Circular plates under uniform pressure: Roark's Formulas for Stress and Strain, and
//     Timoshenko & Woinowsky-Krieger, Theory of Plates and Shells.
// These are screening estimates. They ignore stress concentrations at holes, contact, bolts,
// plasticity, buckling, fatigue, and temperature.
//
// A few words for readers new to this:
//   stress       force spread over an area, in pascals (Pa). Higher stress means the metal
//                is working harder. 1 MPa = 1,000,000 Pa.
//   yield        the stress where metal stops springing back and starts to bend for good.
//   deflection   how far a point moves when the load is applied.
//   moment       a twisting or bending effect: force times the distance it acts over.

// ---------- Cantilever (the bracket) ----------
// A cantilever is a beam held at one end with the other end free, like a diving board.

export interface BracketInput {
  widthM: number; // b, how wide the plate is
  thicknessM: number; // h, how thick the plate is
  lengthM: number; // L, the distance from the support to the load
  forceN: number; // F at x = L, perpendicular to the plate
  gravity: number; // m/s^2, for the plate's own weight
  youngsPa: number; // E, the material's stiffness
  densityKgM3: number; // used to work out the plate's own weight
}

export interface BracketResult {
  inertiaM4: number; // I = b h^3 / 12. How well the cross-section resists bending.
  weightPerLengthNm: number; // w = rho g b h. The plate's own weight per meter of length.
  stressFromForcePa: number; // 6 F L / (b h^2)
  stressFromWeightPa: number; // 3 w L^2 / (b h^2)
  peakStressPa: number; // the two above added together, at the support
  tipDeflectionM: number; // F L^3 / (3 E I) + w L^4 / (8 E I)
  /** Bending stress at distance u from the support (0 <= u <= L). */
  stressAt: (u: number) => number;
  /** Downward deflection at distance u from the support. Past L the beam stays straight. */
  deflectionAt: (u: number) => number;
}

/**
 * Bending of a beam held at one end, with a force at the other end and its own weight
 * spread along the length. The biggest stress is at the support, because that is where the
 * bending moment is largest.
 */
export function bracketBending(i: BracketInput): BracketResult {
  const { widthM: b, thicknessM: h, lengthM: L, forceN: F } = i;
  // Second moment of area for a rectangle. Note the h cubed: doubling the thickness makes
  // the plate eight times stiffer.
  const I = (b * h ** 3) / 12;
  // The plate's own weight per meter: density x gravity x cross-section area.
  const w = i.densityKgM3 * i.gravity * b * h;
  const sectionModulus = (b * h ** 2) / 6; // I / (h/2). Stress = moment / this.

  // Bending moment at distance u from the support. The load F pulls with lever arm (L - u),
  // and the plate's weight beyond that point adds w (L - u)^2 / 2.
  const moment = (u: number) => F * (L - u) + (w * (L - u) ** 2) / 2;
  // Clamp u into the range 0 to L so points past the ends do not give nonsense values.
  const stressAt = (u: number) => moment(Math.min(Math.max(u, 0), L)) / sectionModulus;

  const EI = i.youngsPa * I;
  // Standard deflection formula for a cantilever, split into the part from the end force
  // and the part from the beam's own weight. Valid for u from 0 to L.
  const deflectionWithin = (u: number) =>
    (F * u ** 2 * (3 * L - u)) / (6 * EI) + (w * u ** 2 * (6 * L ** 2 - 4 * L * u + u ** 2)) / (24 * EI);
  const tip = deflectionWithin(L);
  // How steeply the beam is tilted at the tip. Used to continue in a straight line past L.
  const tipSlope = (F * L ** 2) / (2 * EI) + (w * L ** 3) / (6 * EI);
  const deflectionAt = (u: number) =>
    u <= 0 ? 0 : u <= L ? deflectionWithin(u) : tip + tipSlope * (u - L);

  return {
    inertiaM4: I,
    weightPerLengthNm: w,
    stressFromForcePa: (F * L) / sectionModulus,
    stressFromWeightPa: (w * L ** 2) / 2 / sectionModulus,
    peakStressPa: moment(0) / sectionModulus,
    tipDeflectionM: tip,
    stressAt,
    deflectionAt,
  };
}

// ---------- Circular plate under uniform pressure (the hatch) ----------
// A round plate with the same pressure pushing on one whole face, like a drum skin.

// How the rim is held:
//   clamped           cannot move or rotate (bolted rigidly all the way round)
//   simply_supported  cannot move but is free to rotate (gives a higher stress, so safer to assume)
export type EdgeCondition = "clamped" | "simply_supported";

export interface PlateInput {
  radiusM: number; // a
  thicknessM: number; // t
  pressurePa: number; // q, cabin minus outside
  youngsPa: number;
  poisson: number; // nu, how much the plate narrows when stretched
  edge: EdgeCondition;
}

export interface PlateResult {
  flexuralRigidity: number; // D = E t^3 / (12 (1 - nu^2)). How stiff the plate is against bending.
  peakVonMisesPa: number;
  peakRadiusM: number; // where the peak occurs
  centerDeflectionM: number;
  /** Surface von Mises stress at radius r. */
  vonMisesAt: (r: number) => number;
  deflectionAt: (r: number) => number;
  /** Bending moments per unit length, for cross-checking against the deflection. */
  radialMomentAt: (r: number) => number;
  tangentialMomentAt: (r: number) => number;
}

/**
 * Stress and deflection of a round flat plate with even pressure on one face.
 * r is the distance from the plate's center (0 at the center, a at the rim).
 */
export function plateUnderPressure(i: PlateInput): PlateResult {
  const { radiusM: a, thicknessM: t, pressurePa: q, poisson: nu } = i;
  const D = (i.youngsPa * t ** 3) / (12 * (1 - nu ** 2));

  // Bending moments at radius r. A plate bends in two directions at once: along the radius
  // (Mr) and around the circle (Mt). The formulas differ by how the rim is held.
  const Mr =
    i.edge === "clamped"
      ? (r: number) => (q / 16) * ((1 + nu) * a ** 2 - (3 + nu) * r ** 2)
      : (r: number) => (q / 16) * (3 + nu) * (a ** 2 - r ** 2);
  const Mt =
    i.edge === "clamped"
      ? (r: number) => (q / 16) * ((1 + nu) * a ** 2 - (1 + 3 * nu) * r ** 2)
      : (r: number) => (q / 16) * ((3 + nu) * a ** 2 - (1 + 3 * nu) * r ** 2);

  // Surface stress = 6 M / t^2. Plane stress at the surface, so von Mises = sqrt(sr^2 - sr st + st^2).
  // "Von Mises" combines the two directions into one number that can be compared with the
  // material's yield stress.
  const vonMisesAt = (r: number) => {
    const sr = (6 * Mr(r)) / t ** 2;
    const st = (6 * Mt(r)) / t ** 2;
    return Math.sqrt(sr * sr - sr * st + st * st);
  };

  // How far the plate bows at radius r. It is largest at the center (r = 0) and zero at the rim.
  const deflectionAt =
    i.edge === "clamped"
      ? (r: number) => (q * (a ** 2 - r ** 2) ** 2) / (64 * D)
      : (r: number) => ((q * (a ** 2 - r ** 2)) / (64 * D)) * (((5 + nu) / (1 + nu)) * a ** 2 - r ** 2);

  // Find the peak stress by trying 401 evenly spaced radii from the center to the rim and
  // keeping the biggest. The peak is at the rim for a clamped plate and at the center for
  // a simply supported one, but sampling avoids having to assume that.
  let peak = 0;
  let peakR = 0;
  const samples = 400;
  for (let k = 0; k <= samples; k++) {
    const r = (k / samples) * a;
    const s = vonMisesAt(r);
    if (s > peak) {
      peak = s;
      peakR = r;
    }
  }

  return {
    flexuralRigidity: D,
    peakVonMisesPa: peak,
    peakRadiusM: peakR,
    centerDeflectionM: deflectionAt(0),
    vonMisesAt,
    deflectionAt,
    radialMomentAt: Mr,
    tangentialMomentAt: Mt,
  };
}

// ---------- Verdict ----------

// pass: safety factor meets the user's target. marginal: it holds, but with less margin than
// the target. fail: the peak stress is above yield.
export type VerdictKind = "pass" | "marginal" | "fail";

/**
 * Turns a safety factor into a verdict.
 * The safety factor is yield stress divided by peak stress. Below 1 the metal yields.
 * `target` is the user's minimum safety factor (2 by default).
 */
export function verdictFor(safetyFactor: number, target: number): VerdictKind {
  if (safetyFactor < 1) return "fail";
  return safetyFactor >= target ? "pass" : "marginal";
}
