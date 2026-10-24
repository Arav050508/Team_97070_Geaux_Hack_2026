# Habitat Structure Copilot: frontend

React + TypeScript + Three.js frontend. A user picks one of two code-built habitat parts, chooses
Moon or Mars, and describes a load or pressure in plain English. The app proposes a setup, shows
the surfaces it picked, and after the user confirms it checks the part against the material's
yield strength and reports a safety factor with a hand calculation.

It runs fully in the browser (demo mode), so it works before the AI and backend pieces exist.

## Run

```sh
npm install
npm run dev        # http://localhost:5173, demo mode
npm run build      # type-check + production build
```

Demo mode is the default. To use a real backend, set `VITE_USE_MOCK=false` (for example in
`.env.local`). Requests to `/api/interpret` and `/api/solve` are proxied to FastAPI on
`localhost:8000` (`vite.config.ts`). If the Python solver is not ready, the browser solver can ship
as is and the backend only needs the AI call.

## The flow

1. Pick a part: **Equipment bracket** (a plate bolted at one end holding heavy equipment) or
   **Hatch plate** (a round cover with cabin air on one side). Adjust its thickness.
2. Describe the setup in plain English, for example "Fix the two mounting holes and hang a 500 kg
   equipment rack from the end pad."
3. Review the proposal. Hover a row to highlight its surface; edit the load, material, target
   safety factor, and the clarifying questions; or pick surfaces directly on the model.
4. Confirm. Results show a PASS / BELOW TARGET / FAIL banner, a stress colormap, the hand
   calculation, and the assumptions.
5. Read the design options. The app reruns the same check at every whole-millimeter thickness
   (and for both materials), then shows a bar chart of safety factor against thickness and
   suggests the lightest design that meets the user's target. "Try" applies a suggestion so the
   user can run it and see the new result.

## What it calculates

Textbook formulas, not a finite-element solve. The formulas live in `src/solver/analytic.ts`
and are checked by an independent Python script (see "Checking the formulas").

| Part | Model | Peak stress | Deflection |
| --- | --- | --- | --- |
| Bracket | Cantilever beam, load at the pad (or tip) plus the plate's own weight | `6·F·L / (b·h²)` plus `3·w·L² / (b·h²)` | `F·L³/(3·E·I) + w·L⁴/(8·E·I)` |
| Hatch, clamped rim | Circular plate, uniform pressure | `3·q·a² / (4·t²)` radial at the edge; von Mises shown | `q·a⁴ / (64·D)` |
| Hatch, simply supported rim | Same plate, rim free to rotate | `3·(3+ν)·q·a² / (8·t²)` at the center | `(5+ν)·q·a⁴ / (64·(1+ν)·D)` |

Safety factor = yield strength ÷ peak von Mises stress. Verdict: **fail** below 1, **below
target** between 1 and the user's own target (default 2), **pass** at or above it. The target is
the user's choice, not a code requirement.

The recommender (`src/solver/recommend.ts`) adds no formulas of its own. Each option it shows is
the same solver run at another thickness or material, so any row can be reproduced by hand. Its
mass figure treats the bracket as a plain plate and the hatch as a plain disc, so use it to
compare options, not as a mass budget.

Left out on purpose: stress concentrations at the holes, bolts and contact, buckling, fatigue, and
temperature. Every result lists these in its assumptions.

## Off-Earth conditions

The user picks a destination (Moon or Mars) and the app applies its conditions:

- `src/data/environments.ts` holds gravity, outside pressure, and temperature, with source links.
  Values are from the NASA [Moon](https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html)
  and [Mars](https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html) fact sheets (planetary
  reference data, not mission data). It is a static file, so it uses no external API.
- **Weight depends on the destination.** Give a mass and the app computes weight = mass × that
  place's gravity, so the same 500 kg rack loads the bracket about 2.3 times harder on Mars
  than on the Moon.
- **Pressure.** The hatch sees cabin pressure minus the destination's outside pressure. Cabin
  pressure has no default on purpose: enter a cited value for the habitat you are modeling.
- Environment, pressure loads, and the pass target are attached by the frontend from that data and
  the user's inputs, never by the AI. The AI only picks surfaces and reads numbers the user wrote.
- Temperature is displayed for context and not simulated.

## Placeholders to cite before submission

- `src/data/materials.ts`: yield, modulus, Poisson's ratio, and density are typical handbook
  values entered from general knowledge. Check each against a datasheet and add the link here.
- Cabin pressure: whatever value you use in the demo needs a source (for example, a published
  figure for the habitat you name).

## Where things live

| Path | What it is |
| --- | --- |
| `src/types.ts` | The shared contract (spec, geometry, results). Changing it is an interface change. |
| `src/api.ts` | The only file that talks to the backend; switches between demo mode and `/api/*`. |
| `src/data/parts.ts` | The two parts: fixed dimensions, thickness range, example prompts. |
| `src/data/materials.ts` | Material properties (placeholders, see above). |
| `src/data/environments.ts` | Sourced Moon and Mars conditions. |
| `src/parts/geometry.ts` | Builds the two parts in code, with stable face IDs. Always runs in the browser. |
| `src/mocks/interpret.ts` | Fake AI: reads mass, force, and kPa from the prompt with regexes. |
| `src/solver/analytic.ts` | The formulas. Pure functions. |
| `src/solver/solve.ts` | Turns a spec into a result: validation, fields, hand calculation, verdict. |
| `src/solver/recommend.ts` | Reruns the solver across thicknesses and materials to find the lightest passing design. |
| `src/components/` | Viewport, PartPanel, ConfirmationCard, EnvironmentPanel, ResultsCard, Thread. |
| `src/App.tsx` | Stage state machine: empty, ready, interpreting, confirming, solving, results. |
| `scripts/` | Formula checks (below). |

## Checking the formulas

```sh
npx esbuild src/solver/analytic.ts --bundle --platform=node --format=cjs --outfile=/tmp/analytic.cjs
node scripts/dump_formulas.cjs > /tmp/ts_out.json
python3 scripts/check_formulas.py /tmp/ts_out.json
```

The Python script recomputes the closed-form numbers on its own, integrates the beam moment
numerically, and confirms with finite differences that the plate's moment formulas agree with its
deflection formulas.

## Endpoints the backend must provide

| Endpoint | Request | Response |
| --- | --- | --- |
| `POST /api/interpret` | `{ prompt, part_id, environment_id }` | `InterpretResponse` |
| `POST /api/solve` | `{ spec, part_id, thickness_mm }` | `SolveResult` |

Shapes are in `src/types.ts`. Parts are built in the browser, so there is no geometry endpoint. The
geometry payload carries per-face triangles so the viewer can highlight any face by its ID. Result
fields are per-vertex scalars aligned with each face's `positions`. The Python solver should
reproduce `src/solver/solve.ts` and pass the same checks.

## Reading the code for the first time

Every file starts with a comment saying what it is for, and the code is commented throughout for
people new to React and Three.js. A good reading order:

1. `src/types.ts` for the data shapes everything passes around.
2. `src/data/` for the plain numbers (parts, materials, Moon and Mars).
3. `src/solver/analytic.ts`, then `src/solver/solve.ts`, for the engineering.
4. `src/App.tsx` for how the screens connect, then the files in `src/components/`.
5. `src/parts/geometry.ts` and `src/components/Viewport.tsx` last. They are the most involved.

`package.json` cannot hold comments (JSON does not allow them), so it has none.

## GeauxHack README notes (fill in before submission)

- Boilerplate: `package.json`, `tsconfig.json`, `vite.config.ts`, and `index.html` are basic
  Vite + React scaffolding.
- AI-assisted code: list every file here that was AI-generated or AI-assisted, and make sure
  you can explain each one.
- External APIs: the LLM is the only one planned (limit is 2). NASA values are bundled, not fetched.
- No AI-generated image or video assets are used.
