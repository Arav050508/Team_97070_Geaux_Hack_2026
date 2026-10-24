// Material properties the formulas need.
//
// These are PLACEHOLDERS. They are typical handbook numbers for each alloy, entered from
// general engineering knowledge and not looked up in a datasheet yet. Before submitting,
// check each value against a datasheet (for example MatWeb or ASM) and put the link in the
// README. Real values vary with the temper and the supplier. None of these include a
// correction for temperature.

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
