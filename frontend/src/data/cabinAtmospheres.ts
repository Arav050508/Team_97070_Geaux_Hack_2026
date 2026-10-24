// Real cabin pressures from NASA documents, so the user can start from a cited number
// instead of typing a made-up one.
//
// NASA writes cabin pressure in psia (pounds per square inch, absolute). The app works in
// kilopascals (kPa), so each entry stores psia as published and the kPa value is calculated
// from it. If you change a value here, update its source and the README as well.

// How many kilopascals are in one psi.
export const KPA_PER_PSI = 6.894757;

/** psia to kPa. */
export const psiaToKPa = (psia: number) => psia * KPA_PER_PSI;
/** kPa to psia. */
export const kPaToPsia = (kPa: number) => kPa / KPA_PER_PSI;

export interface CabinAtmosphere {
  id: string;
  name: string;
  // Total cabin pressure as NASA publishes it.
  psia: number;
  // Oxygen share of the air, in percent, as published.
  o2Percent: number;
  // Where the number comes from.
  source: { label: string; url: string };
}

// The NASA documents the numbers come from.
const TB_003 = {
  label: "NASA-STD-3001 Technical Brief OCHMO-TB-003, Habitable Atmosphere (Rev A, 2023)",
  url: "https://www.nasa.gov/wp-content/uploads/2023/12/ochmo-tb-003-habitable-atmosphere.pdf",
};
const TP_216134 = {
  label: "NASA/TP-2010-216134, Recommendations for Exploration Spacecraft Internal Atmospheres (2010)",
  url: "https://www.nasa.gov/wp-content/uploads/2023/03/henninger-8.2-34-atm-tp216134-2010.pdf",
};

export const CABIN_ATMOSPHERES: CabinAtmosphere[] = [
  // The brief says the ISS cabin is "typically maintained at 14.7 psia with 21% O2".
  { id: "iss", name: "ISS-type", psia: 14.7, o2Percent: 21, source: TB_003 },
  // The 2010 report recommends 8.0 psia (lunar) and 7.6 psia (Mars) as nominal pressures for
  // surface habitats, both at 32% oxygen.
  { id: "lunar", name: "Lunar habitat", psia: 8.0, o2Percent: 32, source: TP_216134 },
  { id: "mars", name: "Mars habitat", psia: 7.6, o2Percent: 32, source: TP_216134 },
];

// The range of total pressure the technical brief gives for indefinite crew exposure.
// Above 5.0 psia and up to 15.0 psia.
export const HABITABLE_RANGE_PSIA = { min: 5.0, max: 15.0, source: TB_003 };
