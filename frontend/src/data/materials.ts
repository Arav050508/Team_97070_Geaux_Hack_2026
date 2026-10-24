// Material properties the formulas need.
//
// These are typical handbook numbers for each alloy. Real values vary with the temper, the
// product form, and the supplier, and sources differ by about 1% on stiffness, so treat them as
// typical, not guaranteed. None include a correction for temperature. Where each one was
// checked (see the README for the links):
//   Aluminum 6061-T6: yield 276 MPa and density 2.70 g/cm3 match the Proto Labs data sheet.
//     Modulus is 68.9 GPa here. Proto Labs lists 68.3 GPa and other sources say 69 GPa.
//     Poisson's ratio 0.33 is the common handbook value (it is not on the Proto Labs sheet).
//   A36 steel: yield 250 MPa (AISC, for plates up to 8 in), modulus 200 GPa, and Poisson's
//     ratio 0.26 are the values listed on the A36 Wikipedia page, which cites AISC, MatWeb,
//     and Bushwick Metals for them. Density 7850 kg/m3 is the usual figure for structural
//     steel (that page rounds it to 7.8 g/cm3).

// The ids the rest of the app uses to refer to a material.
export type MaterialId = "aluminum_6061_t6" | "steel_a36";

export interface Material {
  id: MaterialId;
  // Name shown in the dropdown.
  name: string;
  // How stiff the material is: stress divided by stretch. Bigger means it bends less.
  youngs_modulus_Pa: number;
  // How much the material gets thinner when it is stretched. Most metals are near 0.3.
  poisson: number;
  // Mass per cubic meter. Used to work out the plate's own weight.
  density_kg_m3: number;
  // The stress where the metal starts to bend permanently. Staying below it is the goal,
  // and the safety factor is this number divided by the actual stress.
  yield_Pa: number;
}

export const MATERIALS: Material[] = [
  {
    id: "aluminum_6061_t6",
    name: "Aluminum 6061-T6",
    youngs_modulus_Pa: 68.9e9, // 68.9 GPa
    poisson: 0.33,
    density_kg_m3: 2700,
    yield_Pa: 276e6, // 276 MPa
  },
  {
    id: "steel_a36",
    name: "Structural steel (A36)",
    youngs_modulus_Pa: 200e9, // 200 GPa
    poisson: 0.26,
    density_kg_m3: 7850,
    yield_Pa: 250e6, // 250 MPa
  },
];

/** Finds a material by id. Returns undefined if the id is not in the list. */
export function getMaterial(id: string): Material | undefined {
  return MATERIALS.find((m) => m.id === id);
}
