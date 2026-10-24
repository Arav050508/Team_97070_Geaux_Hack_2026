// The only file that talks to the backend. Every other file calls the functions here and
// never uses fetch itself, so switching between demo mode and a real backend means changing
// this file and nothing else.
//
// Parts are always built in the browser (src/parts/geometry.ts). For the other two calls
// there are two modes:
//   Demo mode (the default): the "AI" is src/mocks/interpret.ts and the formulas run in the
//     browser (src/solver/solve.ts). No network calls happen.
//   Real mode: set VITE_USE_MOCK=false (for example in a .env.local file). Requests go to
//     /api/*, which Vite forwards to the FastAPI server on port 8000 (see vite.config.ts).
//
// Endpoints the backend must provide, so the team can agree on them:
//   POST /api/interpret  { prompt, part_id, environment_id }   -> InterpretResponse
//   POST /api/solve      { spec, part_id, thickness_mm }       -> SolveResult

import type {
  GeometryPayload,
  InterpretRequest,
  InterpretResponse,
  PartId,
  SimulationSpec,
  SolveResult,
} from "./types";
import { buildPart } from "./parts/geometry";
import { mockInterpret } from "./mocks/interpret";
import { localSolve } from "./solver/solve";

// true unless VITE_USE_MOCK is set to the text "false". Vite replaces import.meta.env with
// the values from the environment when it builds the app.
export const USE_MOCK = import.meta.env.VITE_USE_MOCK !== "false";

/**
 * Sends `body` to `url` as JSON and returns the JSON reply.
 * `<T>` is a type placeholder: the caller says what shape the reply has, and TypeScript
 * then treats the result as that shape. It does not check the reply at run time.
 */
async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  // Anything outside the 200 range is a failure. Include the server's message when it
  // sent one, so the error shown in the chat says what went wrong.
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`${url} failed (${res.status}) ${detail}`.trim());
  }
  return (await res.json()) as T;
}

/**
 * Builds one of the two parts at a given thickness. This is always local because the parts
 * are fixed code. It is async only so callers can treat every function here the same way.
 */
export async function loadPart(partId: PartId, thicknessMm: number): Promise<GeometryPayload> {
  return buildPart(partId, thicknessMm);
}

/**
 * Turns the user's plain-English request into a proposed setup (which surfaces are
 * supports, where the load goes, and so on).
 * `geometry` is only used by the mock, which needs the face list. The real backend already
 * knows the faces from `part_id`.
 */
export async function interpret(
  req: InterpretRequest,
  geometry: GeometryPayload,
): Promise<InterpretResponse> {
  if (USE_MOCK) return mockInterpret(req, geometry);
  return postJson<InterpretResponse>("/api/interpret", req);
}

/** Runs the confirmed setup through the formulas and returns the stress, deflection, and verdict. */
export async function solve(
  spec: SimulationSpec,
  geometry: GeometryPayload,
): Promise<SolveResult> {
  if (USE_MOCK) return localSolve(spec, geometry);
  // The real solver rebuilds the part from these two numbers, so it does not need the
  // triangles.
  return postJson<SolveResult>("/api/solve", {
    spec,
    part_id: geometry.part_id,
    thickness_mm: geometry.thickness_mm,
  });
}
