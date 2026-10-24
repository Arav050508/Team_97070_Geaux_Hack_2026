// The small panel under the destination picker. It shows which part is loaded and lets the
// user change its one adjustable dimension, the thickness.

import { useEffect, useState } from "react";
import { getPart } from "../data/parts";
import type { GeometryPayload } from "../types";

interface Props {
  geometry: GeometryPayload;
  // True while a request is running, so the user cannot change things mid-check.
  disabled: boolean;
  onThickness: (mm: number) => void;
  onChangePart: () => void;
}

/** The chosen part and its one adjustable dimension. */
export function PartPanel({ geometry, disabled, onThickness, onChangePart }: Props) {
  const part = getPart(geometry.part_id);
  const { min, max } = part.thickness;
  // What is currently typed in the box, as text. It can differ from the real thickness
  // while the user is typing. For example, they may clear the box to type a new number, and
  // an empty box is not a valid thickness.
  const [draft, setDraft] = useState(String(geometry.thickness_mm));

  // Follow the real value if it changes from outside (for example when the part changes).
  useEffect(() => setDraft(String(geometry.thickness_mm)), [geometry.thickness_mm, geometry.part_id]);

  // Runs on every keystroke. The part is only rebuilt when the typed number is valid (inside
  // the allowed range) and actually different from the current one.
  const change = (text: string) => {
    setDraft(text);
    const n = parseFloat(text);
    if (n >= min && n <= max && n !== geometry.thickness_mm) onThickness(n);
  };

  return (
    <section className="part-panel" aria-label="Part">
      <div className="part-row">
        <strong>{part.name}</strong>
        <button className="link" disabled={disabled} onClick={onChangePart}>
          Change part
        </button>
      </div>
      <label className="inline">
        <span>Thickness</span>
        <input
          type="number"
          min={min}
          max={max}
          step={1}
          value={draft}
          disabled={disabled}
          onChange={(e) => change(e.target.value)}
        />
        <span>mm</span>
      </label>
      <span className="fineprint">
        Allowed {min} to {max} mm. Thicker is stronger, so try it if a result fails.
      </span>
    </section>
  );
}
