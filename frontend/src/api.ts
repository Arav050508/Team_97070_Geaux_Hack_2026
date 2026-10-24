// The only file that talks to the backend. Every other file calls the functions here and
// never uses fetch itself, so a change to how the app reaches the backend means changing this
// file and nothing else.
//
// Requests go to /api/*, which Vite forwards to the FastAPI server on port 8000 (see
// vite.config.ts). The backend must be running for the app to do anything.
//
// Endpoints the backend provides:
//   POST /api/import-step  multipart form, field "file"          -> GeometryPayload
//   POST /api/interpret    { prompt, environment, model_id, ... } -> InterpretResponse
//   POST /api/solve        { spec, model_id }                     -> SolveResult

import type {
  GeometryPayload,
  InterpretRequest,
  InterpretResponse,
  SimulationSpec,
  SolveResult,
} from "./types";

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
 * Turns the user's plain-English request into a proposed setup (which surfaces are
 * supports, where the load goes, and so on).
 */
export async function interpret(req: InterpretRequest): Promise<InterpretResponse> {
  return postJson<InterpretResponse>("/api/interpret", req);
}

/** Sends the confirmed setup to Ansys and returns the stress, displacement, and verdict. */
export async function solve(spec: SimulationSpec, geometry: GeometryPayload): Promise<SolveResult> {
  // The backend keeps the STEP file, so it only needs the id of the stored model, not the
  // triangles.
  return postJson<SolveResult>("/api/solve", {
    spec,
    part_id: geometry.part_id,
    model_id: geometry.model_id,
  });
}

/**
 * Sends a STEP file to the backend and gets back the part as faces the viewer can draw.
 *
 * The backend answers POST /api/import-step (multipart form, field "file") with a
 * GeometryPayload: part_id "imported", a model_id, the file name as `name`, and one entry in
 * `faces` per CAD face, each with triangles in `positions` (meters) and `candidate: true`
 * for faces the user may pick.
 */
export async function importStep(file: File): Promise<GeometryPayload> {
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
  return { ...geo, part_id: "imported" };
}
