# Habitat Structure Copilot: frontend

React + TypeScript + Three.js. The user imports a STEP file or picks a sample part, types where
the part will be used, and describes a load or pressure in plain English. The app proposes a
setup, colors the faces it picked on a 3D model, and after the user confirms it reports a safety
factor and the stress on the model.

There are two kinds of part, and they are checked differently:

- An imported STEP file goes to the backend, which reads the file, proposes the setup, and runs
  the Ansys analysis. The backend is still being built.
- The two sample parts (an equipment bracket and a round hatch plate) are built in code and
  checked in the browser with textbook formulas. They always work, with or without a backend,
  and their results carry a "Browser formulas (sample part)" badge.

## Run

```sh
npm install
npm run dev        # http://localhost:5173, demo mode
npm run build      # type-check + production build
```

Demo mode is the default. The sample parts work fully, and the import button explains that it
needs the backend. To use the backend, start it on `localhost:8000` and run the frontend with
`VITE_USE_MOCK=false` (in PowerShell: `$env:VITE_USE_MOCK="false"; npm run dev`). The dev server
forwards every `/api` request to port 8000 (`vite.config.ts`).

## The flow

1. Type the destination in the box at the top, then import a STEP file or pick a sample part. A
   sample part also has a thickness box.
2. Describe the test in plain English, for example "Fix the bottom face and hang a 500 kg rack
   from the top."
3. Check the proposal on the confirmation card. Hover a row to light up its face on the model.
   You can change the load and its direction (six axis directions or a custom vector), the
   material, the pressure, and the target safety factor. Faces can be picked by clicking the
   model or from the "choose from a list" menus, so the whole setup works from the keyboard.
4. Confirm. The results show a pass, below target, or fail banner, the stress on the model, what
   the verdict means for the crew, and the assumptions. A sample part also shows its hand
   calculation.
5. For a sample part, read the design options. The app reruns the same formulas at every
   whole-millimeter thickness and for both materials, draws safety factor against thickness, and
   suggests the lightest design that meets the target. "Try" applies a suggestion.

## The safety factor

Safety factor = yield strength ÷ peak von Mises stress. Below 1 is a fail, from 1 up to the
target (1.4 by default) is below target, and the target or higher passes. The team treats 1.4 to
2 as the acceptable band (`src/data/safetyBand.ts`). A pass above 2 gets a note that the part is
heavier than it needs to be. The band is the team's own requirement, not a building code.

## How the sample parts are checked

These are textbook formulas, not a finite element analysis. They live in
`src/solver/analytic.ts`, and an independent Python script checks them (see "Checking the
formulas").

| Part | Model | Peak stress | Deflection |
| --- | --- | --- | --- |
| Bracket | Cantilever beam, load at the pad (or tip) plus the plate's own weight | `6·F·L / (b·h²)` plus `3·w·L² / (b·h²)` | `F·L³/(3·E·I) + w·L⁴/(8·E·I)` |
| Hatch, clamped rim | Circular plate, uniform pressure | `3·q·a² / (4·t²)` radial at the edge; von Mises shown | `q·a⁴ / (64·D)` |
| Hatch, simply supported rim | Same plate, rim free to rotate | `3·(3+ν)·q·a² / (8·t²)` at the center | `(5+ν)·q·a⁴ / (64·(1+ν)·D)` |

The recommender (`src/solver/recommend.ts`) adds no formulas of its own. Each option it shows is
the same solver run at another thickness or material, so any row can be redone by hand. Its mass
figure treats the bracket as a plain plate and the hatch as a plain disc, so it is good for
comparing options and not for a mass budget.

The formulas leave out stress concentrations at the holes, bolts, and contact, and also buckling,
fatigue, and temperature. Every result lists these in its assumptions.

## Off-Earth conditions

The user types a destination. The Moon, Mars, Mercury, Venus, Earth, Pluto, and free space are
built in. For any other name the app asks for the surface gravity and the outside pressure and
uses those numbers. The values do not get their own panel. They show up in the weight tag next to
a mass load and in the results.

- `src/data/environments.ts` holds the gravity and outside pressure of each built-in place, with
  source links. The planets and the Moon use NASA's planetary fact sheets
  ([Moon](https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html),
  [Mars](https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html),
  [Mercury](https://nssdc.gsfc.nasa.gov/planetary/factsheet/mercuryfact.html),
  [Venus](https://nssdc.gsfc.nasa.gov/planetary/factsheet/venusfact.html),
  [Earth](https://nssdc.gsfc.nasa.gov/planetary/factsheet/earthfact.html),
  [Pluto](https://nssdc.gsfc.nasa.gov/planetary/factsheet/plutofact.html)). These are reference
  values for each world, not mission data, and the file is static, so it uses no API. The gas and
  ice giants are left out because they have no solid surface to build on.
- Free space (typing orbit, space, microgravity, or zero g also finds it) is a modeling choice, not
  a fact-sheet value: gravity 0 and a vacuum outside, with NASA's
  [microgravity page](https://www.nasa.gov/centers-and-facilities/glenn/what-is-microgravity/) as
  the reference. With no gravity nothing has weight, so the card asks for loads in newtons, for
  example from thrust or docking.
- Weight is mass times the destination's gravity, so the same 500 kg rack loads the bracket about
  2.3 times harder on Mars than on the Moon.
- A hatch sees cabin pressure minus the outside pressure. Cabin pressure has no default on
  purpose. Three buttons fill in cited NASA values (`src/data/cabinAtmospheres.ts`): an ISS-type
  cabin at 14.7 psia, a lunar habitat at 8.0 psia, and a Mars habitat at 7.6 psia. You can also
  enter your own cited number.
- The results restate the verdict in terms of the people inside (`src/solver/consequence.ts`).
  For a hatch they compare the cabin pressure with the range NASA gives for indefinite crew
  exposure (above 5.0 and up to 15.0 psia). These lines are fixed text filled in from the verdict
  and the inputs, not AI output.
- The frontend attaches the destination values, the pressure loads, and the target from that data
  and the user's inputs. The AI only picks faces and reads numbers the user wrote.

## Sources

- Materials (`src/data/materials.ts`): typical handbook values. The
  [Proto Labs 6061-T6 data sheet](https://www.protolabs.com/media/h54d0gnp/2026-026-cnc-material-data-sheet_aluminum-6061-t651_t6.pdf)
  gives yield 276 MPa, density 2.70 g/cm³, and modulus 68.3 GPa. The
  [6061 aluminium alloy](https://en.wikipedia.org/wiki/6061_aluminium_alloy) page gives Poisson's
  ratio 0.33. The [A36 steel](https://en.wikipedia.org/wiki/A36_steel) page gives yield 250 MPa
  (from AISC), modulus 200 GPa (from MatWeb), and Poisson's ratio 0.26. The app uses 68.9 GPa for
  6061 and 7850 kg/m³ for A36. Both are common handbook figures, about 1% off those pages.
- Cabin pressures (`src/data/cabinAtmospheres.ts`): NASA-STD-3001 Technical Brief OCHMO-TB-003 for
  14.7 psia and the 5.0 to 15.0 psia crew range, and NASA/TP-2010-216134 for 8.0 and 7.6 psia. The
  101 kPa in the sample prompt is the ISS-type value rounded.

## Where things live

| Path | What it is |
| --- | --- |
| `src/types.ts` | The shared contract (spec, geometry, results). Changing it changes what the backend must send. |
| `src/api.ts` | The only file that talks to the backend. Sample parts always use the browser code; imported files use `/api/*`. |
| `src/data/parts.ts` | The two sample parts: fixed dimensions, thickness range, example prompts. |
| `src/data/materials.ts` | Material properties and where each number came from. |
| `src/data/environments.ts` | The built-in destinations, plus the helper for places the user types in. |
| `src/data/cabinAtmospheres.ts` | NASA cabin pressures (ISS, lunar and Mars habitats) and the crew exposure range. |
| `src/data/safetyBand.ts` | The 1.4 to 2 acceptable band. |
| `src/parts/geometry.ts` | Builds the two sample parts in code, with stable face IDs. |
| `src/mocks/interpret.ts` | The demo "AI" for the sample parts: reads mass, force, and kPa from the prompt with regular expressions. |
| `src/solver/analytic.ts` | The formulas. Pure functions. |
| `src/solver/solve.ts` | Turns a spec into a result for a sample part: validation, fields, hand calculation, verdict. |
| `src/solver/consequence.ts` | The "what this means for the crew" lines. |
| `src/solver/recommend.ts` | Reruns the formulas across thicknesses and materials to find the lightest passing design. |
| `src/solver/vector.ts` | Scales a force direction to length 1. |
| `src/components/` | Viewport, PartPanel, ConfirmationCard, EnvironmentPanel, ResultsCard, Thread. |
| `src/App.tsx` | Holds the app's state and moves through the stages: empty, ready, interpreting, confirming, solving, results. |
| `scripts/` | Formula checks (below). |

## Checking the formulas

```sh
npx esbuild src/solver/analytic.ts --bundle --platform=node --format=cjs --outfile=/tmp/analytic.cjs
node scripts/dump_formulas.cjs > /tmp/ts_out.json
python3 scripts/check_formulas.py /tmp/ts_out.json
```

The Python script recomputes the closed-form numbers on its own, integrates the beam moment
numerically, and uses finite differences to confirm that the plate's moment formulas agree with
its deflection formulas.

## What the backend must provide

These are used only for imported STEP files.

| Endpoint | Request | Response |
| --- | --- | --- |
| `POST /api/import-step` | multipart form, field `file` (a .step or .stp) | `GeometryPayload` with `part_id: "imported"` and a `model_id` |
| `POST /api/interpret` | `{ prompt, part_id, environment_id, environment, model_id, faces }`. `environment` holds the name, gravity, and outside pressure in use. `faces` is the face list without triangles. | `InterpretResponse` |
| `POST /api/solve` | `{ spec, part_id, thickness_mm, model_id }`, with `spec.analysis_type` set to `"fea"` | `SolveResult` |

The exact shapes are in `src/types.ts`. Force directions arrive as unit vectors, loads in
newtons, and pressures in pascals. Gravity can be exactly 0 (free space). The backend must send
back the same face ids it gave in `/api/import-step`, and the result fields must have one value
per corner of each face, in the same order as that face's `positions`.

## Reading the code for the first time

Every file starts with a comment saying what it is for, and the code is commented throughout for
people new to React and Three.js. A good reading order:

1. `src/types.ts` for the data shapes everything passes around.
2. `src/data/` for the plain numbers (parts, materials, destinations).
3. `src/solver/analytic.ts`, then `src/solver/solve.ts`, for the engineering.
4. `src/App.tsx` for how the screens connect, then the files in `src/components/`.
5. `src/parts/geometry.ts` and `src/components/Viewport.tsx` last. They are the most involved.

`package.json` has no comments because JSON does not allow them.
