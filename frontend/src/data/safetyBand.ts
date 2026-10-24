// The range of safety factors the team treats as acceptable.
//
// A safety factor is yield strength divided by the peak stress. Below the low end the part is
// too close to yielding. Above the high end it is stronger than it needs to be, which on a
// spacecraft or habitat means extra mass that has to be launched.
//
// The numbers come from the team's own requirement, not from a building code.

export const SAFETY_BAND = {
  /** Lowest acceptable safety factor. Used as the default pass target. */
  min: 1.4,
  /** Highest useful safety factor. Above this the part is heavier than it needs to be. */
  max: 2.0,
};
