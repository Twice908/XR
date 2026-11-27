import type { CardSeed, Rarity } from './types';

const ALL_PHYSICS = ['physics-fundamentals', 'physics-motion', 'physics-electricity', 'physics-magnetism', 'physics-light', 'physics-sound', 'simple-machines', 'physics-101'];

/** id, quantity, SI unit name, symbol, rarity, fact, lessons */
const BASE: [string, string, string, string, Rarity, string, string[]][] = [
  ['length', 'Length', 'metre', 'm', 'epic', 'The metre is the distance light travels in a vacuum in 1/299,792,458 of a second.', ALL_PHYSICS],
  ['mass', 'Mass', 'kilogram', 'kg', 'epic', 'Since 20 May 2019 the kilogram is defined by fixing the Planck constant, replacing a platinum-iridium cylinder kept at the BIPM in Sèvres, near Paris.', ['physics-fundamentals', 'physics-motion', 'simple-machines']],
  ['time', 'Time', 'second', 's', 'epic', 'One second is 9,192,631,770 periods of the radiation given out by caesium-133 atoms as they switch between two energy levels.', ALL_PHYSICS],
  ['current', 'Electric current', 'ampere', 'A', 'epic', 'One ampere is about 6.24 × 10¹⁸ electrons passing a point each second; each carries exactly 1.602176634 × 10⁻¹⁹ coulombs.', ['physics-electricity', 'physics-magnetism']],
  ['temperature', 'Thermodynamic temperature', 'kelvin', 'K', 'epic', '0 K is absolute zero, exactly −273.15 °C: nothing can be colder.', ['physics-fundamentals', 'matter-properties']],
  ['amount', 'Amount of substance', 'mole', 'mol', 'legendary', 'One mole is exactly 6.02214076 × 10²³ particles, fixed in 2019.', ['atom-builder', 'chemistry-101']],
  ['luminous', 'Luminous intensity', 'candela', 'cd', 'legendary', 'A common wax candle gives off roughly one candela, and candela is Latin for candle.', ['physics-light']],
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


/** Fun facts for the derived quantities, each checked against a published source (see the physics card reference). */
const DERIVED_FACTS: Record<string, string> = {
  area: "FIFA's recommended football pitch is 105 m × 68 m, about 7,140 m².",
  volume: "One cubic metre holds exactly 1,000 litres: since 1964 a litre is defined as one cubic decimetre.",
  density: "Water is about 1,000 kg/m³ and gold about 19,300 kg/m³, so gold is roughly 19 times denser than water.",
  speed: "Sound travels at about 343 m/s through dry air at 20 °C.",
  acceleration: "Standard gravity is defined as exactly 9.80665 m/s²: a falling object gains about 9.8 m/s of speed every second.",
  frequency: "India's mains electricity alternates at 50 Hz: the current changes direction 100 times a second.",
  force: "A 100 g apple weighs about 1 newton on Earth (0.1 kg × 9.81 m/s² ≈ 0.98 N).",
  momentum: "A men's cricket ball weighs 155.9–163 g; bowled at 40 m/s (144 km/h) it carries about 6.4 kg·m/s of momentum.",
  pressure: "One standard atmosphere is exactly 101,325 Pa, about the air pressure at sea level.",
  energy: "One food Calorie (a kilocalorie) is 4,184 joules.",
  power: "One mechanical horsepower is about 745.7 watts.",
  charge: "Since 2019 the charge on one electron is fixed at exactly 1.602176634 × 10⁻¹⁹ C.",
  voltage: "Household sockets in India supply 230 volts.",
  resistance: "Georg Ohm published his law in 1827, in a book called Die galvanische Kette. It was poorly received at first.",
  torque: "Torque and energy share the same base units, but torque is always written in N·m, never joules, so the two are not confused.",
  capacitance: "One farad is enormous: everyday capacitors are rated in microfarads or picofarads. The unit honours Michael Faraday.",
  'flux-density': "Earth's magnetic field is 25–65 microtesla; a 1.5 T hospital MRI scanner is about 30,000 times stronger.",
  flux: "The weber honours Wilhelm Weber, who with Carl Friedrich Gauss built an electromagnetic telegraph in Göttingen in 1833.",
  inductance: "Joseph Henry discovered self-inductance while building electromagnets; the unit was named after him in 1893.",
  'power-of-lens': "A lens with a 0.5 m focal length has a power of +2 dioptres. The dioptre is a non-SI name for one reciprocal metre (m⁻¹).",
};

export const DERIVED_CARDS: CardSeed[] = DERIVED.map(([id, q, unit, unitName, definedAs, baseUnits, rarity, lessons], i) => ({
  id: `phys-der-${id}`,
  subject: 'physics',
  set: 'derived-quantities',
  rarity,
  title: q,
  subtitle: unit,
  order: i + 1,
  // The dioptre is a non-SI name for m⁻¹, so it is not labelled an SI derived unit.
  data: { unit, unitName, definedAs, baseUnits, kind: id === 'power-of-lens' ? 'unit of optical power' : 'SI derived quantity' },
  funFact: DERIVED_FACTS[id],
  quizField: 'definedAs',
  lessons,
}));
