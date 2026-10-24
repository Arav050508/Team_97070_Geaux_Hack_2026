# The backend for SimForge. Run it with:
#     uvicorn main:app --port 8000
# Leave out --reload while using Ansys: a reload leaves the old Ansys process running, and
# Ansys Student allows only one at a time.
# The frontend's dev server forwards every /api request here (see frontend/vite.config.ts).
#
# Three endpoints, matching the table in frontend/README.md and the shapes in
# frontend/src/types.ts:
#   POST /api/import-step   a STEP file in, the part's faces out
#   POST /api/interpret     the user's request in, a proposed setup out
#   POST /api/solve         the confirmed setup in, the stress result out
#
# Status of each one:
#   import-step  works. It reads the STEP file with the CAD engine (step_import.py).
#   interpret    PLACEHOLDER. Fixed rules stand in for the LLM until it is connected.
#                See interpret_placeholder below.
#   solve        Runs the analysis in Ansys MAPDL (ansys_solver.py). It needs Ansys installed
#                on this computer, plus the gmsh and ansys-mapdl-core packages.

from __future__ import annotations

import re
import uuid
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from ansys_solver import AnalysisError, analyze
from step_import import StepImportError, build_geometry

app = FastAPI(title="SimForge backend")

# Lets the frontend call the backend directly from the browser (for example from
# http://localhost:5173) as well as through the dev server's forwarding.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Uploaded STEP files are kept here so the solver can open them later by model id. The folder is
# listed in .gitignore, so uploads never end up in the repo.
UPLOAD_DIR = Path(__file__).parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

# What the backend remembers about each imported model, by model id: the file name, where the
# file is, and the face list (without triangles). It lives in memory, so restarting the server
# forgets it and the user has to import the file again.
MODELS: dict[str, dict] = {}

# STEP files bigger than this are refused. The frontend has the same limit.
MAX_UPLOAD_BYTES = 50 * 1024 * 1024


@app.get("/api/health")
def health() -> dict:
    """A quick check that the server is running. Open http://localhost:8000/api/health."""
    return {"ok": True, "models_loaded": len(MODELS)}


# ---------- import ----------


@app.post("/api/import-step")
async def import_step(file: UploadFile = File(...)) -> dict:
    """Reads an uploaded STEP file and returns its faces as a GeometryPayload."""
    name = file.filename or "part.step"
    if not name.lower().endswith((".step", ".stp")):
        raise HTTPException(400, "That is not a STEP file. Choose a file that ends in .step or .stp.")

    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(400, "That file is over 50 MB. Try a single part instead of a whole assembly.")

    model_id = uuid.uuid4().hex
    path = UPLOAD_DIR / f"{model_id}.step"
    path.write_bytes(data)

    try:
        geometry = build_geometry(path, name, model_id)
    except StepImportError as e:
        path.unlink(missing_ok=True)
        raise HTTPException(400, str(e)) from e

    # Keep the face list without the triangles. The solver and the AI only need ids, labels,
    # areas, centers, and normals.
    MODELS[model_id] = {
        "name": name,
        "path": path,
        "faces": [{k: v for k, v in f.items() if k != "positions"} for f in geometry["faces"]],
        # How many corners each face has, to size the result arrays to match the drawing.
        "vertex_counts": {f["id"]: len(f["positions"]) // 3 for f in geometry["faces"]},
        # The display triangles, so the solver can color the same corners the browser draws.
        "positions": {f["id"]: f["positions"] for f in geometry["faces"]},
    }
    return geometry


# ---------- interpret ----------


def _parse_load(prompt: str) -> tuple[float | None, float | None]:
    """Finds a mass in kg or a force in N in the request. Returns (mass_kg, force_N)."""
    text = prompt.lower()
    mass = re.search(r"(\d+(?:\.\d+)?)\s*(?:kg|kilograms?)\b", text)
    force = re.search(r"(\d+(?:\.\d+)?)\s*(?:kn|n|newtons?)\b", text)
    if force:
        value = float(force.group(1))
        # "kn" is kilonewtons, so multiply by 1000.
        if re.search(r"\d\s*kn\b", force.group(0)):
            value *= 1000
        return None, value
    if mass:
        return float(mass.group(1)), None
    return None, None


def interpret_placeholder(body: dict, model: dict) -> dict:
    """
    PLACEHOLDER for the LLM. It does not read the request the way a model would. It always
    proposes the same thing: the lowest flat face (in Z) is fixed, and the highest flat face
    (in Z) is pushed down along -Z. It only reads a number with kg or N from the text.

    Replace this with the LLM call. The LLM should get `body["prompt"]` and `model["faces"]`
    and return the same dictionary shape. Keep the rule that the AI never sets gravity, the
    outside pressure, material values, or the safety factor.
    """
    flat = [f for f in model["faces"] if f["kind"] == "planar" and f["candidate"]]
    if len(flat) < 2:
        raise HTTPException(422, "The placeholder needs at least two flat faces. Pick the faces on the model instead.")
    # Lowest and highest flat faces by the height of their centers.
    bottom = min(flat, key=lambda f: f["centroid"][2])
    top = max(flat, key=lambda f: f["centroid"][2])

    gravity = float(body.get("environment", {}).get("gravity_m_s2", 0) or 0)
    mass, force = _parse_load(body.get("prompt", ""))
    load: dict = {"type": "force", "geometry_id": top["id"], "direction": [0, 0, -1]}
    if mass is not None:
        load["mass_kg"] = mass
        load["magnitude_N"] = mass * gravity
    else:
        # No number in the request: leave the force at 0 so the app asks for it. Never invent one.
        load["magnitude_N"] = force if force is not None else 0.0

    return {
        "spec": {
            "analysis_type": "fea",
            "units": "SI",
            "material": {"name": "aluminum_6061_t6", "source": "ai_assumed"},
            "constraints": [{"type": "fixed_support", "geometry_id": bottom["id"]}],
            "loads": [load],
            "outputs": ["von_mises_stress", "displacement", "safety_factor"],
        },
        "assistant_message": (
            "Placeholder rules, not the AI yet: I fixed the lowest flat face and pushed down on the "
            "highest one. Check both on the model and change them if they are wrong."
            + ("" if (mass is not None or force is not None) else " I did not find a force or mass in your request, so enter the load on the card.")
        ),
        "clarifications": [],
        "pressure_face_ids": [],
        "stated_cabin_pressure_kPa": None,
    }


@app.post("/api/interpret")
def interpret(body: dict) -> dict:
    """Turns the user's request into a proposed setup for an imported model."""
    model = MODELS.get(body.get("model_id") or "")
    if model is None:
        raise HTTPException(404, "The backend does not have that model. Import the STEP file again.")
    return interpret_placeholder(body, model)


# ---------- solve ----------


def run_ansys(spec: dict, model: dict) -> dict:
    """Runs the confirmed setup in Ansys. See ansys_solver.py for how."""
    return analyze(spec, model)


def _error_result(message: str) -> dict:
    """A SolveResult that tells the frontend the solve did not run, and why."""
    return {
        "status": "error",
        "error": message,
        "warnings": [],
        "max_von_mises_MPa": 0,
        "max_displacement_mm": 0,
        "safety_factor": None,
        "yield_MPa": None,
        "verdict": None,
        "method": "none",
        "hand_check": [],
        "fields": {"von_mises_MPa": {}, "displacement_mm": {}},
        "assumptions": [],
    }


@app.post("/api/solve")
def solve(body: dict) -> dict:
    """Runs the confirmed setup and returns the result for an imported model."""
    model = MODELS.get(body.get("model_id") or "")
    if model is None:
        return _error_result("The backend does not have that model. Import the STEP file again.")
    spec = body.get("spec") or {}
    try:
        return run_ansys(spec, model)
    except AnalysisError as e:
        return _error_result(str(e))
    except Exception as e:  # anything Ansys throws: show the reason instead of crashing
        return _error_result(f"The analysis failed: {e}")
