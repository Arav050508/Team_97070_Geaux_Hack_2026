// A tiny helper for direction vectors.

import type { Vec3 } from "../types";

/**
 * Scales a vector to length 1, so [0, 3, 4] becomes [0, 0.6, 0.8]. A direction only says
 * which way the force points. How hard it pushes is the magnitude, stored separately.
 *
 * A zero or non-numeric vector has no direction, so it is returned unchanged. The
 * confirmation card already blocks running in that case.
 */
export function unitVector(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]);
  if (!Number.isFinite(length) || length === 0) return v;
  // Round to 6 decimals so axis directions stay exactly [0, -1, 0] and not -0.9999999.
  const r = (n: number) => Math.round((n / length) * 1e6) / 1e6 + 0;
  return [r(v[0]), r(v[1]), r(v[2])];
}
