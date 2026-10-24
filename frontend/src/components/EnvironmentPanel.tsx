// The destination box at the top of the sidebar. The user types a place name. Names the app
// knows (see data/environments.ts) use NASA values quietly. Any other name shows two boxes
// for the gravity and the outside pressure, so any world can be tested.

import { DESTINATION_NAMES, type Environment } from "../data/environments";

interface Props {
  // What the user has typed in the destination box.
  destination: string;
  onDestination: (text: string) => void;
  // True when the typed name matched a bundled destination.
  known: boolean;
  // The two boxes for places the app does not know. Text, so they can be empty or half typed.
  gravityText: string;
  onGravity: (text: string) => void;
  pressureText: string;
  onPressure: (text: string) => void;
  // What is wrong with the custom values, or null. Shown under the boxes.
  problem: string | null;
  // The destination in use. Only the name is shown here.
  env: Environment;
  disabled: boolean;
  /** Initial open state. Change the component's `key` to reset it. */
  defaultOpen: boolean;
}

export function EnvironmentPanel(p: Props) {
  return (
    <details className="env" open={p.defaultOpen}>
      <summary>
        <span className="env-title">Destination</span>
        <span className="env-current">{p.env.name}</span>
      </summary>

      {/* A text box with a list of suggestions (<datalist>). The user can pick one or type
          any name. */}
      <label className="inline dest">
        <span>Planet or moon</span>
        <input
          type="text"
          list="destination-names"
          value={p.destination}
          disabled={p.disabled}
          placeholder="Mars, Moon, Venus, or any other place"
          onChange={(e) => p.onDestination(e.target.value)}
        />
      </label>
      <datalist id="destination-names">
        {DESTINATION_NAMES.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>

      {/* Only for a name the app does not know: the user supplies the two numbers. */}
      {!p.known && p.destination.trim() !== "" && (
        <div className="group">
          <p className="hint">
            The app has no data for {p.destination.trim()}. Enter its values from a source you trust.
          </p>
          <label className="inline">
            <span>Surface gravity</span>
            <input
              type="number"
              min={0}
              step={0.01}
              value={p.gravityText}
              disabled={p.disabled}
              onChange={(e) => p.onGravity(e.target.value)}
            />
            <span>m/s²</span>
          </label>
          <label className="inline">
            <span>Outside pressure</span>
            <input
              type="number"
              min={0}
              step={0.1}
              value={p.pressureText}
              disabled={p.disabled}
              onChange={(e) => p.onPressure(e.target.value)}
            />
            <span>kPa</span>
          </label>
          {p.problem && <span className="fineprint">{p.problem}</span>}
        </div>
      )}
    </details>
  );
}
