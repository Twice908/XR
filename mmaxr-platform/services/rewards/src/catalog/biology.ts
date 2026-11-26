import type { CardSeed, Rarity } from './types';

/** id, name, found in, job, rarity, fact, lessons */
const CELLS: [string, string, string, string, Rarity, string, string[]][] = [
  ['animal', 'Animal cell', 'animals', 'the basic unit of animal life', 'common', 'Animal cells have no cell wall, so they can take many shapes.', ['cell-explorer']],
  ['plant', 'Plant cell', 'plants', 'the basic unit of plant life', 'common', 'A rigid cell wall and a large vacuole keep plant cells firm.', ['cell-explorer']],
  ['rbc', 'Red blood cell', 'blood', 'carrying oxygen', 'common', 'Mature human red blood cells have no nucleus, leaving room for haemoglobin.', ['biology-respiratory']],
  ['wbc', 'White blood cell', 'blood', 'fighting infection', 'common', 'Some white blood cells swallow bacteria whole.', ['biology-respiratory']],
  ['epithelial', 'Epithelial cell', 'skin and gut lining', 'lining and protecting surfaces', 'common', 'Your gut lining replaces itself every few days.', ['biology-101']],
  ['root-hair', 'Root hair cell', 'plant roots', 'absorbing water and minerals', 'common', 'Its long extension greatly increases surface area.', ['cell-explorer']],
  ['palisade', 'Palisade cell', 'leaves', 'photosynthesis', 'rare', 'Packed with chloroplasts near the top of the leaf.', ['cell-explorer']],
  ['guard', 'Guard cell', 'leaf surfaces', 'opening and closing stomata', 'rare', 'A pair of guard cells controls gas exchange in a leaf.', ['cell-explorer']],
  ['muscle', 'Muscle cell', 'muscles', 'contracting to produce movement', 'rare', 'Muscle cells are packed with mitochondria for energy.', ['cell-explorer']],
  ['alveolar', 'Alveolar cell', 'lungs', 'gas exchange', 'rare', 'Alveolar walls are just one cell thick.', ['biology-respiratory']],
  ['goblet', 'Goblet cell', 'airways and gut', 'making mucus', 'rare', 'Mucus traps dust and microbes before they reach the lungs.', ['biology-respiratory', 'biology-101']],
  ['neuron', 'Neuron', 'nervous system', 'carrying electrical signals', 'epic', 'Some neurons stretch about a metre, from your spine to your toes.', []],
  ['sperm', 'Sperm cell', 'reproductive system', 'carrying genetic material to the egg', 'epic', 'Its mid-piece is full of mitochondria to power the tail.', []],
  ['bacterium', 'Bacterial cell', 'almost everywhere', 'living as a single-celled organism', 'epic', 'Bacteria have no nucleus: their DNA floats in the cytoplasm.', ['cell-explorer']],
  ['stem', 'Stem cell', 'embryos and bone marrow', 'becoming other kinds of cell', 'legendary', 'One kind of stem cell can give rise to every blood cell type.', ['cell-explorer']],
];

export const CELL_CARDS: CardSeed[] = CELLS.map(([id, name, foundIn, job, rarity, fact, lessons], i) => ({
  id: `bio-cell-${id}`,
  subject: 'biology',
  set: 'cells',
  rarity,
  title: name,
  subtitle: foundIn,
  order: i + 1,
  data: { foundIn, job },
  funFact: fact,
  quizField: 'job',
  lessons,
}));

/** id, name, main organs, job, rarity, lessons */
const SYSTEMS: [string, string, string[], string, Rarity, string[]][] = [
  ['digestive', 'Digestive system', ['mouth', 'oesophagus', 'stomach', 'small intestine', 'large intestine'], 'breaking food down and absorbing nutrients', 'common', ['biology-101']],
  ['respiratory', 'Respiratory system', ['nose', 'trachea', 'bronchi', 'lungs', 'diaphragm'], 'exchanging oxygen and carbon dioxide', 'common', ['biology-respiratory']],
  ['circulatory', 'Circulatory system', ['heart', 'arteries', 'veins', 'capillaries'], 'transporting blood around the body', 'common', ['biology-respiratory']],
  ['skeletal', 'Skeletal system', ['skull', 'spine', 'ribs', 'long bones'], 'support, protection and making blood cells', 'common', []],
  ['muscular', 'Muscular system', ['skeletal muscle', 'smooth muscle', 'cardiac muscle'], 'producing movement', 'common', []],
  ['excretory', 'Excretory system', ['kidneys', 'ureters', 'bladder'], 'removing waste from the blood', 'rare', ['biology-101']],
  ['nervous', 'Nervous system', ['brain', 'spinal cord', 'nerves'], 'sending signals around the body', 'rare', []],
  ['endocrine', 'Endocrine system', ['pituitary', 'thyroid', 'pancreas', 'adrenal glands'], 'controlling the body with hormones', 'rare', ['biology-101']],
  ['immune', 'Immune system', ['white blood cells', 'lymph nodes', 'spleen'], 'defending against disease', 'epic', []],
  ['reproductive', 'Reproductive system', ['ovaries', 'testes', 'uterus'], 'producing offspring', 'epic', []],
  ['integumentary', 'Integumentary system', ['skin', 'hair', 'nails'], 'a protective barrier against the outside world', 'epic', []],
];

export const SYSTEM_CARDS: CardSeed[] = SYSTEMS.map(([id, name, organs, job, rarity, lessons], i) => ({
  id: `bio-sys-${id}`,
  subject: 'biology',
  set: 'systems',
  rarity,
  title: name,
  subtitle: `${organs.length} key organs`,
  order: i + 1,
  data: { organs, job },
  funFact: `Key parts: ${organs.join(', ')}.`,
  quizField: 'job',
  lessons,
}));

/** id, binomial name, common name, kingdom, rarity, fact, lessons */
const SPECIES: [string, string, string, string, Rarity, string, string[]][] = [
  ['human', 'Homo sapiens', 'Human', 'Animalia', 'common', '"Homo sapiens" is Latin for "wise human".', ['biology-101', 'biology-respiratory']],
  ['dog', 'Canis familiaris', 'Domestic dog', 'Animalia', 'common', 'Dogs share the genus Canis with wolves.', []],
  ['cat', 'Felis catus', 'Domestic cat', 'Animalia', 'common', 'The genus name Felis is simply Latin for cat.', []],
  ['pea', 'Pisum sativum', 'Garden pea', 'Plantae', 'common', 'Mendel worked out the rules of inheritance with pea plants.', ['cell-explorer']],
  ['onion', 'Allium cepa', 'Onion', 'Plantae', 'common', 'Onion skin is a classic first slide for seeing plant cells.', ['cell-explorer']],
  ['rice', 'Oryza sativa', 'Rice', 'Plantae', 'common', 'Rice feeds more than half of the world\'s people.', []],
  ['tiger', 'Panthera tigris', 'Tiger', 'Animalia', 'rare', 'No two tigers have the same stripe pattern.', []],
  ['peacock', 'Pavo cristatus', 'Indian peafowl', 'Animalia', 'rare', 'Only the male carries the famous tail train.', []],
  ['lotus', 'Nelumbo nucifera', 'Sacred lotus', 'Plantae', 'rare', 'Lotus seeds can still sprout after more than a thousand years.', ['cell-explorer']],
  ['yeast', 'Saccharomyces cerevisiae', 'Baker\'s yeast', 'Fungi', 'rare', 'Yeast respiration releases the CO₂ that makes bread rise.', ['biology-respiratory', 'cell-explorer']],
  ['ecoli', 'Escherichia coli', 'E. coli', 'Bacteria', 'epic', 'Most strains live harmlessly in your gut.', ['biology-101']],
  ['amoeba', 'Amoeba proteus', 'Amoeba', 'Protista', 'epic', 'It moves by pushing out "false feet" called pseudopodia.', ['cell-explorer']],
  ['tardigrade', 'Hypsibius dujardini', 'Tardigrade', 'Animalia', 'legendary', 'Tardigrades have survived exposure to the vacuum of space.', []],
];

export const NOMENCLATURE_CARDS: CardSeed[] = [
  ...SPECIES.map(([id, binomial, common, kingdom, rarity, fact, lessons], i): CardSeed => ({
    id: `bio-nom-${id}`,
    subject: 'biology',
    set: 'nomenclature',
    rarity,
    title: common,
    subtitle: binomial,
    order: i + 1,
    data: { binomial, genus: binomial.split(' ')[0], species: binomial.split(' ')[1], kingdom },
    funFact: fact,
    quizField: 'kingdom',
    lessons,
  })),
  {
    id: 'bio-nom-taxonomy',
    subject: 'biology',
    set: 'nomenclature',
    rarity: 'legendary',
    title: 'The taxonomy ladder',
    subtitle: 'Domain → Species',
    order: SPECIES.length + 1,
    data: { ranks: ['Domain', 'Kingdom', 'Phylum', 'Class', 'Order', 'Family', 'Genus', 'Species'] },
    funFact: 'Linnaeus set out the ranked system in 1735; "Dear King Philip Came Over For Good Soup" helps remember it.',
    quizField: 'ranks',
    lessons: ['cell-explorer'],
  },
];
