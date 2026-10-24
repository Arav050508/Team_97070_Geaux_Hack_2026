// Takes the confirmed setup (a SimulationSpec) and produces the results (a SolveResult).
// It does this by feeding the numbers into the formulas in analytic.ts, then packaging the
// answer with the working shown, so a person can follow every step.
//
// The real backend will do the same job in Python with the same inputs and outputs. In demo
// mode this runs inside the browser, so the whole app works without a server.

import { BRACKET, HATCH } from "../data/parts";
import { getMaterial } from "../data/materials";
import type { ForceLoad, GeometryPayload, PressureLoad, SimulationSpec, SolveResult } from "../types";
import { bracketBending, plateUnderPressure, verdictFor } from "./analytic";

// Waits for `ms` milliseconds, to imitate a network call.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Pascals to megapascals.
const MPa = (pa: number) => pa / 1e6;
// Rounds to a few significant digits for display. 12345.678 becomes "12300", 0.00123456
// becomes "0.00123". The Number() step drops trailing zeros.
const fmt = (n: number, digits = 3) => Number(n.toPrecision(digits)).toString();

/** Builds a result that carries only an error message, for when the inputs make no sense. */
function failure(error: string): SolveResult {
  return {
    status: "error",
    error,
    warnings: [],
    max_von_mises_MPa: 0,
    max_displacement_mm: 0,
    safety_factor: null,
    yield_MPa: null,
    verdict: null,
    method: "",
    hand_check: [],
    fields: { von_mises_MPa: {}, displacement_mm: {} },
    assumptions: [],
  };
}

/** "mars" becomes "Mars". */
function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * The demo-mode version of the backend call: waits a moment, like a network request would,
 * then does the real work in solveSync below.
 */
export async function localSolve(spec: SimulationSpec, geometry: GeometryPayload): Promise<SolveResult> {
  await sleep(700);
  return solveSync(spec, geometry);
}

/**
 * Checks the inputs, picks the right formulas for the part, and builds the result.
 * `geometry` is needed for the face positions (to color the 3D view) and the thickness.
 * It has no delay and no waiting, so src/solver/recommend.ts can call it many times in a
 * row to try different thicknesses.
 */
export function solveSync(spec: SimulationSpec, geometry: GeometryPayload): SolveResult {
  // ----- Check the inputs -----
  const mat = getMaterial(spec.material.name);
  if (!mat) return failure(`Unknown material "${spec.material.name}".`);
  if (spec.constraints.length === 0) {
    return failure("No fixed support is defined, so the part is free to move. Add at least one support.");
  }

  // Find the loads by type. The `l is ForceLoad` part tells TypeScript which kind of load
  // `find` returned, so we can read its fields without extra checks.
  const force = spec.loads.find((l): l is ForceLoad => l.type === "force");
  const pressure = spec.loads.find((l): l is PressureLoad => l.type === "pressure_differential");
  const env = spec.environment;
  const envName = capitalize(env.name);
  const faceById = (id: string) => geometry.faces.find((f) => f.id === id);

  // Assumption lines that apply to both parts. They end up in the results card.
  const common = [
    `Destination: ${envName}, gravity ${env.gravity_m_s2} m/s² (source: ${env.sources.join(", ")}).`,
    `Material: ${mat.name}, yield ${fmt(MPa(mat.yield_Pa))} MPa, E ${fmt(mat.youngs_modulus_Pa / 1e9)} GPa. Typical handbook values, not a specific batch.`,
    "Temperature extremes are not modeled. Strength is taken at room-temperature values.",
    "Analytic screening only: no stress concentrations at holes, no bolts or contact, no buckling or fatigue.",
  ];

  // ---------- bracket: cantilever beam ----------
  if (geometry.part_id === "bracket") {
    if (!force || !(force.magnitude_N > 0)) return failure("The bracket needs a force on the end pad.");
    // Where along the plate (x) each support sits. NaN ("not a number") marks a face id we
    // could not find.
    const supportXs = spec.constraints.map((c) => faceById(c.geometry_id)?.centroid[0] ?? NaN);
    const loadFace = faceById(force.geometry_id);
    if (supportXs.some(Number.isNaN) || !loadFace) return failure("A support or load face is not on this part.");

    // Treat the supports as one fixed line at their average x position.
    const xSupport = supportXs.reduce((a, b) => a + b, 0) / supportXs.length;
    // The load acts either at the middle of the pad or at the very tip, per the user's answer.
    const atTip = spec.options.load_position === "free_end";
    const xLoad = atTip ? BRACKET.LENGTH_M : loadFace.centroid[0];
    // L is the lever arm: how far the load is from the support.
    const L = xLoad - xSupport;
    if (!(L > 0.01)) {
      return failure("The load has to be farther along the plate than the supports. Check which faces you picked.");
    }

    const h = geometry.thickness_mm / 1000;
    const r = bracketBending({
      widthM: BRACKET.WIDTH_M,
      thicknessM: h,
      lengthM: L,
      forceN: force.magnitude_N,
      gravity: env.gravity_m_s2,
      youngsPa: mat.youngs_modulus_Pa,
      densityKgM3: mat.density_kg_m3,
    });

    const peakMPa = MPa(r.peakStressPa);
    // Safety factor: how many times stronger the metal is than the load requires.
    const sf = mat.yield_Pa / r.peakStressPa;
    const warnings = [
      ...(pressure ? ["A pressure load was set, but the bracket model only uses the force. Pressure was ignored."] : []),
      "Analytic screening estimate, not a finite-element result.",
    ];

    // Values for coloring the 3D view: one number per corner of every triangle, keyed by
    // face id. The stress and deflection depend only on the distance along the plate.
    const vm: Record<string, number[]> = {};
    const disp: Record<string, number[]> = {};
    let peakD = 0;
    for (const face of geometry.faces) {
      const s: number[] = [];
      const d: number[] = [];
      // positions is x,y,z,x,y,z,... so step by 3 to visit each corner.
      for (let i = 0; i < face.positions.length; i += 3) {
        const u = face.positions[i] - xSupport; // distance from the support
        s.push(MPa(r.stressAt(u)));
        const dv = r.deflectionAt(u) * 1000; // meters to millimeters
        d.push(dv);
        if (dv > peakD) peakD = dv;
      }
      vm[face.id] = s;
      disp[face.id] = d;
    }

    const massLine =
      force.mass_kg !== undefined
        ? [`Weight on ${envName}: F = m·g = ${fmt(force.mass_kg)} kg × ${env.gravity_m_s2} m/s² = ${fmt(force.magnitude_N)} N`]
        : [`Applied force: F = ${fmt(force.magnitude_N)} N`];

    return {
      status: "ok",
      warnings,
      max_von_mises_MPa: peakMPa,
      max_displacement_mm: peakD,
      safety_factor: sf,
      yield_MPa: MPa(mat.yield_Pa),
      verdict: verdictFor(sf, spec.criteria.min_safety_factor),
      method: "Cantilever beam bending (Euler-Bernoulli)",
      // The working, one line per step. The results card shows these so the reader can
      // redo the math with a calculator.
      hand_check: [
        ...massLine,
        `Lever arm: L = ${fmt(L)} m (supports at x = ${fmt(xSupport)} m, load at x = ${fmt(xLoad)} m)`,
        `Section: b = ${fmt(BRACKET.WIDTH_M * 1000)} mm, h = ${fmt(geometry.thickness_mm)} mm, I = b·h³/12 = ${fmt(r.inertiaM4)} m⁴`,
        `Stress from the load: σ = 6·F·L / (b·h²) = ${fmt(MPa(r.stressFromForcePa))} MPa`,
        `Plate's own weight: w = ρ·g·b·h = ${fmt(r.weightPerLengthNm)} N/m, σ = 3·w·L² / (b·h²) = ${fmt(MPa(r.stressFromWeightPa))} MPa`,
        `Peak stress (at the supports) = ${fmt(peakMPa)} MPa`,
        `Safety factor = yield / peak = ${fmt(MPa(mat.yield_Pa))} / ${fmt(peakMPa)} = ${fmt(sf)}`,
        `Tip deflection: δ = F·L³/(3·E·I) + w·L⁴/(8·E·I) = ${fmt(r.tipDeflectionM * 1000)} mm`,
      ],
      fields: { von_mises_MPa: vm, displacement_mm: disp },
      assumptions: [
        ...common,
        "The part is treated as a beam fixed at the average position of the supports. The rest of the plate is a uniform rectangle (the raised pad is ignored).",
        atTip
          ? "The load acts at the free tip of the bracket."
          : "The load acts at the center of the end pad.",
        "The load is perpendicular to the plate. Its weight is mass × the destination's gravity.",
        "The colormap shows the beam-theory bending stress along the plate. It is the same across the width and does not show stress concentrations at the holes.",
      ],
    };
  }

  // ---------- hatch: circular plate under pressure ----------
  if (!pressure) {
    return failure("The hatch needs a pressurized face and a cabin pressure. Add both, then run again.");
  }
  // The net push on the plate is the cabin pressure minus the pressure outside.
  const q = pressure.internal_pressure_Pa - pressure.external_pressure_Pa;
  if (!(q > 0)) return failure("Cabin pressure must be higher than the outside pressure for this model.");

  // If the user did not answer the rim question, assume the rim is clamped.
  const edge = spec.options.edge_condition ?? "clamped";
  const t = geometry.thickness_mm / 1000;
  const r = plateUnderPressure({
    radiusM: HATCH.RADIUS_M,
    thicknessM: t,
    pressurePa: q,
    youngsPa: mat.youngs_modulus_Pa,
    poisson: mat.poisson,
    edge,
  });

  const peakMPa = MPa(r.peakVonMisesPa);
  const sf = mat.yield_Pa / r.peakVonMisesPa;
  const warnings = [
    ...(force ? ["A force load was set, but the hatch model only uses pressure. The force was ignored."] : []),
    "Analytic screening estimate, not a finite-element result.",
  ];

  // Same idea as the bracket: one stress and one deflection value per triangle corner.
  // Here they depend only on the distance from the center of the disc.
  const vm: Record<string, number[]> = {};
  const disp: Record<string, number[]> = {};
  for (const face of geometry.faces) {
    const s: number[] = [];
    const d: number[] = [];
    for (let i = 0; i < face.positions.length; i += 3) {
      // Distance from the center, using x and z (y is the thickness direction). The min()
      // stops tiny rounding errors from putting a rim point just outside the radius.
      const rad = Math.min(Math.hypot(face.positions[i], face.positions[i + 2]), HATCH.RADIUS_M);
      s.push(MPa(r.vonMisesAt(rad)));
      d.push(r.deflectionAt(rad) * 1000);
    }
    vm[face.id] = s;
    disp[face.id] = d;
  }

  const clamped = edge === "clamped";
  return {
    status: "ok",
    warnings,
    max_von_mises_MPa: peakMPa,
    max_displacement_mm: r.centerDeflectionM * 1000,
    safety_factor: sf,
    yield_MPa: MPa(mat.yield_Pa),
    verdict: verdictFor(sf, spec.criteria.min_safety_factor),
    method: clamped
      ? "Circular plate, clamped edge, uniform pressure (Roark)"
      : "Circular plate, simply supported edge, uniform pressure (Roark)",
    // The working. The two edge cases use different closed-form expressions.
    hand_check: [
      `Pressure load: q = cabin − outside = ${fmt(pressure.internal_pressure_Pa / 1000)} kPa − ${fmt(pressure.external_pressure_Pa / 1000)} kPa = ${fmt(q / 1000)} kPa`,
      `Plate: radius a = ${fmt(HATCH.RADIUS_M * 1000)} mm, thickness t = ${fmt(geometry.thickness_mm)} mm, D = E·t³ / (12·(1−ν²)) = ${fmt(r.flexuralRigidity)} N·m`,
      clamped
        ? `Edge stress: σ = 3·q·a² / (4·t²) = ${fmt(MPa((3 * q * HATCH.RADIUS_M ** 2) / (4 * t ** 2)))} MPa (radial); von Mises there = ${fmt(peakMPa)} MPa`
        : `Center stress: σ = 3·(3+ν)·q·a² / (8·t²) = ${fmt(peakMPa)} MPa`,
      `Peak von Mises = ${fmt(peakMPa)} MPa at r = ${fmt(r.peakRadiusM * 1000)} mm`,
      `Safety factor = yield / peak = ${fmt(MPa(mat.yield_Pa))} / ${fmt(peakMPa)} = ${fmt(sf)}`,
      clamped
        ? `Center deflection: w = q·a⁴ / (64·D) = ${fmt(r.centerDeflectionM * 1000)} mm`
        : `Center deflection: w = (5+ν)·q·a⁴ / (64·(1+ν)·D) = ${fmt(r.centerDeflectionM * 1000)} mm`,
    ],
    fields: { von_mises_MPa: vm, displacement_mm: disp },
    assumptions: [
      ...common,
      `Pressure differential: cabin ${fmt(pressure.internal_pressure_Pa / 1000)} kPa against ${fmt(pressure.external_pressure_Pa)} Pa outside, applied evenly over the plate.`,
      clamped
        ? "The rim is clamped: it cannot move or rotate. Real bolted joints are somewhere between clamped and simply supported."
        : "The rim is simply supported: it cannot move but can rotate. This is the more conservative case.",
      "Stress is the surface von Mises value. The plate's own weight and any seal or bolt loads are ignored.",
    ],
  };
}
