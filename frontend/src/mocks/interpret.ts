// A fake version of the AI step, used in demo mode.
//
// In the finished product, the user's sentence goes to a language model that reads it and
// proposes a setup. Here we skip the model. We pull a few numbers out of the sentence
// (mass, force, cabin pressure) with regular expressions and always propose the same
// faces for each part. That is enough to make the interface feel real while the AI side of
// the project is still being built.
//
// The shape of the answer (InterpretResponse in src/types.ts) is the same one the real
// backend will return, so the rest of the app does not need to change later.

import { getEnvironment } from "../data/environments";
import type { GeometryPayload, InterpretRequest, InterpretResponse } from "../types";

// Waits for `ms` milliseconds. Used to imitate the delay of a real network call.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Turns text like "1,200" into the number 1200. Commas are removed first.
const num = (s: string) => parseFloat(s.replace(/,/g, ""));

// A regular expression ("regex") is a pattern for finding text. In the three helpers below:
//   [\d,]+(?:\.\d+)?   a number, possibly with commas and a decimal part
//   \s*                any amount of spaces
//   \b                 the end of a word, so "kg" matches but "kgs" does not
//   /i                 ignore upper or lower case
// The parentheses "capture" the number so m[1] holds just the digits.

/** Finds a mass like "500 kg" in the prompt. Returns null if there is none. */
function parseMassKg(prompt: string): number | null {
  const m = prompt.match(/([\d,]+(?:\.\d+)?)\s*kg\b/i);
  return m ? num(m[1]) : null;
}

/** Finds a force like "2000 N" or "2 kN" in the prompt and returns it in newtons. */
function parseForceN(prompt: string): number | null {
  const m = prompt.match(/([\d,]+(?:\.\d+)?)\s*(kN|N|newtons?)\b/i);
  if (!m) return null;
  // m[2] is the unit. Kilonewtons are 1000 newtons each.
  return /kN/i.test(m[2]) ? num(m[1]) * 1000 : num(m[1]);
}

/** Finds a pressure like "101 kPa" in the prompt. Returns it in kilopascals. */
function parseKPa(prompt: string): number | null {
  const m = prompt.match(/([\d,]+(?:\.\d+)?)\s*kpa\b/i);
  return m ? num(m[1]) : null;
}

/**
 * The fake AI. Takes the user's request and the part's faces, and returns a proposed setup
 * plus a message and some questions for the user.
 */
export async function mockInterpret(
  req: InterpretRequest,
  geometry: GeometryPayload,
): Promise<InterpretResponse> {
  await sleep(700);
  const env = getEnvironment(req.environment_id);

  // ----- Hatch: clamp the rim and pressurize the cabin side -----
  if (req.part_id === "hatch") {
    // The rim is the only curved face. face_01 is the cabin-side face (see geometry.ts).
    const rim = geometry.faces.find((f) => f.kind === "cylindrical");
    const cabinSide = geometry.faces.find((f) => f.id === "face_01");
    const kPa = parseKPa(req.prompt);
    return {
      spec: {
        analysis_type: "analytic_screening",
        units: "SI",
        // "ai_assumed" tells the UI the user did not pick this material, so it can say so.
        material: { name: "aluminum_6061_t6", source: "ai_assumed" },
        constraints: rim ? [{ type: "fixed_support", geometry_id: rim.id, confidence: 0.95 }] : [],
        // No loads here. The pressure load is added later by App.tsx, once the user has
        // confirmed a cabin pressure. The AI never sets pressures.
        loads: [],
        outputs: ["von_mises_stress", "displacement", "safety_factor"],
      },
      assistant_message:
        `Using ${env.name} conditions. I clamped the rim and marked the cabin-side face as the pressurized one. ` +
        (kPa === null
          ? "You did not give a cabin pressure, so enter one below."
          : `I took the cabin pressure of ${kPa} kPa from your message; please check it.`),
      // A clarification is a multiple-choice question the user answers on the card.
      clarifications: [
        {
          id: "edge_condition",
          question: "How is the hatch rim held?",
          options: [
            { value: "clamped", label: "Clamped: bolted rigidly all the way round" },
            { value: "simply_supported", label: "Simply supported: free to rotate (more conservative)" },
          ],
          default: "clamped",
        },
      ],
      pressure_face_ids: cabinSide ? [cabinSide.id] : [],
      stated_cabin_pressure_kPa: kPa,
    };
  }

  // ----- Bracket: fix the mounting holes and put a weight on the end pad -----
  // The two mounting holes are the curved faces the user is allowed to pick.
  const holes = geometry.faces.filter((f) => f.kind === "cylindrical" && f.candidate);
  const pad = geometry.faces.find((f) => f.id === "face_42");
  const mass = parseMassKg(req.prompt);
  const force = parseForceN(req.prompt);
  // Weight is mass times gravity, so the same 500 kg weighs less on the Moon than on Mars.
  // If the user gave a force directly we use that. If they gave neither we guess 2000 N.
  const magnitude = mass !== null ? mass * env.gravity_m_s2 : (force ?? 2000);

  return {
    spec: {
      analysis_type: "analytic_screening",
      units: "SI",
      material: { name: "aluminum_6061_t6", source: "ai_assumed" },
      constraints: holes.map((h, i) => ({
        type: "fixed_support" as const,
        geometry_id: h.id,
        // How sure the AI is. Made-up numbers here, since there is no real model.
        confidence: i === 0 ? 0.97 : 0.96,
      })),
      loads: pad
        ? [
            {
              type: "force" as const,
              geometry_id: pad.id,
              magnitude_N: magnitude,
              // [0, -1, 0] points straight down, with y as the up axis.
              direction: [0, -1, 0],
              // Keep the mass too (only if the user gave one) so the results can show the
              // "weight = mass x gravity" step.
              ...(mass !== null ? { mass_kg: mass } : {}),
            },
          ]
        : [],
      outputs: ["von_mises_stress", "displacement", "safety_factor"],
    },
    assistant_message:
      `Using ${env.name} conditions (gravity ${env.gravity_m_s2} m/s²). I fixed the two mounting holes and put the load on the end pad.` +
      (mass !== null
        ? ` Weight is mass × gravity, so ${mass} kg weighs ${(mass * env.gravity_m_s2).toFixed(0)} N here.`
        : " You gave a force, so I used it as written."),
    clarifications: [
      {
        id: "load_position",
        question: "Where does the load act along the bracket?",
        options: [
          { value: "pad_center", label: "Center of the end pad" },
          { value: "free_end", label: "Very tip of the bracket (longer lever arm)" },
        ],
        default: "pad_center",
      },
      {
        id: "support_model",
        question: "Fix the whole hole surface, or model bolts and contact?",
        options: [
          { value: "fixed_surface", label: "Fix the hole surfaces (simple)" },
          // The UI shows this option greyed out, since the formulas cannot model bolts.
          { value: "bolts", label: "Model bolts and contact", unsupported: true },
        ],
        default: "fixed_surface",
      },
    ],
    // Only the hatch has pressure, so the bracket leaves these empty.
    pressure_face_ids: [],
    stated_cabin_pressure_kPa: null,
  };
}
