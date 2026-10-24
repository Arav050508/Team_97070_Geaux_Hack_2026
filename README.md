<div align="center">

  # SimForge

  Import a part, say where it will be used and how it is loaded, confirm the setup on a 3D model, and get a safety factor for it on the Moon, Mars, in orbit, or anywhere else you can give numbers for.

</div>

## Team

[Arav Gandhi](https://www.linkedin.com/in/arav-gandhi-13b5a6372) (frontend, UX, and backend), [Amr Mohieldin](https://www.linkedin.com/in/amr-mohieldin-089053425/) (backend assistant), [Jeremy Lin](https://www.linkedin.com/in/jeremylin492987/) (backend assistant), [Braxton Anderson](https://github.com/BracketsA) (frontend and backend), [Kevin Guo](https://www.linkedin.com/in/kevin-guo-14a156353/) (pitch, presentation, and team management)

Team 97070. Prompt: create a system that helps humans sustain life in extreme off-Earth environments.

## About

<div align="center">

  ![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
  ![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)
  ![Three.js](https://img.shields.io/badge/three.js-000000?style=for-the-badge&logo=threedotjs&logoColor=white)
  ![Vite](https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white)

</div>

A habitat keeps people alive only if its structure holds. Equipment hangs from brackets that weigh less on the Moon than on Mars and nothing at all in orbit, and every hatch has cabin air pushing out on one side and close to nothing pushing back on the other. Checking parts like these takes a finite element analysis, and setting one up by hand is slow and easy to get wrong: which faces are fixed, where the load acts, which way it points, what the local gravity is.

SimForge does that setup with you. You import a STEP file of the part, type where it will be used, and describe the test in plain English, for example "Fix the bottom face and hang a 500 kg rack from the top." The app proposes which faces are fixed and loaded, the force and its direction, the material, and any pressure, and it colors those faces on the 3D model. You check every choice, change what is wrong, and confirm. Only then does the analysis run, and the app shows the stress on the model and a safety factor (yield strength divided by peak stress). The team's acceptable band is 1.4 to 2. Below 1 the part yields, between 1 and 1.4 it holds but with too little margin, and above 2 it is heavier than it needs to be. The 1.4 to 2 band is our own requirement, not a building code.

The STEP import and the analysis run on a small Python backend in `backend/`. It reads the STEP file with Open CASCADE, fills the part with 10-node tetrahedra using gmsh, and runs a linear static analysis in Ansys Mechanical APDL through PyMAPDL (tested with Ansys Student 2025 R2). The AI step is not connected yet. For now, fixed rules propose the faces (the lowest flat face is fixed and the highest one is loaded), and the chat says so plainly. Either way, you check and change every face before anything runs. TODO: replace the rules with the LLM call, or keep this paragraph as is if the step stays rule based.

So the app works without the backend, it also has two built-in sample parts, an equipment bracket and a round hatch plate, checked in the browser with textbook formulas. Their results say "Browser formulas (sample part)" so nobody mistakes them for the Ansys analysis. For the sample parts the app also shows the hand calculation line by line, and it reruns the formulas at every allowed thickness and for both materials to suggest the lightest design that passes. That sweep is not part of the Ansys path, which would need too many analysis runs.

The results also say what the verdict means for the crew. For a hatch, the app compares your cabin pressure with the range NASA's technical brief gives for indefinite crew exposure (above 5.0 and up to 15.0 psia), and says how far the cabin would drop if the hatch failed. These sentences are fixed text filled in from the verdict and your inputs, not AI output.

How the app handles the off-Earth conditions:

- You type the destination. The Moon, Mars, Mercury, Venus, Earth, Pluto, and free space (typing orbit, space, or zero g also finds it) come with their gravity and outside pressure built in. For any other name, such as Titan or Europa, the app asks you for the surface gravity and outside pressure and uses those numbers. Jupiter, Saturn, Uranus, and Neptune have no solid surface, so they are not built in.
- Weight is mass times the destination's gravity, so the same 500 kg rack pushes on its bracket about 2.3 times harder on Mars (3.73 m/s²) than on the Moon (1.62 m/s²). In free space there is no weight at all. Gravity is set to 0 there, and the app asks for loads as forces in newtons, for example from thrust or docking.
- A hatch sees cabin pressure minus the outside pressure. The app has no default cabin pressure. Buttons fill in a NASA-published value (an ISS-type cabin at 14.7 psia, a lunar habitat at 8.0 psia, or a Mars habitat at 7.6 psia), or you enter your own.
- The AI only picks faces and reads numbers you wrote. Gravity and outside pressure come from the bundled NASA data or from you, material values come from datasheets, and the safety factor comes from the solver. The AI sets none of them.
- Every face can be chosen two ways: by clicking it on the model, or from a list on the confirmation card. The lists mean the whole setup can be done with the keyboard.
- The sample-part formulas are a screening estimate, not a certification. They leave out stress concentrations at holes, bolts, and contact, and also buckling, fatigue, and temperature. Each result lists these assumptions. The Ansys analysis models the whole part in 3D, so it does show stress concentrations around holes and edges. It still leaves out contact between parts, bolts, the part's own weight, temperature, buckling, and fatigue, and it treats fixed faces as perfectly rigid, which overstates stress right at their edges. The app shows a note with the peak away from the supports when the two differ.

### External tools and APIs

The only external API planned is one LLM call (the limit is 2). TODO: name the provider and model once it is connected.

The analysis uses Ansys Student 2025 R2, installed on the computer that runs the backend and driven through PyMAPDL. It runs locally, not as a web API. The backend also uses the open-source libraries FastAPI, gmsh, and Open CASCADE (through `cadquery-ocp`).

The destination data is bundled in `frontend/src/data/environments.ts`, so it uses no API. Gravity and pressure come from NASA's planetary fact sheets for the [Moon](https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html), [Mars](https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html), [Mercury](https://nssdc.gsfc.nasa.gov/planetary/factsheet/mercuryfact.html), [Venus](https://nssdc.gsfc.nasa.gov/planetary/factsheet/venusfact.html), [Earth](https://nssdc.gsfc.nasa.gov/planetary/factsheet/earthfact.html), and [Pluto](https://nssdc.gsfc.nasa.gov/planetary/factsheet/plutofact.html). These are reference values for each world, not mission data. Free space is a modeling choice (gravity 0, vacuum outside), with NASA's page [What is microgravity?](https://www.nasa.gov/centers-and-facilities/glenn/what-is-microgravity/) as the reference.

Cabin pressures come from the [NASA-STD-3001 Technical Brief on habitable atmosphere](https://www.nasa.gov/wp-content/uploads/2023/12/ochmo-tb-003-habitable-atmosphere.pdf) (the 14.7 psia ISS cabin and the crew exposure range) and the [Exploration Atmospheres Working Group report, NASA/TP-2010-216134](https://www.nasa.gov/wp-content/uploads/2023/03/henninger-8.2-34-atm-tp216134-2010.pdf) (8.0 psia lunar and 7.6 psia Mars habitats).

Material values are typical handbook numbers for 6061-T6 aluminum and A36 steel, checked against the [Proto Labs 6061-T6 data sheet](https://www.protolabs.com/media/h54d0gnp/2026-026-cnc-material-data-sheet_aluminum-6061-t651_t6.pdf), the [6061 aluminium alloy](https://en.wikipedia.org/wiki/6061_aluminium_alloy) page, and the [A36 steel](https://en.wikipedia.org/wiki/A36_steel) page (which cites AISC, MatWeb, and Bushwick Metals). `frontend/src/data/materials.ts` says which source each number came from. The sample-part formulas are standard strength-of-materials results: Euler-Bernoulli beam theory for the bracket, and Roark's Formulas for Stress and Strain for the circular plate.

The 3D view uses the open-source libraries React and three.js.

### Boilerplate

`package.json`, `tsconfig.json`, `vite.config.ts`, and `index.html` are standard Vite + React + TypeScript scaffolding. Nothing in them addresses the prompt.

### AI-generated and AI-assisted code

All of the code in `frontend/` (the app, the part builder, the formulas, the recommender, and the scripts) was written with AI assistance from Claude, Anthropic's assistant, and so were the comments and the READMEs. No image or video assets were made with AI. In demo mode, the "AI" step for the sample parts is plain regular expressions in `frontend/src/mocks/interpret.ts`, not a model. The backend (`backend/main.py`, `backend/step_import.py`, and `backend/ansys_solver.py`) was also written with AI assistance from Claude.

## Prerequisites

You need Node.js 18 or newer and npm for the app. To import STEP files and run the analysis you also need Python 3.11 or newer and Ansys Student 2025 R2 (free from Ansys, Windows only) on the same computer.

```sh
# Check your versions
node --version
python --version
```

## Build from source

Without a backend the app runs in demo mode, where the sample parts work fully in the browser. Importing a STEP file needs the backend.

```sh
# Clone the project
git clone https://github.com/Arav050508/Team_97070_Geaux_Hack_2026.git && cd Team_97070_Geaux_Hack_2026/frontend

# Install dependencies and run the app (opens at http://localhost:5173)
npm install && npm run dev
```

To check that it type-checks and builds, run `npm run build`.

To import STEP files and run the Ansys analysis, start the backend in a second terminal (Windows PowerShell), then start the frontend in real mode:

```powershell
# Backend, from the repo root (first time: create the environment and install packages)
python -m venv backend\.venv
backend\.venv\Scripts\Activate.ps1
pip install -r backend\requirements.txt

# Run it. Leave out --reload: a reload leaves the old Ansys process holding the license.
cd backend
uvicorn main:app --port 8000

# Frontend, in another terminal
cd frontend
$env:VITE_USE_MOCK="false"; npm run dev
```

`backend/README.md` explains how the analysis works and what to do if Ansys does not start.

## Extras

Two sample STEP parts are in `samples/`: a 100 mm square cantilever beam, which has a known textbook answer to check results against, and an L bracket with four holes. `samples/README.md` has the expected numbers.

We checked the Ansys path against beam theory with the cantilever beam (aluminum 6061-T6, fixed at one end, 20 N down on the other):

| | Beam theory | SimForge with Ansys |
| --- | --- | --- |
| Tip deflection | 1.86 mm | 1.85 mm |
| Stress near the fixed end | 96 MPa | 93 MPa away from the support (103 MPa right at its edge) |

How the sample parts are checked in the browser:

| Part | Model | Peak stress |
| --- | --- | --- |
| Equipment bracket | Cantilever beam, load on the end pad plus the plate's own weight | `6·F·L / (b·h²)` plus `3·w·L² / (b·h²)` |
| Hatch, clamped rim | Circular plate, uniform pressure | `3·q·a² / (4·t²)` at the edge |
| Hatch, simply supported rim | Same plate, rim free to rotate | `3·(3+ν)·q·a² / (8·t²)` at the center |

The safety factor is yield strength divided by peak von Mises stress. Below 1 is a fail, from 1 up to your target (1.4 by default) is below target, and the target or higher passes. A pass above 2 gets a note that the part could be lighter.

An independent Python script, `frontend/scripts/check_formulas.py`, recomputes these numbers on its own and uses finite differences to confirm that the plate's stress formulas agree with its deflection formulas. `frontend/README.md` has the steps to run it, a guide to every file, and a reading order for people new to the code.
