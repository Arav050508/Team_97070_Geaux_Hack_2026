// The "Confirm the setup" card. After the AI proposes a setup, this is where the user checks
// it and fixes anything wrong: which faces are supports, how big the load is, the cabin
// pressure, the material, the pass target, and a few multiple-choice questions.
//
// This component holds no data of its own. Everything it shows comes in through props, and
// every change goes back out through a callback prop (the ones starting with "on"). App.tsx
// owns the state. That keeps this file about layout, which is easier to follow.
//
// The "Confirm and check design" button stays disabled until the `problems` list below is
// empty, so a bad setup can never reach the solver.

import { SAFETY_BAND } from "../data/safetyBand";
import { CABIN_ATMOSPHERES, kPaToPsia, psiaToKPa } from "../data/cabinAtmospheres";
import type { Environment } from "../data/environments";
import { MATERIALS, getMaterial } from "../data/materials";
import type { Clarification, GeometryPayload, ProposedSpec, Vec3 } from "../types";

// What a click on the 3D model currently does: choose supports, choose the load face,
// choose pressurized faces, or nothing (null).
export type PickMode = "support" | "load" | "pressure" | null;

interface Props {
  spec: ProposedSpec;
  env: Environment;
  pressureFaces: string[];
  // Kept as text, not a number, so the user can clear the box or type "1." without the
  // field fighting them. It is converted to a number when needed.
  cabinPressureKPa: string;
  onCabinPressure: (kPa: string) => void;
  onRemovePressureFace: (id: string) => void;
  geometry: GeometryPayload;
  clarifications: Clarification[];
  // The user's answers so far, by question id.
  answers: Record<string, string>;
  // Ids of faces the user chose by clicking, as opposed to ones the AI chose.
  userPicked: Set<string>;
  pickMode: PickMode;
  hoveredId: string | null;
  // True while a request is running, to stop a double click.
  busy: boolean;
  onHover: (id: string | null) => void;
  minSafetyFactor: string;
  onMinSafetyFactor: (v: string) => void;
  onChangeLoadValue: (unit: "N" | "kg", value: number) => void;
  onChangeLoadUnit: (unit: "N" | "kg") => void;
  onChangeMaterial: (name: string) => void;
  onAnswer: (id: string, value: string) => void;
  onRemoveSupport: (id: string) => void;
  onSetPickMode: (mode: PickMode) => void;
  onRun: () => void;
}

/** Turns a direction vector into words, for example [0, -1, 0] into "downward (-Y)". */
function describeDirection(d: Vec3): string {
  const names: Array<[Vec3, string]> = [
    [[0, -1, 0], "downward (-Y)"],
    [[0, 1, 0], "upward (+Y)"],
    [[1, 0, 0], "along +X"],
    [[-1, 0, 0], "along -X"],
    [[0, 0, 1], "along +Z"],
    [[0, 0, -1], "along -Z"],
  ];
  const hit = names.find(([v]) => v[0] === d[0] && v[1] === d[1] && v[2] === d[2]);
  // For any direction not in the list, just show the raw numbers.
  return hit ? hit[1] : `[${d.join(", ")}]`;
}

export function ConfirmationCard(p: Props) {
  // The readable name for a face id, such as "Mounting hole A". Falls back to the id.
  const label = (id: string) => p.geometry.faces.find((f) => f.id === id)?.label ?? id;
  const load = p.spec.loads[0];
  const isHatch = p.geometry.part_id === "hatch";
  const material = getMaterial(p.spec.material.name);
  // The user can enter the load as a mass (kg) or as a force (N). A load that carries a
  // mass_kg value is shown in kg.
  const loadUnit = load?.mass_kg !== undefined ? "kg" : "N";
  const shownLoad = load ? (loadUnit === "kg" ? load.mass_kg : load.magnitude_N) : undefined;
  // The force in newtons either way: mass x gravity, or the force as given.
  const loadN = load ? (load.mass_kg !== undefined ? load.mass_kg * p.env.gravity_m_s2 : load.magnitude_N) : 0;

  // Build the list of things still wrong with the setup. While it has anything in it, the
  // run button is disabled and the messages are shown under the form.
  const problems: string[] = [];
  if (p.spec.constraints.length === 0) {
    problems.push(isHatch ? "Choose the rim as the fixed support." : "Add at least one fixed support.");
  }
  const cabin = parseFloat(p.cabinPressureKPa);
  if (isHatch) {
    if (p.pressureFaces.length === 0) problems.push("Choose the face the cabin pressure acts on.");
    // `!(cabin > 0)` is also true when cabin is NaN (an empty box), which `cabin <= 0` is not.
    if (!(cabin > 0)) problems.push("Enter the cabin pressure in kPa.");
  } else if (!load) {
    problems.push("Choose a face to load.");
  } else if (!(loadN > 0)) {
    problems.push(`Enter a ${loadUnit === "kg" ? "mass" : "force"} greater than zero.`);
  }
  if (!(parseFloat(p.minSafetyFactor) >= 1)) problems.push("Enter a target safety factor of 1 or more.");

  // Props shared by every row that stands for a face: highlight the row, and highlight the
  // matching face in the 3D view while the mouse is over it.
  const rowProps = (id: string) => ({
    className: `row${p.hoveredId === id ? " row-hot" : ""}`,
    onMouseEnter: () => p.onHover(id),
    onMouseLeave: () => p.onHover(null),
  });

  return (
    <section className="card" aria-label="Confirm simulation setup">
      <header className="card-head">
        <h3>Confirm the setup</h3>
        <span className="hint">Hover a row to see its face on the model</span>
      </header>

      {/* Fixed supports: the faces that hold the part in place. */}
      <div className="group">
        <div className="group-title">
          <span className="swatch swatch-support" /> Fixed supports
        </div>
        {p.spec.constraints.length === 0 && <p className="empty">None yet.</p>}
        {p.spec.constraints.map((c) => (
          <div key={c.geometry_id} {...rowProps(c.geometry_id)}>
            <div className="row-main">
              <strong>{label(c.geometry_id)}</strong>
              <span className="tag">
                {p.userPicked.has(c.geometry_id)
                  ? "Picked by you"
                  : `AI estimate ${Math.round(c.confidence * 100)}%`}
              </span>
            </div>
            <button className="link" onClick={() => p.onRemoveSupport(c.geometry_id)}>
              Remove
            </button>
          </div>
        ))}
        {/* Clicking toggles pick mode. While it is on, clicks on the model add supports. */}
        <button
          className={`chip${p.pickMode === "support" ? " chip-on" : ""}`}
          onClick={() => p.onSetPickMode(p.pickMode === "support" ? null : "support")}
        >
          {p.pickMode === "support"
            ? `Click ${isHatch ? "the rim" : "holes"} on the model… (done)`
            : "+ Pick support on model"}
        </button>
      </div>

      {/* Applied load: the bracket only. The hatch is loaded by pressure instead. */}
      {!isHatch && (
      <div className="group">
        <div className="group-title">
          <span className="swatch swatch-load" /> Applied load
        </div>
        {load ? (
          <div {...rowProps(load.geometry_id)}>
            <div className="row-main">
              <strong>{label(load.geometry_id)}</strong>
              <span className="tag">{describeDirection(load.direction)}</span>
              {p.userPicked.has(load.geometry_id) && <span className="tag">Picked by you</span>}
            </div>
            <label className="inline">
              <input
                type="number"
                min={0}
                step={loadUnit === "kg" ? 10 : 100}
                value={shownLoad !== undefined && Number.isFinite(shownLoad) ? shownLoad : ""}
                onChange={(e) => p.onChangeLoadValue(loadUnit, parseFloat(e.target.value))}
              />
              <select
                value={loadUnit}
                aria-label="Load unit"
                onChange={(e) => p.onChangeLoadUnit(e.target.value as "N" | "kg")}
              >
                <option value="kg">kg (mass)</option>
                <option value="N">N (force)</option>
              </select>
            </label>
            {/* When the load is a mass, show what it weighs at this destination. */}
            {loadUnit === "kg" && (
              <span className="tag">
                weighs {Number.isFinite(loadN) ? loadN.toFixed(0) : "…"} N on {p.env.name}
              </span>
            )}
          </div>
        ) : (
          <p className="empty">No loaded face yet.</p>
        )}
        <button
          className={`chip${p.pickMode === "load" ? " chip-on" : ""}`}
          onClick={() => p.onSetPickMode(p.pickMode === "load" ? null : "load")}
        >
          {p.pickMode === "load" ? "Click the loaded face… (done)" : "Pick load face on model"}
        </button>
      </div>
      )}

      {/* Cabin pressure: the hatch only. */}
      {isHatch && (
      <div className="group">
        <div className="group-title">
          <span className="swatch swatch-pressure" /> Cabin pressure
        </div>
        <p className="hint">
          Cabin pressure pushes outward on the faces you pick, against the {p.env.name} outside
          pressure ({p.env.pressure_label}).
        </p>
        <label className="inline">
          <span>Cabin pressure</span>
          <input
            type="number"
            min={0}
            step={1}
            placeholder="kPa"
            value={p.cabinPressureKPa}
            onChange={(e) => p.onCabinPressure(e.target.value)}
          />
          <span>kPa</span>
          {/* Echo the same pressure in psia, the unit NASA publishes. */}
          {cabin > 0 && <span className="tag">{kPaToPsia(cabin).toFixed(1)} psia</span>}
        </label>
        {/* One button per cited NASA cabin pressure. Clicking fills the box above. */}
        <div className="presets">
          {CABIN_ATMOSPHERES.map((a) => (
            <button
              key={a.id}
              className="chip"
              title={`${a.psia} psia, ${a.o2Percent}% oxygen. ${a.source.label}`}
              onClick={() => p.onCabinPressure(String(Number(psiaToKPa(a.psia).toFixed(2))))}
            >
              {a.name}: {a.psia.toFixed(1)} psia
            </button>
          ))}
        </div>
        <span className="fineprint">
          No default. Pick a NASA value or enter your own cited number. Sources:{" "}
          {/* Link each distinct source once, even if two presets share it. */}
          {Array.from(new Map(CABIN_ATMOSPHERES.map((a) => [a.source.url, a.source])).values()).map((s, i) => (
            <span key={s.url}>
              {i > 0 && "; "}
              <a href={s.url} target="_blank" rel="noreferrer">
                {s.label}
              </a>
            </span>
          ))}
          .
        </span>
        {p.pressureFaces.map((id) => (
          <div key={id} {...rowProps(id)}>
            <div className="row-main">
              <strong>{label(id)}</strong>
              <span className="tag">Pressurized face</span>
            </div>
            <button className="link" onClick={() => p.onRemovePressureFace(id)}>
              Remove
            </button>
          </div>
        ))}
        <button
          className={`chip${p.pickMode === "pressure" ? " chip-on" : ""}`}
          onClick={() => p.onSetPickMode(p.pickMode === "pressure" ? null : "pressure")}
        >
          {p.pickMode === "pressure" ? "Click pressurized faces… (done)" : "+ Pick pressurized face"}
        </button>
      </div>
      )}

      {/* Material: a dropdown filled from the list in data/materials.ts. */}
      <div className="group">
        <div className="group-title">Material</div>
        <select
          value={p.spec.material.name}
          onChange={(e) => p.onChangeMaterial(e.target.value)}
          aria-label="Material"
        >
          {MATERIALS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        {material && (
          <span className="tag">yield {Math.round(material.yield_Pa / 1e6)} MPa (typical value)</span>
        )}
        {p.spec.material.source === "ai_assumed" && (
          <span className="tag">Assumed by the AI: check it</span>
        )}
      </div>

      {/* The user's own pass mark. The verdict compares the safety factor against this. */}
      <div className="group">
        <div className="group-title">Pass target</div>
        <label className="inline">
          <span>Minimum safety factor</span>
          <input
            type="number"
            min={1}
            step={0.1}
            value={p.minSafetyFactor}
            onChange={(e) => p.onMinSafetyFactor(e.target.value)}
          />
        </label>
        <span className="tag">Acceptable band: {SAFETY_BAND.min} to {SAFETY_BAND.max}</span>
      </div>

      {/* Multiple-choice questions from the AI. An option marked unsupported is shown but
          cannot be chosen. */}
      {p.clarifications.map((q) => (
        <fieldset className="group question" key={q.id}>
          <legend>{q.question}</legend>
          {q.options.map((o) => (
            <label key={o.value} className={`radio${o.unsupported ? " radio-off" : ""}`}>
              <input
                type="radio"
                name={q.id}
                value={o.value}
                disabled={o.unsupported}
                // Use the user's answer if they gave one, otherwise the question's default.
                checked={(p.answers[q.id] ?? q.default) === o.value}
                onChange={() => p.onAnswer(q.id, o.value)}
              />
              <span>
                {o.label}
                {o.unsupported && <em> (not supported in this version)</em>}
              </span>
            </label>
          ))}
        </fieldset>
      ))}

      {problems.length > 0 && (
        <ul className="problems">
          {problems.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}

      <button className="primary" disabled={problems.length > 0 || p.busy} onClick={p.onRun}>
        Confirm and check design
      </button>
    </section>
  );
}
