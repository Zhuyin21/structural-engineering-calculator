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

Every solve also runs an equilibrium check: after the last node, the shear,
moment, axial force and torque must return to zero. The page reports the
outcome under the reactions table.

Not yet validated against an independent program (for example a commercial
beam solver). Comparing a set of textbook problems side by side is a good
next step before students rely on it.
