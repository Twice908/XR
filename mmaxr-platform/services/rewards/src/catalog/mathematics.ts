import type { CardSeed, Rarity } from './types';

/** id, symbol, name, meaning, rarity, fact, lessons */
const SYMBOLS: [string, string, string, string, Rarity, string, string[]][] = [
  ['plus-minus', '±', 'Plus-minus', 'one value plus or minus another', 'common', 'Used to show measurement uncertainty, like 9.8 ± 0.1 m/s².', ['physics-fundamentals']],
  ['approx', '≈', 'Approximately equal', 'close in value to', 'common', 'Scientists use it whenever a value is rounded.', ['physics-fundamentals']],
  ['proportional', '∝', 'Proportional to', 'changes in step with', 'common', 'F ∝ a means doubling acceleration doubles the force.', ['physics-motion', 'physics-electricity']],
  ['delta', 'Δ', 'Delta', 'change in a quantity', 'common', 'Δv means final velocity minus initial velocity.', ['physics-motion']],
  ['sqrt', '√', 'Square root', 'the number that squared gives the value', 'common', 'The symbol may come from a stretched letter r, for radix.', ['physics-fundamentals']],
  ['pi', 'π', 'Pi', 'ratio of a circle\'s circumference to its diameter', 'rare', 'π has been computed to over 100 trillion digits.', ['physics-light', 'physics-sound']],
  ['theta', 'θ', 'Theta', 'an angle', 'rare', 'Angles of incidence and reflection are usually written θᵢ and θᵣ.', ['physics-light']],
  ['lambda', 'λ', 'Lambda', 'wavelength', 'rare', 'Visible light has λ between about 380 and 750 nm.', ['physics-sound', 'physics-light', 'physics-101']],
  ['sigma', 'Σ', 'Sigma (sum)', 'add up a series of terms', 'rare', 'Σ is the Greek capital S, for "sum".', ['physics-electricity']],
  ['infinity', '∞', 'Infinity', 'without any bound', 'rare', 'A plane mirror behaves like a curved mirror with infinite radius.', ['physics-light']],
  ['therefore', '∴', 'Therefore', 'so it follows that', 'common', 'Three dots in a triangle end a line of reasoning.', []],
  ['integral', '∫', 'Integral', 'add up infinitely many tiny pieces', 'epic', 'Leibniz drew it as a long S for "summa".', ['physics-motion']],
  ['nabla', '∇', 'Nabla', 'rate of change in every direction', 'epic', 'Named after a Phoenician harp it resembles.', ['physics-magnetism']],
  ['euler', 'e', "Euler's number", 'the base of natural growth, about 2.718', 'epic', 'Compound interest taken to the limit gives e.', []],
  ['aleph', 'ℵ₀', 'Aleph-null', 'the size of the set of counting numbers', 'legendary', 'There are bigger infinities than this one.', []],
];

export const SYMBOL_CARDS: CardSeed[] = SYMBOLS.map(([id, symbol, name, meaning, rarity, fact, lessons], i) => ({
  id: `math-sym-${id}`,
  subject: 'mathematics',
  set: 'symbols',
  rarity,
  title: name,
  subtitle: symbol,
  order: i + 1,
  data: { symbol, meaning },
  funFact: fact,
  quizField: 'meaning',
  lessons,
}));

/** id, name, rule, example, rarity, lessons */
const POWERS: [string, string, string, string, Rarity, string[]][] = [
  ['product', 'Product of powers', 'aᵐ × aⁿ = aᵐ⁺ⁿ', '2³ × 2² = 2⁵ = 32', 'common', ['physics-fundamentals']],
  ['quotient', 'Quotient of powers', 'aᵐ ÷ aⁿ = aᵐ⁻ⁿ', '10⁶ ÷ 10² = 10⁴', 'common', ['physics-fundamentals']],
  ['power-of-power', 'Power of a power', '(aᵐ)ⁿ = aᵐⁿ', '(3²)³ = 3⁶ = 729', 'common', ['physics-fundamentals']],
  ['zero', 'Zero exponent', 'a⁰ = 1', '7⁰ = 1', 'common', []],
  ['negative', 'Negative exponent', 'a⁻ⁿ = 1 ÷ aⁿ', '10⁻³ = 0.001', 'rare', ['physics-electricity', 'physics-light']],
  ['fractional', 'Fractional exponent', 'a^(1/n) = ⁿ√a', '8^(1/3) = 2', 'rare', []],
  ['product-power', 'Power of a product', '(ab)ⁿ = aⁿbⁿ', '(2·5)² = 4·25 = 100', 'rare', []],
  ['sci-notation', 'Scientific notation', 'N = a × 10ⁿ, 1 ≤ a < 10', '299,792,458 ≈ 3.0 × 10⁸', 'rare', ['physics-light', 'atom-builder', 'physics-101']],
  ['squares', 'Perfect squares', 'n² = n × n', '12² = 144', 'common', ['physics-motion']],
  ['inverse-square', 'Inverse-square law', 'I ∝ 1 ÷ r²', 'Double the distance → a quarter of the intensity', 'epic', ['physics-light', 'physics-sound', 'physics-motion']],
  ['exp-growth', 'Exponential growth', 'N = N₀ × 2^(t/T)', 'Bacteria doubling every 20 minutes', 'epic', ['biology-101']],
  ['logarithm', 'Logarithm', 'log_b(x) = y ⇔ bʸ = x', 'pH = −log₁₀[H⁺]', 'legendary', ['chemistry-101', 'physics-sound']],
];

export const POWER_CARDS: CardSeed[] = POWERS.map(([id, name, rule, example, rarity, lessons], i) => ({
  id: `math-pow-${id}`,
  subject: 'mathematics',
  set: 'powers',
  rarity,
  title: name,
  subtitle: rule,
  order: i + 1,
  data: { rule, example },
  funFact: `Example: ${example}.`,
  quizField: 'example',
  lessons,
}));

/** id, name, formula, what it gives, rarity, lessons */
const FORMULAS: [string, string, string, string, Rarity, string[]][] = [
  ['rect-area', 'Area of a rectangle', 'A = l × w', 'the area of a rectangle', 'common', ['physics-fundamentals']],
  ['triangle-area', 'Area of a triangle', 'A = ½ × b × h', 'the area of a triangle', 'common', []],
  ['circle-area', 'Area of a circle', 'A = πr²', 'the area of a circle', 'common', ['physics-light']],
  ['circumference', 'Circumference', 'C = 2πr', 'the distance round a circle', 'common', []],
  ['cuboid-volume', 'Volume of a cuboid', 'V = l × w × h', 'the space inside a box', 'common', ['physics-fundamentals', 'matter-properties']],
  ['sphere-volume', 'Volume of a sphere', 'V = ⁴⁄₃πr³', 'the space inside a ball', 'rare', []],
  ['speed', 'Speed', 'v = d ÷ t', 'how fast something moves', 'common', ['physics-motion', 'physics-sound']],
  ['density', 'Density', 'ρ = m ÷ V', 'how much mass is packed in a volume', 'common', ['physics-fundamentals', 'matter-properties', 'metals-101']],
  ['newton2', "Newton's second law", 'F = m × a', 'the force needed to accelerate a mass', 'rare', ['physics-motion', 'simple-machines']],
  ['suvat1', 'First equation of motion', 'v = u + at', 'final velocity under steady acceleration', 'rare', ['physics-motion']],
  ['suvat2', 'Second equation of motion', 's = ut + ½at²', 'distance under steady acceleration', 'rare', ['physics-motion']],
  ['ohm', "Ohm's law", 'V = I × R', 'voltage across a resistor', 'rare', ['physics-electricity']],
  ['wave', 'Wave equation', 'v = f × λ', 'the speed of a wave', 'rare', ['physics-sound', 'physics-light']],
  ['mirror', 'Mirror formula', '1/f = 1/v + 1/u', 'where a mirror forms an image', 'epic', ['physics-light']],
  ['pythagoras', 'Pythagoras\' theorem', 'a² + b² = c²', 'the long side of a right-angled triangle', 'rare', []],
  ['quadratic', 'Quadratic formula', 'x = (−b ± √(b² − 4ac)) ÷ 2a', 'the roots of ax² + bx + c = 0', 'epic', []],
  ['kinetic', 'Kinetic energy', 'Eₖ = ½mv²', 'the energy of a moving mass', 'rare', ['physics-motion', 'physics-fundamentals']],
  ['gravitation', 'Universal gravitation', 'F = Gm₁m₂ ÷ r²', 'the pull between two masses', 'epic', ['physics-motion']],
  ['mass-energy', 'Mass–energy equivalence', 'E = mc²', 'the energy locked in a mass', 'legendary', ['physics-101']],
  ['euler-identity', "Euler's identity", 'e^(iπ) + 1 = 0', 'a link between five key numbers', 'legendary', []],
  ['ftc', 'Fundamental theorem of calculus', '∫ₐᵇ f′(x) dx = f(b) − f(a)', 'the link between slopes and areas', 'legendary', []],
];

export const FORMULA_CARDS: CardSeed[] = FORMULAS.map(([id, name, formula, gives, rarity, lessons], i) => ({
  id: `math-frm-${id}`,
  subject: 'mathematics',
  set: 'formulas',
  rarity,
  title: name,
  subtitle: formula,
  order: i + 1,
  data: { formula, gives },
  funFact: `${formula} gives ${gives}.`,
  quizField: 'gives',
  lessons,
}));
