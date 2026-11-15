// Material library. Every value is from Shigley's Mechanical Engineering
// Design, 11th ed. (Budynas and Nisbett):
//   Table A-5   physical constants: E, G, Poisson's ratio
//   Table A-20  deterministic ASTM minimum tensile and yield strengths for
//               hot-rolled (HR) and cold-drawn (CD) steels, 18 to 32 mm sizes
//               (Shigley's source: 1986 SAE Handbook, p. 2.15)
// SI values in Pa. Strengths are null where the book's tables give none;
// students can always type their own numbers.

const CARBON_STEEL = { E: 207e9, G: 79.3e9, nu: 0.292 };      // Table A-5, "Carbon steel"

// [AISI no., HR Sut, HR Sy, CD Sut, CD Sy] in MPa, Table A-20
const A20 = [
  ['1006', 300, 170, 330, 280],
  ['1010', 320, 180, 370, 300],
  ['1015', 340, 190, 390, 320],
  ['1018', 400, 220, 440, 370],
  ['1020', 380, 210, 470, 390],
  ['1030', 470, 260, 520, 440],
  ['1035', 500, 270, 550, 460],
  ['1040', 520, 290, 590, 490],
  ['1045', 570, 310, 630, 530],
  ['1050', 620, 340, 690, 580],
];

const steels = (process, iu, iy) => A20.map((row) => ({
  id: `aisi-${row[0]}-${process.toLowerCase()}`,
  name: `AISI ${row[0]} ${process}`,
  group: `Carbon steel, ${process === 'HR' ? 'hot-rolled' : 'cold-drawn'}`,
  ...CARBON_STEEL, Sut: row[iu] * 1e6, Sy: row[iy] * 1e6,
}));

// Table A-5 entries without tabulated strengths.
const generic = (id, name, Egpa, Ggpa, nu) => ({ id, name, group: 'Other metals (elastic constants only)', E: Egpa * 1e9, G: Ggpa * 1e9, nu, Sy: null, Sut: null });

export const MATERIALS = [
  ...steels('HR', 1, 2),
  ...steels('CD', 3, 4),
  generic('aluminum', 'Aluminum (all alloys)', 71.7, 26.9, 0.333),
  generic('stainless-18-8', 'Stainless steel (18-8)', 190, 73.1, 0.305),
  generic('titanium', 'Titanium alloys', 114, 42.4, 0.340),
  generic('brass', 'Brass', 106, 40.1, 0.324),
  generic('copper', 'Copper', 119, 44.7, 0.326),
  generic('cast-iron-gray', 'Cast iron (gray)', 100, 41.4, 0.211),
  generic('magnesium', 'Magnesium', 44.8, 16.5, 0.350),
  { id: 'custom', name: 'Custom', group: null, E: null, G: null, nu: null, Sy: null, Sut: null },
];

export const DEFAULT_MATERIAL = 'aisi-1020-hr';
export const MATERIAL_SOURCE = "Shigley's Mechanical Engineering Design, 11th ed., Tables A-5 and A-20";
