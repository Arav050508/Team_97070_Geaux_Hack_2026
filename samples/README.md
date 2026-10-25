# Sample STEP parts

Four parts for trying the import and for checking results. Import them with "Import a STEP file"
(the backend must be running).

| File | What it is | Faces |
| --- | --- | --- |
| `Cantilever beam.STEP` | A 100 × 5 × 5 mm square bar (STEP AP203) | 6 flat |
| `L brackets.STEP` | An L-shaped bracket, 102 × 50 × 100 mm, 2 mm thick, with 4 holes (STEP AP214) | 8 flat, 8 cylindrical |
| `Kettle Bell.STEP` | A kettlebell, about 273 mm tall, standing along the Y axis | 21 faces: 1 flat, 6 cylindrical, 14 curved |
| `hex flange nut_am.STEP` | A hex flange nut, 30 mm across the flats and 22.5 mm tall, axis along Z | 32 faces |

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

## Prompts to try

The app shows one of these under the chat box when the matching file is open. They name faces by
the labels the app shows, so they pick the same faces every time. Check the faces on the
confirmation card before you run.

| File | Prompt | Notes |
| --- | --- | --- |
| `Cantilever beam.STEP` | Fix Flat face 1 and push down on Flat face 3 with 20 N | Known answer: 96 MPa and about 1.9 mm (see above). |
| `L brackets.STEP` | Fix Flat face 5 against the wall and put a 30 kg load on Flat face 6 | A shelf bracket. The weight depends on the destination, so try Moon and Mars and compare. |
| `Kettle Bell.STEP` | Fix Cylindrical face 16, the grip, and pull on Flat face 13, the base, along -Y with a 16 kg load | This part stands along Y, so the viewer shows it lying down and "down" is -Y. Use the custom direction on the card if the proposal picks -Z. |
| `hex flange nut_am.STEP` | Fix Flat face 15 and push down on Flat face 14 with 25000 N | A clamp load on a nut. Face 15 is the flange bottom. |

Only the beam has a hand-calculated answer. For the other three, treat the first run as a
check that the setup looks right, not as a verified number.
