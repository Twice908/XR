/** The two cell types compared in the Cell Explorer. */
export type CellKind = "plant" | "animal";

/** Both cell kinds, in the order they are shown. */
export const CELL_KINDS: readonly CellKind[] = ["plant", "animal"];

/** Every organelle (and cell boundary) the biology kit knows about. */
export type OrganelleId =
  | "cell-wall"
  | "cell-membrane"
  | "cytoplasm"
  | "nucleus"
  | "endoplasmic-reticulum"
  | "ribosome"
  | "golgi-apparatus"
  | "lysosome"
  | "mitochondrion"
  | "chloroplast"
  | "vacuole";

/** Named parts inside an organelle that can be labelled and picked. */
export type OrganellePartId =
  | "outer-membrane"
  | "inner-membrane"
  | "cristae"
  | "matrix"
  | "grana"
  | "stroma"
  | "cellulose-fibres"
  | "middle-lamella"
  | "plasmodesmata"
  | "phospholipid-heads"
  | "lipid-tails"
  | "membrane-protein"
  | "nuclear-envelope"
  | "nuclear-pore"
  | "chromatin"
  | "nucleolus"
  | "large-subunit"
  | "small-subunit"
  | "mrna"
  | "protein-chain"
  | "rough-er"
  | "smooth-er"
  | "cisternae"
  | "vesicles"
  | "lysosome-membrane"
  | "enzymes"
  | "tonoplast"
  | "cell-sap";

/** Whether the teacher has checked a piece of content. */
export type ReviewStatus = "pending" | "verified";

/** One labelled part of an organelle. */
export interface OrganellePart {
  readonly id: OrganellePartId;
  /** Label shown to students. */
  readonly name: string;
  /** Short plain-English note shown with the label, or null. */
  readonly note: string | null;
}

/** Whether an organelle is found in a cell kind, with an optional short note. */
export interface OrganellePresence {
  readonly present: boolean;
  /** For example "one large central vacuole". */
  readonly note: string | null;
}

/** One entry in the organelle table. */
export interface Organelle {
  readonly id: OrganelleId;
  /** Singular name shown to students. */
  readonly name: string;
  readonly pluralName: string;
  readonly presence: Readonly<Record<CellKind, OrganellePresence>>;
  /** Labelled parts (empty until the organelle is taught in detail). */
  readonly parts: readonly OrganellePart[];
  /** One- or two-sentence description for students, or null until it is written and reviewed. */
  readonly summary: string | null;
  /** True once the organelle has a journey chapter, facts and checkpoints. */
  readonly teachable: boolean;
  readonly reviewStatus: ReviewStatus;
}

const both = { present: true, note: null } as const;
const absent = { present: false, note: null } as const;

/**
 * The major organelles taught in school biology, with which cell kinds contain them.
 * Every one but the cytoplasm has a journey chapter (XR adds the eight beyond mitochondria
 * and chloroplasts). Every entry awaits the teacher's review.
 */
export const ORGANELLES: readonly Organelle[] = [
  {
    id: "cell-wall",
    name: "Cell wall",
    pluralName: "Cell walls",
    presence: { plant: both, animal: absent },
    parts: [
      { id: "cellulose-fibres", name: "Cellulose fibres", note: "long strands that make the wall strong" },
      { id: "middle-lamella", name: "Middle lamella", note: "glues neighbouring cells together" },
      { id: "plasmodesmata", name: "Plasmodesmata", note: "channels linking neighbouring cells" },
    ],
    summary:
      "A tough layer of cellulose outside the membrane. It gives the plant cell its shape and strength.",
    teachable: true,
    reviewStatus: "pending",
  },
  {
    id: "cell-membrane",
    name: "Cell membrane",
    pluralName: "Cell membranes",
    presence: { plant: both, animal: both },
    parts: [
      { id: "phospholipid-heads", name: "Phospholipid heads", note: "water-loving, facing outwards" },
      { id: "lipid-tails", name: "Fatty tails", note: "water-hating, in the middle" },
      { id: "membrane-protein", name: "Protein channel", note: "lets chosen substances through" },
    ],
    summary:
      "A thin, flexible double layer of lipids with proteins in it. It controls what enters and leaves the cell.",
    teachable: true,
    reviewStatus: "pending",
  },
  {
    id: "cytoplasm",
    name: "Cytoplasm",
    pluralName: "Cytoplasm",
    presence: { plant: both, animal: both },
    parts: [],
    summary: null,
    teachable: false,
    reviewStatus: "pending",
  },
  {
    id: "nucleus",
    name: "Nucleus",
    pluralName: "Nuclei",
    presence: { plant: both, animal: both },
    parts: [
      { id: "nuclear-envelope", name: "Nuclear envelope", note: "a double membrane" },
      { id: "nuclear-pore", name: "Nuclear pore", note: "an opening in the envelope" },
      { id: "chromatin", name: "Chromatin", note: "DNA, the cell's instructions" },
      { id: "nucleolus", name: "Nucleolus", note: "makes ribosomes" },
    ],
    summary:
      "The control centre of the cell. It holds the DNA that directs the cell's work.",
    teachable: true,
    reviewStatus: "pending",
  },
  {
    id: "endoplasmic-reticulum",
    name: "Endoplasmic reticulum",
    pluralName: "Endoplasmic reticulum",
    presence: { plant: both, animal: both },
    parts: [
      { id: "rough-er", name: "Rough ER", note: "studded with ribosomes" },
      { id: "smooth-er", name: "Smooth ER", note: "no ribosomes; makes lipids" },
    ],
    summary:
      "A network of membrane channels. Rough ER carries proteins; smooth ER makes lipids.",
    teachable: true,
    reviewStatus: "pending",
  },
  {
    id: "ribosome",
    name: "Ribosome",
    pluralName: "Ribosomes",
    presence: { plant: both, animal: both },
    parts: [
      { id: "large-subunit", name: "Large subunit", note: null },
      { id: "small-subunit", name: "Small subunit", note: null },
      { id: "mrna", name: "Messenger RNA", note: "the message from the nucleus" },
      { id: "protein-chain", name: "Protein chain", note: "built link by link" },
    ],
    summary:
      "A tiny particle that reads the message from the nucleus and builds proteins.",
    teachable: true,
    reviewStatus: "pending",
  },
  {
    id: "golgi-apparatus",
    name: "Golgi apparatus",
    pluralName: "Golgi apparatus",
    presence: { plant: both, animal: both },
    parts: [
      { id: "cisternae", name: "Cisternae", note: "flattened sacs" },
      { id: "vesicles", name: "Vesicles", note: "carry packed materials away" },
    ],
    summary:
      "A stack of flattened sacs that changes, sorts and packs materials and sends them on.",
    teachable: true,
    reviewStatus: "pending",
  },
  {
    id: "lysosome",
    name: "Lysosome",
    pluralName: "Lysosomes",
    presence: { plant: both, animal: both },
    parts: [
      { id: "lysosome-membrane", name: "Membrane", note: "keeps the enzymes inside" },
      { id: "enzymes", name: "Digestive enzymes", note: "break down waste and germs" },
    ],
    summary:
      "A small bag of digestive enzymes that breaks down waste, worn-out parts and germs.",
    teachable: true,
    reviewStatus: "pending",
  },
  {
    id: "mitochondrion",
    name: "Mitochondrion",
    pluralName: "Mitochondria",
    presence: { plant: both, animal: both },
    parts: [
      { id: "outer-membrane", name: "Outer membrane", note: null },
      { id: "inner-membrane", name: "Inner membrane", note: null },
      { id: "cristae", name: "Cristae", note: "folds of the inner membrane" },
      { id: "matrix", name: "Matrix", note: "the fluid inside the inner membrane" },
    ],
    summary:
      "The powerhouse of the cell. It releases energy from food so the cell can do its work.",
    teachable: true,
    reviewStatus: "pending",
  },
  {
    id: "chloroplast",
    name: "Chloroplast",
    pluralName: "Chloroplasts",
    presence: { plant: both, animal: absent },
    parts: [
      { id: "outer-membrane", name: "Outer membrane", note: null },
      { id: "inner-membrane", name: "Inner membrane", note: null },
      { id: "grana", name: "Grana", note: "stacks of thylakoids" },
      { id: "stroma", name: "Stroma", note: "the fluid around the grana" },
    ],
    summary:
      "A green plastid that holds chlorophyll. It uses sunlight to make food for the plant.",
    teachable: true,
    reviewStatus: "pending",
  },
  {
    id: "vacuole",
    name: "Vacuole",
    pluralName: "Vacuoles",
    presence: {
      plant: { present: true, note: "one large central vacuole" },
      animal: { present: true, note: "small and few" },
    },
    parts: [
      { id: "tonoplast", name: "Tonoplast", note: "the vacuole's membrane" },
      { id: "cell-sap", name: "Cell sap", note: "water with dissolved sugars and salts" },
    ],
    summary:
      "A sac filled with cell sap. In plant cells one large central vacuole keeps the cell firm.",
    teachable: true,
    reviewStatus: "pending",
  },
];

const BY_ID: ReadonlyMap<OrganelleId, Organelle> = new Map(ORGANELLES.map((organelle) => [organelle.id, organelle]));

/** Look up an organelle by id. */
export function organelleById(id: OrganelleId): Organelle {
  const organelle = BY_ID.get(id);
  if (!organelle) throw new Error(`Unknown organelle: ${id}`);
  return organelle;
}

/** Whether an organelle is found in a cell kind. */
export function isPresentIn(id: OrganelleId, kind: CellKind): boolean {
  return organelleById(id).presence[kind].present;
}

/** Organelles found in a cell kind, in table order. */
export function organellesIn(kind: CellKind): readonly Organelle[] {
  return ORGANELLES.filter((organelle) => organelle.presence[kind].present);
}

/** Organelles that have a journey chapter, facts and checkpoints. */
export function teachableOrganelles(): readonly Organelle[] {
  return ORGANELLES.filter((organelle) => organelle.teachable);
}

/** One labelled part of an organelle, or null when it has no such part. */
export function organellePart(id: OrganelleId, partId: OrganellePartId): OrganellePart | null {
  return organelleById(id).parts.find((part) => part.id === partId) ?? null;
}

/** Organelles split by where they are found, for "sort them" checkpoints. */
export interface OrganelleGroups {
  readonly plantOnly: readonly OrganelleId[];
  readonly animalOnly: readonly OrganelleId[];
  readonly both: readonly OrganelleId[];
}

/** Split organelles into plant only, animal only, and found in both. */
export function groupOrganelles(organelles: readonly Organelle[] = ORGANELLES): OrganelleGroups {
  const plantOnly: OrganelleId[] = [];
  const animalOnly: OrganelleId[] = [];
  const shared: OrganelleId[] = [];
  for (const organelle of organelles) {
    const inPlant = organelle.presence.plant.present;
    const inAnimal = organelle.presence.animal.present;
    if (inPlant && inAnimal) shared.push(organelle.id);
    else if (inPlant) plantOnly.push(organelle.id);
    else if (inAnimal) animalOnly.push(organelle.id);
  }
  return { plantOnly, animalOnly, both: shared };
}
