// The recommender. After a check runs, this answers "what would pass?" and "what is the
// lightest version that still passes?" by running the same solver again for every thickness
// the part allows, with each material.
//
// Nothing new is calculated here. Every number comes from solveSync in solve.ts, which in
// turn uses the formulas in analytic.ts. This file only repeats that check in a loop and
// picks the best result. That keeps the recommendation traceable: any row it shows can be
// reproduced by setting that thickness and material by hand and running the check.
//
// Mass is approximate. It treats the bracket as a plain rectangular plate (the holes and the
// raised pad are ignored) and the hatch as a plain disc. The numbers are good for comparing
// options with each other, not for a real mass budget.

import { BRACKET, HATCH, getPart } from "../data/parts";
import { MATERIALS, getMaterial } from "../data/materials";
import type { GeometryPayload, SimulationSpec, Verdict } from "../types";
import { verdictFor } from "./analytic";
import { solveSync } from "./solve";

/** One design that was tried: a material, a thickness, and how it did. */
export interface DesignOption {
  materialId: string;
  materialName: string;
  thicknessMm: number;
  safetyFactor: number;
  verdict: Verdict;
  // Approximate mass in kilograms. See the note at the top of this file.
  massKg: number;
}

export interface Recommendation {
  // The design the user just checked.
  current: DesignOption;
  // The lightest passing design that keeps the user's material. null if nothing passes.
  sameMaterial: DesignOption | null;
  // The lightest passing design with any material. null if nothing passes.
  anyMaterial: DesignOption | null;
  // The user's material at every allowed thickness, thinnest first. Drawn as the bar chart.
  sweep: DesignOption[];
}

/** Approximate mass of the part at a given thickness and density. */
function massOf(partId: GeometryPayload["part_id"], thicknessMm: number, densityKgM3: number): number {
  const t = thicknessMm / 1000;
  const area = partId === "bracket" ? BRACKET.LENGTH_M * BRACKET.WIDTH_M : Math.PI * HATCH.RADIUS_M ** 2;
  return area * t * densityKgM3;
}

/**
 * Tries one material at one thickness. Returns null if the solver cannot run it.
 * `light` is a copy of the part with no triangles. The solver needs the face centers but
 * not the triangles, and dropping them makes each try much faster.
 */
function tryDesign(
  spec: SimulationSpec,
  light: GeometryPayload,
  materialId: string,
  thicknessMm: number,
): DesignOption | null {
  const mat = getMaterial(materialId);
  if (!mat) return null;
  const res = solveSync(
    { ...spec, material: { name: materialId, source: "user_selected" } },
    { ...light, thickness_mm: thicknessMm },
  );
  if (res.status !== "ok" || res.safety_factor === null) return null;
  return {
    materialId,
    materialName: mat.name,
    thicknessMm,
    safetyFactor: res.safety_factor,
    verdict: verdictFor(res.safety_factor, spec.criteria.min_safety_factor),
    massKg: massOf(light.part_id, thicknessMm, mat.density_kg_m3),
  };
}

/** The passing option with the smallest mass. If masses tie, the thinner one wins. */
function lightest(options: DesignOption[]): DesignOption | null {
  const passing = options.filter((o) => o.verdict === "pass");
  if (passing.length === 0) return null;
  return passing.reduce((best, o) =>
    o.massKg < best.massKg || (o.massKg === best.massKg && o.thicknessMm < best.thicknessMm) ? o : best,
  );
}

/**
 * Runs the check at every whole-millimeter thickness the part allows, for every material,
 * and summarizes the results. Returns null if the current setup cannot be solved at all.
 */
export function recommend(spec: SimulationSpec, geometry: GeometryPayload): Recommendation | null {
  const current = tryDesign(spec, geometry, spec.material.name, geometry.thickness_mm);
  if (!current) return null;

  // A copy of the part without its triangles (see tryDesign).
  const light: GeometryPayload = { ...geometry, faces: geometry.faces.map((f) => ({ ...f, positions: [] })) };
  const { min, max } = getPart(geometry.part_id).thickness;

  const sweep: DesignOption[] = [];
  const all: DesignOption[] = [];
  for (const m of MATERIALS) {
    for (let t = min; t <= max; t++) {
      const option = tryDesign(spec, light, m.id, t);
      if (!option) continue;
      all.push(option);
      if (m.id === spec.material.name) sweep.push(option);
    }
  }

  return {
    current,
    sameMaterial: lightest(sweep),
    anyMaterial: lightest(all),
    sweep,
  };
}
