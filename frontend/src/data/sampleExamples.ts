// The "Try:" prompt shown under the chat box. Each sample STEP part in samples/ has its own,
// written for that part's faces. Any other file gets the generic prompt.
//
// The prompts name faces by the labels the app shows ("Flat face 5"), because those never
// change for the same file. Directions are written in the file's own axes (see samples/README.md).

const GENERIC = "Fix the bottom face and push down on the top face with 2000 N";

const BY_FILE: Record<string, string> = {
  // 100 x 5 x 5 mm bar. Face 1 is one end, face 3 is the other end. Beam theory predicts
  // 96 MPa for 20 N.
  "cantilever beam": "Fix Flat face 1 and push down on Flat face 3 with 20 N",
  // L-shaped bracket. Face 5 is the back of the upright leg, face 6 is the top of the arm.
  "l brackets": "Fix Flat face 5 against the wall and put a 30 kg load on Flat face 6",
  // The bell stands along the Y axis of the file, so "down" is -Y, not -Z.
  "kettle bell": "Fix Cylindrical face 16, the grip, and pull on Flat face 13, the base, along -Y with a 16 kg load",
  // Hex flange nut with its axis along Z. Face 15 is the flange bottom. Faces 6 and 7 are the two
  // halves of the threaded bore, where a bolt pulls on the nut. The force is shared by both.
  "hex flange nut_am": "Fix Flat face 15 and pull down on Cylindrical face 6 and Cylindrical face 7 with 25000 N",
};

/** The example prompt for a part, found by its file name (ignoring case and the extension). */
export function exampleFor(fileName: string): string {
  const key = fileName.replace(/\.(step|stp)$/i, "").trim().toLowerCase();
  return BY_FILE[key] ?? GENERIC;
}
