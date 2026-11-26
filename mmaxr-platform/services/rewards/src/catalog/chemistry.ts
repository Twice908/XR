import type { CardSeed, Rarity } from './types';

type Category =
  | 'alkali metal'
  | 'alkaline earth metal'
  | 'transition metal'
  | 'post-transition metal'
  | 'metalloid'
  | 'nonmetal'
  | 'halogen'
  | 'noble gas'
  | 'lanthanide'
  | 'actinide';

const C: Record<string, Category> = {
  A: 'alkali metal', E: 'alkaline earth metal', T: 'transition metal', P: 'post-transition metal', M: 'metalloid',
  N: 'nonmetal', H: 'halogen', G: 'noble gas', L: 'lanthanide', X: 'actinide',
};

/** Z, symbol, name, standard atomic weight (rounded; mass number of the longest-lived isotope for synthetic elements), category code. */
const ELEMENTS: [number, string, string, number, string][] = [
  [1, 'H', 'Hydrogen', 1.008, 'N'], [2, 'He', 'Helium', 4.0026, 'G'], [3, 'Li', 'Lithium', 6.94, 'A'], [4, 'Be', 'Beryllium', 9.0122, 'E'],
  [5, 'B', 'Boron', 10.81, 'M'], [6, 'C', 'Carbon', 12.011, 'N'], [7, 'N', 'Nitrogen', 14.007, 'N'], [8, 'O', 'Oxygen', 15.999, 'N'],
  [9, 'F', 'Fluorine', 18.998, 'H'], [10, 'Ne', 'Neon', 20.180, 'G'], [11, 'Na', 'Sodium', 22.990, 'A'], [12, 'Mg', 'Magnesium', 24.305, 'E'],
  [13, 'Al', 'Aluminium', 26.982, 'P'], [14, 'Si', 'Silicon', 28.085, 'M'], [15, 'P', 'Phosphorus', 30.974, 'N'], [16, 'S', 'Sulfur', 32.06, 'N'],
  [17, 'Cl', 'Chlorine', 35.45, 'H'], [18, 'Ar', 'Argon', 39.948, 'G'], [19, 'K', 'Potassium', 39.098, 'A'], [20, 'Ca', 'Calcium', 40.078, 'E'],
  [21, 'Sc', 'Scandium', 44.956, 'T'], [22, 'Ti', 'Titanium', 47.867, 'T'], [23, 'V', 'Vanadium', 50.942, 'T'], [24, 'Cr', 'Chromium', 51.996, 'T'],
  [25, 'Mn', 'Manganese', 54.938, 'T'], [26, 'Fe', 'Iron', 55.845, 'T'], [27, 'Co', 'Cobalt', 58.933, 'T'], [28, 'Ni', 'Nickel', 58.693, 'T'],
  [29, 'Cu', 'Copper', 63.546, 'T'], [30, 'Zn', 'Zinc', 65.38, 'T'], [31, 'Ga', 'Gallium', 69.723, 'P'], [32, 'Ge', 'Germanium', 72.630, 'M'],
  [33, 'As', 'Arsenic', 74.922, 'M'], [34, 'Se', 'Selenium', 78.971, 'N'], [35, 'Br', 'Bromine', 79.904, 'H'], [36, 'Kr', 'Krypton', 83.798, 'G'],
  [37, 'Rb', 'Rubidium', 85.468, 'A'], [38, 'Sr', 'Strontium', 87.62, 'E'], [39, 'Y', 'Yttrium', 88.906, 'T'], [40, 'Zr', 'Zirconium', 91.224, 'T'],
  [41, 'Nb', 'Niobium', 92.906, 'T'], [42, 'Mo', 'Molybdenum', 95.95, 'T'], [43, 'Tc', 'Technetium', 98, 'T'], [44, 'Ru', 'Ruthenium', 101.07, 'T'],
  [45, 'Rh', 'Rhodium', 102.91, 'T'], [46, 'Pd', 'Palladium', 106.42, 'T'], [47, 'Ag', 'Silver', 107.87, 'T'], [48, 'Cd', 'Cadmium', 112.41, 'T'],
  [49, 'In', 'Indium', 114.82, 'P'], [50, 'Sn', 'Tin', 118.71, 'P'], [51, 'Sb', 'Antimony', 121.76, 'M'], [52, 'Te', 'Tellurium', 127.60, 'M'],
  [53, 'I', 'Iodine', 126.90, 'H'], [54, 'Xe', 'Xenon', 131.29, 'G'], [55, 'Cs', 'Caesium', 132.91, 'A'], [56, 'Ba', 'Barium', 137.33, 'E'],
  [57, 'La', 'Lanthanum', 138.91, 'L'], [58, 'Ce', 'Cerium', 140.12, 'L'], [59, 'Pr', 'Praseodymium', 140.91, 'L'], [60, 'Nd', 'Neodymium', 144.24, 'L'],
  [61, 'Pm', 'Promethium', 145, 'L'], [62, 'Sm', 'Samarium', 150.36, 'L'], [63, 'Eu', 'Europium', 151.96, 'L'], [64, 'Gd', 'Gadolinium', 157.25, 'L'],
  [65, 'Tb', 'Terbium', 158.93, 'L'], [66, 'Dy', 'Dysprosium', 162.50, 'L'], [67, 'Ho', 'Holmium', 164.93, 'L'], [68, 'Er', 'Erbium', 167.26, 'L'],
  [69, 'Tm', 'Thulium', 168.93, 'L'], [70, 'Yb', 'Ytterbium', 173.05, 'L'], [71, 'Lu', 'Lutetium', 174.97, 'L'], [72, 'Hf', 'Hafnium', 178.49, 'T'],
  [73, 'Ta', 'Tantalum', 180.95, 'T'], [74, 'W', 'Tungsten', 183.84, 'T'], [75, 'Re', 'Rhenium', 186.21, 'T'], [76, 'Os', 'Osmium', 190.23, 'T'],
  [77, 'Ir', 'Iridium', 192.22, 'T'], [78, 'Pt', 'Platinum', 195.08, 'T'], [79, 'Au', 'Gold', 196.97, 'T'], [80, 'Hg', 'Mercury', 200.59, 'T'],
  [81, 'Tl', 'Thallium', 204.38, 'P'], [82, 'Pb', 'Lead', 207.2, 'P'], [83, 'Bi', 'Bismuth', 208.98, 'P'], [84, 'Po', 'Polonium', 209, 'P'],
  [85, 'At', 'Astatine', 210, 'H'], [86, 'Rn', 'Radon', 222, 'G'], [87, 'Fr', 'Francium', 223, 'A'], [88, 'Ra', 'Radium', 226, 'E'],
  [89, 'Ac', 'Actinium', 227, 'X'], [90, 'Th', 'Thorium', 232.04, 'X'], [91, 'Pa', 'Protactinium', 231.04, 'X'], [92, 'U', 'Uranium', 238.03, 'X'],
  [93, 'Np', 'Neptunium', 237, 'X'], [94, 'Pu', 'Plutonium', 244, 'X'], [95, 'Am', 'Americium', 243, 'X'], [96, 'Cm', 'Curium', 247, 'X'],
  [97, 'Bk', 'Berkelium', 247, 'X'], [98, 'Cf', 'Californium', 251, 'X'], [99, 'Es', 'Einsteinium', 252, 'X'], [100, 'Fm', 'Fermium', 257, 'X'],
  [101, 'Md', 'Mendelevium', 258, 'X'], [102, 'No', 'Nobelium', 259, 'X'], [103, 'Lr', 'Lawrencium', 266, 'X'], [104, 'Rf', 'Rutherfordium', 267, 'T'],
  [105, 'Db', 'Dubnium', 268, 'T'], [106, 'Sg', 'Seaborgium', 269, 'T'], [107, 'Bh', 'Bohrium', 270, 'T'], [108, 'Hs', 'Hassium', 277, 'T'],
  [109, 'Mt', 'Meitnerium', 278, 'T'], [110, 'Ds', 'Darmstadtium', 281, 'T'], [111, 'Rg', 'Roentgenium', 282, 'T'], [112, 'Cn', 'Copernicium', 285, 'T'],
  [113, 'Nh', 'Nihonium', 286, 'P'], [114, 'Fl', 'Flerovium', 289, 'P'], [115, 'Mc', 'Moscovium', 290, 'P'], [116, 'Lv', 'Livermorium', 293, 'P'],
  [117, 'Ts', 'Tennessine', 294, 'H'], [118, 'Og', 'Oganesson', 294, 'G'],
];

/** Group (1-18) for the periodic-table layout; lanthanides and actinides are shown in their own rows (group 3 slot). */
export function groupOf(z: number): number {
  if (z === 1) return 1;
  if (z === 2) return 18;
  if (z <= 10) return z <= 4 ? z - 2 : z + 8;
  if (z <= 18) return z <= 12 ? z - 10 : z;
  if (z <= 36) return z - 18;
  if (z <= 54) return z - 36;
  if (z <= 56 || (z >= 87 && z <= 88)) return z <= 56 ? z - 54 : z - 86;
  if ((z >= 57 && z <= 71) || (z >= 89 && z <= 103)) return 3;
  return z <= 86 ? z - 68 : z - 100;
}

function periodOf(z: number): number {
  return z <= 2 ? 1 : z <= 10 ? 2 : z <= 18 ? 3 : z <= 36 ? 4 : z <= 54 ? 5 : z <= 86 ? 6 : 7;
}

function elementRarity(z: number, cat: Category): Rarity {
  if (z >= 104) return 'legendary';
  if (cat === 'noble gas' || cat === 'lanthanide' || cat === 'actinide') return 'epic';
  if (cat === 'transition metal') return 'rare';
  return 'common';
}

const FUN_FACTS: Record<string, string> = {
  H: 'About three quarters of the ordinary matter in the universe is hydrogen.',
  He: 'Helium was found in the Sun\'s spectrum in 1868, decades before it was found on Earth.',
  C: 'Diamond and graphite are both pure carbon: only the arrangement of the atoms differs.',
  N: 'Nitrogen makes up about 78% of the air you breathe.',
  O: 'Oxygen is the most abundant element in the Earth\'s crust by mass.',
  Na: 'Sodium is soft enough to cut with a knife and reacts vigorously with water.',
  Cl: 'Chlorine is a toxic gas, yet bonded to sodium it becomes table salt.',
  Fe: 'Iron in haemoglobin carries oxygen around your body.',
  Au: 'Gold is so malleable that one gram can be beaten into a sheet about a square metre in size.',
  Hg: 'Mercury is the only metal that is liquid at room temperature.',
  Si: 'Silicon is the base of almost every computer chip.',
  Ca: 'Your bones and teeth hold about a kilogram of calcium.',
  Ne: 'Neon signs glow red-orange; other colours come from other gases or coated tubes.',
  U: 'One kilogram of uranium-235 can release about as much energy as burning 2,700 tonnes of coal.',
  Og: 'Only a handful of oganesson atoms have ever been made, each lasting under a millisecond.',
};

const IONIC = new Set(['Li', 'Na', 'K', 'Rb', 'Cs', 'Be', 'Mg', 'Ca', 'Sr', 'Ba', 'F', 'Cl', 'Br', 'I', 'O', 'S', 'N', 'Al']);
const INDICATORS = new Set(['H', 'O', 'Na', 'Cl', 'C', 'S', 'N', 'K', 'Ca']);

function elementLessons(z: number, sym: string, cat: Category): string[] {
  const out: string[] = [];
  if (z <= 20) out.push('atom-builder', 'physics-101');
  if (IONIC.has(sym)) out.push('ionic-bonding');
  if (INDICATORS.has(sym)) out.push('chemistry-101');
  if (cat.includes('metal') || cat === 'metalloid' || ['C', 'S', 'O', 'P', 'N', 'H'].includes(sym)) out.push('metals-101');
  if (z <= 20 || ['Fe', 'Cu', 'Ag', 'Au', 'Hg'].includes(sym)) out.push('matter-properties');
  return out;
}

export const ELEMENT_CARDS: CardSeed[] = ELEMENTS.map(([z, sym, name, mass, code]) => {
  const category = C[code];
  return {
    id: `chem-el-${sym}`,
    subject: 'chemistry',
    set: 'elements',
    rarity: elementRarity(z, category),
    title: name,
    subtitle: sym,
    order: z,
    data: { symbol: sym, atomicNumber: z, atomicMass: mass, category, group: groupOf(z), period: periodOf(z), protons: z, electrons: z },
    funFact: FUN_FACTS[sym] ?? `${name} has ${z} proton${z === 1 ? '' : 's'} in its nucleus and sits in period ${periodOf(z)}.`,
    quizField: 'category',
    lessons: elementLessons(z, sym, category),
  };
});

/** id, name, formula, kind, rarity, use, lessons */
const COMPOUNDS: [string, string, string, string, Rarity, string, string[]][] = [
  ['water', 'Water', 'H₂O', 'covalent', 'common', 'Universal solvent; covers about 71% of Earth\'s surface.', ['chemistry-101', 'matter-properties']],
  ['salt', 'Sodium chloride', 'NaCl', 'ionic', 'common', 'Table salt: a lattice of Na⁺ and Cl⁻ ions.', ['ionic-bonding', 'chemistry-101']],
  ['co2', 'Carbon dioxide', 'CO₂', 'covalent', 'common', 'Plants turn it into sugar during photosynthesis.', ['matter-properties', 'cell-explorer']],
  ['o2', 'Oxygen gas', 'O₂', 'covalent', 'common', 'Released by photosynthesis; used in respiration.', ['biology-respiratory', 'cell-explorer']],
  ['ammonia', 'Ammonia', 'NH₃', 'covalent', 'common', 'A weak base used to make fertilisers.', ['chemistry-101']],
  ['methane', 'Methane', 'CH₄', 'covalent', 'common', 'The main component of natural gas.', ['matter-properties']],
  ['hcl', 'Hydrochloric acid', 'HCl', 'covalent', 'common', 'Your stomach makes it to digest food.', ['chemistry-101', 'biology-101']],
  ['naoh', 'Sodium hydroxide', 'NaOH', 'ionic', 'common', 'A strong base used in soap making.', ['chemistry-101', 'ionic-bonding']],
  ['caco3', 'Calcium carbonate', 'CaCO₃', 'ionic', 'common', 'Chalk, limestone, marble and seashells.', ['chemistry-101', 'ionic-bonding']],
  ['mgo', 'Magnesium oxide', 'MgO', 'ionic', 'common', 'Forms with a brilliant white flame when magnesium burns.', ['ionic-bonding', 'metals-101']],
  ['kcl', 'Potassium chloride', 'KCl', 'ionic', 'common', 'Used as a salt substitute and fertiliser.', ['ionic-bonding']],
  ['h2so4', 'Sulfuric acid', 'H₂SO₄', 'covalent', 'rare', 'The most produced industrial chemical in the world.', ['chemistry-101']],
  ['hno3', 'Nitric acid', 'HNO₃', 'covalent', 'rare', 'Used to make fertilisers and explosives.', ['chemistry-101']],
  ['nahco3', 'Sodium bicarbonate', 'NaHCO₃', 'ionic', 'rare', 'Baking soda: releases CO₂ that makes cakes rise.', ['chemistry-101', 'ionic-bonding']],
  ['cacl2', 'Calcium chloride', 'CaCl₂', 'ionic', 'rare', 'Spread on roads to melt ice.', ['ionic-bonding']],
  ['mgcl2', 'Magnesium chloride', 'MgCl₂', 'ionic', 'rare', 'Found in sea water; a source of magnesium metal.', ['ionic-bonding']],
  ['fe2o3', 'Iron(III) oxide', 'Fe₂O₃', 'ionic', 'rare', 'Rust: what iron becomes in moist air.', ['metals-101']],
  ['cuso4', 'Copper(II) sulfate', 'CuSO₄', 'ionic', 'rare', 'Its hydrated crystals are a striking blue.', ['metals-101']],
  ['glucose', 'Glucose', 'C₆H₁₂O₆', 'covalent', 'rare', 'The sugar cells burn for energy.', ['cell-explorer', 'biology-101']],
  ['ethanol', 'Ethanol', 'C₂H₅OH', 'covalent', 'rare', 'A fuel and a solvent.', ['matter-properties']],
  ['al2o3', 'Aluminium oxide', 'Al₂O₃', 'ionic', 'rare', 'Rubies and sapphires are this, with trace metals added.', ['ionic-bonding', 'metals-101']],
  ['lif', 'Lithium fluoride', 'LiF', 'ionic', 'rare', 'Transparent to ultraviolet light; used in UV optics.', ['ionic-bonding']],
  ['nh4cl', 'Ammonium chloride', 'NH₄Cl', 'ionic', 'epic', 'An ionic compound with no metal atom in it.', ['ionic-bonding', 'chemistry-101']],
  ['ozone', 'Ozone', 'O₃', 'covalent', 'epic', 'High in the atmosphere it shields life from UV rays.', ['matter-properties']],
  ['chlorophyll', 'Chlorophyll a', 'C₅₅H₇₂O₅N₄Mg', 'covalent', 'epic', 'The green pigment that captures sunlight in chloroplasts.', ['cell-explorer']],
  ['atp', 'Adenosine triphosphate', 'C₁₀H₁₆N₅O₁₃P₃', 'covalent', 'epic', 'The energy currency made in mitochondria.', ['cell-explorer', 'biology-respiratory']],
  ['haemoglobin', 'Haem group', 'C₃₄H₃₂FeN₄O₄', 'covalent', 'epic', 'The iron-holding part of haemoglobin that binds oxygen.', ['biology-respiratory']],
  ['ybco', 'YBCO superconductor', 'YBa₂Cu₃O₇', 'ionic', 'legendary', 'Superconducts above the boiling point of liquid nitrogen.', ['physics-electricity', 'physics-magnetism']],
  ['dna', 'DNA nucleotide', 'C₁₀H₁₄N₅O₇P', 'covalent', 'legendary', 'Four kinds of these, repeated billions of times, spell your genome.', ['cell-explorer']],
  ['c60', 'Buckminsterfullerene', 'C₆₀', 'covalent', 'legendary', 'A football-shaped molecule of 60 carbon atoms.', ['atom-builder', 'matter-properties']],
];

export const COMPOUND_CARDS: CardSeed[] = COMPOUNDS.map(([id, name, formula, kind, rarity, use, lessons], i) => ({
  id: `chem-cp-${id}`,
  subject: 'chemistry',
  set: 'compounds',
  rarity,
  title: name,
  subtitle: formula,
  order: i + 1,
  data: { formula, bondType: kind },
  funFact: use,
  quizField: 'bondType',
  lessons,
}));
