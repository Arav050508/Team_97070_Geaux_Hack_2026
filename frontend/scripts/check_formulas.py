"""Independent check of src/solver/analytic.ts.

The idea: the TypeScript formulas are only trustworthy if something else agrees with them.
This script does two kinds of checking.

1. Hand-calc: the closed-form numbers computed again here in Python.
2. Consistency: the moment formulas must match the deflection formulas through the plate
   equations M_r = -D (w'' + nu w'/r) and M_t = -D (w'/r + nu w''), checked by finite differences.

Run:  npx esbuild src/solver/analytic.ts --bundle --platform=node --format=cjs --outfile=/tmp/analytic.cjs
      node scripts/dump_formulas.cjs > /tmp/ts_out.json && python3 scripts/check_formulas.py /tmp/ts_out.json

The first command bundles the TypeScript formulas into one file Node can load. The second
runs them on sample inputs and saves the numbers as JSON. This script reads that JSON, which
is why it takes the JSON path as its one argument.
"""
import json, math, sys

# The numbers that the TypeScript code produced. sys.argv[1] is the path given on the
# command line.
ts = json.load(open(sys.argv[1]))
# Count of checks that failed. The script exits with an error code if this is not zero.
bad = 0


def close(name, got, want, tol=1e-9):
    """Compares the TypeScript value (got) with the Python value (want) and prints the result.

    tol is a relative tolerance: the allowed difference as a fraction of the wanted value.
    max(1.0, abs(want)) keeps the check from becoming too strict when want is near zero.
    """
    global bad
    ok = abs(got - want) <= tol * max(1.0, abs(want))
    print(("ok   " if ok else "FAIL ") + f"{name}: ts={got:.9g} py={want:.9g}")
    if not ok:
        bad += 1


# ---- bracket: 500 kg on Mars, b=60 mm, h=12 mm, L=0.13 m, aluminium ----
# These must match the sample inputs in scripts/dump_formulas.cjs.
c = ts["bracket"]
b, h, L = 0.06, 0.012, 0.13
F = 500 * 3.73  # weight = mass x Mars gravity
E, rho, g = 68.9e9, 2700, 3.73
I = b * h**3 / 12  # second moment of area of the cross-section
w = rho * g * b * h  # the plate's own weight per meter
sF = 6 * F * L / (b * h**2)  # stress from the end force
sW = 3 * w * L**2 / (b * h**2)  # stress from the plate's own weight
tip = F * L**3 / (3 * E * I) + w * L**4 / (8 * E * I)
close("bracket I", c["inertia"], I)
close("bracket w", c["w"], w)
close("bracket stress from force", c["sF"], sF)
close("bracket stress from weight", c["sW"], sW)
close("bracket peak", c["peak"], sF + sW)
close("bracket tip deflection", c["tip"], tip)
close("bracket deflectionAt(L)", c["deflL"], tip)
close("bracket stressAt(0)", c["stress0"], sF + sW)
# At the free end the bending moment is zero, so the stress there should be zero.
close("bracket stressAt(L)", c["stressL"], 0.0, 1e-12)
# deflection by double-integrating the moment numerically
# Bending theory says: slope is the integral of M/(E I), and deflection is the integral of
# the slope. We do both sums in small steps and compare to the closed-form tip deflection.
n = 20000
dx = L / n
slope = 0.0
defl = 0.0
for i in range(n):
    u = (i + 0.5) * dx  # middle of this step, measured from the support
    M = F * (L - u) + w * (L - u) ** 2 / 2
    slope += M / (E * I) * dx
    defl += slope * dx
close("bracket tip by numeric integration", defl, c["tip"], 1e-3)

# ---- plates ----
# Same pressure, size, and material as scripts/dump_formulas.cjs.
for case in ("clamped", "simply_supported"):
    p = ts[case]
    a, t, q, nu, E2 = 0.25, 0.005, 101000 - 636, 0.33, 68.9e9
    D = E2 * t**3 / (12 * (1 - nu**2))
    close(f"{case} D", p["D"], D)
    if case == "clamped":
        sr = 3 * q * a**2 / (4 * t**2)
        close("clamped edge radial stress (Roark)", p["edgeSr"], sr)
        # At the clamped edge the tangential stress is nu times the radial stress, so the
        # von Mises value reduces to sr * sqrt(1 - nu + nu^2).
        close("clamped peak von Mises", p["peak"], sr * math.sqrt(1 - nu + nu**2))
        close("clamped center deflection q a^4/64D", p["wc"], q * a**4 / (64 * D))
    else:
        close("ss center stress 3(3+nu) q a^2 / 8 t^2", p["peak"], 3 * (3 + nu) * q * a**2 / (8 * t**2))
        close("ss center deflection", p["wc"], (5 + nu) * q * a**4 / (64 * (1 + nu) * D))
    # finite-difference consistency between w(r) and M_r, M_t
    # The moments and the deflection are separate formulas in analytic.ts. Plate theory says
    # the moments can be found from the deflection's first and second derivatives. We
    # estimate those derivatives from neighboring samples and see if the results agree.
    worst = 0.0
    # w samples come from the dump
    rs = p["rs"]; ws = p["ws"]; Mr = p["Mr"]; Mt = p["Mt"]
    step = rs[1] - rs[0]
    # Skip the first and last few samples, where the center and edge need special care,
    # and test every 7th one.
    for k in range(5, len(rs) - 5, 7):
        r = rs[k]
        w1 = (ws[k + 1] - ws[k - 1]) / (2 * step)  # first derivative
        w2 = (ws[k + 1] - 2 * ws[k] + ws[k - 1]) / step**2  # second derivative
        mr = -D * (w2 + nu * w1 / r)
        mt = -D * (w1 / r + nu * w2)
        worst = max(worst, abs(mr - Mr[k]) / max(abs(Mr[k]), 1), abs(mt - Mt[k]) / max(abs(Mt[k]), 1))
    print(("ok   " if worst < 1e-3 else "FAIL ") + f"{case} moments vs deflection (worst rel err {worst:.2e})")
    if worst >= 1e-3:
        bad += 1

print("ALL CHECKS PASSED" if bad == 0 else f"{bad} CHECK(S) FAILED")
sys.exit(1 if bad else 0)
