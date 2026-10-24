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
  // The sample parts always use the browser version, even with the backend on. The backend only
  // knows imported files.
  if (USE_MOCK || req.part_id !== "imported") return mockInterpret(req, geometry);
  return postJson<InterpretResponse>("/api/interpret", req);
}

/** Runs the confirmed setup through the formulas and returns the stress, deflection, and verdict. */
export async function solve(
  spec: SimulationSpec,
  geometry: GeometryPayload,
): Promise<SolveResult> {
  // Same rule: sample parts are checked with the browser formulas, imported files by the backend.
  if (USE_MOCK || geometry.part_id !== "imported") return localSolve(spec, geometry);
  // The real solver rebuilds the part from these two numbers, so it does not need the
  // triangles.
  return postJson<SolveResult>("/api/solve", {
    spec,
    part_id: geometry.part_id,
    thickness_mm: geometry.thickness_mm,
    // Imported files only: tells the backend which stored STEP model to analyze.
    model_id: geometry.model_id,
  });
}

/**
 * Sends a STEP file to the backend and gets back the part as faces the viewer can draw.
 *
 * The browser cannot read STEP files itself, so there is no demo-mode version of this. In
 * demo mode it throws a clear message instead of pretending, and the user can still try the
 * two sample parts.
 *
 * The backend must answer POST /api/import-step (multipart form, field "file") with a
 * GeometryPayload: part_id "imported", a model_id, the file name as `name`, and one entry in
 * `faces` per CAD face, each with triangles in `positions` (meters) and `candidate: true`
 * for faces the user may pick.
 */
export async function importStep(file: File): Promise<GeometryPayload> {
  if (USE_MOCK) {
    throw new Error(
      "STEP import needs the backend, and the app is in demo mode. Start the backend and set VITE_USE_MOCK=false, or try a sample part.",
    );
  }
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/import-step", { method: "POST", body: form });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`/api/import-step failed (${res.status}) ${detail}`.trim());
  }
  const geo = (await res.json()) as GeometryPayload;
  // A quick sanity check, so a malformed reply gives a clear error instead of a blank view.
  if (!geo || !Array.isArray(geo.faces) || geo.faces.length === 0) {
    throw new Error("The backend returned a model with no faces.");
  }
  return { ...geo, part_id: "imported", thickness_mm: geo.thickness_mm ?? 0 };
}
