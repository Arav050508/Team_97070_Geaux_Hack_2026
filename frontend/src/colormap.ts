// The color scale used to paint stress and displacement onto the 3D part.
// Low values are blue, high values are red, with green and yellow in between.
// The steps also go from dark to light in a steady order, so the picture still reads
// correctly when printed in black and white.

// Each entry is one color stop as [red, green, blue], each from 0 to 1 (not 0 to 255,
// because Three.js, the 3D library, uses 0 to 1). The six stops are spread evenly, so the
// first is the lowest value and the last is the highest.
export const COLOR_STOPS: Array<[number, number, number]> = [
  [0.18, 0.25, 0.78], // blue: lowest
  [0.1, 0.62, 0.86], // light blue
  [0.2, 0.78, 0.5], // green
  [0.95, 0.86, 0.25], // yellow
  [0.95, 0.5, 0.15], // orange
  [0.78, 0.12, 0.12], // red: highest
];

/**
 * Turns a number from 0 to 1 into a color.
 * 0 gives the first stop, 1 gives the last, and anything between blends the two
 * nearest stops. The caller scales its real values (MPa, mm) into 0 to 1 first.
 */
export function colormap(t: number): [number, number, number] {
  // Clamp t into 0..1 so a value slightly out of range does not break the lookup,
  // then stretch it across the stops: t = 1 becomes position 5 (the last stop).
  const x = Math.min(1, Math.max(0, t)) * (COLOR_STOPS.length - 1);
  // i is the stop just below x. It is capped so that i + 1 always exists.
  const i = Math.min(COLOR_STOPS.length - 2, Math.floor(x));
  // f is how far x is from stop i toward stop i + 1, from 0 to 1.
  const f = x - i;
  const a = COLOR_STOPS[i];
  const b = COLOR_STOPS[i + 1];
  // Linear blend of each channel: a + (b - a) * f.
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

/**
 * Builds a CSS gradient string that matches the color scale, for the legend bar in the
 * results card. Because it reads the same COLOR_STOPS, the legend and the 3D view
 * cannot drift apart.
 */
export function cssGradient(direction = "to right"): string {
  const stops = COLOR_STOPS.map((c, i) => {
    // Position of this stop along the bar as a percentage: 0%, 20%, 40%, ... 100%.
    const pct = (i / (COLOR_STOPS.length - 1)) * 100;
    // CSS wants 0 to 255 per channel, so scale up from our 0 to 1 values.
    return `rgb(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)}) ${pct}%`;
  });
  return `linear-gradient(${direction}, ${stops.join(", ")})`;
}
