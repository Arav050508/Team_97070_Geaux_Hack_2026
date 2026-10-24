<div align="center">

  # Habitat Structure Copilot

  Describe a part in plain English, pick the Moon or Mars, and get a pass or fail verdict with the hand calculation, plus the lightest design that still passes.

</div>

## Team

[Arav Gandhi](https://www.linkedin.com/in/arav-gandhi-13b5a6372) (frontend and UX), TODO: add the other members and their links

Team 97070, prompt TODO: add the prompt number from the Devpost page.

## About

<div align="center">

  ![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
  ![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)
  ![Three.js](https://img.shields.io/badge/three.js-000000?style=for-the-badge&logo=threedotjs&logoColor=white)
  ![Vite](https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white)

</div>

Our prompt was to build something that helps humans sustain life in extreme off-Earth environments. A habitat only keeps people alive if its structure holds. Equipment hangs from brackets that weigh less on the Moon than on Mars, and every hatch has cabin air pushing out on one side and almost nothing pushing back on the other.

Habitat Structure Copilot is a screening tool for those two cases. You pick a part (an equipment bracket or a round hatch plate), choose Moon or Mars, and type what you want to test, for example "Fix the two mounting holes and hang a 500 kg equipment rack from the end pad." The app proposes a setup and highlights the surfaces it chose on a 3D model. You check it, fix anything wrong, and confirm. It then calculates the peak stress, divides the material's yield strength by it to get a safety factor, and says pass, below your target, or fail. The hand calculation is shown line by line so anyone can redo it with a calculator.

After a check, the app also reruns the same formulas at every allowed thickness and for both materials, draws a bar chart of safety factor against thickness, and suggests the lightest design that meets your target.

The results also say what the verdict means for the crew. For the hatch, the app compares your cabin pressure with the range NASA's technical brief gives for indefinite crew exposure (above 5.0 and up to 15.0 psia), and states how far below that range the cabin would fall if the hatch failed. These sentences are fixed text filled in from the verdict and your inputs, not AI output.

A few choices worth knowing about:

- Weight is mass times the destination's gravity (Moon 1.62 m/s², Mars 3.73 m/s²), so the same 500 kg rack loads the bracket about 2.3 times harder on Mars.
- The hatch sees cabin pressure minus the destination's outside pressure. There is no default cabin pressure. You can pick a NASA-published value (an ISS-type cabin at 14.7 psia, or the recommended 8.0 psia for a lunar habitat and 7.6 psia for a Mars habitat) or enter your own.
- The AI step only picks surfaces and reads numbers you wrote. Gravity, outside pressure, the material values, and the safety factor all come from data files and formulas, never from the AI.
- This is a screening estimate, not a certification. It uses textbook closed-form formulas and leaves out stress concentrations at holes, bolts and contact, buckling, fatigue, and temperature. Every result lists these assumptions.

**External tools and APIs.** The only external API is planned to be one LLM call (limit is 2): TODO: name the provider and model once the backend is wired up. Moon and Mars conditions are bundled in `frontend/src/data/environments.ts` from the NASA [Moon](https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html) and [Mars](https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html) fact sheets. They are planetary reference values, not live data, so they use no API. Cabin pressures come from two NASA documents: the [NASA-STD-3001 Technical Brief on habitable atmosphere](https://www.nasa.gov/wp-content/uploads/2023/12/ochmo-tb-003-habitable-atmosphere.pdf) (14.7 psia ISS cabin, and the crew exposure range) and the [Exploration Atmospheres Working Group report, NASA/TP-2010-216134](https://www.nasa.gov/wp-content/uploads/2023/03/henninger-8.2-34-atm-tp216134-2010.pdf) (8.0 psia lunar and 7.6 psia Mars habitats). The 3D view uses the open-source libraries React and three.js.

**Boilerplate.** `package.json`, `tsconfig.json`, `vite.config.ts`, and `index.html` are standard Vite + React + TypeScript scaffolding. Nothing in them addresses the prompt. The material values in `frontend/src/data/materials.ts` are typical handbook numbers for 6061-T6 aluminum and A36 steel, and the formulas come from standard strength-of-materials references (Euler-Bernoulli beam theory, and Roark's Formulas for Stress and Strain for circular plates). TODO: add datasheet links for the material values before submitting.

**AI-generated and AI-assisted code.** All of the code in `frontend/` (the app, the part builder, the formulas, the recommender, and the scripts) was written with AI assistance from Claude, Anthropic's assistant, and so were the comments and READMEs. No image or video assets were made with AI. The demo mode's "AI" is plain regular expressions in `frontend/src/mocks/interpret.ts`, not a model. TODO: add the backend files and say which of them were AI-assisted.

## Prerequisites

You need Node.js 18 or newer and npm.

```sh
# Check your version
node --version
```

## Build from source

The app runs entirely in your browser in demo mode, so you do not need the backend to try it.

```sh
# Clone the project
git clone https://github.com/Arav050508/Team_97070_Geaux_Hack_2026.git && cd Team_97070_Geaux_Hack_2026/frontend

# Install dependencies and run the app (opens at http://localhost:5173)
npm install && npm run dev
```

To check that it type-checks and builds, run `npm run build`.

## Extras

How the checks work:

| Part | Model | Peak stress |
| --- | --- | --- |
| Equipment bracket | Cantilever beam, load on the end pad plus the plate's own weight | `6·F·L / (b·h²)` plus `3·w·L² / (b·h²)` |
| Hatch, clamped rim | Circular plate, uniform pressure | `3·q·a² / (4·t²)` at the edge |
| Hatch, simply supported rim | Same plate, rim free to rotate | `3·(3+ν)·q·a² / (8·t²)` at the center |

Safety factor is yield strength divided by peak von Mises stress. Below 1 is a fail. At or above the target you set (default 2) is a pass. The target is your own, not a code requirement.

The formulas are checked by an independent Python script: `frontend/scripts/check_formulas.py` recomputes the numbers on its own and confirms with finite differences that the plate's moment formulas agree with its deflection formulas. The steps to run it are in `frontend/README.md`, which also has the file-by-file guide and a reading order for newcomers.
