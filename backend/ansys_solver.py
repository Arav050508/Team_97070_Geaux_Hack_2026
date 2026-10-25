# Runs the structural analysis of an imported STEP part in Ansys Mechanical APDL (MAPDL).
#
# The steps:
#   1. gmsh (a free mesher) reads the STEP file and fills the part with small 10-node
#      tetrahedra, the solid elements Ansys calls SOLID187.
#   2. Each face the app knows about (face_001, face_002, ...) is matched to the same surface in
#      gmsh by its center and area, so supports and loads land on the faces the user picked.
#   3. The nodes, elements, supports, loads, and material are written to a plain APDL input file.
#      PyMAPDL starts Ansys, reads that file, and solves a linear static analysis.
#   4. The von Mises stress and displacement at every node come back from Ansys. Each corner of
#      the app's display triangles takes the value of the nearest node on the same face, which is
#      what colors the model in the browser.
#
# Everything is in SI units inside the analysis: meters, newtons, pascals.

from __future__ import annotations

import math
import tempfile
import threading
import time
from pathlib import Path

from mesh_repair import repair
from reset_ansys import reset_ansys

import numpy as np

# Material values, the same numbers as frontend/src/data/materials.ts (see that file for
# sources). If you change one there, change it here too.
MATERIALS = {
    "aluminum_6061_t6": {"name": "Aluminum 6061-T6", "E": 68.9e9, "nu": 0.33, "yield": 276e6},
    "steel_a36": {"name": "Structural steel (A36)", "E": 200e9, "nu": 0.26, "yield": 250e6},
}

# Ansys Student allows at most 128,000 nodes or elements in a structural model. Staying below
# this leaves some room.
MAX_NODES = 120_000

# About how many elements to aim for. Enough for a smooth stress picture on a simple part, and
# small enough to solve in seconds.
TARGET_ELEMENTS = 20_000
MIN_TARGET_ELEMENTS = 2_000
MAX_TARGET_ELEMENTS = 70_000


def log(message: str) -> None:
    """Prints a progress line to the backend terminal, so you can see which step a solve is on."""
    print(f"[solve {time.strftime('%H:%M:%S')}] {message}", flush=True)


class AnalysisError(Exception):
    """Something about the setup or the analysis went wrong. The message is shown to the user."""


# ---------- meshing ----------


def _solid187_order() -> list[int]:
    """
    Works out how to reorder gmsh's 10 tetrahedron nodes into the order Ansys expects.

    Both programs list the 4 corners first, then one node in the middle of each edge, but they
    list the edges in a different order. Ansys wants the middle nodes of edges 1-2, 2-3, 3-1,
    1-4, 2-4, 3-4 (corners numbered 1 to 4). gmsh says where each of its nodes sits, so this
    finds, for each edge Ansys wants, the gmsh node halfway along it.
    """
    import gmsh

    local = np.array(gmsh.model.mesh.getElementProperties(11)[4]).reshape(10, 3)
    corners = local[:4]
    wanted_edges = [(0, 1), (1, 2), (2, 0), (0, 3), (1, 3), (2, 3)]
    order = [0, 1, 2, 3]
    for a, b in wanted_edges:
        middle = (corners[a] + corners[b]) / 2
        order.append(int(np.argmin(np.linalg.norm(local - middle, axis=1))))
    return order


def _match_faces(app_faces: list[dict]) -> dict[str, int]:
    """
    Finds the gmsh surface for each of the app's faces, by center and area. Both programs read
    the same file with the same CAD engine, but nothing promises they number the faces alike.
    """
    import gmsh

    surfaces = []
    for _, tag in gmsh.model.getEntities(2):
        area = gmsh.model.occ.getMass(2, tag)
        center = np.array(gmsh.model.occ.getCenterOfMass(2, tag))
        surfaces.append((tag, area, center))

    # The size of the part, used to decide how close two centers must be to count as the same.
    centers = np.array([s[2] for s in surfaces])
    size = float(np.linalg.norm(centers.max(axis=0) - centers.min(axis=0))) or 1.0

    matches: dict[str, int] = {}
    for face in app_faces:
        target = np.array(face["centroid"])
        best = None
        for tag, area, center in surfaces:
            # The area must agree within 2% (or a tiny absolute amount for very small faces).
            if abs(area - face["area_m2"]) > max(0.02 * face["area_m2"], 1e-9):
                continue
            distance = float(np.linalg.norm(center - target))
            if best is None or distance < best[0]:
                best = (distance, tag)
        if best is not None and best[0] < 0.01 * size:
            matches[face["id"]] = best[1]
    return matches


def build_mesh(step_path: Path, app_faces: list[dict], needed_faces: set[str], target_elements: int = TARGET_ELEMENTS) -> dict:
    """
    Meshes the STEP file with 10-node tetrahedra. Returns the node coordinates (meters), the
    elements in Ansys node order, and the nodes that lie on each face in `needed_faces`.
    """
    import gmsh

    # interruptible=False stops gmsh from installing a Ctrl+C handler, which Python only allows
    # on the main thread. The web server runs each request on a worker thread.
    gmsh.initialize(interruptible=False)
    try:
        gmsh.option.setNumber("General.Terminal", 0)
        # Ask gmsh to convert the file to meters while reading it.
        gmsh.option.setString("Geometry.OCCTargetUnit", "M")
        gmsh.model.occ.importShapes(str(step_path))
        gmsh.model.occ.synchronize()

        volumes = gmsh.model.getEntities(3)
        if not volumes:
            raise AnalysisError("The STEP file has no solid to analyze. Export the part as a solid body.")
        volume = sum(gmsh.model.occ.getMass(3, tag) for _, tag in volumes)

        matches = _match_faces(app_faces)
        missing = [f for f in needed_faces if f not in matches]
        if missing:
            raise AnalysisError(f"Could not find these faces in the mesh: {', '.join(sorted(missing))}.")

        # Element size so the part gets roughly target_elements tetrahedra. A cube of side h
        # holds about 6 tetrahedra, so h = (6 x volume / count)^(1/3).
        h = (6 * volume / target_elements) ** (1 / 3)
        for _attempt in range(4):
            gmsh.model.mesh.clear()
            gmsh.option.setNumber("Mesh.MeshSizeMin", h * 0.5)
            gmsh.option.setNumber("Mesh.MeshSizeMax", h)
            gmsh.option.setNumber("Mesh.ElementOrder", 2)
            # On curved parts, the middle-of-edge nodes can pull a tetrahedron inside out, and
            # Ansys then refuses it ("zero or negative determinant of the Jacobian"). This
            # option makes gmsh repair those elements. It costs well under a second.
            gmsh.option.setNumber("Mesh.HighOrderOptimize", 1)
            gmsh.model.mesh.generate(3)
            node_tags, coords, _ = gmsh.model.mesh.getNodes()
            if len(node_tags) <= MAX_NODES:
                break
            h *= 1.4  # too many nodes for Ansys Student: use bigger elements and try again
        else:
            raise AnalysisError("The part needs more nodes than Ansys Student allows. Try a simpler part.")

        order = _solid187_order()
        types, _, element_nodes = gmsh.model.mesh.getElements(3)
        if 11 not in list(types):
            raise AnalysisError("gmsh did not make 10-node tetrahedra for this part.")
        tets = np.array(element_nodes[list(types).index(11)], dtype=np.int64).reshape(-1, 10)[:, order]

        face_nodes = {}
        for face_id in needed_faces:
            tags, _, _ = gmsh.model.mesh.getNodes(2, matches[face_id], includeBoundary=True)
            face_nodes[face_id] = np.unique(np.array(tags, dtype=np.int64))

        # Straighten the middle nodes of any element that curved edges fold inside out, because
        # Ansys refuses those (see mesh_repair.py).
        node_tags = np.array(node_tags, dtype=np.int64)
        coords = np.array(coords).reshape(-1, 3)
        coords, n_fixed = repair(node_tags, coords, tets)
        if n_fixed:
            log(f"straightened the curved edges of {n_fixed} badly shaped elements")

        return {
            "node_tags": node_tags,
            "coords": coords,
            "elements": tets,
            "face_nodes": face_nodes,
            "element_size_m": h,
        }
    finally:
        gmsh.finalize()


# ---------- the Ansys input file ----------


def write_input(mesh: dict, spec: dict, material: dict, path: Path) -> None:
    """Writes every node, element, support, and load as APDL commands into one text file."""
    lines = [
        "/NOPR",  # do not echo each command, which makes reading the file much faster
        "/PREP7",
        "ET,1,SOLID187",  # 10-node tetrahedron
        # Ansys checks each tetrahedron's shape when it is created and refuses a bad one, with
        # "zero or negative determinant of the Jacobian". Curved parts trip this on elements that
        # are fine for a linear stress analysis. The message itself suggests this setting: check
        # the shape as a straight-edged tetrahedron.
        "SHPP,LSTET,ON",
        f"MP,EX,1,{material['E']:.6e}",
        f"MP,PRXY,1,{material['nu']}",
        "TYPE,1",
        "MAT,1",
    ]
    for tag, (x, y, z) in zip(mesh["node_tags"], mesh["coords"]):
        lines.append(f"N,{tag},{x:.9e},{y:.9e},{z:.9e}")
    # The E command takes up to 8 nodes. EMORE adds the last 2 to the same element.
    for n in mesh["elements"]:
        lines.append("E," + ",".join(str(v) for v in n[:8]))
        lines.append(f"EMORE,{n[8]},{n[9]}")

    # Fixed supports: every node on a support face is held still in all directions.
    for c in spec.get("constraints", []):
        for node in mesh["face_nodes"][c["geometry_id"]]:
            lines.append(f"D,{node},ALL,0")

    # FCUM,ADD makes forces on the same node add up instead of replacing each other.
    lines.append("FCUM,ADD")
    for load in spec.get("loads", []):
        nodes = mesh["face_nodes"][load["geometry_id"]]
        if load["type"] == "force" and load.get("extra_geometry_ids"):
            # A force on several faces (for example both halves of a bore) is shared by all of
            # their nodes together. A node on two of the faces is counted once.
            nodes = np.unique(np.concatenate([nodes] + [mesh["face_nodes"][i] for i in load["extra_geometry_ids"]]))
        if load["type"] == "force":
            # The total force is shared equally by the nodes on the face. That gives the right
            # total force and moment, which is what a beam or bracket check depends on.
            share = float(load["magnitude_N"]) / len(nodes)
            dx, dy, dz = (share * c for c in load["direction"])
            for node in nodes:
                for label, value in (("FX", dx), ("FY", dy), ("FZ", dz)):
                    if value != 0:
                        lines.append(f"F,{node},{label},{value:.9e}")
        elif load["type"] == "pressure_differential":
            # Inside minus outside. A positive Ansys pressure pushes into the face, which is how
            # cabin air pushes on the cabin side of a hatch.
            net = float(load["internal_pressure_Pa"]) - float(load["external_pressure_Pa"])
            lines.append("NSEL,NONE")
            for node in nodes:
                lines.append(f"NSEL,A,NODE,,{node}")
            lines.append(f"SF,ALL,PRES,{net:.9e}")
            lines.append("NSEL,ALL")

    # The model ends here. _run_in_ansys sends the solve commands separately, so the log can
    # show how long loading the model and solving each take.
    lines += ["FINISH", "/GOPR"]
    path.write_text("\n".join(lines) + "\n")


# ---------- running Ansys ----------

# One Ansys session is started on the first solve and reused, because starting Ansys takes
# several seconds.
_mapdl = None


def _has_solver(mapdl) -> bool:
    """
    False when Ansys started without a solver. That happens when another Ansys process holds the
    one-session Student license: Ansys then starts the "PrepPost" product, which loads a model
    but dies at SOLVE. Ansys writes the product name and the license complaint at the top of its
    own output file, so look there.
    """
    text = ""
    try:
        text += str(mapdl.info)
    except Exception:
        pass
    try:
        for f in Path(str(mapdl.directory)).glob("file*.out"):
            text += f.read_text(errors="ignore")[:30000]
    except Exception:
        pass
    return "PrepPost" not in text and "demo users" not in text


def _get_mapdl():
    global _mapdl
    if _mapdl is not None:
        return _mapdl
    try:
        from ansys.mapdl.core import launch_mapdl
    except ImportError as e:
        raise AnalysisError("PyMAPDL is not installed. Run: pip install ansys-mapdl-core") from e

    # Two tries. If the first start has no solver license, end the old Ansys processes and
    # start again. This is the same fix as ending them by hand in Task Manager.
    for attempt in (1, 2):
        try:
            # start_timeout makes a stuck start fail with a message after 2 minutes instead of
            # waiting forever.
            log("starting Ansys MAPDL (the first time can take a minute)...")
            mapdl = launch_mapdl(loglevel="ERROR", cleanup_on_exit=True, start_timeout=120)
        except Exception as e:  # Ansys missing, no license, wrong path, or a stuck old process
            if attempt == 1:
                log(f"Ansys did not start ({str(e).splitlines()[0]}). Ending old Ansys processes and retrying...")
                log("ended: " + (", ".join(reset_ansys()) or "nothing"))
                continue
            raise AnalysisError(
                f"Could not start Ansys MAPDL: {e}. End every ansys and mapdl process in Task Manager and try again."
            ) from e
        if _has_solver(mapdl):
            _mapdl = mapdl
            return _mapdl
        try:
            mapdl.exit()
        except Exception:
            pass
        if attempt == 1:
            log("Ansys started without a solver license. Ending old Ansys processes and retrying...")
            log("ended: " + (", ".join(reset_ansys()) or "nothing"))
    raise AnalysisError(
        "Ansys started without a solver license twice. Close any open Ansys windows (Workbench, Mechanical), "
        "or restart the computer to clear the stuck license, then try again."
    )


def _first_error(output: str) -> str:
    """The text of the first *** ERROR *** block in Ansys output, on one line."""
    lines = output.splitlines()
    for i, line in enumerate(lines):
        if "*** ERROR ***" in line:
            block = " ".join(l.strip() for l in lines[i + 2 : i + 6] if l.strip())
            return f"Ansys says: {block[:300]}"
    return "Check the supports and loads."


def _run_in_ansys(input_path: Path) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Solves the model in Ansys. Returns node numbers, von Mises stress (Pa), and displacement (m)."""
    global _mapdl
    mapdl = _get_mapdl()
    try:
        mapdl.clear()
        n_lines = sum(1 for _ in open(input_path))
        log(f"Ansys is running, loading the model ({n_lines} lines)...")
        t0 = time.time()
        output = mapdl.input(str(input_path))
        if "cannot store element" in str(output) or "element shape" in str(output):
            # Some elements are still refused. Turn the shape check off and load the model again.
            # A truly broken element would still make the solve fail, and that is reported below.
            log("Ansys refused some badly shaped elements, loading again with the shape check off...")
            text = Path(input_path).read_text().replace("SHPP,LSTET,ON", "SHPP,OFF", 1)
            Path(input_path).write_text(text)
            mapdl.clear()
            output = mapdl.input(str(input_path))
        if "*** ERROR ***" in str(output):
            raise AnalysisError("Ansys reported an error while loading the model. " + _first_error(str(output)))
        log(f"model loaded in {time.time() - t0:.1f} s, solving...")

        # Print a line every 10 s while Ansys works, so a slow solve can be told from a stuck one.
        done = threading.Event()

        def heartbeat() -> None:
            start = time.time()
            while not done.wait(10):
                log(f"  still solving... {time.time() - start:.0f} s")

        threading.Thread(target=heartbeat, daemon=True).start()
        t1 = time.time()
        try:
            mapdl.run("/SOLU")
            mapdl.run("ANTYPE,STATIC")
            solve_output = mapdl.run("SOLVE")
            mapdl.run("FINISH")
        finally:
            done.set()
        if "*** ERROR ***" in str(solve_output):
            raise AnalysisError("Ansys reported an error while solving. " + _first_error(str(solve_output)))
        log(f"solved in {time.time() - t1:.1f} s, reading results...")
        t2 = time.time()
        mapdl.post1()
        mapdl.set("LAST")
        nodes = np.array(mapdl.mesh.nnum, dtype=np.int64)
        stress = np.array(mapdl.post_processing.nodal_eqv_stress())
        displacement = np.array(mapdl.post_processing.nodal_displacement("NORM"))
        log(f"results read in {time.time() - t2:.1f} s")
        return nodes, stress, displacement
    except AnalysisError:
        raise
    except Exception as e:
        # The session may be broken. Drop it so the next solve starts a fresh one.
        try:
            mapdl.exit()
        except Exception:
            pass
        _mapdl = None
        raise AnalysisError(f"The Ansys run failed: {e}") from e


# ---------- turning results into what the app draws ----------


def _nearest(points: np.ndarray, candidates: np.ndarray) -> np.ndarray:
    """For each point, the index of the closest candidate. Done in chunks to limit memory."""
    try:
        from scipy.spatial import cKDTree  # much faster than the brute-force loop below

        return cKDTree(candidates).query(points)[1].astype(np.int64)
    except ImportError:
        pass
    out = np.empty(len(points), dtype=np.int64)
    for start in range(0, len(points), 2000):
        chunk = points[start : start + 2000]
        d = ((chunk[:, None, :] - candidates[None, :, :]) ** 2).sum(axis=2)
        out[start : start + 2000] = d.argmin(axis=1)
    return out


def verdict_for(safety_factor: float, target: float) -> str:
    """Same rule as the frontend: fail below 1, marginal below the target, pass otherwise."""
    if safety_factor < 1:
        return "fail"
    return "pass" if safety_factor >= target else "marginal"


def analyze(spec: dict, model: dict, solver=None) -> dict:
    """
    Runs the whole analysis and returns a SolveResult dictionary for the frontend.

    `solver` is only for testing: a function that takes the input file path and returns the
    same three arrays as _run_in_ansys. Normally it is left out and Ansys does the work.
    """
    material = MATERIALS.get(spec.get("material", {}).get("name", ""))
    if material is None:
        raise AnalysisError("Unknown material. Pick aluminum 6061-T6 or A36 steel.")
    if not spec.get("constraints"):
        raise AnalysisError("Add at least one fixed support.")
    if not spec.get("loads"):
        raise AnalysisError("Add a force or a pressure.")

    needed = {c["geometry_id"] for c in spec["constraints"]} | {l["geometry_id"] for l in spec["loads"]}
    needed |= {i for l in spec["loads"] for i in l.get("extra_geometry_ids", [])}
    # Every display face is needed too, so its colors can come from its own nodes.
    needed |= set(model["positions"].keys())
    log("meshing the part with gmsh...")
    # The user's mesh detail dial. Keep it in a safe range whatever the request says.
    try:
        wanted = int((spec.get("options") or {}).get("mesh_target_elements") or TARGET_ELEMENTS)
    except (TypeError, ValueError):
        wanted = TARGET_ELEMENTS
    wanted = max(MIN_TARGET_ELEMENTS, min(MAX_TARGET_ELEMENTS, wanted))
    mesh = build_mesh(model["path"], model["faces"], needed, wanted)
    log(f"mesh ready: {len(mesh['elements'])} elements, {len(mesh['node_tags'])} nodes")

    with tempfile.TemporaryDirectory() as tmp:
        input_path = Path(tmp) / "model.inp"
        write_input(mesh, spec, material, input_path)
        nodes, stress, displacement = (solver or _run_in_ansys)(input_path)

    # Look up each result by node number.
    stress_by_node = dict(zip(nodes.tolist(), stress.tolist()))
    disp_by_node = dict(zip(nodes.tolist(), displacement.tolist()))
    coord_by_node = dict(zip(mesh["node_tags"].tolist(), mesh["coords"]))

    # Color each display corner with the nearest node on the same face.
    fields_s: dict[str, list[float]] = {}
    fields_d: dict[str, list[float]] = {}
    for face_id, positions in model["positions"].items():
        corners = np.array(positions).reshape(-1, 3)
        face_nodes = [n for n in mesh["face_nodes"][face_id] if n in stress_by_node]
        if not face_nodes or len(corners) == 0:
            fields_s[face_id] = [0.0] * len(corners)
            fields_d[face_id] = [0.0] * len(corners)
            continue
        idx = _nearest(corners, np.array([coord_by_node[n] for n in face_nodes]))
        fields_s[face_id] = [stress_by_node[face_nodes[i]] / 1e6 for i in idx]
        fields_d[face_id] = [disp_by_node[face_nodes[i]] * 1000 for i in idx]

    log("done")
    peak_pa = float(stress.max())
    max_disp_m = float(displacement.max())
    safety = material["yield"] / peak_pa if peak_pa > 0 else math.inf
    target = float(spec.get("criteria", {}).get("min_safety_factor", 1.4))

    # The peak often sits right where the part meets a fixed face. A perfectly rigid support
    # makes the stress there higher than in reality. Report the peak away from the supports too,
    # so the user can see how much of the peak comes from that edge.
    support_nodes = np.unique(np.concatenate([mesh["face_nodes"][c["geometry_id"]] for c in spec["constraints"]]))
    support_xyz = np.array([coord_by_node[n] for n in support_nodes])
    node_xyz = np.array([coord_by_node[n] for n in nodes.tolist()])
    near = _distances_to(node_xyz, support_xyz) < 2 * mesh["element_size_m"]
    warnings = []
    away_MPa = None
    if (~near).any():
        away = float(stress[~near].max())
        # Shown when the two differ by more than 5%.
        if away < 0.95 * peak_pa:
            away_MPa = away / 1e6
            warnings.append(
                f"The peak of {peak_pa / 1e6:.0f} MPa is at a fixed face, where a perfectly rigid support "
                f"overstates stress. Away from the supports the peak is {away / 1e6:.0f} MPa."
            )

    return {
        "status": "ok",
        "warnings": warnings,
        "max_von_mises_MPa": peak_pa / 1e6,
        # The peak away from the fixed faces, or None when it is about the same as the overall peak.
        "away_from_supports_MPa": away_MPa,
        "max_displacement_mm": max_disp_m * 1000,
        "safety_factor": safety,
        "yield_MPa": material["yield"] / 1e6,
        "verdict": verdict_for(safety, target),
        "method": f"Ansys MAPDL linear static, {len(mesh['elements'])} SOLID187 tetrahedra, {len(mesh['node_tags'])} nodes",
        "hand_check": [],
        "fields": {"von_mises_MPa": fields_s, "displacement_mm": fields_d},
        "assumptions": [
            "Linear static analysis: small deflections and a linear elastic material.",
            "Fixed supports are perfectly rigid, which can overstate the stress right at their edges.",
            "Each force is shared equally by the nodes on its face.",
            "The part's own weight, temperature, bolts, and contact between parts are not included.",
            f"Material: {material['name']}, yield {material['yield'] / 1e6:.0f} MPa.",
        ],
    }


def _distances_to(points: np.ndarray, targets: np.ndarray) -> np.ndarray:
    """For each point, the distance to the closest target point."""
    try:
        from scipy.spatial import cKDTree

        return cKDTree(targets).query(points)[0]
    except ImportError:
        pass
    out = np.empty(len(points))
    for start in range(0, len(points), 2000):
        chunk = points[start : start + 2000]
        d = ((chunk[:, None, :] - targets[None, :, :]) ** 2).sum(axis=2)
        out[start : start + 2000] = np.sqrt(d.min(axis=1))
    return out
