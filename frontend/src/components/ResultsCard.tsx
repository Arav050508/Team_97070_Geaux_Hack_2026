// The "Results" card shown after a check runs. It shows the verdict (pass, below target, or
// fail), a switch between the stress and displacement views, a color legend, any warnings,
// and the assumptions behind the numbers.
//
// Like ConfirmationCard, this component keeps no state. The result and the current view come
// in as props, and button clicks go back out through callbacks.

import { SAFETY_BAND } from "../data/safetyBand";
import { cssGradient } from "../colormap";
import type { SolveResult, Verdict } from "../types";

// Which result is painted on the model.
export type ResultKind = "von_mises" | "displacement";

interface Props {
  result: SolveResult;
  kind: ResultKind;
  // The user's minimum safety factor, shown next to the verdict.
  targetSafetyFactor: number;
  // Plain-language lines about what the verdict means for the crew (src/solver/consequence.ts).
  consequence: string[];
  onKind: (k: ResultKind) => void;
  onEditSetup: () => void;
  onNewRequest: () => void;
}

// The headline for each verdict. These match the CSS classes verdict-pass, verdict-marginal,
// and verdict-fail in styles.css.
const VERDICT_TEXT: Record<Verdict, string> = {
  pass: "Meets your target",
  marginal: "Below your target",
  fail: "Fails: stress is above yield",
};

export function ResultsCard({
  result,
  kind,
  targetSafetyFactor,
  consequence,
  onKind,
  onEditSetup,
  onNewRequest,
}: Props) {
  const isStress = kind === "von_mises";
  // The peak value and unit for whichever view is selected. The legend uses them.
  const peak = isStress ? result.max_von_mises_MPa : result.max_displacement_mm;
  const unit = isStress ? "MPa" : "mm";

  return (
    <section className="card" aria-label="Simulation results">
      <header className="card-head">
        <h3>Results</h3>
      </header>

      {/* The verdict box. The three null checks are there because a failed run has no
          safety factor. */}
      {result.verdict && result.safety_factor !== null && result.yield_MPa !== null && (
        <div className={`verdict verdict-${result.verdict}`} role="status">
          <div className="verdict-label">{VERDICT_TEXT[result.verdict]}</div>
          <div className="verdict-sf">Safety factor {result.safety_factor.toFixed(2)}</div>
          <div className="verdict-sub">
            {result.yield_MPa.toFixed(0)} MPa yield ÷ {result.max_von_mises_MPa.toFixed(0)} MPa peak stress
            · your target {targetSafetyFactor}
          </div>
          <div className="verdict-sub">Solved with {result.method}</div>
          {/* Above the top of the acceptable band the part is stronger than needed, which
              means extra mass. Say so instead of calling it a plain pass. */}
          {result.verdict === "pass" && result.safety_factor > SAFETY_BAND.max && (
            <div className="verdict-sub">
              Above the {SAFETY_BAND.max} top of the acceptable band. The part is stronger than it needs to be
              and could be lighter.
            </div>
          )}
        </div>
      )}

      {/* What the verdict means for the people inside. */}
      {consequence.length > 0 && (
        <div className="group">
          <div className="group-title">What this means for the crew</div>
          {consequence.map((line) => (
            <p key={line} className="opt-line">
              {line}
            </p>
          ))}
        </div>
      )}

      {/* Two tabs that switch what is painted on the 3D model. */}
      <div className="seg" role="tablist">
        <button
          role="tab"
          aria-selected={isStress}
          className={isStress ? "seg-on" : ""}
          onClick={() => onKind("von_mises")}
        >
          von Mises stress
        </button>
        <button
          role="tab"
          aria-selected={!isStress}
          className={!isStress ? "seg-on" : ""}
          onClick={() => onKind("displacement")}
        >
          Displacement
        </button>
      </div>

      {/* The legend: a color bar running from zero to the peak value. */}
      <div className="legend">
        <div className="legend-bar" style={{ background: cssGradient() }} />
        <div className="legend-labels">
          <span>0 {unit}</span>
          <span>
            peak {peak.toFixed(isStress ? 0 : 2)} {unit}
          </span>
        </div>
      </div>

      {result.warnings.length > 0 && (
        <ul className="warnings">
          {result.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      <div className="group">
        <div className="group-title">Assumptions behind these results</div>
        <ul className="plain">
          {result.assumptions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
        <p className="fineprint">
          This is a screening estimate, not a certification. Verify the setup and results before
          relying on them.
        </p>
      </div>

      <div className="actions">
        <button onClick={onEditSetup}>Edit setup</button>
        <button onClick={onNewRequest}>New request</button>
      </div>
    </section>
  );
}
