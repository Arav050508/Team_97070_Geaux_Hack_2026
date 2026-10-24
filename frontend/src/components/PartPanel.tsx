// The small panel under the destination box. It shows which part is loaded and lets the user
// start over with a different file.

import type { GeometryPayload } from "../types";

interface Props {
  geometry: GeometryPayload;
  // True while a request is running, so the user cannot change things mid-check.
  disabled: boolean;
  onChangePart: () => void;
}

/** The imported part's file name, with a link to choose another file. */
export function PartPanel({ geometry, disabled, onChangePart }: Props) {
  return (
    <section className="part-panel" aria-label="Part">
      <div className="part-row">
        <strong>{geometry.name}</strong>
        <button className="link" disabled={disabled} onClick={onChangePart}>
          Change part
        </button>
      </div>
      <span className="fineprint">Imported STEP file. The shape comes from the file.</span>
    </section>
  );
}
