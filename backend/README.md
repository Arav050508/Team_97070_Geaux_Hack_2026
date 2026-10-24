# SimForge: backend

A small FastAPI server for the frontend. It imports STEP files, proposes the test setup, and
solves it in Ansys.

## Run

```powershell
# from the repo root, once
python -m venv backend\.venv
backend\.venv\Scripts\Activate.ps1
pip install -r backend\requirements.txt   # includes gmsh and ansys-mapdl-core

# every time (no --reload when using Ansys: a reload leaves the old Ansys process
# running, and Ansys Student allows only one at a time)
cd backend
uvicorn main:app --port 8000
```

Then start the frontend from `frontend/` with `npm run dev`.
Check the server with http://localhost:8000/api/health.

## Status

| Endpoint | Status |
| --- | --- |
| `POST /api/import-step` | Works. Reads the STEP file with Open CASCADE (`cadquery-ocp`), meshes each face for display, and returns ids, labels, areas, centers, normals, and triangles in meters. |
| `POST /api/interpret` | Placeholder. Fixed rules, not an AI: the lowest flat face (in Z) is fixed and the highest flat face is pushed along -Z. It only reads a number with kg, N, or kN. Replace `interpret_placeholder` in `main.py` with the LLM call. |
| `POST /api/solve` | Runs the analysis in Ansys Mechanical APDL (`ansys_solver.py`). Needs Ansys installed on this computer (Ansys Student works). |

How the solve works: gmsh fills the part with 10-node tetrahedra (Ansys element SOLID187), each
app face is matched to its gmsh surface by center and area, and the nodes, elements, supports, and
loads go to Ansys as one APDL input file through PyMAPDL. Ansys solves a linear static analysis,
and the von Mises stress and displacement at each node are copied onto the display triangles.
The mesh is kept under 120,000 nodes, below the 128,000 limit of Ansys Student.

Checked against beam theory, in Ansys Student 2025 R2 on our laptop. `samples/Cantilever beam.STEP`
(100 x 5 x 5 mm, aluminum 6061-T6), fixed at one end with 20 N down on the other:

| | Beam theory | SimForge with Ansys |
| --- | --- | --- |
| Tip deflection | 1.86 mm | 1.85 mm |
| Stress near the fixed end | 96 MPa | 93 MPa away from the support, 103 MPa right at its edge |

The higher number right at the edge comes from the perfectly rigid support, and the app says so
in a note. Before Ansys was installed, the same input files were also solved by a small
independent finite element script, which agreed within 2%. That script also checked pressure
loads: 0.1 MPa on the top face of the same beam gave a tip deflection of 1.737 mm against 1.742 mm
from beam theory. Pressure has not been run in Ansys itself yet.

## Things to know

- Units: STEP files are read in millimeters and sent to the frontend in meters. Results go back
  in MPa and mm.
- Axes: the analysis uses the CAD file's own axes. Most CAD programs use Z as up, so the viewer turns imported parts to show +Z up, and the direction menu calls -Z "Down".
- Face ids (`face_001`, ...) follow the order Open CASCADE walks the faces. The solver matches
  each one to its gmsh surface by center and area, not by order.
- If a solve hangs at "starting Ansys MAPDL", an old Ansys process is probably still holding the
  license. End every process with ansys or mapdl in its name in Task Manager and try again. The
  backend terminal prints a line for each step of a solve.
- Imported models are kept in memory. Restarting the server forgets them, so import the file again.
- Uploaded files go to `backend/uploads/`, which is in `.gitignore`.
