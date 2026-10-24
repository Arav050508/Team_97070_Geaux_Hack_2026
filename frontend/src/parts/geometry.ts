// Builds the 3D shape of each part in code.
//
// This is real app code, not a mock. The frontend always builds the parts itself: nothing is
// loaded from a CAD file, and the backend has no geometry endpoint. Dimensions come from
// src/data/parts.ts. The face ids ("face_42" and so on) are fixed for each part, so the AI
// and the solver can refer to a face by id whatever the thickness is.
//
// How the output is organized: a 3D shape is a mesh of triangles. We sort the triangles of
// each part into named groups ("faces"), such as "Mounting hole A" or "End loading pad", so
// the user can click a whole face and the solver can ask "where is this face?". The result
// is a GeometryPayload (see src/types.ts).
//
// Three.js (imported as THREE) is the 3D library. We use it here only to generate the
// triangles. The drawing itself happens in src/components/Viewport.tsx.

import * as THREE from "three";
import { BRACKET, HATCH, getPart } from "../data/parts";
import type { FaceKind, FaceMesh, GeometryPayload, PartId, Vec3 } from "../types";

// A "bucket" is a face that is still being filled. We add triangles to it one at a time,
// and at the end finalize() measures it and turns it into a finished FaceMesh.
interface Bucket {
  id: string;
  kind: FaceKind;
  label: string;
  candidate: boolean;
  // Flat list of corner coordinates: x, y, z, x, y, z, ... Three corners make a triangle.
  positions: number[];
}

// Scratch vectors that the helper functions below reuse. Making a new object for every
// triangle would be slow when there are thousands of them, so we create these once.
// Because they are shared, never keep a reference to one after a function returns.
const va = new THREE.Vector3();
const vb = new THREE.Vector3();
const vc = new THREE.Vector3();
const ab = new THREE.Vector3();
const ac = new THREE.Vector3();
const nrm = new THREE.Vector3();

/**
 * Calls `fn` once for each triangle in a Three.js shape.
 * `fn` receives the three corners (a, b, c) and the triangle's normal `n`, which is a
 * length-1 vector pointing straight out of the triangle's surface. The normal lets us tell
 * a top face (pointing up) from a side face (pointing sideways).
 */
function eachTriangle(
  geo: THREE.BufferGeometry,
  fn: (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, n: THREE.Vector3) => void,
) {
  // Some Three.js shapes share corners between triangles ("indexed"). Convert to the plain
  // "three fresh corners per triangle" layout so the loop below can step by 3.
  const g = geo.index ? geo.toNonIndexed() : geo;
  const p = g.getAttribute("position");
  for (let i = 0; i < p.count; i += 3) {
    va.fromBufferAttribute(p, i);
    vb.fromBufferAttribute(p, i + 1);
    vc.fromBufferAttribute(p, i + 2);
    // Two edges of the triangle. Their cross product points straight out of the surface,
    // and normalizing it makes its length 1.
    ab.subVectors(vb, va);
    ac.subVectors(vc, va);
    nrm.crossVectors(ab, ac).normalize();
    fn(va, vb, vc, nrm);
  }
}

/** Adds one triangle (three corners) to a face. */
function push(bucket: Bucket, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) {
  bucket.positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
}

/**
 * Turns a filled bucket into a finished face: it measures the area, finds the center, and
 * (for flat faces) finds which way the face points.
 */
function finalize(bucket: Bucket): FaceMesh {
  let area = 0;
  // Running totals. Each triangle contributes in proportion to its area, so big triangles
  // count for more than small ones.
  const cen = new THREE.Vector3();
  const nsum = new THREE.Vector3();
  const p = bucket.positions;
  // Step by 9 numbers = 3 corners x 3 coordinates = one triangle.
  for (let i = 0; i < p.length; i += 9) {
    va.set(p[i], p[i + 1], p[i + 2]);
    vb.set(p[i + 3], p[i + 4], p[i + 5]);
    vc.set(p[i + 6], p[i + 7], p[i + 8]);
    ab.subVectors(vb, va);
    ac.subVectors(vc, va);
    // The length of the cross product of two edges is twice the triangle's area.
    const cross = new THREE.Vector3().crossVectors(ab, ac);
    const a = cross.length() / 2;
    area += a;
    // A triangle's center is the average of its three corners. Weight it by area.
    cen.addScaledVector(new THREE.Vector3().add(va).add(vb).add(vc).multiplyScalar(1 / 3), a);
    nsum.addScaledVector(cross.normalize(), a);
  }
  // Divide the weighted sum by the total area to get the average position.
  if (area > 0) cen.multiplyScalar(1 / area);
  const mesh: FaceMesh = {
    id: bucket.id,
    kind: bucket.kind,
    label: bucket.label,
    candidate: bucket.candidate,
    area_m2: area,
    centroid: [cen.x, cen.y, cen.z] as Vec3,
    positions: bucket.positions,
  };
  // Only flat faces have one direction they point in. Curved faces do not.
  if (bucket.kind === "planar" && nsum.lengthSq() > 0) {
    nsum.normalize();
    mesh.normal = [nsum.x, nsum.y, nsum.z];
  }
  return mesh;
}

/** Makes an empty face to be filled with triangles later. */
function bucket(id: string, kind: FaceKind, label: string, candidate: boolean): Bucket {
  return { id, kind, label, candidate, positions: [] };
}

/**
 * Cuts every triangle into four smaller ones, `levels` times (so 3 levels gives 64 triangles
 * from each original).
 *
 * Why: the results are painted by giving each corner a value and blending between corners.
 * A big triangle can only blend in a straight line, so a change that starts partway across
 * it (like where the bracket's supports end) shows up as a streak. Smaller triangles let
 * the color follow the real values.
 */
function subdivide(positions: number[], levels: number): number[] {
  let tris = positions;
  for (let l = 0; l < levels; l++) {
    const next: number[] = [];
    for (let i = 0; i < tris.length; i += 9) {
      // The triangle's three corners.
      const A = [tris[i], tris[i + 1], tris[i + 2]];
      const B = [tris[i + 3], tris[i + 4], tris[i + 5]];
      const C = [tris[i + 6], tris[i + 7], tris[i + 8]];
      // The point halfway between two corners.
      const mid = (P: number[], Q: number[]) => [(P[0] + Q[0]) / 2, (P[1] + Q[1]) / 2, (P[2] + Q[2]) / 2];
      const ab = mid(A, B);
      const bc = mid(B, C);
      const ca = mid(C, A);
      // Joining the three midpoints splits the triangle into four: one at each corner
      // and one in the middle.
      next.push(...A, ...ab, ...ca, ...ab, ...B, ...bc, ...ca, ...bc, ...C, ...ab, ...bc, ...ca);
    }
    tris = next;
  }
  return tris;
}

/**
 * Packages the finished faces into a GeometryPayload.
 * `refineFlatFaces` is how many times to subdivide the flat faces (see subdivide above).
 * Curved faces are skipped because cutting their triangles at the midpoints would pull
 * the new corners slightly off the curve.
 */
function toPayload(
  partId: PartId,
  thicknessMm: number,
  name: string,
  buckets: Bucket[],
  refineFlatFaces = 0,
): GeometryPayload {
  for (const b of buckets) {
    if (b.kind !== "cylindrical" && refineFlatFaces > 0) b.positions = subdivide(b.positions, refineFlatFaces);
  }
  return {
    part_id: partId,
    thickness_mm: thicknessMm,
    name,
    // Drop any face that ended up with no triangles at all.
    faces: buckets.filter((b) => b.positions.length > 0).map(finalize),
  };
}

// ---------- Equipment bracket ----------

/**
 * The bracket is a flat rectangular plate with two mounting holes near one end and a raised
 * block (the "pad") at the other end. Axes: x runs along the plate, y is up, z is across.
 */
function buildBracket(thicknessMm: number): GeometryPayload {
  const { LENGTH_M: L, WIDTH_M: W, PAD_START_M, PAD_HEIGHT_M, HOLE_RADIUS_M, HOLE_X_M } = BRACKET;
  // The rest of the app talks in millimeters, but all geometry math is in meters.
  const T = thicknessMm / 1000;

  // The faces. The ids are arbitrary but must never change: the AI and solver rely on them.
  // The last argument is `candidate`: only the holes and the pad can be picked by the user.
  const holeA = bucket("face_17", "cylindrical", "Mounting hole A", true);
  const holeB = bucket("face_18", "cylindrical", "Mounting hole B", true);
  const pad = bucket("face_42", "planar", "End loading pad", true);
  const top = bucket("face_01", "planar", "Plate top surface", false);
  const bottom = bucket("face_02", "planar", "Plate bottom", false);
  const sides = bucket("face_03", "other", "Plate outer sides", false);
  const padSides = bucket("face_43", "other", "Pad sides", false);
  const holes = [
    { b: holeA, x: HOLE_X_M[0] },
    { b: holeB, x: HOLE_X_M[1] },
  ];

  // Step 1: draw the plate's outline as a rectangle in 2D, with a circular hole cut out at
  // each hole position. Three.js calls this a Shape.
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(L, 0);
  shape.lineTo(L, W);
  shape.lineTo(0, W);
  shape.lineTo(0, 0);
  for (const h of holes) {
    const path = new THREE.Path();
    // absarc draws a circle: center x, center y, radius, start angle, end angle, clockwise.
    // The hole sits halfway across the width. The shape's y axis becomes -z after the
    // rotation below, hence the double negative that turns -W/2 back into +W/2.
    path.absarc(h.x, -(-W / 2), HOLE_RADIUS_M, 0, Math.PI * 2, true);
    shape.holes.push(path);
  }
  // Step 2: push the 2D shape up to give it thickness T. Extruding goes along the shape's
  // own z axis, so we then rotate the result a quarter turn to make "up" the y axis.
  const plate = new THREE.ExtrudeGeometry(shape, { depth: T, bevelEnabled: false, curveSegments: 48 });
  plate.rotateX(-Math.PI / 2);

  // Step 3: sort every triangle of the plate into the right face.
  eachTriangle(plate, (a, b, c, n) => {
    // The triangle's center along x and z.
    const cx = (a.x + b.x + c.x) / 3;
    const cz = (a.z + b.z + c.z) / 3;
    let target = sides;
    // A normal pointing mostly up or down means a flat top or bottom triangle.
    if (n.y > 0.9) target = top;
    else if (n.y < -0.9) target = bottom;
    else {
      // Otherwise it is a vertical wall. If it is close to a hole center it belongs to that
      // hole's wall. The 1.6 factor is a safe margin: wall triangles lie right at the
      // radius, and anything farther than 1.6 radii is the outer edge of the plate.
      for (const h of holes) {
        if (Math.hypot(cx - h.x, cz - -W / 2) < HOLE_RADIUS_M * 1.6) target = h.b;
      }
    }
    push(target, a, b, c);
  });

  // The top surface of the plate cannot be picked, because the load belongs on the pad.
  // Step 4: the raised pad is a simple box. BoxGeometry is centered on the origin, so
  // translate moves it to sit on top of the plate near the free end.
  const padW = L - PAD_START_M;
  const padGeo = new THREE.BoxGeometry(padW, PAD_HEIGHT_M, W);
  padGeo.translate(PAD_START_M + padW / 2, T + PAD_HEIGHT_M / 2, -W / 2);
  eachTriangle(padGeo, (a, b, c, n) => {
    // The upward-facing triangles are the pad's top, which is the loading surface.
    push(n.y > 0.9 ? pad : padSides, a, b, c);
  });

  // The final 3 asks for flat faces to be subdivided 3 times, so the stress colors have
  // enough detail along the plate.
  return toPayload("bracket", thicknessMm, `Equipment bracket, ${thicknessMm} mm thick`, [
    holeA,
    holeB,
    pad,
    top,
    bottom,
    sides,
    padSides,
  ], 3);
}

// ---------- Hatch plate ----------

// The flat faces of the hatch are drawn as concentric rings, then each ring is cut into
// wedges. RINGS is how many rings from the center to the rim, and SEGMENTS is how many
// wedges around. More of each makes a smoother picture and a bigger mesh.
const RINGS = 28;
const SEGMENTS = 96;

/**
 * The hatch is a flat round disc. Its axis is y. The top face is the cabin side, the
 * bottom face is the outside, and the curved edge is the rim that is bolted down.
 */
function buildHatch(thicknessMm: number): GeometryPayload {
  const R = HATCH.RADIUS_M;
  const t = thicknessMm / 1000;

  const cabin = bucket("face_01", "planar", "Cabin-side face", true);
  const outer = bucket("face_02", "planar", "Outer face", false);
  const rim = bucket("face_03", "cylindrical", "Rim (bolted edge)", true);

  // Draws one flat face of the disc at height y, as rings. `up` says whether the face
  // points up (top face) or down (bottom face).
  // We use rings instead of a simple pie-slice fan because the stress and deflection change
  // smoothly from the center to the edge. A fan has only two points of detail along each
  // slice, so it would draw a straight blend where the real answer is curved.
  const ring = (y: number, up: boolean, target: Bucket) => {
    // A point on ring i (0 = center, RINGS = rim) at angle step j (0 to SEGMENTS).
    const p = (i: number, j: number) =>
      new THREE.Vector3(
        ((i / RINGS) * R) * Math.cos((j / SEGMENTS) * Math.PI * 2),
        y,
        ((i / RINGS) * R) * Math.sin((j / SEGMENTS) * Math.PI * 2),
      );
    // Adds one triangle, flipped if needed so it faces the right way.
    const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => {
      // The cross product's y part tells us which way the triangle faces as written.
      const cross = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a));
      // Corner order sets which side is the front. Keep the order if it already faces the
      // way we want (up for the top face, down for the bottom), otherwise swap two corners.
      if (up === cross.y > 0) push(target, a, b, c);
      else push(target, a, c, b);
    };
    for (let i = 0; i < RINGS; i++) {
      for (let j = 0; j < SEGMENTS; j++) {
        if (i === 0) {
          // The center ring is a single point, so each wedge there is one triangle.
          tri(p(0, 0), p(1, j), p(1, j + 1));
        } else {
          // Everywhere else a wedge between two rings is a four-sided piece. Cut it into
          // two triangles.
          tri(p(i, j), p(i + 1, j), p(i + 1, j + 1));
          tri(p(i, j), p(i + 1, j + 1), p(i, j + 1));
        }
      }
    }
  };
  // Top face at height t (the cabin side), bottom face at height 0.
  ring(t, true, cabin);
  ring(0, false, outer);

  // The curved edge: a tube with no end caps (the `true` at the end means "open ended").
  // It is built centered on the origin, so lift it by half its height to span 0 to t.
  const wall = new THREE.CylinderGeometry(R, R, t, SEGMENTS, 1, true);
  wall.translate(0, t / 2, 0);
  eachTriangle(wall, (a, b, c) => push(rim, a, b, c));

  // No subdivision here (the default of 0), because the rings already give enough detail.
  return toPayload("hatch", thicknessMm, `Hatch plate, ${thicknessMm} mm thick`, [cabin, outer, rim]);
}

// ---------- Public ----------

/**
 * The one function other files call. Builds the requested part. If no thickness is given
 * it uses that part's default from src/data/parts.ts.
 */
export function buildPart(partId: PartId, thicknessMm?: number): GeometryPayload {
  const t = thicknessMm ?? getPart(partId).thickness.default;
  return partId === "bracket" ? buildBracket(t) : buildHatch(t);
}
