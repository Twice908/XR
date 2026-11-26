import type { CardSeed, Rarity } from './types';

const ALL_PHYSICS = ['physics-fundamentals', 'physics-motion', 'physics-electricity', 'physics-magnetism', 'physics-light', 'physics-sound', 'simple-machines', 'physics-101'];

/** id, quantity, SI unit name, symbol, rarity, fact, lessons */
const BASE: [string, string, string, string, Rarity, string, string[]][] = [
  ['length', 'Length', 'metre', 'm', 'epic', 'The metre is defined by how far light travels in 1/299,792,458 of a second.', ALL_PHYSICS],
  ['mass', 'Mass', 'kilogram', 'kg', 'epic', 'Since 2019 the kilogram is defined through the Planck constant, not a metal cylinder in Paris.', ['physics-fundamentals', 'physics-motion', 'simple-machines']],
  ['time', 'Time', 'second', 's', 'epic', 'A second is 9,192,631,770 oscillations of a caesium-133 atom.', ALL_PHYSICS],
  ['current', 'Electric current', 'ampere', 'A', 'epic', 'One ampere is about 6.24 × 10¹⁸ electrons passing a point each second.', ['physics-electricity', 'physics-magnetism']],
  ['temperature', 'Thermodynamic temperature', 'kelvin', 'K', 'epic', '0 K is absolute zero: −273.15 °C.', ['physics-fundamentals', 'matter-properties']],
  ['amount', 'Amount of substance', 'mole', 'mol', 'legendary', 'One mole is exactly 6.02214076 × 10²³ particles.', ['atom-builder', 'chemistry-101']],
  ['luminous', 'Luminous intensity', 'candela', 'cd', 'legendary', 'A common candle gives off roughly one candela.', ['physics-light']],
];

export const FUNDAMENTAL_CARDS: CardSeed[] = BASE.map(([id, q, unitName, unit, rarity, fact, lessons], i) => ({
  id: `phys-base-${id}`,
  subject: 'physics',
  set: 'fundamental-quantities',
  rarity,
  title: q,
  subtitle: unit,
  order: i + 1,
  data: { unit, unitName, kind: 'SI base quantity' },
  funFact: fact,
  quizField: 'unitName',
  lessons,
}));

/** id, quantity, unit symbol, unit name, defined as, in base units, rarity, lessons */
const DERIVED: [string, string, string, string, string, string, Rarity, string[]][] = [
  ['area', 'Area', 'm²', 'square metre', 'length × length', 'm²', 'common', ['physics-fundamentals']],
  ['volume', 'Volume', 'm³', 'cubic metre', 'length × length × length', 'm³', 'common', ['physics-fundamentals', 'matter-properties']],
  ['density', 'Density', 'kg/m³', 'kilogram per cubic metre', 'mass ÷ volume', 'kg·m⁻³', 'common', ['physics-fundamentals', 'matter-properties', 'metals-101']],
  ['speed', 'Speed', 'm/s', 'metre per second', 'distance ÷ time', 'm·s⁻¹', 'common', ['physics-motion', 'physics-sound']],
  ['acceleration', 'Acceleration', 'm/s²', 'metre per second squared', 'change in velocity ÷ time', 'm·s⁻²', 'common', ['physics-motion']],
  ['frequency', 'Frequency', 'Hz', 'hertz', 'cycles ÷ time', 's⁻¹', 'common', ['physics-sound', 'physics-101']],
  ['force', 'Force', 'N', 'newton', 'mass × acceleration', 'kg·m·s⁻²', 'rare', ['physics-motion', 'physics-fundamentals', 'simple-machines']],
  ['momentum', 'Momentum', 'kg·m/s', 'kilogram metre per second', 'mass × velocity', 'kg·m·s⁻¹', 'rare', ['physics-motion']],
  ['pressure', 'Pressure', 'Pa', 'pascal', 'force ÷ area', 'kg·m⁻¹·s⁻²', 'rare', ['physics-fundamentals', 'matter-properties']],
  ['energy', 'Energy', 'J', 'joule', 'force × distance', 'kg·m²·s⁻²', 'rare', ['physics-fundamentals', 'simple-machines', 'physics-101']],
  ['power', 'Power', 'W', 'watt', 'energy ÷ time', 'kg·m²·s⁻³', 'rare', ['physics-electricity', 'simple-machines']],
  ['charge', 'Electric charge', 'C', 'coulomb', 'current × time', 'A·s', 'rare', ['physics-electricity']],
  ['voltage', 'Potential difference', 'V', 'volt', 'energy ÷ charge', 'kg·m²·s⁻³·A⁻¹', 'rare', ['physics-electricity']],
  ['resistance', 'Resistance', 'Ω', 'ohm', 'potential difference ÷ current', 'kg·m²·s⁻³·A⁻²', 'rare', ['physics-electricity']],
  ['torque', 'Torque', 'N·m', 'newton metre', 'force × perpendicular distance', 'kg·m²·s⁻²', 'epic', ['simple-machines']],
  ['capacitance', 'Capacitance', 'F', 'farad', 'charge ÷ potential difference', 'kg⁻¹·m⁻²·s⁴·A²', 'epic', ['physics-electricity']],
  ['flux-density', 'Magnetic flux density', 'T', 'tesla', 'force ÷ (current × length)', 'kg·s⁻²·A⁻¹', 'epic', ['physics-magnetism']],
  ['flux', 'Magnetic flux', 'Wb', 'weber', 'flux density × area', 'kg·m²·s⁻²·A⁻¹', 'epic', ['physics-magnetism']],
  ['inductance', 'Inductance', 'H', 'henry', 'magnetic flux ÷ current', 'kg·m²·s⁻²·A⁻²', 'legendary', ['physics-magnetism', 'physics-electricity']],
  ['power-of-lens', 'Optical power', 'D', 'dioptre', '1 ÷ focal length', 'm⁻¹', 'epic', ['physics-light']],
];

export const DERIVED_CARDS: CardSeed[] = DERIVED.map(([id, q, unit, unitName, definedAs, baseUnits, rarity, lessons], i) => ({
  id: `phys-der-${id}`,
  subject: 'physics',
  set: 'derived-quantities',
  rarity,
  title: q,
  subtitle: unit,
  order: i + 1,
  data: { unit, unitName, definedAs, baseUnits, kind: 'SI derived quantity' },
  funFact: `${q} is ${definedAs}, so in base units it is ${baseUnits}.`,
  quizField: 'definedAs',
  lessons,
}));
