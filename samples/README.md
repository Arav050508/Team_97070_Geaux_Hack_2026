# Sample STEP parts

Two parts for trying the import and for checking results. Import them with "Import a STEP file"
(the backend must be running).

| File | What it is | Faces |
| --- | --- | --- |
| `Cantilever beam.STEP` | A 100 × 5 × 5 mm square bar (STEP AP203) | 6 flat |
| `L brackets.STEP` | An L-shaped bracket, 102 × 50 × 100 mm, 2 mm thick, with 4 holes (STEP AP214) | 8 flat, 8 cylindrical |

## Cantilever beam: a check with a known answer

Fix one end and push the other end sideways, and beam theory gives the answer directly. With
the beam length L = 100 mm, width b = 5 mm, height h = 5 mm, and a tip force F in newtons:

- Peak bending stress at the fixed end: σ = 6FL / (b·h²) = 4.8 MPa per newton.
- Tip deflection for aluminum 6061-T6 (E = 68.9 GPa): δ = FL³ / (3EI), with I = b·h³/12 =
  52.1 mm⁴, which is 0.093 mm per newton.

For example, 20 N gives 96 MPa (safety factor 276 / 96 = 2.88) and about 1.9 mm of deflection.
An analysis should land close to these numbers. Expect a somewhat higher peak right at the fixed
corner in Ansys, because the stress concentrates where the beam meets the fixed face.

In the app: the fixed end is **Flat face 1** (at x = -3 mm) and the free end is **Flat face 3**
(at x = 97 mm). Pick them from the lists if the proposal chose other faces.

## L bracket: things to know

- The CAD program stored each hole as two half-cylinders, so a hole shows up as two faces. To fix
  a hole, add both halves as supports.
- The part keeps the axes it was drawn in. Check which leg is meant to be up before choosing a
  force direction.
