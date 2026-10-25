// Helpers for a force that acts on more than one face. The load keeps its main face in
// geometry_id and any others in extra_geometry_ids (see types.ts).

import type { ForceLoad, PressureLoad } from "./types";

/** Every face the load acts on, main face first. */
export function loadFaceIds(load: ForceLoad | PressureLoad): string[] {
  return load.type === "force" ? [load.geometry_id, ...(load.extra_geometry_ids ?? [])] : [load.geometry_id];
}

/** The same force on a new list of faces. Returns null when no faces are left. */
export function withLoadFaces(load: ForceLoad, ids: string[]): ForceLoad | null {
  if (ids.length === 0) return null;
  const { extra_geometry_ids: _old, ...rest } = load;
  return ids.length > 1 ? { ...rest, geometry_id: ids[0], extra_geometry_ids: ids.slice(1) } : { ...rest, geometry_id: ids[0] };
}
