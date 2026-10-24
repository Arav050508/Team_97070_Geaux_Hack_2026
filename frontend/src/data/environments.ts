// Conditions at each destination, bundled with the app as plain data.
//
// Because the numbers live here and are not fetched from a website at run time, the app
// uses no external API for them (the hackathon allows two). The values come from NASA's
// planetary fact sheets. Those are reference data for each world, not readings from a
// specific mission.
//
// The user types a destination name. If it matches a body in the list below, these values are
// used. If it does not (a moon, an asteroid, anywhere else), the user enters the gravity and
// outside pressure themselves, see customEnvironment at the bottom of this file.
//
// If you change a value, update its source in the README as well.

export interface Environment {
  // A short lowercase id for the backend, for example "mars". User-entered places use "custom".
  id: string;
  // The name shown in the app and used in the results, for example "Mars".
  name: string;
  // Gravity at the surface in meters per second squared. Earth is about 9.81.
  gravity_m_s2: number;
  /** Air pressure outside, in pascals. For reference: 1 millibar = 100 Pa, 1 bar = 100,000 Pa. */
  external_pressure_Pa: number;
  // The pressure as the source states it, used in sentences. It is not calculated from the
  // number above, so it never shows a rounded copy.
  pressure_label: string;
  // Other names that should find this destination, in lowercase, for example "orbit".
  aliases?: string[];
  sources: Array<{ label: string; url: string }>;
}

// Builds the NASA fact sheet link for one body. The page names follow one pattern.
const factSheet = (name: string, page: string) => ({
  label: `NASA ${name} Fact Sheet`,
  url: `https://nssdc.gsfc.nasa.gov/planetary/factsheet/${page}.html`,
});

export const ENVIRONMENTS: Environment[] = [
  {
    // Living and working in space itself, in orbit or far from any world. In free fall nothing
    // has weight, so gravity is 0 and loads come from thrust, docking, or handling instead.
    // Outside is a vacuum. This is a modeling choice, not a measured value: real orbits keep
    // a tiny leftover acceleration, far too small to matter for these checks.
    id: "space",
    name: "Free space (orbit)",
    gravity_m_s2: 0,
    external_pressure_Pa: 0,
    pressure_label: "vacuum",
    aliases: ["space", "orbit", "free space", "in space", "low earth orbit", "leo", "microgravity", "zero gravity", "zero g", "deep space", "iss"],
    sources: [{ label: "NASA: What is microgravity?", url: "https://www.nasa.gov/centers-and-facilities/glenn/what-is-microgravity/" }],
  },
  {
    id: "moon",
    name: "Moon",
    gravity_m_s2: 1.62,
    external_pressure_Pa: 3e-10, // the fact sheet gives 3 x 10^-15 bar, which is 3e-10 Pa
    pressure_label: "about 3 × 10⁻¹⁵ bar (near-vacuum)",
    sources: [factSheet("Moon", "moonfact")],
  },
  {
    id: "mars",
    name: "Mars",
    gravity_m_s2: 3.73,
    external_pressure_Pa: 636, // 6.36 mb is the mean; it swings between 4.0 and 8.7 mb over the year
    pressure_label: "6.36 mb mean (4.0 to 8.7 seasonal)",
    sources: [factSheet("Mars", "marsfact")],
  },
  {
    id: "mercury",
    name: "Mercury",
    gravity_m_s2: 3.7,
    external_pressure_Pa: 5e-10, // the sheet gives less than about 5 x 10^-15 bar, so this is the upper bound
    pressure_label: "less than about 5 × 10⁻¹⁵ bar (near-vacuum)",
    sources: [factSheet("Mercury", "mercuryfact")],
  },
  {
    id: "venus",
    name: "Venus",
    gravity_m_s2: 8.87,
    external_pressure_Pa: 9.2e6, // 92 bar
    pressure_label: "92 bar",
    sources: [factSheet("Venus", "venusfact")],
  },
  {
    id: "earth",
    name: "Earth",
    gravity_m_s2: 9.78, // the sheet's equatorial value. The mean is a little higher, about 9.8.
    external_pressure_Pa: 101400, // 1014 mb
    pressure_label: "1014 mb",
    sources: [factSheet("Earth", "earthfact")],
  },
  {
    id: "pluto",
    name: "Pluto",
    gravity_m_s2: 0.62,
    external_pressure_Pa: 1.3, // about 13 microbar
    pressure_label: "about 13 microbar",
    sources: [factSheet("Pluto", "plutofact")],
  },
];

/** Names that appear in the suggestion list while typing. */
export const DESTINATION_NAMES = ENVIRONMENTS.map((e) => e.name);

/**
 * Finds a bundled destination from what the user typed. Capitals and extra spaces do not
 * matter, so " mars " matches Mars. Returns null when there is no match.
 */
export function findEnvironment(text: string): Environment | null {
  const wanted = text.trim().toLowerCase();
  return ENVIRONMENTS.find((e) => e.name.toLowerCase() === wanted || e.aliases?.includes(wanted)) ?? null;
}

/**
 * Builds a destination from values the user typed, for any place that is not bundled.
 *
 * Gravity is in m/s² and the outside pressure is in kPa (0 is a vacuum). `problem` says what
 * is wrong, or is null when both numbers are usable. The returned `env` is always an object,
 * with NaN in the fields that are not valid yet, so the rest of the app can keep drawing.
 */
export function customEnvironment(
  name: string,
  gravityText: string,
  pressureKPaText: string,
): { env: Environment; problem: string | null } {
  const gravity = parseFloat(gravityText);
  const pressureKPa = parseFloat(pressureKPaText);
  const label = name.trim() || "your destination";

  let problem: string | null = null;
  if (!name.trim()) problem = "Type a destination name.";
  else if (!(gravity >= 0)) problem = `Enter the surface gravity of ${label} in m/s².`;
  else if (!(pressureKPa >= 0)) problem = `Enter the outside pressure at ${label} in kPa (0 for a vacuum).`;

  return {
    env: {
      id: "custom",
      name: name.trim() || "Custom",
      gravity_m_s2: gravity,
      external_pressure_Pa: pressureKPa * 1000,
      pressure_label: `${pressureKPaText || "?"} kPa, entered by you`,
      sources: [{ label: "Values entered by the user", url: "" }],
    },
    problem,
  };
}
