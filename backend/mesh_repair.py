# Finds 10-node tetrahedra whose curved edges fold the element over itself, and straightens
# those edges.
#
# gmsh puts the middle-of-edge nodes on the curved CAD surface. On a tight curve, a node can
# land so far off that the element's Jacobian (how it maps a perfect tetrahedron onto the real
# one) goes to zero or negative at some point inside it. Ansys then refuses the element:
# "zero or negative determinant of the Jacobian ... Midside nodes may be poorly positioned".
# Moving that element's middle nodes back to the middle of each straight edge fixes it. For a
# linear stress analysis the loss of curvature in a few elements does not matter.

from __future__ import annotations

import numpy as np

# Middle-of-edge nodes (columns 4 to 9) and the two corners each one sits between, in the
# Ansys SOLID187 order that ansys_solver.py uses.
EDGES = [(0, 1), (1, 2), (2, 0), (0, 3), (1, 3), (2, 3)]

# Points inside the reference tetrahedron where the Jacobian is checked: the four corners, the
# center, and the four 4-point Gauss points Ansys uses for this element.
_A, _B = 0.5854101966249685, 0.1381966011250105
_POINTS = np.array(
    [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [0.25, 0.25, 0.25], [_B, _B, _B], [_A, _B, _B], [_B, _A, _B], [_B, _B, _A]]
)


def _shape_derivatives(point: np.ndarray) -> np.ndarray:
    """d(shape function)/d(xi, eta, zeta) for the 10 nodes at one point. Shape (10, 3)."""
    L = np.array([1 - point.sum(), point[0], point[1], point[2]])
    dL = np.array([[-1, -1, -1], [1, 0, 0], [0, 1, 0], [0, 0, 1]], dtype=float)
    d = np.zeros((10, 3))
    for i in range(4):
        d[i] = (4 * L[i] - 1) * dL[i]
    for k, (i, j) in enumerate(EDGES):
        d[4 + k] = 4 * (L[j] * dL[i] + L[i] * dL[j])
    return d


_DERIVATIVES = np.array([_shape_derivatives(p) for p in _POINTS])  # (9, 10, 3)


def jacobian_ratio(xyz: np.ndarray) -> np.ndarray:
    """
    xyz has shape (n_elements, 10, 3): the 10 node positions of each element. Returns the
    smallest Jacobian determinant of each element divided by that of its straight-edged
    version. 1 is perfect, 0 or less is inside out.
    """
    # J[e, p] = sum over nodes k of xyz[e, k] (outer) dN[p, k]  -> (n, 9, 3, 3)
    J = np.einsum("enc,pnd->epcd", xyz, _DERIVATIVES)
    det = np.linalg.det(J)
    corners = xyz[:, :4, :]
    straight = np.linalg.det(np.stack([corners[:, 1] - corners[:, 0], corners[:, 2] - corners[:, 0], corners[:, 3] - corners[:, 0]], axis=1))
    sign = np.where(straight < 0, -1.0, 1.0)  # a mirrored element is fine as long as it is consistent
    return (det * sign[:, None]).min(axis=1) / np.abs(straight).clip(min=1e-300)


def repair(node_tags: np.ndarray, coords: np.ndarray, elements: np.ndarray, min_ratio: float = 0.1, passes: int = 3) -> tuple[np.ndarray, int]:
    """
    Straightens the middle nodes of every element whose Jacobian ratio is below min_ratio.
    elements holds node TAGS (not row numbers) in Ansys order. Returns (new coords, number of
    elements fixed). The input coords are not changed.
    """
    coords = coords.copy()
    order = np.argsort(node_tags)
    sorted_tags = node_tags[order]
    rows = order[np.searchsorted(sorted_tags, elements)]  # element node tag -> row in coords
    fixed = set()
    for _ in range(passes):
        ratio = jacobian_ratio(coords[rows])
        bad = np.where(ratio < min_ratio)[0]
        if len(bad) == 0:
            break
        fixed.update(bad.tolist())
        for e in bad:
            for k, (i, j) in enumerate(EDGES):
                coords[rows[e, 4 + k]] = (coords[rows[e, i]] + coords[rows[e, j]]) / 2
    return coords, len(fixed)
