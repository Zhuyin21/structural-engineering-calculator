// Typical room-temperature elastic constants, as tabulated in mechanics of
// materials textbooks. E and G in Pa. Students can always type their own.
export const MATERIALS = [
  { id: 'steel', name: 'Steel (structural)', E: 200e9, G: 77e9 },
  { id: 'stainless', name: 'Stainless steel 304', E: 193e9, G: 75e9 },
  { id: 'aluminum', name: 'Aluminum 6061-T6', E: 68.9e9, G: 26e9 },
  { id: 'titanium', name: 'Titanium Ti-6Al-4V', E: 114e9, G: 44e9 },
  { id: 'custom', name: 'Custom', E: null, G: null },
];
