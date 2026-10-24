// The collapsible "Destination" panel at the top of the sidebar. The user picks Moon or
// Mars here, and the panel shows the conditions that will be used (gravity, outside
// pressure, temperature) with links to where the numbers came from.

import { ENVIRONMENTS, type EnvId, type Environment } from "../data/environments";

interface Props {
  env: Environment;
  disabled: boolean;
  /** Initial open state. Change the component's `key` to reset it. */
  defaultOpen: boolean;
  onChange: (id: EnvId) => void;
}

/** Destination selector plus the sourced conditions that will be applied to the simulation. */
export function EnvironmentPanel({ env, disabled, defaultOpen, onChange }: Props) {
  return (
    // <details> opens and closes on click. `open` only sets its starting state. App.tsx
    // changes this component's `key` when the stage changes, which makes React build a fresh
    // copy and so re-applies defaultOpen.
    <details className="env" open={defaultOpen}>
      <summary>
        <span className="env-title">Destination</span>
        <span className="env-current">{env.name}</span>
      </summary>

      {/* One button per destination, built from the list in data/environments.ts. The
          role and aria-checked attributes tell screen readers this is a radio group. */}
      <div className="seg" role="radiogroup" aria-label="Destination">
        {ENVIRONMENTS.map((e) => (
          <button
            key={e.id}
            role="radio"
            aria-checked={e.id === env.id}
            className={e.id === env.id ? "seg-on" : ""}
            disabled={disabled}
            onClick={() => onChange(e.id)}
          >
            {e.name}
          </button>
        ))}
      </div>

      {/* A <dl> is a list of labels (dt) and values (dd). */}
      <dl className="env-grid">
        <dt>Surface gravity</dt>
        <dd>{env.gravity_m_s2} m/s²</dd>
        <dt>Outside pressure</dt>
        <dd>{env.pressure_label}</dd>
        <dt>Temperature</dt>
        <dd>
          {env.temperature_label}
          <span className="fineprint"> (shown for context; not simulated)</span>
        </dd>
      </dl>

      <p className="fineprint">
        Sources:{" "}
        {env.sources.map((s, i) => (
          <span key={s.url}>
            {/* Put a comma before every source except the first. */}
            {i > 0 && ", "}
            {/* rel="noreferrer" is the usual safety setting for links that open a new tab. */}
            <a href={s.url} target="_blank" rel="noreferrer">
              {s.label}
            </a>
          </span>
        ))}
        . Planetary reference data.
      </p>
    </details>
  );
}
