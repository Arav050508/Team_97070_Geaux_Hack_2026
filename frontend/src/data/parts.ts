// The two parts the app can model, plus the fixed dimensions of each.
//
// The 3D builder (src/parts/geometry.ts) and the solver (src/solver/solve.ts) both read the
// numbers from this file. Keeping them in one place means the picture and the math cannot
// disagree about how big a part is. The only dimension the user can change is thickness.

import type { PartId } from "../types";

/** What the part picker and the thickness input need to know about a part. */
export interface PartInfo {
  id: PartId;
  name: string;
  // One or two sentences shown on the part button.
  blurb: string;
  // Allowed thickness in millimeters. `default` is what a new part starts with.
  thickness: { default: number; min: number; max: number };
  // The prompt the "Try:" button fills in. It is written to work with the mock AI.
  example: string;
}

// The list the part picker shows, in order.
export const PARTS: PartInfo[] = [
  {
    id: "bracket",
    name: "Equipment bracket",
    blurb: "A plate bolted at one end that holds heavy equipment at the other. Weight depends on where you are.",
    thickness: { default: 12, min: 4, max: 30 },
    example: "Fix the two mounting holes and hang a 500 kg equipment rack from the end pad.",
  },
  {
    id: "hatch",
    name: "Hatch plate",
    blurb: "A round cover plate with cabin air pushing on one side and almost nothing on the other.",
    thickness: { default: 5, min: 2, max: 20 },
    example: "Clamp the rim and pressurize the cabin side to 101 kPa.",
  },
];

/** Looks up a part by id. Falls back to the first part if the id is somehow unknown. */
export function getPart(id: PartId): PartInfo {
  return PARTS.find((p) => p.id === id) ?? PARTS[0];
}

/**
 * Bracket dimensions in meters. The axes are: x along the length of the plate, y up
 * (the thickness direction), z across the width.
 */
export const BRACKET = {
  LENGTH_M: 0.2, // 200 mm long
  WIDTH_M: 0.06, // 60 mm wide
  PAD_START_M: 0.16, // the raised pad at the free end starts at x = 160 mm
  PAD_HEIGHT_M: 0.012, // and stands 12 mm above the plate
  HOLE_RADIUS_M: 0.007, // each mounting hole is 14 mm across
  HOLE_X_M: [0.025, 0.075] as const, // where the two hole centers are along x
};

/** Hatch dimensions in meters. The disc's axis is y, and the cabin side is the top face. */
export const HATCH = {
  RADIUS_M: 0.25, // a 500 mm wide disc
};
