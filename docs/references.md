# References

The calculators follow one textbook:

R. G. Budynas and J. K. Nisbett, *Shigley's Mechanical Engineering Design*,
11th ed. New York, NY: McGraw-Hill, 2020.

| Used for | Where in Shigley |
|----------|------------------|
| Axial stress, strain and deflection of a bar | Secs. 3-9 and 4-3 |
| Shear force and bending moment, beam sign convention | Secs. 3-2 and 3-3 |
| Bending stress Mc/I, bending in two planes | Sec. 3-10 |
| Transverse shear stress, maximum values by shape | Sec. 3-11, Table 3-2 |
| Torsional shear stress Tr/J | Sec. 3-12 |
| Beam deflection by integration and singularity functions | Secs. 4-4 to 4-6 |
| Span-to-depth ratio of 10 for neglecting shear deflection | Secs. 4-4 and 7-5 |
| Euler column formula and end-condition constants | Sec. 4-11, Eqs. (4-43), (4-44), Table 4-2 |
| Limiting slenderness ratio and J. B. Johnson formula | Sec. 4-12, Eqs. (4-45), (4-48) |
| Secant formula for eccentric loading | Sec. 4-13, Eqs. (4-53), (4-54) |
| von Mises stress and factor of safety, distortion-energy theory | Sec. 5-5, Eqs. (5-13) to (5-19) |
| Stress concentration, Kt and Kts | Sec. 3-13; Table A-15, Figures A-15-1 to A-15-9 and A-15-13 to A-15-15 |
| Elastic constants E, G and Poisson's ratio | Table A-5 |
| Tensile and yield strengths of AISI 1006 to 1050 steels, HR and CD | Table A-20 |

Table A-20 lists estimated ASTM minimum values for bar 18 to 32 mm in size;
Shigley's source is the 1986 SAE Handbook, p. 2.15.

The Table A-15 charts are reproduced in Shigley from R. E. Peterson, "Design
Factors for Stress Concentration", *Machine Design*, vol. 23, 1951. The
calculator does not use curve-fit equations for them. `tools/extract_kt_charts.py`
reads the curves themselves out of the book's PDF, where they are stored as
vector paths, and writes them as numbers to `src/kt/chartdata.js`. The PDF is
not part of this repository.

Two things in the code go beyond the book and are noted where they occur:

- The torsion constant of a solid rectangle uses the exact Saint-Venant
  series, and the transverse shear stress of the I-beam and rectangular tube
  uses VQ/It for the idealised shape, where Table 3-2 gives the simpler
  V/A_web estimate.
- The secant formula is derived in the book for rounded ends. For other end
  conditions the calculator uses the effective length l/sqrt(C).
