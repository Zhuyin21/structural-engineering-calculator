# Structural Engineering Calculator

Open-source calculators for engineering students to check their homework.
They run in the browser, with nothing to install.

The first tool is the **beam calculator**. Shaft, truss and frame calculators
are planned and will share the same menu, units and section library.

## Beam calculator

A straight beam along x, with loads and supports in the XY and XZ planes,
plus axial force and torque.

- **Supports**: fixed wall, pin, roller (both planes or one), spring, or a
  custom choice of which movements are held. Any number, at any position.
- **Loads**: point forces (Fx, Fy, Fz), moments (My, Mz) and torque (T),
  and distributed loads that are uniform, linearly varying, or given by a
  formula such as `-5*sin(pi*x/L)`.
- **Section and material**: rectangle, circle, round tube, I-beam,
  rectangular tube, or your own A, I and J. Leave them out to solve
  reactions and force diagrams only.
- **Units**: force (N, kN, lbf, kip), length (m, mm, in, ft) and stress
  (Pa, MPa, psi, ksi) are chosen independently, with a separate unit for
  section sizes and deflection, and GPa or ksi for E.
- **Results**: support reactions, shear, bending moment, slope and
  deflection in each plane, total bending moment, torque, angle of twist,
  axial force, peak stresses, values at any position, and CSV export.

The workflow is set up, then **Solve**. The plane views redraw as you type;
results grey out when the beam changes until you solve again.

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
`dist/beam-calculator.html`, a single file that opens straight from disk.

## How the beam is solved

Because the beam is straight and y, z are principal axes of the section, the
problem splits into four independent ones: axial, torsion, bending in XY and
bending in XZ. Each is solved in two steps.

1. **Stiffness method** with a node at every support, load and load end.
   With work-equivalent nodal loads this gives exact nodal displacements and
   reactions for Euler-Bernoulli theory, including statically indeterminate
   beams and spring supports.
2. **Method of sections.** Internal forces are built by summing everything to
   the left of the cut, and slope and deflection by integrating M/EI from
   each node. Point, uniform and linear loads are integrated in closed form;
   formula loads by Gauss-Legendre quadrature.

Sign conventions are in [docs/sign-conventions.md](docs/sign-conventions.md).
What the solver has been checked against is in
[docs/validation.md](docs/validation.md).

### Limits

Euler-Bernoulli theory (no shear deformation), small deflections, linear
elastic material, one uniform cross-section with its principal axes along y
and z. No buckling, no internal hinges yet, and torsional stress only for
round sections and closed rectangular tubes.

## Tests

```
npm test
```

runs the solver against closed-form textbook results, with signs checked,
and confirms that every worked example gives the same answer in every unit
system. No dependencies are needed for the tests.

## Project layout

```
index.html            beam calculator page
styles/app.css        shared styles (light and dark)
src/core/             units, section library, materials, formula parser, numerics
src/ui/               menus, dialogs and diagram plots shared by all calculators
src/beam/solver.js    the beam mechanics (no page code)
src/beam/model.js     the beam as entered, unit conversion, worked examples
src/beam/draw.js      plane-view drawings
src/beam/app.js       the page: tables, Solve, results
tests/                validation tests
docs/                 sign conventions and validation notes
```

A new calculator adds a page, a folder under `src/`, and an entry in the
Analysis menu; `src/core` and `src/ui` are shared.

## Licence

MIT. Results are for learning. Check anything that matters independently.
