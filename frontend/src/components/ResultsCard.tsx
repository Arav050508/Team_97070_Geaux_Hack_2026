// The "Results" card shown after a check runs. It shows the verdict (pass, below target, or
// fail), a switch between the stress and displacement views, a color legend, any warnings,
// the hand calculation, and the assumptions behind the numbers.
//
// Like ConfirmationCard, this component keeps no state. The result and the current view come
// in as props, and button clicks go back out through callbacks.

import { SAFETY_BAND } from "../data/safetyBand";
import { cssGradient } from "../colormap";
import { USE_MOCK } from "../api";
import type { DesignOption, Recommendation } from "../solver/recommend";
import type { SolveResult, Verdict } from "../types";

// Which result is painted on the model.
export type ResultKind = "von_mises" | "displacement";

interface Props {
  result: SolveResult;
  kind: ResultKind;
  // The user's minimum safety factor, shown next to the verdict.
  targetSafetyFactor: number;
  // What the recommender found. null if it could not run.
  recommendation: Recommendation | null;
  // Plain-language lines about what the verdict means for the crew (src/solver/consequence.ts).
  consequence: string[];
  onKind: (k: ResultKind) => void;
  // The user clicked "Try ..." on one of the suggested designs.
  onApplyOption: (o: DesignOption) => void;
  onEditSetup: () => void;
  onNewRequest: () => void;
}

/** "-23%" or "+40%": how much heavier or lighter `to` is compared with `from`. */
function percentChange(from: number, to: number): string {
  const p = Math.round(((to - from) / from) * 100);
  return `${p > 0 ? "+" : ""}${p}%`;
}

/** "7 mm Aluminum 6061-T6, safety factor 2.10, 0.45 kg" */
function describeOption(o: DesignOption): string {
  return `${o.thicknessMm} mm ${o.materialName}, safety factor ${o.safetyFactor.toFixed(2)}, ${o.massKg.toFixed(2)} kg`;
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
  recommendation,
  consequence,
  onKind,
  onApplyOption,
  onEditSetup,
  onNewRequest,
}: Props) {
  const isStress = kind === "von_mises";
  // The peak value and unit for whichever view is selected. The legend uses them.
  const peak = isStress ? result.max_von_mises_MPa : result.max_displacement_mm;
  const unit = isStress ? "MPa" : "mm";

  // ----- Design options (from the recommender) -----
  const rec = recommendation;
  const same = rec?.sameMaterial ?? null;
  const any = rec?.anyMaterial ?? null;
  // Show the all-materials suggestion only when it adds something: a different design from
  // the same-material one, and lighter than it.
  const showAny =
    !!rec && !!any && (!same || (any.materialId !== same.materialId && any.massKg < same.massKg));
  // The bar chart is scaled so the target sits at two thirds of its height. Bars taller than
  // the chart are cut off at the top.
  const chartMax = Math.max(targetSafetyFactor * 1.5, 1.5);

  return (
    <section className="card" aria-label="Simulation results">
      <header className="card-head">
        <h3>Results</h3>
        {/* Tells the user the numbers came from the in-browser solver, not a real server. */}
        {USE_MOCK && <span className="badge-mock">Browser demo solver</span>}
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

      {/* Design options: what would pass, and what is the lightest version that does. */}
      {rec && (
        <div className="group options">
          <div className="group-title">Design options</div>
          {rec.current.verdict === "pass" ? (
            same && same.thicknessMm < rec.current.thicknessMm ? (
              <p className="opt-line">
                This passes, but it has room to spare. {same.thicknessMm} mm would still meet your target
                (safety factor {same.safetyFactor.toFixed(2)}) and weighs about{" "}
                {percentChange(rec.current.massKg, same.massKg)} compared with {rec.current.thicknessMm} mm.
              </p>
            ) : (
              <p className="opt-line">This is already the thinnest whole-millimeter thickness that passes in this material.</p>
            )
          ) : same ? (
            <p className="opt-line">
              The thinnest thickness that meets your target in this material is {same.thicknessMm} mm (safety factor{" "}
              {same.safetyFactor.toFixed(2)}, about {percentChange(rec.current.massKg, same.massKg)} mass).
            </p>
          ) : (
            <p className="opt-line">No thickness in the allowed range meets your target with this material.</p>
          )}

          {/* One button per suggestion. A suggestion that equals the current design is skipped. */}
          {same && same.thicknessMm !== rec.current.thicknessMm && (
            <button className="chip" onClick={() => onApplyOption(same)}>
              Try {same.thicknessMm} mm
            </button>
          )}
          {showAny && any && (
            <>
              <p className="opt-line">
                Lightest option that passes with any material: {describeOption(any)}.
              </p>
              <button className="chip" onClick={() => onApplyOption(any)}>
                Try {any.thicknessMm} mm {any.materialName}
              </button>
            </>
          )}

          {/* Bar chart: safety factor at every thickness, for the current material. */}
          <div className="sweep" role="img" aria-label="Safety factor at each thickness">
            <div className="sweep-bars">
              {/* The target line. */}
              <div className="sweep-target" style={{ bottom: `${(targetSafetyFactor / chartMax) * 100}%` }} />
              {rec.sweep.map((o) => (
                <div
                  key={o.thicknessMm}
                  className={`sweep-bar sweep-${o.verdict}${o.thicknessMm === rec.current.thicknessMm ? " sweep-now" : ""}`}
                  style={{ height: `${Math.min(o.safetyFactor / chartMax, 1) * 100}%` }}
                  title={`${o.thicknessMm} mm: safety factor ${o.safetyFactor.toFixed(2)}`}
                />
              ))}
            </div>
            <div className="sweep-axis">
              <span>{rec.sweep[0]?.thicknessMm} mm</span>
              <span>{rec.sweep[rec.sweep.length - 1]?.thicknessMm} mm</span>
            </div>
            <p className="fineprint">
              Safety factor at each thickness in this material. The outlined bar is the current design and the
              dashed line is your target.
            </p>
          </div>
        </div>
      )}

      {/* <details> is a built-in HTML element that opens and closes on click. */}
      <details className="handcalc">
        <summary>Show the hand calculation ({result.method})</summary>
        <ol>
          {result.hand_check.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ol>
        <p className="fineprint">Check these numbers with a calculator. They are the whole answer.</p>
      </details>

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
