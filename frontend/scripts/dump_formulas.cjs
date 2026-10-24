// Prints sample values from the bundled analytic.ts for scripts/check_formulas.py.
// It runs the TypeScript formulas on fixed sample inputs and prints the answers as JSON.
// The Python script then recomputes the same numbers independently and compares.
// Before running this, bundle the formulas with the esbuild command in check_formulas.py.
// (.cjs means a CommonJS file, which lets us use require() below.)
const { bracketBending, plateUnderPressure } = require("/tmp/analytic.cjs");

// Sample bracket: 500 kg on Mars (Mars gravity 3.73), 60 mm wide, 12 mm thick, 0.13 m lever
// arm, aluminum. If you change a number here, change it in check_formulas.py too.
const L = 0.13;
const br = bracketBending({
  widthM: 0.06, thicknessM: 0.012, lengthM: L, forceN: 500 * 3.73,
  gravity: 3.73, youngsPa: 68.9e9, densityKgM3: 2700,
});

// Sample hatch for one rim type: 0.25 m radius, 5 mm thick, 101 kPa cabin against 636 Pa
// outside. Besides the headline numbers, it samples the deflection and the two moments at
// 499 radii so the Python side can check that they agree with each other.
const plate = (edge) => {
  const a = 0.25;
  const p = plateUnderPressure({
    radiusM: a, thicknessM: 0.005, pressurePa: 101000 - 636,
    youngsPa: 68.9e9, poisson: 0.33, edge,
  });
  const n = 500;
  const rs = [], ws = [], Mr = [], Mt = [];
  // k starts at 1 to skip r = 0, where the formulas divide by r in the Python check.
  for (let k = 1; k < n; k++) {
    const r = (k / n) * a;
    rs.push(r); ws.push(p.deflectionAt(r)); Mr.push(p.radialMomentAt(r)); Mt.push(p.tangentialMomentAt(r));
  }
  // Radial stress at the rim, from the moment there: stress = 6 M / t^2.
  const edgeSr = (6 * p.radialMomentAt(a)) / 0.005 ** 2;
  return { D: p.flexuralRigidity, peak: p.peakVonMisesPa, wc: p.centerDeflectionM, edgeSr: Math.abs(edgeSr), rs, ws, Mr, Mt };
};

// One JSON object on standard output. The key names must match what check_formulas.py reads.
console.log(JSON.stringify({
  bracket: {
    inertia: br.inertiaM4, w: br.weightPerLengthNm, sF: br.stressFromForcePa, sW: br.stressFromWeightPa,
    peak: br.peakStressPa, tip: br.tipDeflectionM, deflL: br.deflectionAt(L), stress0: br.stressAt(0), stressL: br.stressAt(L),
  },
  clamped: plate("clamped"),
  simply_supported: plate("simply_supported"),
}));
