// The 3D view. It draws the part, colors each face, lets the user hover and click faces,
// and draws the force arrows. It does not decide what any of that means: App.tsx passes in
// props saying which faces are supports, which are loads, what the colors should be, and
// so on, and this component just draws them.
//
// This file mixes React with raw Three.js. A few ideas help when reading it:
//   - A React component normally describes the screen and React updates it. Three.js does
//     not work that way: we create objects and change them by hand. So the Three.js objects
//     live outside React's normal flow, and we use useEffect to keep them in sync.
//   - useEffect(fn, [a, b]) runs `fn` after the first draw, and again whenever `a` or `b`
//     changes. If `fn` returns a function, React calls that when it is time to clean up.
//   - useRef gives a box that survives between redraws. Changing it does not trigger a redraw.

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { colormap } from "../colormap";
import type { FaceRole, GeometryPayload, Vec3 } from "../types";

// One force arrow to draw.
export interface ArrowSpec {
  tip: Vec3; // where the arrow points to (on the loaded face)
  dir: Vec3; // direction the force acts
}

// The numbers used to paint results onto the part.
export interface FieldSpec {
  values: Record<string, number[]>; // per-face, per-vertex scalars
  min: number;
  max: number;
}

export interface ViewportProps {
  geometry: GeometryPayload | null;
  // What each face is currently used for, by face id. A missing id means "none".
  roles: Record<string, FaceRole>;
  hoveredId: string | null;
  /** If set, only these faces react to hover and click. null = every face. */
  selectableIds: Set<string> | null;
  // When this is set, the faces are painted with results instead of role colors.
  field: FieldSpec | null;
  arrows: ArrowSpec[];
  onHover: (id: string | null) => void;
  onPick: (id: string) => void;
}

// Colors for each face role. The numbers are hex colors, 0xRRGGBB.
const BASE = new THREE.Color(0xa7afbd); // a face with no job
const SUPPORT = new THREE.Color(0x3b82f6); // blue
const LOAD = new THREE.Color(0xf59e0b); // orange
const PRESSURE = new THREE.Color(0xa78bfa); // purple
const HOVER = new THREE.Color(0xfde047); // yellow, for a plain face under the mouse

// Everything we create once for the scene and need to reach later.
interface Ctx {
  renderer: THREE.WebGLRenderer; // draws the scene onto a <canvas>
  scene: THREE.Scene; // the container for everything we draw
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls; // lets the user rotate, pan, and zoom with the mouse
  faces: THREE.Group; // one mesh per face of the part
  arrows: THREE.Group; // the force arrows
  grid: THREE.GridHelper; // the floor grid
}

/** The color a face should have, given its role and whether the mouse is over it. */
function faceColor(role: FaceRole, hovered: boolean): THREE.Color {
  const c =
    role === "support" ? SUPPORT : role === "load" ? LOAD : role === "pressure" ? PRESSURE : BASE;
  if (!hovered) return c;
  // A hovered face with a role gets lighter. A hovered plain face turns yellow.
  // clone() is used so the shared color constants above are never changed.
  return role === "none" ? HOVER.clone() : c.clone().lerp(new THREE.Color(0xffffff), 0.45);
}

export function Viewport(props: ViewportProps) {
  // The <div> that the 3D canvas gets placed inside.
  const mountRef = useRef<HTMLDivElement>(null);
  // The Three.js objects, once they exist.
  const ctxRef = useRef<Ctx | null>(null);
  const framedPart = useRef<string | null>(null); // reframe the camera only when the part changes

  // Latest callbacks and settings, readable from long-lived event handlers.
  // The mouse handlers below are created once, so they would otherwise keep using the props
  // from the first draw. Reading `live.current` always gives the newest props.
  const live = useRef(props);
  live.current = props;

  // 1. Scene setup, once. The empty [] at the end means "run only on the first draw".
  useEffect(() => {
    const mount = mountRef.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    // On high-density screens, draw more pixels for sharpness, but never more than 2x.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0e1117);

    // Arguments: field of view in degrees, aspect ratio (fixed later by resize), nearest and
    // farthest distances that get drawn.
    const camera = new THREE.PerspectiveCamera(40, 1, 0.005, 20);
    camera.position.set(0.3, 0.22, 0.2);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; // gives the rotation a little glide
    controls.target.set(0.1, 0.01, -0.03); // the point the camera orbits around

    // Two lights: ambient light fills every surface evenly, and the directional light acts
    // like the sun, so surfaces facing it look brighter and the shape is easier to read.
    scene.add(new THREE.AmbientLight(0xffffff, 1.0));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(0.4, 0.8, 0.5);
    scene.add(sun);

    // Size 0.6 m with 24 divisions. It is moved and scaled to fit each part later.
    const grid = new THREE.GridHelper(0.6, 24, 0x2a3140, 0x1b212c);
    grid.position.set(0.1, -0.004, -0.03);
    scene.add(grid);

    const faces = new THREE.Group();
    const arrows = new THREE.Group();
    scene.add(faces, arrows);

    const ctx: Ctx = { renderer, scene, camera, controls, faces, arrows, grid };
    ctxRef.current = ctx;

    // Keeps the canvas the same size as its container.
    // The last size used, so a resize event with the same size does nothing.
    let lastW = 0;
    let lastH = 0;
    const resize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      if (w === 0 || h === 0 || (w === lastW && h === lastH)) return;
      lastW = w;
      lastH = h;
      // `false` leaves the canvas's on-screen size to the CSS (100% of the box). If Three.js set
      // it in pixels, a rounding difference at some display scalings can make the canvas 1px too
      // big, add a scrollbar, shrink the box, and start the resize over and over (flicker).
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    // ResizeObserver calls resize whenever the container changes size.
    const ro = new ResizeObserver(resize);
    ro.observe(mount);
    resize();

    // Picking: hover highlights, click (without dragging) selects.
    // "Picking" means working out which face is under the mouse. A raycaster shoots an
    // invisible line from the camera through the mouse position and reports what it hits.
    const el = renderer.domElement;
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let lastHover: string | null = null;
    let down: { x: number; y: number } | null = null;

    // Returns the id of the face under the mouse, or null if none (or if that face is not
    // allowed to be picked right now).
    const pick = (e: PointerEvent): string | null => {
      const r = el.getBoundingClientRect();
      // Convert the mouse position to "normalized device coordinates": x and y both run from
      // -1 to 1, with y up. This is the form Three.js expects.
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      // `false` means do not look inside child objects. The nearest hit comes first.
      const hit = raycaster.intersectObjects(faces.children, false)[0];
      if (!hit) return null;
      const id = hit.object.userData.faceId as string;
      const allowed = live.current.selectableIds;
      return !allowed || allowed.has(id) ? id : null;
    };
    const onMove = (e: PointerEvent) => {
      if (e.buttons !== 0) return; // orbiting
      const id = pick(e);
      el.style.cursor = id ? "pointer" : "grab";
      // Only tell App.tsx when the hovered face changes, not on every pixel of movement.
      if (id !== lastHover) {
        lastHover = id;
        live.current.onHover(id);
      }
    };
    const onLeave = () => {
      if (lastHover !== null) {
        lastHover = null;
        live.current.onHover(null);
      }
    };
    // A click is a press and a release in nearly the same spot. Dragging to rotate the view
    // should not count, so we remember where the press began.
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved > 4) return; // moved more than 4 pixels, so it was a drag
      const id = pick(e);
      if (id) live.current.onPick(id);
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointerup", onUp);

    // Draw a new frame on every screen refresh.
    renderer.setAnimationLoop(() => {
      controls.update();
      renderer.render(scene, camera);
    });

    // Cleanup, run when the component is removed. Without it the old canvas, listeners, and
    // graphics memory would pile up.
    return () => {
      renderer.setAnimationLoop(null);
      ro.disconnect();
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointerup", onUp);
      controls.dispose();
      disposeGroup(faces);
      disposeGroup(arrows);
      renderer.dispose();
      mount.removeChild(el);
      ctxRef.current = null;
    };
  }, []);

  // 2. Rebuild meshes when the geometry changes, and frame the camera on it.
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    // Throw away the old meshes first.
    disposeGroup(ctx.faces);
    if (!props.geometry) {
      framedPart.current = null;
      return;
    }

    // CAD programs usually treat Z as up, while this viewer treats Y as up. Turn the part a
    // quarter turn about X so the file's +Z points up on screen. This only changes the drawing:
    // the face positions, force directions, and results all stay in the file's own coordinates.
    // The arrows group turns the same way so arrows stay attached to their faces.
    ctx.faces.rotation.x = -Math.PI / 2;
    ctx.arrows.rotation.x = -Math.PI / 2;

    for (const face of props.geometry.faces) {
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(face.positions);
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      // One color per corner (3 numbers each). Starts all zero and is filled in by effect 3.
      geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(pos.length), 3));
      geo.computeVertexNormals(); // needed for the lighting to work

      // vertexColors means "use the color attribute above". DoubleSide draws both sides of
      // each triangle, so a face is visible even if its triangles point the wrong way.
      const mesh = new THREE.Mesh(
        geo,
        new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
      );
      // Remember which face this mesh is, so picking can report the id.
      mesh.userData.faceId = face.id;

      // Dark outline along the sharp edges (angles over 30 degrees), to show the shape.
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geo, 30),
        new THREE.LineBasicMaterial({ color: 0x1c222d }),
      );
      mesh.add(edges);
      ctx.faces.add(mesh);
    }

    // A box around the whole part as it appears on screen (after the turn above). We use it to
    // aim the camera and to place the grid.
    ctx.faces.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(ctx.faces);

    // Move the camera only when the user switches to a different part, so the view does not
    // jump when the same part is redrawn. Each import has its own model id.
    const partKey = props.geometry.model_id ?? props.geometry.part_id;
    const samePart = framedPart.current === partKey;
    framedPart.current = partKey;
    if (!box.isEmpty() && !samePart) {
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3()).length(); // the box's diagonal
      ctx.controls.target.copy(center);
      // Put the grid just under the part and scale it to match the part's size.
      ctx.grid.position.set(center.x, box.min.y - 0.002, center.z);
      ctx.grid.scale.setScalar(Math.max(size * 3, 0.1) / 0.6);
      // Back the camera off from the center along a fixed diagonal, a distance in
      // proportion to the part's size.
      ctx.camera.position.copy(center).add(new THREE.Vector3(0.9, 0.7, 0.8).multiplyScalar(size));
      ctx.camera.near = size / 200;
      ctx.camera.far = size * 40;
      ctx.camera.updateProjectionMatrix();
    }
  }, [props.geometry]);

  // 3. Recolor on role, hover, or result changes. Declared after the rebuild effect so it
  //    runs after new meshes exist.
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    for (const obj of ctx.faces.children) {
      const mesh = obj as THREE.Mesh;
      const id = mesh.userData.faceId as string;
      const attr = mesh.geometry.getAttribute("color") as THREE.BufferAttribute;
      const scalars = props.field?.values[id];

      if (props.field && scalars) {
        // Showing results. Turn each corner's number into a color. (value - min) / range
        // squeezes the value into 0 to 1, which is what colormap() expects. `|| 1` avoids
        // dividing by zero if min and max are equal.
        const range = props.field.max - props.field.min || 1;
        for (let i = 0; i < attr.count; i++) {
          const [r, g, b] = colormap((scalars[i] - props.field.min) / range);
          attr.setXYZ(i, r, g, b);
        }
      } else {
        // Not showing results. Paint the whole face one color based on its role.
        const c = faceColor(props.roles[id] ?? "none", props.hoveredId === id);
        for (let i = 0; i < attr.count; i++) attr.setXYZ(i, c.r, c.g, c.b);
      }
      // Tells Three.js to send the changed colors to the graphics card.
      attr.needsUpdate = true;
    }
  }, [props.geometry, props.roles, props.hoveredId, props.field]);

  // 4. Force arrows.
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    disposeGroup(ctx.arrows);
    // Size the arrows to the part: a quarter of the part's overall size. A fixed size looked
    // tiny on a big part and swallowed a small one (a 100 mm beam).
    const box = new THREE.Box3();
    for (const f of props.geometry?.faces ?? []) {
      for (let i = 0; i < f.positions.length; i += 3) {
        box.expandByPoint(new THREE.Vector3(f.positions[i], f.positions[i + 1], f.positions[i + 2]));
      }
    }
    const size = box.isEmpty() ? 0.28 : box.getSize(new THREE.Vector3()).length();
    const length = size * 0.25;
    for (const a of props.arrows) {
      const dir = new THREE.Vector3(...a.dir).normalize();
      // The arrow is drawn from its tail, so back up from the tip against the direction.
      const origin = new THREE.Vector3(...a.tip).addScaledVector(dir, -length);
      // Arguments: direction, origin, length, color, head length, head width.
      ctx.arrows.add(new THREE.ArrowHelper(dir, origin, length, 0xf59e0b, length * 0.3, length * 0.18));
    }
  }, [props.arrows, props.geometry]);

  // The only thing React draws here is an empty box. Effect 1 puts the canvas inside it.
  return <div className="viewport-mount" ref={mountRef} />;
}

/**
 * Removes everything from a group and frees the graphics memory it used.
 * Three.js does not free geometry and materials on its own, so leaving this out would leak
 * memory every time the part is rebuilt.
 */
function disposeGroup(group: THREE.Group) {
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    // A mesh can have one material or a list of them.
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else if (mat) mat.dispose();
  });
  group.clear();
}
