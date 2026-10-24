# Reads a STEP file and turns it into the face list the frontend draws.
#
# A STEP file describes a part as exact curved surfaces, not triangles. A 3D view can only draw
# triangles, so this file asks the CAD engine (OCP, the Python version of Open CASCADE) to cut
# every face into small triangles. Each face keeps its own id, so the user can say "fix face 3"
# and the app knows which surface that is.
#
# The result has the same shape as GeometryPayload in frontend/src/types.ts.

from __future__ import annotations

import uuid
from pathlib import Path

from OCP.Bnd import Bnd_Box
from OCP.BRep import BRep_Tool
from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.BRepBndLib import BRepBndLib
from OCP.BRepGProp import BRepGProp
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.GeomAbs import GeomAbs_Cylinder, GeomAbs_Plane
from OCP.GProp import GProp_GProps
from OCP.IFSelect import IFSelect_RetDone
from OCP.STEPControl import STEPControl_Reader
from OCP.TopAbs import TopAbs_FACE, TopAbs_REVERSED
from OCP.TopExp import TopExp_Explorer
from OCP.TopLoc import TopLoc_Location
from OCP.TopoDS import TopoDS

# STEP files are usually in millimeters. The reader converts everything to millimeters, and the
# frontend wants meters.
MM_TO_M = 0.001

# Older OCP versions call the face cast TopoDS.Face_s, newer ones (8.0+) call it TopoDS.Face.
# This picks whichever exists, so the code works with both.
_to_face = getattr(TopoDS, "Face_s", None) or TopoDS.Face

# Faces smaller than this (1 square millimeter) are tiny details such as fillets. They are drawn
# but cannot be picked, which keeps the pick list short.
MIN_PICKABLE_AREA_MM2 = 1.0


class StepImportError(Exception):
    """The file could not be read as a STEP part. The message is safe to show the user."""


def read_step(path: Path):
    """Loads the STEP file and returns its shape (the whole part)."""
    reader = STEPControl_Reader()
    if reader.ReadFile(str(path)) != IFSelect_RetDone:
        raise StepImportError("That file could not be read as STEP. Check that it is a .step or .stp file.")
    # TransferRoots converts the file's contents into a shape we can work with.
    if reader.TransferRoots() == 0:
        raise StepImportError("The STEP file has no solid shapes in it.")
    shape = reader.OneShape()
    if shape.IsNull():
        raise StepImportError("The STEP file has no solid shapes in it.")
    return shape


def _mesh_settings(shape) -> float:
    """Picks how fine the triangles are: 0.2% of the part's overall size, in millimeters."""
    box = Bnd_Box()
    BRepBndLib.Add_s(shape, box)
    # CornerMin and CornerMax are the two opposite corners of the box around the part.
    lo, hi = box.CornerMin(), box.CornerMax()
    diagonal = lo.Distance(hi)
    # max() keeps a floor, so a very small part is not meshed into millions of triangles.
    return max(diagonal * 0.002, 0.01)


def build_geometry(path: Path, name: str, model_id: str | None = None) -> dict:
    """Reads the file at `path` and returns the GeometryPayload the frontend expects."""
    shape = read_step(path)

    # Cut every face into triangles. The mesh is stored on the shape itself.
    BRepMesh_IncrementalMesh(shape, _mesh_settings(shape), False, 0.3, True)

    faces = []
    explorer = TopExp_Explorer(shape, TopAbs_FACE)
    index = 0
    while explorer.More():
        face = _to_face(explorer.Current())
        explorer.Next()
        index += 1
        built = _build_face(face, index)
        if built is not None:
            faces.append(built)

    if not faces:
        raise StepImportError("The STEP file loaded, but it has no surfaces that could be drawn.")

    return {
        "part_id": "imported",
        "model_id": model_id or uuid.uuid4().hex,
        # An imported part has no single adjustable thickness. The frontend ignores this.
        "thickness_mm": 0,
        "name": name,
        "faces": faces,
    }


def _build_face(face, index: int) -> dict | None:
    """Turns one CAD face into a FaceMesh dictionary, or None if it has no triangles."""
    location = TopLoc_Location()
    triangulation = BRep_Tool.Triangulation_s(face, location)
    if triangulation is None:
        return None

    transform = location.Transformation()
    # A face can be stored facing the opposite way. Then its triangle corners must be swapped
    # so they still point out of the part.
    flipped = face.Orientation() == TopAbs_REVERSED

    positions: list[float] = []
    for i in range(1, triangulation.NbTriangles() + 1):
        a, b, c = triangulation.Triangle(i).Get()
        if flipped:
            b, c = c, b
        for node in (a, b, c):
            p = triangulation.Node(node).Transformed(transform)
            positions += [p.X() * MM_TO_M, p.Y() * MM_TO_M, p.Z() * MM_TO_M]

    # Area and center of the face, measured by the CAD engine.
    props = GProp_GProps()
    BRepGProp.SurfaceProperties_s(face, props)
    area_mm2 = props.Mass()
    center = props.CentreOfMass()

    surface = BRepAdaptor_Surface(face)
    kind = "other"
    label = f"Curved face {index}"
    normal = None
    if surface.GetType() == GeomAbs_Plane:
        kind = "planar"
        label = f"Flat face {index}"
        direction = surface.Plane().Axis().Direction()
        sign = -1 if flipped else 1
        normal = [sign * direction.X(), sign * direction.Y(), sign * direction.Z()]
    elif surface.GetType() == GeomAbs_Cylinder:
        kind = "cylindrical"
        label = f"Cylindrical face {index}"

    out = {
        "id": f"face_{index:03d}",
        "kind": kind,
        "label": label,
        "area_m2": area_mm2 * 1e-6,
        "centroid": [center.X() * MM_TO_M, center.Y() * MM_TO_M, center.Z() * MM_TO_M],
        "candidate": area_mm2 >= MIN_PICKABLE_AREA_MM2,
        "positions": positions,
    }
    if normal is not None:
        out["normal"] = normal
    return out
