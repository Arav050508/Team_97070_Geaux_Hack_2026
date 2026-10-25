// The mesh detail dial: how finely the backend cuts the part into tetrahedra before the
// analysis. More elements give a more detailed stress picture, especially around holes and
// edges, but take longer. Ansys Student allows at most 128,000 nodes, and the backend keeps
// the mesh under 120,000 nodes whatever the dial says.

export interface MeshLevel {
  label: string;
  // The number of tetrahedra the backend aims for. The real count differs a little, because
  // it depends on the part's shape. The results show the actual count.
  elements: number;
}

export const MESH_LEVELS: MeshLevel[] = [
  { label: "Coarse", elements: 5_000 },
  { label: "Fast", elements: 10_000 },
  { label: "Standard", elements: 20_000 },
  { label: "Fine", elements: 40_000 },
  { label: "Finest", elements: 65_000 },
];

// The index of "Standard" in MESH_LEVELS.
export const DEFAULT_MESH_LEVEL = 2;
