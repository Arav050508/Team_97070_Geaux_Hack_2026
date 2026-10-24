// The top-level component. It owns all of the app's state and decides what appears on
// screen at each step. The other files are smaller pieces that this one puts together:
//   EnvironmentPanel, PartPanel   the sidebar controls
//   Thread                        the chat column (which also shows the current step's card)
//   ConfirmationCard, ResultsCard the two big cards
//   Viewport                      the 3D view
//   api.ts                        the three calls: build the part, ask the AI, run the check
//
// The app moves through "stages" (the Stage type in types.ts):
//   empty        no part chosen yet
//   ready        a part is loaded, waiting for the user to describe a test
//   interpreting the AI is reading the request
//   confirming   the AI's proposed setup is shown for the user to check and fix
//   solving      the formulas are running
//   results      the verdict and colored model are shown
//
// React note: useState gives a value plus a function to change it. Calling that function
// redraws the component with the new value. Never change a state value directly.

import { SAFETY_BAND } from "./data/safetyBand";
import { useEffect, useMemo, useRef, useState } from "react";
import { USE_MOCK, importStep, interpret, loadPart, solve } from "./api";
import { ConfirmationCard, type PickMode } from "./components/ConfirmationCard";
import { EnvironmentPanel } from "./components/EnvironmentPanel";
import { PartPanel } from "./components/PartPanel";
import { ResultsCard, type ResultKind } from "./components/ResultsCard";
import { Thread } from "./components/Thread";
import { Viewport, type ArrowSpec, type FieldSpec } from "./components/Viewport";
import { customEnvironment, findEnvironment } from "./data/environments";
import { PARTS, getPart } from "./data/parts";
import { unitVector } from "./solver/vector";
import { crewConsequence } from "./solver/consequence";
import { recommend, type DesignOption, type Recommendation } from "./solver/recommend";
import type {
  ChatMessage,
  Clarification,
  FaceRole,
  GeometryPayload,
  PartId,
  PressureLoad,
  ProposedSpec,
  SimulationSpec,
  SolveResult,
  SpecOptions,
  Stage,
  Vec3,
} from "./types";

// A random short string, used as a unique id for each chat message.
const newId = () => Math.random().toString(36).slice(2);

// The first message in the chat.
const WELCOME: ChatMessage = {
  id: "welcome",
  role: "assistant",
  text: "Import a STEP file (or try a sample part), type where it will be used (Mars, the Moon, or any other place), then describe the test in plain English. I will propose the supports, load, and direction, and show you the surfaces I picked before anything runs.",
};

/** Gets a readable message out of whatever was thrown. */
function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export default function App() {
  // ---------- state ----------
  // Which step the app is on.
  const [stage, setStage] = useState<Stage>("empty");
  // The 3D part that is loaded (null before one is chosen).
  const [geometry, setGeometry] = useState<GeometryPayload | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME]);
  // The setup the AI proposed, which the user edits on the confirmation card.
  const [spec, setSpec] = useState<ProposedSpec | null>(null);
  // The destination the user typed. Mars is the default. If the name is not one the app knows,
  // the user also enters the gravity and outside pressure (kept as text, like the other boxes).
  const [destination, setDestination] = useState("Mars");
  const [customGravity, setCustomGravity] = useState("");
  const [customPressureKPa, setCustomPressureKPa] = useState("");
  // Ids of the faces the cabin pressure pushes on (hatch only).
  const [pressureFaces, setPressureFaces] = useState<string[]>([]);
  // Typed text, so the field can be empty or half-typed.
  const [cabinPressureKPa, setCabinPressureKPa] = useState("");
  const [minSafetyFactor, setMinSafetyFactor] = useState(String(SAFETY_BAND.min));
  // The AI's multiple-choice questions, and the user's answers keyed by question id.
  const [clarifications, setClarifications] = useState<Clarification[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  // Faces the user chose by clicking, used to label them "Picked by you".
  const [userPicked, setUserPicked] = useState<Set<string>>(new Set());
  // What a click on the model does right now. null means nothing.
  const [pickMode, setPickMode] = useState<PickMode>(null);
  // The face under the mouse, from either the 3D view or a row in the card.
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [result, setResult] = useState<SolveResult | null>(null);
  // The recommender's answer for the latest result: lighter or passing alternatives.
  const [recommendation, setRecommendation] = useState<Recommendation | null>(null);
  // Which result is painted on the model: stress or displacement.
  const [resultKind, setResultKind] = useState<ResultKind>("von_mises");

  // Adds a message to the chat. `role` says who it is from.
  const say = (role: ChatMessage["role"], text: string) =>
    setMessages((m) => [...m, { id: newId(), role, text }]);

  // Work out which destination is in use: a bundled one if the typed name matches, otherwise
  // one built from the numbers the user entered. `envProblem` says what is missing, if anything.
  const knownEnv = findEnvironment(destination);
  const custom = customEnvironment(destination, customGravity, customPressureKPa);
  const env = knownEnv ?? custom.env;
  const envProblem = knownEnv ? null : custom.problem;

  // When the destination changes after a check has run, the old results used other conditions,
  // so clear them. `lastEnvKey` remembers the previous values to notice a change.
  const envKey = `${env.name}|${env.gravity_m_s2}|${env.external_pressure_Pa}`;
  const lastEnvKey = useRef(envKey);
  useEffect(() => {
    if (lastEnvKey.current === envKey) return;
    lastEnvKey.current = envKey;
    if (stage === "results") {
      setResult(null);
      setStage("confirming");
      say("system", "The old results used different conditions, so they were cleared. Run again to update.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [envKey]);

  // ---------- choosing and adjusting the part ----------

  // Forgets the current setup and results, but keeps the part and the chat history.
  const clearSetup = () => {
    setSpec(null);
    setResult(null);
    setRecommendation(null);
    setClarifications([]);
    setAnswers({});
    setUserPicked(new Set());
    setPressureFaces([]);
    setCabinPressureKPa("");
    setPickMode(null);
  };

  // The user chose a STEP file. The backend turns it into faces the viewer can draw.
  const importFile = async (file: File) => {
    const name = file.name.toLowerCase();
    if (!name.endsWith(".step") && !name.endsWith(".stp")) {
      return say("system", "That is not a STEP file. Choose a file that ends in .step or .stp.");
    }
    // 50 MB is a sanity limit. Larger files are likely not a single part.
    if (file.size > 50 * 1024 * 1024) {
      return say("system", "That file is over 50 MB. Try a single part instead of a whole assembly.");
    }
    say("system", `Reading ${file.name}…`);
    try {
      const geo = await importStep(file);
      clearSetup();
      setGeometry({ ...geo, name: file.name });
      setStage("ready");
      say("system", `Loaded ${file.name} with ${geo.faces.length} faces. Describe the test to continue.`);
    } catch (e) {
      say("system", `Could not import the file: ${errMsg(e)}`);
    }
  };

  const choosePart = async (id: PartId) => {
    try {
      const geo = await loadPart(id, getPart(id).thickness.default);
      clearSetup();
      setGeometry(geo);
      setStage("ready");
      say("system", `Loaded the ${getPart(id).name.toLowerCase()}, ${geo.thickness_mm} mm thick.`);
    } catch (e) {
      say("system", `Could not load the part: ${errMsg(e)}`);
    }
  };

  const changePart = () => {
    setGeometry(null);
    clearSetup();
    setStage("empty");
  };

  const changeThickness = async (mm: number) => {
    if (!geometry) return;
    try {
      setGeometry(await loadPart(geometry.part_id, mm));
      // Old results no longer match the new thickness, so drop them and go back a step.
      if (stage === "results") {
        setResult(null);
        setStage("confirming");
        say("system", `Thickness set to ${mm} mm. The old results were cleared. Run again to update.`);
      }
    } catch (e) {
      say("system", `Could not rebuild the part: ${errMsg(e)}`);
    }
  };

  // ---------- conversation ----------

  // Called when the user sends a request. Asks the AI for a proposed setup.
  const send = async (text: string) => {
    if (!geometry) return;
    // The destination must be usable first, because the load depends on its gravity.
    if (envProblem) return say("system", envProblem);
    // If the request fails, return to the step we were on.
    const previousStage = spec ? "confirming" : "ready";
    say("user", text);
    setPickMode(null);
    setResult(null);
    setStage("interpreting");
    try {
      const res = await interpret(
        {
          prompt: text,
          part_id: geometry.part_id,
          environment_id: env.id,
          environment: {
            name: env.name,
            gravity_m_s2: env.gravity_m_s2,
            external_pressure_Pa: env.external_pressure_Pa,
          },
          // An imported file is only known to the backend by its id, so also send the face
          // list (without triangles) that the AI chooses from.
          ...(geometry.part_id === "imported"
            ? {
                model_id: geometry.model_id,
                faces: geometry.faces.map(({ positions: _positions, ...meta }) => meta),
              }
            : {}),
        },
        geometry,
      );
      setSpec(res.spec);
      setClarifications(res.clarifications);
      // Start each question on its default answer. Object.fromEntries turns a list of
      // [key, value] pairs into an object.
      setAnswers(Object.fromEntries(res.clarifications.map((c) => [c.id, c.default])));
      setUserPicked(new Set());
      setPressureFaces(res.pressure_face_ids);
      if (res.stated_cabin_pressure_kPa !== null) setCabinPressureKPa(String(res.stated_cabin_pressure_kPa));
      say("assistant", res.assistant_message);
      setStage("confirming");
    } catch (e) {
      say("system", `I could not interpret that: ${errMsg(e)}`);
      setStage(previousStage);
    }
  };

  // Called when the user confirms. Builds the complete spec and sends it to the solver.
  const run = async () => {
    if (!spec || !geometry || envProblem) return;
    // The environment, pressure loads, target, and force-from-mass come from our bundled data
    // and the user's inputs, never from the AI.
    // Cabin pressure is typed in kPa, but the solver wants pascals (1 kPa = 1000 Pa).
    const cabinPa = parseFloat(cabinPressureKPa) * 1000;
    const cabinOk = cabinPa > 0;
    // Only the hatch has a pressure load. One entry per pressurized face.
    const pressureLoads: PressureLoad[] =
      (geometry.part_id === "hatch" || geometry.part_id === "imported") && cabinOk
        ? pressureFaces.map((id) => ({
            type: "pressure_differential",
            geometry_id: id,
            internal_pressure_Pa: cabinPa,
            external_pressure_Pa: env.external_pressure_Pa,
          }))
        : [];
    // Turn the user's multiple-choice answers into the solver's option fields.
    const options: SpecOptions = {};
    if (answers.load_position) options.load_position = answers.load_position as SpecOptions["load_position"];
    if (answers.edge_condition) options.edge_condition = answers.edge_condition as SpecOptions["edge_condition"];

    const finalSpec: SimulationSpec = {
      ...spec,
      // An imported part is analyzed by the Ansys backend. The built-in parts use the formulas.
      analysis_type: geometry.part_id === "imported" ? "fea" : spec.analysis_type,
      loads: [
        // If a load was entered as a mass, recompute its force with this destination's
        // gravity. That way switching from Mars to Moon changes the weight correctly.
        // The direction is also scaled to length 1, so a custom vector like [1, 1, 0] is fine.
        ...spec.loads.map((l) => ({
          ...(l.mass_kg !== undefined ? { ...l, magnitude_N: l.mass_kg * env.gravity_m_s2 } : l),
          direction: unitVector(l.direction),
        })),
        ...pressureLoads,
      ],
      environment: {
        name: env.name.toLowerCase(),
        gravity_m_s2: env.gravity_m_s2,
        external_pressure_Pa: env.external_pressure_Pa,
        internal_pressure_Pa: cabinOk ? cabinPa : null,
        sources: env.sources.map((s) => s.label),
      },
      criteria: { min_safety_factor: parseFloat(minSafetyFactor) },
      options,
    };
    setPickMode(null);
    setStage("solving");
    say("system", "Running the check…");
    try {
      const res = await solve(finalSpec, geometry);
      // The solver reports bad input as a result with status "error", not as an exception.
      if (res.status === "error") {
        say("assistant", `The solver reported a problem: ${res.error ?? "unknown error"}`);
        setStage("confirming");
        return;
      }
      setResult(res);
      // Try the other thicknesses and materials with the same setup, to suggest a better design.
      // Only the built-in parts: the sweep reruns the browser formulas, which do not apply to an
      // imported part analyzed in Ansys.
      setRecommendation(geometry.part_id === "imported" ? null : recommend(finalSpec, geometry));
      setResultKind("von_mises");
      setStage("results");
      const verdict =
        res.verdict === "pass"
          ? "That meets your target."
          : res.verdict === "marginal"
            ? "That is below your target. A thicker part or a stronger material may fix it."
            : "That fails: the stress is above the material's yield strength.";
      say(
        "assistant",
        `Safety factor ${res.safety_factor?.toFixed(2)} (peak stress ${res.max_von_mises_MPa.toFixed(0)} MPa against ${res.yield_MPa?.toFixed(0)} MPa yield). ${verdict} ${geometry.part_id === "imported" ? "The details and assumptions are below." : "The hand calculation and assumptions are below."}`,
      );
    } catch (e) {
      say("assistant", `The check failed: ${errMsg(e)}`);
      setStage("confirming");
    }
  };

  // The user clicked "Try ..." on a suggested design. Rebuild the part at that thickness,
  // switch the material if needed, and go back to the confirmation card so they can run it.
  const applyOption = async (o: DesignOption) => {
    if (!geometry) return;
    try {
      setGeometry(await loadPart(geometry.part_id, o.thicknessMm));
      if (spec && o.materialId !== spec.material.name) changeMaterial(o.materialId);
      setResult(null);
      setRecommendation(null);
      setStage("confirming");
      say("system", `Set to ${o.thicknessMm} mm ${o.materialName}. Press "Confirm and check design" to run it.`);
    } catch (e) {
      say("system", `Could not rebuild the part: ${errMsg(e)}`);
    }
  };

  // ---------- editing the proposed spec ----------
  // These are used by the confirmation card. Each one makes a changed copy of the spec with
  // setSpec. The `s && {...}` pattern means "do nothing if there is no spec yet".

  // The user typed a new load value. Only the first load is editable, hence `i !== 0`.
  const changeLoadValue = (unit: "N" | "kg", value: number) =>
    setSpec(
      (s) =>
        s && {
          ...s,
          loads: s.loads.map((l, i) =>
            i !== 0
              ? l
              : unit === "kg"
                ? { ...l, mass_kg: value, magnitude_N: value * env.gravity_m_s2 }
                : { ...l, mass_kg: undefined, magnitude_N: value },
          ),
        },
    );

  // The user switched between kg and N. Convert the current value so the load stays the same.
  const changeLoadUnit = (unit: "N" | "kg") =>
    setSpec(
      (s) =>
        s && {
          ...s,
          loads: s.loads.map((l, i) => {
            if (i !== 0) return l;
            // With no gravity a force cannot be turned into a mass, so keep it in newtons.
            if (unit === "kg" && env.gravity_m_s2 === 0) return l;
            if (unit === "kg") {
              // Force to mass, rounded to one decimal place.
              const mass = Math.round((l.magnitude_N / env.gravity_m_s2) * 10) / 10;
              return { ...l, mass_kg: mass };
            }
            // Mass to force, rounded to a whole newton.
            return { ...l, mass_kg: undefined, magnitude_N: Math.round(l.mass_kg !== undefined ? l.mass_kg * env.gravity_m_s2 : l.magnitude_N) };
          }),
        },
    );

  // The user picked a new force direction.
  const changeLoadDirection = (direction: Vec3) =>
    setSpec((s) => s && { ...s, loads: s.loads.map((l, i) => (i === 0 ? { ...l, direction } : l)) });

  const changeMaterial = (name: string) =>
    setSpec((s) => s && { ...s, material: { name, source: "user_selected" } });

  const removeSupport = (id: string) =>
    setSpec((s) => s && { ...s, constraints: s.constraints.filter((c) => c.geometry_id !== id) });

  const removePressureFace = (id: string) => setPressureFaces((f) => f.filter((x) => x !== id));

  // Called when the user clicks a face in the 3D view. What happens depends on pickMode.
  const onPick = (id: string) => {
    // Clicks do nothing unless a pick mode is on and the confirmation card is showing.
    if (!pickMode) return;
    applyPick(pickMode, id);
  };

  // Adds, moves, or removes a face for one role. It is shared by clicks on the 3D model and by
  // the "Choose from a list" menus on the card, so the keyboard does the same thing as the mouse.
  const applyPick = (pickMode: "support" | "load" | "pressure", id: string) => {
    if (!spec || stage !== "confirming") return;
    const isSupport = spec.constraints.some((c) => c.geometry_id === id);
    const isLoad = spec.loads.some((l) => l.geometry_id === id);

    if (pickMode === "pressure") {
      if (isSupport || isLoad) {
        return say("system", "That face is already a support or the loaded face. Pick another for pressure.");
      }
      // Clicking a face that is already pressurized removes it, otherwise it adds it.
      setPressureFaces((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id]));
      return;
    }

    if (pickMode === "support") {
      if (isLoad) return say("system", "That face carries the load, so it cannot also be a support.");
      // Clicking an existing support removes it.
      if (isSupport) return removeSupport(id);
      // confidence: 1 because the user chose this face themselves.
      setSpec({
        ...spec,
        constraints: [...spec.constraints, { type: "fixed_support", geometry_id: id, confidence: 1 }],
      });
    } else {
      if (isSupport) return say("system", "That face is a support, so it cannot also carry the load.");
      // Move the existing load to the new face, or create a 2000 N load pointing down.
      const existing = spec.loads[0];
      setSpec({
        ...spec,
        loads: [
          existing
            ? { ...existing, geometry_id: id }
            : { type: "force", geometry_id: id, magnitude_N: 2000, direction: [0, -1, 0] },
        ],
      });
    }
    setUserPicked((s) => new Set(s).add(id));
  };

  // ---------- derived viewport inputs ----------
  // Values worked out from the state above and handed to the 3D view. useMemo remembers the
  // result and only recalculates when something in its [list] changes, so the 3D view is not
  // redrawn for no reason.

  // The setup colors and arrows are shown while confirming and solving, but not on results.
  const showSetup = stage === "confirming" || stage === "solving";

  // Which role each face has, for coloring. A later line wins if a face has two roles.
  const roles = useMemo(() => {
    const r: Record<string, FaceRole> = {};
    if (spec && showSetup) {
      pressureFaces.forEach((id) => (r[id] = "pressure"));
      spec.constraints.forEach((c) => (r[c.geometry_id] = "support"));
      spec.loads.forEach((l) => (r[l.geometry_id] = "load"));
    }
    return r;
  }, [spec, showSetup, pressureFaces]);

  // One arrow per load, pointing at the middle of the loaded face.
  const arrows = useMemo<ArrowSpec[]>(() => {
    if (!spec || !geometry || !showSetup) return [];
    return spec.loads.flatMap((l) => {
      const face = geometry.faces.find((f) => f.id === l.geometry_id);
      return face ? [{ tip: face.centroid, dir: l.direction }] : [];
    });
  }, [spec, geometry, showSetup]);

  // The numbers that color the model on the results screen. The scale runs from zero to the
  // peak, so the legend and the colors always agree.
  const field = useMemo<FieldSpec | null>(() => {
    if (stage !== "results" || !result) return null;
    const stress = resultKind === "von_mises";
    return {
      values: stress ? result.fields.von_mises_MPa : result.fields.displacement_mm,
      min: 0,
      max: stress ? result.max_von_mises_MPa : result.max_displacement_mm,
    };
  }, [stage, result, resultKind]);

  // Everything marked as a candidate can be hovered and picked. Which picks make sense is up
  // to the pick mode.
  const selectableIds = useMemo(
    () => new Set(geometry?.faces.filter((f) => f.candidate).map((f) => f.id) ?? []),
    [geometry],
  );

  const hoveredFace = geometry?.faces.find((f) => f.id === hoveredId) ?? null;
  // True while waiting on the AI or the solver.
  const busy = stage === "interpreting" || stage === "solving";
  const canSend = !!geometry;
  const example = !geometry
    ? ""
    : geometry.part_id === "imported"
      ? "Fix the bottom face and push down on the top face with 2000 N"
      : getPart(geometry.part_id).example;

  const placeholder = !geometry
    ? "Import a STEP file or pick a sample part first"
    : stage === "confirming"
      ? "Change the request, e.g. make it 800 kg"
      : "Describe the supports and load in plain English";

  // ---------- stage card inside the thread ----------
  // Pick the card to show at the bottom of the chat, based on the current stage.

  let card: React.ReactNode = null;
  if (stage === "empty") {
    card = (
      <section className="card">
        <header className="card-head">
          <h3>Start with a part</h3>
        </header>
        <div className="group">
          <div className="group-title">Import your own part</div>
          {/* The file input is hidden. The label is styled as a button and opens it. */}
          <label className="part-choice import-choice">
            <strong>Import a STEP file</strong>
            <span>
              A .step or .stp file of one part. The backend reads it and the faces show up on the
              model, so you can fix supports and apply loads to them.
            </span>
            <input
              type="file"
              accept=".step,.stp"
              className="visually-hidden"
              aria-label="Import a STEP file"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void importFile(file);
                // Reset so choosing the same file again still fires.
                e.target.value = "";
              }}
            />
          </label>
          {USE_MOCK && (
            <p className="fineprint">
              Demo mode cannot read STEP files. Run the backend with VITE_USE_MOCK=false to use import.
            </p>
          )}
        </div>
        <div className="group-title">Or try a sample part (browser fallback demo)</div>
        <div className="part-choices">
          {PARTS.map((p) => (
            // `void` tells TypeScript we are deliberately not waiting for the async call.
            <button key={p.id} className="part-choice" onClick={() => void choosePart(p.id)}>
              <strong>{p.name}</strong>
              <span>{p.blurb}</span>
            </button>
          ))}
        </div>
        <p className="fineprint">The sample parts are built in code and checked with textbook formulas in your browser. No upload, no backend.</p>
      </section>
    );
  } else if (stage === "confirming" && spec && geometry) {
    card = (
      <ConfirmationCard
        spec={spec}
        env={env}
        envProblem={envProblem}
        pressureFaces={pressureFaces}
        cabinPressureKPa={cabinPressureKPa}
        onCabinPressure={setCabinPressureKPa}
        onRemovePressureFace={removePressureFace}
        geometry={geometry}
        clarifications={clarifications}
        answers={answers}
        userPicked={userPicked}
        pickMode={pickMode}
        hoveredId={hoveredId}
        busy={busy}
        minSafetyFactor={minSafetyFactor}
        onMinSafetyFactor={setMinSafetyFactor}
        onHover={setHoveredId}
        onChangeLoadValue={changeLoadValue}
        onChangeLoadUnit={changeLoadUnit}
        onChangeLoadDirection={changeLoadDirection}
        onChangeMaterial={changeMaterial}
        onAnswer={(id, value) => setAnswers((a) => ({ ...a, [id]: value }))}
        onRemoveSupport={removeSupport}
        onSetPickMode={setPickMode}
        onPickFromList={applyPick}
        onRun={run}
      />
    );
  } else if (stage === "solving") {
    card = (
      <section className="card" aria-live="polite">
        <header className="card-head">
          <h3>Checking the design</h3>
        </header>
        <div className="progress">
          <div />
        </div>
        <p className="fineprint">
          {geometry?.part_id === "imported"
            ? "Meshing the part and running the analysis in Ansys. The first run also starts Ansys, so it can take a minute."
            : "Applying conditions and working through the formulas."}
        </p>
      </section>
    );
  } else if (stage === "results" && result) {
    card = (
      <ResultsCard
        result={result}
        kind={resultKind}
        targetSafetyFactor={parseFloat(minSafetyFactor)}
        browserSolver={geometry?.part_id !== "imported"}
        recommendation={recommendation}
        consequence={
          result.verdict && geometry
            ? crewConsequence({
                partId: geometry.part_id,
                verdict: result.verdict,
                cabinKPa: geometry.part_id === "hatch" ? parseFloat(cabinPressureKPa) : null,
                outsidePa: env.external_pressure_Pa,
                destinationName: env.name,
              })
            : []
        }
        onKind={setResultKind}
        onApplyOption={(o) => void applyOption(o)}
        onEditSetup={() => setStage("confirming")}
        onNewRequest={() => {
          setStage("ready");
          clearSetup();
        }}
      />
    );
  }

  // ---------- the page ----------
  // Left side: the sidebar (destination, part, chat). Right side: the 3D view with some
  // labels laid on top of it.

  return (
    <div className="app">
      <header className="topbar">
        <h1>SimForge</h1>
        <span className="topbar-sub">Import it. Describe it. Confirm it. Check it on any world.</span>
        {USE_MOCK && <span className="badge-mock">Demo mode</span>}
      </header>

      <main className="layout">
        <aside className="sidebar">
          {/* The key changes between "open" and "closed" so the panel resets itself:
              open before a request is made, folded away afterward to save space. */}
          <EnvironmentPanel
            key={stage === "empty" || stage === "ready" ? "open" : "closed"}
            defaultOpen={stage === "empty" || stage === "ready"}
            env={env}
            destination={destination}
            onDestination={setDestination}
            known={knownEnv !== null}
            gravityText={customGravity}
            onGravity={setCustomGravity}
            pressureText={customPressureKPa}
            onPressure={setCustomPressureKPa}
            problem={envProblem}
            disabled={busy}
          />
          {geometry && (
            <PartPanel
              geometry={geometry}
              disabled={busy}
              onThickness={(mm) => void changeThickness(mm)}
              onChangePart={changePart}
            />
          )}
          {/* The stage card goes inside Thread as its child, so it scrolls with the chat. */}
          <Thread
            messages={messages}
            busy={busy && stage === "interpreting"}
            canSend={canSend}
            placeholder={placeholder}
            example={example}
            onSend={send}
            scrollKey={stage}
          >
            {card}
          </Thread>
        </aside>

        <section className="stage">
          <Viewport
            geometry={geometry}
            roles={roles}
            hoveredId={hoveredId}
            selectableIds={selectableIds}
            field={field}
            arrows={arrows}
            onHover={setHoveredId}
            onPick={onPick}
          />

          {/* Labels on top of the 3D view. Their positions are set in styles.css. */}
          {geometry && <div className="overlay tl">{geometry.name}</div>}
          {pickMode && (
            <div className="overlay banner">
              {pickMode === "support"
                ? "Click a surface to add or remove a support"
                : pickMode === "pressure"
                  ? "Click faces the cabin pressure acts on"
                  : "Click the face the load acts on"}
            </div>
          )}
          {hoveredFace && (
            <div className="overlay bl">
              {hoveredFace.label} · {(hoveredFace.area_m2 * 1e4).toFixed(1)} cm²
            </div>
          )}
          {/* The color key, shown only while the setup colors are on screen. */}
          {showSetup && (
            <div className="overlay br key">
              <span className="swatch swatch-support" /> Support
              {spec && spec.loads.length > 0 && (
                <>
                  <span className="swatch swatch-load" /> Load
                </>
              )}
              {pressureFaces.length > 0 && (
                <>
                  <span className="swatch swatch-pressure" /> Pressure
                </>
              )}
            </div>
          )}
          {stage === "solving" && <div className="overlay center">Checking…</div>}
          {!geometry && <div className="overlay center muted">Import a STEP file to begin</div>}
        </section>
      </main>
    </div>
  );
}
