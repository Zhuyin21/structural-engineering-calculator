# Structural Engineering Calculator

Open-source calculators for engineering students to check their homework.
They run in the browser, with nothing to install. Formulas and material
properties follow *Shigley's Mechanical Engineering Design*, 11th ed.
(Budynas and Nisbett); see [docs/references.md](docs/references.md).

| Analysis | What it is for |
|----------|----------------|
| **Beam** | transverse and bending loads in two planes, plus axial force and torque |
| **Bar** | axial load on a stepped member: force, stress, strain, displacement |
| **Column** | buckling under compression: Euler, Johnson and secant formulas |
| Shaft, Truss, Frame | planned |

Switch between them from the **Analysis** menu. They share the units,
cross-section library and materials library. The workflow is always set up,
then **Solve**; results grey out when the model changes until you solve again.

## Beam

A straight beam along x with one uniform cross-section, with loads and
supports in the XY and XZ planes, plus axial force and torque.

- **Supports**: fixed wall, pin, roller (both planes or one), spring, or a
  custom choice of which movements are held. Any number, at any position.
- **Loads**: point forces (Fx, Fy, Fz), moments (My, Mz) and torque (T),
  and distributed loads that are uniform, linearly varying, or given by a
  formula such as `-5*sin(pi*x/L)`. A formula remembers the units it was
  written in.
- **Results**: support reactions; shear, bending moment, slope and
  deflection for each plane (Beam Diagrams XY and XZ); total bending moment,
  torque, axial force and angle of twist (3D Beam Diagrams); normal stress,
  transverse shear stress and von Mises stress along the beam (Stress
  Diagrams); factor of safety against yielding; values at any position; CSV.
- Euler-Bernoulli theory. Below a span-to-depth ratio of 10 the calculator
  warns that the deflection shown is too small.

## Bar

A straight bar along x under axial load only. It can be stepped: each
segment has its own area (a shape, or the area typed directly). One material
for the whole bar. Fixed at the left end, the right end, or both
(statically indeterminate). Point and distributed axial loads. Results:
axial force, stress, strain and displacement diagrams, change in length and
factor of safety per segment, reactions.

## Column

Critical load of a centrally loaded column, checked for buckling in the XY
plane (about z) and the XZ plane (about y) with its own end condition in
each. Euler's formula for long columns and the J. B. Johnson parabola for
intermediate ones, chosen automatically at (l/k)1. End-condition constants
from Shigley Table 4-2 (recommended, theoretical or conservative values, or
your own). Optional load for the factor of safety, and optional eccentricity
for the secant formula. A chart shows the column on the critical-unit-load
curve.

## Shared

- **Units**: force (N, kN, lbf, kip), length (m, mm, in, ft) and stress
  (Pa, MPa, psi, ksi) are chosen independently, with a separate unit for
  section sizes and deflection, and GPa or ksi for E. Everything is solved in
  SI.
- **Sections**: rectangle, circle, round tube, I-beam, rectangular tube, or
  your own A, I and J.
- **Materials**: AISI 1006 to 1050 steels, hot-rolled and cold-drawn, with
  Sy and Sut (Shigley Table A-20), and elastic constants for other metals
  (Table A-5). Any value can be overridden.

## Use it

**Online.** Once GitHub Pages is enabled for this repository
(Settings → Pages → Deploy from a branch → `main`, folder `/ (root)`), the
calculator is served at `https://zhuyin21.github.io/structural-engineering-calculator/`.

**On your own computer.** The page uses JavaScript modules, which browsers
only load from a web server:

```
git clone https://github.com/Zhuyin21/structural-engineering-calculator
cd structural-engineering-calculator
npm run serve          # then open http://localhost:8000
```

**As one offline file.** `npm install && npm run bundle` writes
`dist/calculator.html`, a single file that opens straight from disk.

## How the beam is solved

Because the beam is straight and y, z are principal axes of the section, the
problem splits into four independent ones: axial, torsion, bending in XY and
bending in XZ. Each is solved in two steps.

1. **Reactions.** Bending uses the method of initial parameters (Macaulay's
   method, the one done by hand): the unknowns are the deflection and slope
   at x = 0 and the support reactions, and the equations are the support
   conditions plus force and moment balance. It handles statically
   indeterminate beams and springs, and has no elements, so a load a hair's
   width from a support is not a problem. Axial and torsion use the stiffness
   method.
2. **Method of sections.** Internal forces are built by summing everything to
   the left of the cut, and slope and deflection by integrating M/EI along
   the beam. Point, uniform and linear loads are integrated in closed form;
   formula loads by adaptive Gauss-Legendre quadrature, which also copes with
   jumps such as `step(x - 2)`.

Every solve is checked twice: the internal forces must return to zero at the
right end, and each bending plane is solved again by the stiffness method
(cubic beam elements) to confirm the reactions. The page reports both.

Sign conventions are in [docs/sign-conventions.md](docs/sign-conventions.md).
What the solvers have been checked against is in
[docs/validation.md](docs/validation.md).

### Limits

Linear elastic, small deflections. The beam and column take one uniform
cross-section, symmetric about y and z. No shear deformation, no internal
hinges, no temperature change, no stress concentration at steps. Torsion is
not included in the beam's stress diagrams or von Mises stress; torsional
shear is listed separately for round sections and closed rectangular tubes.

## Tests

```
npm test
```

runs the solvers against closed-form results and worked examples from
Shigley, with signs checked, and confirms that every beam example gives the
same answer in every unit system. No dependencies are needed for the tests.

## Project layout

```
index.html              the page: one section per analysis
styles/app.css          shared styles (light and dark)
src/main.js             menu bar and switching between analyses
src/core/               units, sections, materials, formula parser, numerics, shared inputs
src/ui/                 menus, dialogs, tables and plots shared by all analyses
src/beam/               solver.js (mechanics), model.js, draw.js, app.js (page)
src/bar/                solver.js, app.js
src/column/             solver.js, app.js
tests/                  validation tests
docs/                   sign conventions, validation notes, references
```

A new analysis adds a folder under `src/`, a section in `index.html`, and one
line in `src/main.js`. It gets the menus, units, sections and materials for
free.

## Licence

MIT. Results are for learning. Check anything that matters independently.
