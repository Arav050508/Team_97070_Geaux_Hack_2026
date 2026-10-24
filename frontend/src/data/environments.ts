// Conditions at each destination, bundled with the app as plain data.
//
// Because the numbers live here and are not fetched from a website at run time, the app
// uses no external API for them (the hackathon allows two). The values come from NASA's
// planetary fact sheets. Those are reference data for each world, not readings from a
// specific mission.
//
// If you change a value, update its source in the README and the design doc as well.

// The ids the rest of the app uses for destinations.
export type EnvId = "moon" | "mars";

export interface Environment {
  id: EnvId;
  name: string;
  // Gravity at the surface in meters per second squared. Earth is about 9.81.
  gravity_m_s2: number;
  /** Air pressure outside, in pascals. For reference: 1 millibar = 100 Pa, 1 bar = 100,000 Pa. */
  external_pressure_Pa: number;
  // The next two are text shown in the panel exactly as the source states them. They are
  // not calculated from the numbers above, so the panel never shows a rounded copy.
  pressure_label: string;
  temperature_label: string;
  sources: Array<{ label: string; url: string }>;
}

export const ENVIRONMENTS: Environment[] = [
  {
    id: "moon",
    name: "Moon",
    gravity_m_s2: 1.62,
    external_pressure_Pa: 3e-10, // the fact sheet gives 3 x 10^-15 bar, which is 3e-10 Pa
    pressure_label: "about 3 × 10⁻¹⁵ bar (near-vacuum)",
    temperature_label: "95 K to 390 K, equatorial day/night",
    sources: [
      {
        label: "NASA Moon Fact Sheet",
        url: "https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html",
      },
    ],
  },
  {
    id: "mars",
    name: "Mars",
    gravity_m_s2: 3.73,
    external_pressure_Pa: 636, // 6.36 mb is the mean; it swings between 4.0 and 8.7 mb over the year
    pressure_label: "6.36 mb mean (4.0 to 8.7 seasonal)",
    temperature_label: "about 214 K mean; 184 K to 242 K at the Viking 1 site",
    sources: [
      {
        label: "NASA Mars Fact Sheet",
        url: "https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html",
      },
    ],
  },
];

/** Looks up a destination by id. Falls back to the first one if the id is unknown. */
export function getEnvironment(id: EnvId): Environment {
  return ENVIRONMENTS.find((e) => e.id === id) ?? ENVIRONMENTS[0];
}
