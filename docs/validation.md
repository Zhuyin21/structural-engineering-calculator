# Validation

`npm test` checks the solver against closed-form results. Magnitudes and
signs are both asserted, to a relative tolerance of 1e-9 unless noted.

| Case | Checked against |
|------|-----------------|
| Simply supported, point load | reactions, Pab/L, deflection under the load, position and value of the maximum deflection, end slopes |
| Cantilever, uniform load | wall shear and moment (hogging negative), tip deflection wL⁴/8EI and slope wL³/6EI |
| Cantilever, end couple | constant moment, tip deflection ML²/2EI |
| Simply supported, couple at midspan | reactions ±M/L and the jump in the moment diagram |
| Fixed-fixed, uniform load | end moments wL²/12, midspan wL²/24, deflection wL⁴/384EI |
| Propped cantilever, uniform load | 3wL/8, 5wL/8, wL²/8, peak sagging moment 9wL²/128 at 5L/8 |
| Two-span continuous beam | 0.375wL, 1.25wL, support moment wL²/8 |
| Simply supported, triangular load | reactions, peak moment w₀L²/9√3 at L/√3, peak deflection 0.00652 w₀L⁴/EI (to 1e-3) |
| Partial uniform load | peak moment where the shear crosses zero |
| Formula load vs the same linear load | shear, moment, slope, deflection at six positions |
| Sinusoidal formula load | w₀L/π, w₀L²/π², w₀L⁴/π⁴EI |
| Overhanging beam | reactions, support moment, tip deflection Pa²(L+a)/3EI |
| Translational and rotational springs | load sharing with the beam stiffness |
| XZ plane (top view, z down) | reads like XY using Iy: positive shear and moment for a load pointing down the page; deflection along +z |
| Moment signs | Mz and My equal the right-hand-rule components of the internal moment, from a cantilever cross-product check |
| Both planes | resultant bending moment |
| Axial | tension positive; fixed-free, fixed-fixed, distributed load |
| Torsion | fixed-free, fixed-fixed, distributed torque, balanced torques on an unrestrained shaft |
| Stability | unsupported, single support, unresisted axial load or torque are reported as errors |
| Continuity | deflection and slope continuous across every load and support of a mixed two-plane case |
| Superposition | sum of two load cases equals the combined case |
| Units | every worked example gives the same SI answer when entered in N-mm, lbf-in and kip-ft |
| US customary case | 20 ft span, 2 kip/ft, E = 29000 ksi, I = 800 in⁴: 100 kip·ft and 5wL⁴/384EI in inches |
| Sections | I, A and J formulas against independent sums and tabulated torsion constants |
| Stresses | Mc/I for one and two planes plus axial, VQ/It for a rectangle and circle, Tr/J |

| Two methods | every bending case above is solved by the method of initial parameters and again by the stiffness method; reactions must agree to 1e-9 |
| Close positions | loads and supports 1e-3 to 1e-9 m apart; a load 1e-7 m from an interior support |
| Formula with a jump | equals the same load entered as a partial uniform row, to 1e-10 |
| Many spans | 12 spans with loads in both planes |
| Peak total moment | located to 1e-8 against a fine scan, with distributed loads in both planes |

| Stress along the beam | Mc/I at the extreme fibre, 3V/2A and 4V/3A at the neutral axis, von Mises as the larger of the two locations; resultant moment and shear on a round bar |
| Formula units | a formula load gives the same beam after the model's units are changed |

## Bar

| Case | Checked against |
|------|-----------------|
| Stepped bar, one end fixed | N, sigma = N/A, strain, NL/AE per segment, total change in length, stress jump at the step |
| Held at both ends, two materials | reactions shared in proportion to EA/L; zero net change in length |
| Distributed axial load | N(x) and tip displacement wL^2/2EA |
| Input checks | no support, missing area, missing E for an indeterminate bar |

## Column

| Case | Checked against |
|------|-----------------|
| Shigley Example 4-16 | Euler: d = 37.5 mm for 88 kN at l = 1.5 m; l/k = 150 for d = 40 mm; (l/k)1 = 90.4 |
| Shigley Example 4-17 | fixed-fixed with C = 1.2: h = 22.2 mm |
| Shigley Example 4-18 | Johnson: d = 19.0 mm for 88 kN at l = 375 mm; l/k = 75 for d = 20 mm |
| Shigley Example 4-19 | (l/k)1 = 88.9 for Sy = 75 kpsi, E = 30 Mpsi |
| Table 4-2 | all end-condition constants |
| Formulas meet | Johnson and Euler both give Sy/2 at (l/k)1 |
| Secant formula | direct evaluation of Eq. (4-53); yield load tends to the Euler load as e tends to zero |
| Two planes | weak axis governs; a free end in the other plane can take over |

## Stress concentration

The tool against every value the book itself reads from Table A-15:

| Figure | Read at | Book | Tool | Where in Shigley |
|--------|---------|------|------|------------------|
| A-15-1 | d/w = 0.1 | 2.7 | 2.69 | Example 3-13 |
| A-15-1 | d/w = 0.25 | 2.45 | 2.42 | Example 6-10 |
| A-15-5 | r/d = 0.026, D/d = 1.18 | 2.5 | 2.45 | Example 3-13 |
| A-15-6 | r/d = 0.15, D/d = 3 | 1.68 | 1.65 | Chapter 14 |
| A-15-8 | r/d = 0.10, D/d = 1.5 | 1.42 | 1.44 | Example 7-1 |
| A-15-8 | r/d = 0.1, D/d = 1.23 | 1.35 | 1.37 | Example 7-2 |
| A-15-9 | r/d = 0.094, D/d = 1.19 | 1.65 | 1.65 | Examples 6-6, 6-7 |
| A-15-9 | r/d = 0.1, D/d = 3 | 1.8 | 1.81 | Chapter 6 |
| A-15-9 | r/d = 0.10, D/d = 1.5 | 1.68 | 1.68 | Example 7-1 |
| A-15-9 | r/d = 0.1, D/d = 1.23 | 1.6 | 1.63 | Example 7-2 |

All within about 2 percent; the book reads the charts by eye to two or three
figures. The tests also check the nominal stresses of Example 3-13, the
combination of loads, the chart limits, and that every curve is well formed.

Known soft spot: when a part lies between a printed curve and one that has
already left the top of the chart (Kt above 3), the tool uses the highest
curve still on the chart and says so. The true value is somewhat higher.

## Materials

Spot checks of Table A-20 (1006, 1020, 1045, 1050; HR and CD) and Table A-5
(carbon steel, aluminum), and of conversion to and from US units.

Every solve in the page runs the same two checks: the shear, moment, axial
force and torque must return to zero at the right end, and the two bending
methods must give the same reactions. The outcome is shown under the
reactions table.

Not yet validated against an independent program (for example a commercial
beam solver). Comparing a set of textbook problems side by side is a good
next step before students rely on it.
