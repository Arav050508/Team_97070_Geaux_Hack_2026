// Shared types for the whole frontend.
//
// A "type" in TypeScript describes the shape of some data, for example "a face has an id,
// a label, and an area". Types produce no code at run time. They let the editor and the
// compiler catch mistakes, like using a field that does not exist.
//
// These types are also the contract with the rest of the team. The AI code, the solver,
// and this frontend all send each other JSON shaped like this. Changing a type here is an
// interface change: agree on it with the AI and solver owners first, or their code will
// quietly stop matching.

// A point or direction in 3D: [x, y, z]. Units are meters unless stated otherwise.
export type Vec3 = [number, number, number];

// ---------- Parts (read from a STEP file by the backend) ----------

// Every part is a STEP file the user imported. The id stays in the API so the backend can tell
// what kind of part a request is about if more kinds are added later.
export type PartId = "imported";

// What kind of surface a face is. The viewer and the AI use this to tell holes (cylindrical)
// from flat faces (planar).
export type FaceKind = "planar" | "cylindrical" | "other";

/** Information about one face of a part. The AI is only allowed to choose from these. */
export interface FaceMeta {
  // A stable name like "face_17". The same part always uses the same ids, whatever the
  // thickness, so the AI and the solver can refer to a face without guessing.
  id: string;
  kind: FaceKind;
  // A name a person can read, such as "Mounting hole A".
  label: string;
  // Surface area in square meters.
  area_m2: number;
  // The middle of the face. The solver uses it to measure distances (for example how far
  // the load is from the supports) and the viewer uses it to place the force arrow.
  centroid: Vec3;
  // Which way a flat face points. Only set for planar faces.
  normal?: Vec3;
  // true means the user may pick this face as a support, load, or pressurized face.
  // Faces with false are shown but cannot be clicked.
  candidate: boolean;
}

/** A face plus its triangles, so the 3D viewer can draw it and highlight it. */
export interface FaceMesh extends FaceMeta {
  // Every 3 numbers are one corner (x, y, z), and every 3 corners make one triangle.
  // The corners are not shared between triangles ("non-indexed"), which keeps the format
  // simple. Units are meters.
  positions: number[];
}

/** Everything the viewer needs to draw one part. */
export interface GeometryPayload {
  part_id: PartId;
  // The id the backend gave the stored model. It is sent back with the interpret and solve
  // requests so the backend knows which file to use.
  model_id?: string;
  // Display name shown in the corner of the 3D view.
  name: string;
  faces: FaceMesh[];
}

// ---------- The simulation spec (the shared contract) ----------

// What the solver can report. "safety_factor" is always calculated.
export type OutputKind = "von_mises_stress" | "displacement" | "safety_factor";

/** A force pushing on one face. */
export interface ForceLoad {
  type: "force";
  // Which face the force acts on, one of the ids in the part's face list.
  geometry_id: string;
  // The force in newtons. The spec sent to the solver always has this filled in.
  magnitude_N: number;
  // Which way the force pushes, as a direction vector. [0, -1, 0] is straight down.
  direction: Vec3;
  /**
   * Set when the user gave a mass instead of a force. The frontend then recalculates
   * magnitude_N = mass_kg times the destination's gravity when it runs the check, so the
   * same rack weighs less on the Moon than on Mars.
   */
  mass_kg?: number;
  /**
   * More faces that carry the same force, for example the second half of a bore. The force
   * is shared evenly by geometry_id and every face listed here.
   */
  extra_geometry_ids?: string[];
}

/**
 * Air pressure on the inside of a face minus air pressure on the outside.
 * The frontend adds this load itself. The AI never writes pressure values.
 */
export interface PressureLoad {
  type: "pressure_differential";
  geometry_id: string;
  // Pressure inside the cabin, in pascals (Pa).
  internal_pressure_Pa: number;
  // Pressure outside, in pascals. It comes from the Moon or Mars data file.
  external_pressure_Pa: number;
}

/**
 * The conditions at the chosen destination. They come from the bundled data file
 * (src/data/environments.ts), never from the AI, so every value has a source.
 */
export interface SpecEnvironment {
  name: string; // the destination, for example "mars" or the name the user typed
  gravity_m_s2: number;
  external_pressure_Pa: number;
  // null until the user types a cabin pressure. There is deliberately no default.
  internal_pressure_Pa: number | null;
  // Names of the sources, such as "NASA Mars Fact Sheet".
  sources: string[];
}

/** The user's own pass mark. It is a target they choose, not a code requirement. */
export interface SpecCriteria {
  // The safety factor the user wants to reach. 2 means "twice as strong as needed".
  min_safety_factor: number;
}

/**
 * Extra solver options. mesh_target_elements is the number of tetrahedra the user's mesh
 * detail dial asks for. The backend keeps it between 2,000 and 70,000 and stays under the
 * Ansys Student node limit.
 */
export interface SpecOptions {
  mesh_target_elements?: number;
}

/**
 * The full request sent to the solver: everything it needs to produce an answer.
 * It is built in two stages. The AI proposes the supports and loads, then the frontend
 * adds the environment, criteria, and options before running.
 */
export interface SimulationSpec {
  // "fea" is the Ansys finite element analysis on the backend.
  analysis_type: "fea";
  units: "SI"; // meters, newtons, pascals, kilograms
  // `name` is a material id from src/data/materials.ts, for example "aluminum_6061_t6".
  // `source` records who chose it, so the UI can warn when the AI guessed.
  material: { name: string; source: "user_selected" | "ai_assumed" };
  // Surfaces that are held in place.
  constraints: Array<{
    type: "fixed_support";
    geometry_id: string;
  }>;
  loads: Array<ForceLoad | PressureLoad>;
  outputs: OutputKind[];
  environment: SpecEnvironment;
  criteria: SpecCriteria;
  options: SpecOptions;
}

/**
 * What the AI hands back before the frontend finishes the spec. It leaves out the fields
 * the frontend fills in (environment, criteria, options), and its loads are forces only.
 * `Omit<A, "x" | "y">` means "type A without the fields x and y".
 */
export type ProposedSpec = Omit<SimulationSpec, "environment" | "loads" | "criteria" | "options"> & {
  loads: ForceLoad[];
};

// ---------- AI interpretation ----------

/** One answer choice for a clarifying question. */
export interface ClarificationOption {
  value: string;
  label: string;
  // true shows the choice grayed out with a "not supported" note. It is a way to be
  // honest about what the tool cannot do yet.
  unsupported?: boolean;
}

/** A question the AI asks when the request could mean two different things. */
export interface Clarification {
  id: string;
  question: string;
  options: ClarificationOption[];
  // The `value` of the option that is selected at first.
  default: string;
}

/** What the frontend sends to the AI. */
export interface InterpretRequest {
  // The plain-English request the user typed.
  prompt: string;
  part_id: PartId;
  // A short id such as "mars", or "custom" for a place the user described with their own numbers.
  environment_id: string;
  // The destination values the app is using, so the backend does not need its own table.
  environment: { name: string; gravity_m_s2: number; external_pressure_Pa: number };
  // Which stored model this is, and the faces the AI can choose from (ids, labels, areas,
  // positions, normals). Triangles are left out to keep the request small.
  model_id?: string;
  faces?: FaceMeta[];
}

/** What the AI sends back. */
export interface InterpretResponse {
  spec: ProposedSpec;
  // A short plain-English explanation shown in the chat.
  assistant_message: string;
  clarifications: Clarification[];
  /**
   * Faces the AI thinks the cabin pressure acts on. These are face ids only. The pressure
   * value itself always comes from the user.
   */
  pressure_face_ids: string[];
  /** A cabin pressure the user wrote in the prompt, copied as written. null if they gave none. */
  stated_cabin_pressure_kPa: number | null;
}

// ---------- Solver results ----------

// pass: safety factor meets the user's target.
// marginal: at least 1 but below the target.
// fail: below 1, meaning the stress is above the material's yield strength.
export type Verdict = "pass" | "marginal" | "fail";

/** What the solver sends back. */
export interface SolveResult {
  // "error" means the solver could not run. The `error` field then says why, in plain words.
  status: "ok" | "error";
  // Notes that do not stop the result, such as a peak stress that sits at a fixed support.
  warnings: string[];
  error?: string;
  // The highest von Mises stress anywhere on the part, in megapascals (MPa).
  // Von Mises stress is one number that summarizes a 3D stress state, so it can be
  // compared against the material's yield strength.
  max_von_mises_MPa: number;
  // The peak stress away from the fixed faces, set when it is clearly lower than the overall
  // peak (a rigid support overstates stress at its own edge).
  away_from_supports_MPa?: number | null;
  max_displacement_mm: number;
  // yield strength divided by the peak stress. null when status is "error".
  safety_factor: number | null;
  yield_MPa: number | null;
  verdict: Verdict | null;
  // One line naming the solver and the mesh, for example "Ansys MAPDL linear static, 16659 SOLID187 tetrahedra".
  method: string;
  /**
   * The values painted onto the part. For each face id there is one number per corner,
   * in the same order as that face's `positions`. (3 floats in `positions` = 1 vertex,
   * so a face with 30 floats has 10 values here.)
   */
  fields: {
    von_mises_MPa: Record<string, number[]>;
    displacement_mm: Record<string, number[]>;
  };
  // Plain-English list of what the result assumes, shown under the results.
  assumptions: string[];
}

// ---------- UI state ----------

/** Which screen the app is on. App.tsx moves between these as the user works. */
export type Stage =
  | "empty" // no part chosen yet
  | "ready" // part loaded, waiting for a request
  | "interpreting" // waiting for the AI
  | "confirming" // the AI's proposal is on screen for the user to review
  | "solving" // Ansys is running
  | "results"
  | "error";

/** One bubble in the chat. */
export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
}

// What a face is currently being used for, which decides its color in the 3D view.
export type FaceRole = "support" | "load" | "pressure" | "none";
