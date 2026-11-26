import { seededRandom } from "@mma/engine-core";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Position3 } from "./atom-view.js";
import type { SceneContent } from "./molecule-view.js";

/** Organelles scattered through a cell's cytoplasm. */
export type CellSceneOrganelleKind = "mitochondrion" | "chloroplast" | "lysosome" | "ribosome";

/** Organelles that have a large, cut-open (or magnified) detail model. */
export type OrganelleDetailKind =
  | "mitochondrion"
  | "chloroplast"
  | "cell-wall"
  | "cell-membrane"
  | "nucleus"
  | "ribosome"
  | "endoplasmic-reticulum"
  | "golgi-apparatus"
  | "lysosome"
  | "vacuole";

/** Parts of a detail model that can be picked and highlighted. */
export type OrganelleDetailPart =
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

/** One organelle placed in a cell, relative to the cell centre. */
export interface CellSceneOrganelle {
  readonly id: string;
  readonly organelle: CellSceneOrganelleKind;
  readonly position: Position3;
  /** Unit vector along the organelle's length. */
  readonly axis: Position3;
  /** Turn about the axis, in radians. */
  readonly roll: number;
  /** Full length (along the axis), width and depth. */
  readonly size: Position3;
}

/** One cell to draw. A biology kit's cell layout fits this shape directly. */
export interface CellSceneCell {
  readonly id: string;
  /** Where the cell centre sits, in content units. */
  readonly position: Position3;
  readonly body: {
    readonly shape: "rounded-box" | "blob";
    /** Full width, height and depth. */
    readonly size: Position3;
    /** Cell wall thickness; 0 draws no wall. */
    readonly wallThickness: number;
    /** How far a blob's surface bulges in or out. */
    readonly wobble: number;
    readonly seed: number;
  };
  readonly nucleus: { readonly position: Position3; readonly radius: number; readonly nucleolusRadius: number };
  readonly reticulum: { readonly facing: Position3; readonly innerRadius: number; readonly outerRadius: number };
  readonly vacuoles: readonly { readonly id: string; readonly position: Position3; readonly radii: Position3 }[];
  readonly golgi: readonly { readonly id: string; readonly position: Position3; readonly axis: Position3; readonly size: number }[];
  readonly organelles: readonly CellSceneOrganelle[];
}

/** A large organelle model that can be opened to show its inside parts. */
export interface CellSceneDetail {
  readonly id: string;
  readonly organelle: OrganelleDetailKind;
  readonly position: Position3;
  /** Full length, in content units. */
  readonly length: number;
  /** Turn about the vertical axis, in radians. */
  readonly yaw: number;
  /** Cut a wedge out of the front so the inside parts show. */
  readonly cutaway: boolean;
  /**
   * A magnified view floating in front of the cells (rather than an organelle opened in place): the
   * cells behind fade back so the close-up reads clearly.
   */
  readonly magnified?: boolean;
}

/** Everything a {@link CellView} draws. */
export interface CellSceneFrame {
  readonly cells: readonly CellSceneCell[];
  readonly details: readonly CellSceneDetail[];
  /**
   * Scattered organelles not to draw, as `<cell id>:<organelle id>`, for example the one a
   * close-up model replaces.
   */
  readonly hiddenOrganelles?: readonly string[];
}

/** Options for {@link CellView}. */
export interface CellViewOptions {
  /** `low` uses fewer polygons and moves fewer small parts, for phones. Defaults to `high`. */
  readonly quality?: "high" | "low";
  /** Keep everything still: no swaying, breathing or pulsing highlight. */
  readonly reducedMotion?: boolean;
  /** Milliseconds clock for the living motion, read each time the scene is drawn. Defaults to `performance.now`. */
  readonly now?: () => number;
}

/** Pick target for a structure inside one cell (for example its mitochondria). */
export function cellOrganelleTarget(cellId: string, organelle: string): string {
  return `cell:${cellId}:${organelle}`;
}

/** Pick target for one part of a detail model. */
export function organelleDetailTarget(detailId: string, part: OrganelleDetailPart): string {
  return `detail:${detailId}:${part}`;
}

/** What a {@link CellView} pick target points at, or null for another view's target. */
export type CellPick =
  | { readonly kind: "cell"; readonly cellId: string; readonly organelle: string }
  | { readonly kind: "detail"; readonly detailId: string; readonly part: OrganelleDetailPart };

/** Read a pick target made by {@link cellOrganelleTarget} or {@link organelleDetailTarget}. */
export function parseCellTarget(target: string): CellPick | null {
  const [kind, id, rest] = target.split(":");
  if (!id || !rest) return null;
  if (kind === "cell") return { kind: "cell", cellId: id, organelle: rest };
  if (kind === "detail" && (DETAIL_PARTS as readonly string[]).includes(rest)) {
    return { kind: "detail", detailId: id, part: rest as OrganelleDetailPart };
  }
  return null;
}

const DETAIL_PARTS: readonly OrganelleDetailPart[] = [
  "outer-membrane", "inner-membrane", "cristae", "matrix", "grana", "stroma",
  "cellulose-fibres", "middle-lamella", "plasmodesmata",
  "phospholipid-heads", "lipid-tails", "membrane-protein",
  "nuclear-envelope", "nuclear-pore", "chromatin", "nucleolus",
  "large-subunit", "small-subunit", "mrna", "protein-chain",
  "rough-er", "smooth-er", "cisternae", "vesicles",
  "lysosome-membrane", "enzymes", "tonoplast", "cell-sap",
];

/**
 * Natural colours after realistic textbook renders (and micrograph stains): a green, fibrous plant wall, pink
 * and mauve membrane systems, a deep purple nucleus, orange mitochondria and clear, pale blue vacuoles.
 */
const COLOR = {
  wall: 0x9ccc74,
  plantMembrane: 0xcde8a8,
  plantCytoplasm: 0xe4f2d2,
  animalMembrane: 0xe9a9a0,
  animalCytoplasm: 0xfbe5dd,
  nucleus: 0x8d5bc4,
  nucleusInner: 0xa77ad6,
  nucleoplasm: 0xc9a6ea,
  nucleolus: 0x4a2272,
  chromatin: 0xb07ee0,
  pore: 0x3a1f55,
  vacuole: 0xa6d6f0,
  tonoplast: 0xa9d6ee,
  cellSap: 0xdcf1fa,
  sugar: 0xffffff,
  salt: 0xf6e7a8,
  reticulum: 0xd99ab8,
  smoothReticulum: 0xe9b6cc,
  golgi: 0xb882a6,
  golgiCis: 0xd3a4c2,
  golgiTrans: 0x9c6a8e,
  vesicle: 0xc996b8,
  mitochondrion: 0xef8a3c,
  chloroplast: 0x4fa236,
  lysosome: 0xc9a24d,
  lysosomeFluid: 0xf6e6b8,
  enzymeA: 0x9a5a2b,
  enzymeB: 0xd4693f,
  ribosome: 0x2b2233,
  ribosomeLarge: 0x6a5a9c,
  ribosomeSmall: 0xa595cf,
  mrna: 0xe9a23a,
  cellulose: 0xe4f0c8,
  lamella2: 0xd8c27c,
  plasmodesma: 0x6e9a45,
  lipidHead: 0xd9785a,
  lipidTail: 0xf3dda2,
  protein: 0x6f7fd1,
  mitoOuter: 0xec8d66,
  mitoInner: 0xf4a582,
  cristae: 0xd2643f,
  matrix: 0xfcd9c6,
  chloroOuter: 0x86c95e,
  chloroInner: 0x62b043,
  stroma: 0xd8f0bc,
  grana: 0x2c7a2e,
  lamella: 0x3f8f39,
  /** Magenta sits opposite the greens and oranges of the cells, so the highlight always stands out. */
  highlight: 0xe0218a,
  /** Everything else fades towards this pale tone while something is highlighted. */
  dim: 0xf3f7f0,
} as const;

/** Outline width as a share of the viewing distance, so it looks the same size at any zoom. */
const OUTLINE_WIDTH = 0.0065;
/** How far the rest of the cell fades while something is highlighted (0 = not at all). */
const DIM_AMOUNT = 0.42;

const OUTLINE_VERTEX = /* glsl */ `
uniform float uWidth;
void main() {
  vec4 local = vec4(position, 1.0);
  vec3 bent = normal;
  #ifdef USE_INSTANCING
    local = instanceMatrix * local;
    bent = mat3(instanceMatrix) * bent;
  #endif
  vec4 view = modelViewMatrix * local;
  // Push the back faces out along the normal by a share of the distance: an even outline.
  view.xyz += normalize(normalMatrix * bent) * uWidth * max(0.25, -view.z);
  gl_Position = projectionMatrix * view;
}
`;

const OUTLINE_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
void main() {
  gl_FragColor = vec4(uColor, uOpacity);
}
`;

/** Gentle sway of one instanced batch of organelles, so the cell looks alive. */
interface SwayingBatch {
  readonly mesh: THREE.InstancedMesh;
  readonly items: readonly {
    readonly position: THREE.Vector3;
    readonly rotation: THREE.Quaternion;
    readonly scale: THREE.Vector3;
    readonly phase: number;
    readonly spin: THREE.Vector3;
  }[];
  /** Largest drift, in content units. */
  readonly drift: number;
  /** Instances that ride inside another batch's instances (grana inside chloroplasts). */
  readonly follow?: { readonly parent: SwayingBatch; readonly parentIndex: readonly number[]; readonly local: readonly THREE.Matrix4[] };
  /** Matrices from the last animation step, read by followers. */
  current: THREE.Matrix4[];
}

/** Wedge left open by a cut-away, in radians. */
const CUTAWAY_GAP = Math.PI * 0.62;
const UP = new THREE.Vector3(0, 1, 0);
const ALONG = new THREE.Vector3(1, 0, 0);

interface Highlightable {
  readonly material: THREE.MeshStandardMaterial;
  /** A see-through shell (wall, membrane, vacuole): highlighted by its rim, never filled in. */
  readonly shell: boolean;
  readonly color: THREE.Color;
  readonly emissive: THREE.Color;
  readonly emissiveIntensity: number;
  readonly opacity: number;
}

/**
 * View-only drawing of realistic plant and animal cells: the wall and membrane, cytoplasm,
 * nucleus with nucleolus, endoplasmic reticulum, Golgi apparatus, vacuoles, and instanced
 * mitochondria, chloroplasts, lysosomes and ribosomes. It can also draw large detail
 * models of a mitochondrion or chloroplast, cut open to show their parts. Every structure
 * is a pick target ({@link cellOrganelleTarget}, {@link organelleDetailTarget}); the see-
 * through shells (wall, membrane) yield to anything picked inside them.
 *
 * The highlighted structure gets a pulsing magenta outline and glow while the rest fades
 * back. The cells look alive: organelles sway, cells breathe and opened models float, a
 * little each time the scene is drawn (also in XR). Motion is view-only and never moves a
 * structure far from its place; reduced motion keeps everything still.
 */
export class CellView implements SceneContent {
  readonly root = new THREE.Group();
  private readonly segments: number;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly targets = new Map<string, Highlightable[]>();
  private readonly picks: THREE.Object3D[] = [];
  private frame: CellSceneFrame | null = null;
  private highlightTarget: string | null = null;
  private unitSphere: THREE.BufferGeometry | null = null;
  /** Materials of the cells themselves (not of close-ups), faded while a magnified view shows. */
  private cellMaterials: THREE.MeshPhysicalMaterial[] = [];
  private collectingCell = false;
  private backdrop = false;
  /** Procedural surface textures, made once per view and kept across redraws. */
  private readonly textures = new Map<string, THREE.Texture | null>();
  private readonly lowQuality: boolean;
  private readonly reducedMotion: boolean;
  private readonly now: () => number;
  /** Drawn objects of each pick target, for outlining. */
  private readonly targetObjects = new Map<string, THREE.Mesh[]>();
  private readonly outlineMaterial = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(COLOR.highlight) }, uOpacity: { value: 0.95 }, uWidth: { value: OUTLINE_WIDTH } },
    vertexShader: OUTLINE_VERTEX,
    fragmentShader: OUTLINE_FRAGMENT,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
  });
  private outlines: THREE.Mesh[] = [];
  private swaying: SwayingBatch[] = [];
  private breathing: { readonly object: THREE.Object3D; readonly amount: number; readonly phase: number }[] = [];
  private floating: { readonly object: THREE.Object3D; readonly base: THREE.Vector3; readonly rise: number; readonly phase: number }[] = [];
  private lastAnimated: number | null = null;
  /** Invisible mesh whose draw call advances the motion once per rendered frame. */
  private readonly driver: THREE.Mesh;

  constructor(options: CellViewOptions = {}) {
    this.lowQuality = options.quality === "low";
    this.segments = this.lowQuality ? 20 : 36;
    this.reducedMotion = options.reducedMotion ?? false;
    this.now = options.now ?? (() => performance.now());
    this.root.name = "cell-root";
    const driverGeometry = new THREE.BufferGeometry();
    driverGeometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
    this.driver = new THREE.Mesh(driverGeometry, new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
    this.driver.name = "cell-motion-driver";
    this.driver.frustumCulled = false;
    this.driver.raycast = () => undefined;
    this.driver.onBeforeRender = () => {
      const time = this.now();
      // Both eyes of a stereo frame share one step.
      if (this.lastAnimated !== null && Math.abs(time - this.lastAnimated) < 1) return;
      this.lastAnimated = time;
      this.animate(time);
    };
  }

  /** The latest frame, or null before the first update. */
  get currentFrame(): CellSceneFrame | null {
    return this.frame;
  }

  get boundingRadius(): number {
    const frame = this.frame;
    if (!frame) return 1;
    let radius = 1;
    for (const cell of frame.cells) {
      const half = Math.hypot(cell.body.size.x, cell.body.size.y, cell.body.size.z) / 2;
      radius = Math.max(radius, length(cell.position) + half);
    }
    for (const detail of frame.details) radius = Math.max(radius, length(detail.position) + detail.length / 2);
    return radius;
  }

  get interactiveMeshes(): THREE.Object3D[] {
    return [...this.picks];
  }

  /** Redraw from a new frame. */
  update(frame: CellSceneFrame): void {
    this.frame = frame;
    this.clear();
    const hidden = new Set(frame.hiddenOrganelles ?? []);
    this.backdrop = frame.details.some((detail) => detail.magnified === true);
    this.collectingCell = true;
    for (const cell of frame.cells) this.drawCell(cell, hidden);
    this.collectingCell = false;
    for (const detail of frame.details) this.drawDetail(detail);
    this.root.add(this.driver);
    this.applyHighlight();
    this.animate(this.lastAnimated ?? 0);
  }

  /**
   * Advance the living motion and the highlight pulse to `timeMs`. Called each time the scene
   * is drawn; call it directly to show a given moment. With reduced motion everything rests.
   */
  animate(timeMs: number): void {
    const t = this.reducedMotion ? 0 : timeMs / 1000;
    const still = this.reducedMotion;
    // Every wave is measured from its start, so at time 0 (and with reduced motion) all rests in place.
    const wave = (speed: number, phase: number): number => Math.sin(t * speed + phase) - Math.sin(phase);
    for (const breath of this.breathing) {
      const k = still ? 0 : breath.amount;
      breath.object.scale.set(1 + k * wave(0.9, breath.phase), 1 + k * wave(0.9, breath.phase + 1.3), 1 + k * wave(0.9, breath.phase + 2.6));
    }
    for (const float of this.floating) {
      const k = still ? 0 : float.rise;
      float.object.position.set(float.base.x, float.base.y + k * wave(0.8, float.phase), float.base.z);
      float.object.rotation.z = still ? 0 : 0.04 * wave(0.5, float.phase);
    }
    const offset = new THREE.Vector3();
    const turn = new THREE.Quaternion();
    const rotation = new THREE.Quaternion();
    for (const batch of this.swaying) {
      if (batch.follow) {
        const { parent, parentIndex, local } = batch.follow;
        batch.current = local.map((matrix, index) => (parent.current[parentIndex[index] as number] ?? new THREE.Matrix4()).clone().multiply(matrix));
      } else {
        batch.current = batch.items.map((item) => {
          const k = still ? 0 : batch.drift;
          offset.set(wave(0.7, item.phase), wave(0.55, item.phase * 1.7), wave(0.63, item.phase * 2.3)).multiplyScalar(k);
          turn.setFromAxisAngle(item.spin, still ? 0 : 0.2 * wave(0.45, item.phase));
          rotation.copy(item.rotation).premultiply(turn);
          return new THREE.Matrix4().compose(offset.add(item.position), rotation, item.scale);
        });
      }
      batch.current.forEach((matrix, index) => batch.mesh.setMatrixAt(index, matrix));
      batch.mesh.instanceMatrix.needsUpdate = true;
    }
    // The highlight breathes too, so the eye finds it.
    const pulse = still ? 1 : 0.5 + 0.5 * Math.sin(timeMs / 1000 * 4.2);
    const uniforms = this.outlineMaterial.uniforms as { uWidth: { value: number }; uOpacity: { value: number } };
    uniforms.uWidth.value = OUTLINE_WIDTH * (0.8 + 0.45 * pulse);
    uniforms.uOpacity.value = 0.7 + 0.3 * pulse;
    const lit = this.highlightTarget ? this.targets.get(this.highlightTarget) : undefined;
    for (const entry of lit ?? []) entry.material.emissiveIntensity = (entry.shell ? 0.1 : 0.28) + (entry.shell ? 0.12 : 0.3) * pulse;
  }

  setHighlight(target: string | null): void {
    this.highlightTarget = target;
    this.applyHighlight();
  }

  /** Cells have no electron slots. */
  setSlotsVisible(): void {}

  dispose(): void {
    this.clear();
    for (const texture of this.textures.values()) texture?.dispose();
    this.textures.clear();
    this.outlineMaterial.dispose();
    this.driver.geometry.dispose();
    (this.driver.material as THREE.Material).dispose();
    this.root.removeFromParent();
  }

  // --- cells -----------------------------------------------------------------

  private drawCell(cell: CellSceneCell, hidden: ReadonlySet<string>): void {
    const group = new THREE.Group();
    group.name = `cell-${cell.id}`;
    group.position.set(cell.position.x, cell.position.y, cell.position.z);
    this.root.add(group);
    const target = (organelle: string) => cellOrganelleTarget(cell.id, organelle);
    const plant = cell.body.shape === "rounded-box";
    // A soft animal cell breathes more than a plant cell held in its wall.
    this.breathing.push({ object: group, amount: plant ? 0.005 : 0.016, phase: cell.body.seed % 7 });
    const { size, wallThickness } = cell.body;

    if (plant) {
      const cornerRadius = Math.min(size.x, size.y, size.z) * 0.16;
      if (wallThickness > 0) {
        const wall = this.mesh(
          this.own(new RoundedBoxGeometry(size.x, size.y, size.z, 5, cornerRadius)),
          this.shell(COLOR.wall, 0.3, { roughness: 0.8, map: this.texture("fibres") }),
          target("cell-wall"),
          true,
        );
        wall.renderOrder = 3;
        group.add(wall);
      }
      const inset = wallThickness + 0.03;
      const membrane = this.mesh(
        this.own(new RoundedBoxGeometry(size.x - inset * 2, size.y - inset * 2, size.z - inset * 2, 5, cornerRadius * 0.85)),
        this.shell(COLOR.plantMembrane, 0.2, { clearcoat: 0.6 }),
        target("cell-membrane"),
        true,
      );
      membrane.renderOrder = 2;
      const cytoplasm = this.mesh(
        this.own(new RoundedBoxGeometry(size.x - inset * 2 - 0.04, size.y - inset * 2 - 0.04, size.z - inset * 2 - 0.04, 5, cornerRadius * 0.8)),
        this.shell(COLOR.plantCytoplasm, 0.6, { side: THREE.BackSide, roughness: 0.9, map: this.texture("speckle") }),
        null,
      );
      group.add(membrane, cytoplasm);
    } else {
      const blob = this.blobGeometry(size, cell.body.wobble, cell.body.seed);
      const membrane = this.mesh(blob, this.shell(COLOR.animalMembrane, 0.32, { clearcoat: 1, roughness: 0.35, sheen: 0.6 }), target("cell-membrane"), true);
      membrane.renderOrder = 2;
      const cytoplasm = this.mesh(blob, this.shell(COLOR.animalCytoplasm, 0.62, { side: THREE.BackSide, roughness: 0.9, map: this.texture("speckle") }), null);
      cytoplasm.scale.setScalar(0.985);
      group.add(membrane, cytoplasm);
    }

    this.drawNucleus(group, cell, target("nucleus"));
    this.drawReticulum(group, cell, target("endoplasmic-reticulum"));
    for (const stack of cell.golgi) this.drawGolgi(group, stack, target("golgi-apparatus"));
    for (const vacuole of cell.vacuoles) {
      // Not a pick backdrop like the wall and membrane: the vacuole is a body you can tap, and the nearest
      // thing along the tap wins, so it is picked wherever it is in front (XR: the central vacuole checkpoint).
      const mesh = this.mesh(
        this.sphere(),
        this.shell(COLOR.vacuole, 0.55, { clearcoat: 1, roughness: 0.12, map: this.texture("mottle") }),
        target("vacuole"),
      );
      mesh.name = `cell-${cell.id}-${vacuole.id}`;
      mesh.position.set(vacuole.position.x, vacuole.position.y, vacuole.position.z);
      mesh.scale.set(vacuole.radii.x * 2, vacuole.radii.y * 2, vacuole.radii.z * 2);
      mesh.renderOrder = 1;
      group.add(mesh);
    }
    this.drawScattered(group, cell, target, hidden);
  }

  private drawNucleus(group: THREE.Group, cell: CellSceneCell, target: string): void {
    const { position, radius, nucleolusRadius } = cell.nucleus;
    // Cut open towards the viewer, as in a textbook model, so the nucleolus shows inside.
    const envelope = this.mesh(this.ellipsoidLathe(CUTAWAY_GAP * 0.55), this.solid(COLOR.nucleus, { side: THREE.DoubleSide, clearcoat: 0.7, roughness: 0.4, map: this.texture("mottle") }), target);
    envelope.name = `cell-${cell.id}-nucleus`;
    envelope.scale.setScalar(radius);
    envelope.rotation.x = -0.3;
    const inside = this.mesh(this.ellipsoidLathe(0), this.solid(COLOR.nucleoplasm, { side: THREE.BackSide, roughness: 0.9, map: this.texture("mottle") }), target);
    inside.scale.setScalar(radius * 0.96);
    const nucleolus = this.mesh(this.sphere(), this.solid(COLOR.nucleolus, { roughness: 0.6, map: this.texture("mottle") }), target);
    nucleolus.scale.setScalar(nucleolusRadius * 2);
    nucleolus.position.set(radius * 0.1, radius * 0.05, radius * 0.2);
    const holder = new THREE.Group();
    holder.position.set(position.x, position.y, position.z);
    holder.add(nucleolus, inside, envelope);
    group.add(holder);
    this.floating.push({ object: holder, base: holder.position.clone(), rise: radius * 0.03, phase: cell.body.seed % 5 });
  }

  /** Folded sheets wrapped part-way round the nucleus, studded with ribosomes. */
  private drawReticulum(group: THREE.Group, cell: CellSceneCell, target: string): void {
    const { facing, innerRadius, outerRadius } = cell.reticulum;
    const holder = new THREE.Group();
    holder.position.set(cell.nucleus.position.x, cell.nucleus.position.y, cell.nucleus.position.z);
    holder.quaternion.setFromUnitVectors(UP, new THREE.Vector3(facing.x, facing.y, facing.z).normalize());
    group.add(holder);
    const material = this.solid(COLOR.reticulum, { side: THREE.DoubleSide, roughness: 0.45, clearcoat: 0.5, transparent: true, opacity: 0.85, map: this.texture("mottle") });
    const sheets = 4;
    const studs: THREE.Vector3[] = [];
    const random = seededRandom(cell.body.seed + 11);
    for (let index = 0; index < sheets; index += 1) {
      const radius = innerRadius + ((outerRadius - innerRadius) * index) / (sheets - 1);
      const geometry = this.own(new THREE.SphereGeometry(radius, this.segments, Math.round(this.segments / 3), 0, Math.PI * 2, 0, 0.8 - index * 0.07));
      ripple(geometry, 0.018, 4 + index, index);
      const sheet = this.mesh(geometry, material, target);
      holder.add(sheet);
      if (index >= sheets - 2) {
        for (let stud = 0; stud < 18; stud += 1) {
          const theta = random() * (0.75 - index * 0.07);
          const phi = random() * Math.PI * 2;
          studs.push(new THREE.Vector3().setFromSphericalCoords(radius + 0.02, theta, phi));
        }
      }
    }
    const ribosomes = this.instanced(this.sphere(), this.solid(COLOR.ribosome, { roughness: 0.7 }), studs.length, target);
    studs.forEach((point, index) => {
      ribosomes.setMatrixAt(index, new THREE.Matrix4().compose(point, new THREE.Quaternion(), new THREE.Vector3().setScalar(0.022)));
    });
    holder.add(ribosomes);
    // Smooth ER: bare tubes branching off beyond the rough sheets.
    const smooth = this.solid(COLOR.smoothReticulum, { roughness: 0.4, clearcoat: 0.6 });
    for (let index = 0; index < 5; index += 1) {
      const points: THREE.Vector3[] = [];
      let point = new THREE.Vector3().setFromSphericalCoords(outerRadius + 0.02, 0.35 + random() * 0.4, random() * Math.PI * 2);
      for (let step = 0; step < 5; step += 1) {
        points.push(point.clone());
        point = point.add(new THREE.Vector3(random() - 0.5, random() * 0.6, random() - 0.5).multiplyScalar(0.12));
      }
      holder.add(this.mesh(this.own(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 24, 0.022, 6)), smooth, target));
    }
  }

  /** A stack of curved, flattened sacs with a few budding vesicles. */
  private drawGolgi(group: THREE.Group, stack: CellSceneCell["golgi"][number], target: string): void {
    const holder = new THREE.Group();
    holder.position.set(stack.position.x, stack.position.y, stack.position.z);
    holder.quaternion.setFromUnitVectors(UP, new THREE.Vector3(stack.axis.x, stack.axis.y, stack.axis.z).normalize());
    group.add(holder);
    const material = this.solid(COLOR.golgi, { roughness: 0.5, clearcoat: 0.4, map: this.texture("mottle") });
    const sacs = 5;
    const spacing = stack.size * 0.11;
    for (let index = 0; index < sacs; index += 1) {
      const middle = (sacs - 1) / 2;
      const width = stack.size * (1 - Math.abs(index - middle) * 0.13);
      const geometry = this.own(new THREE.CylinderGeometry(width / 2, width / 2, spacing * 0.55, this.segments, 1));
      bend(geometry, 1.6 / stack.size);
      const sac = this.mesh(geometry, material, target);
      sac.position.y = (index - middle) * spacing;
      sac.scale.z = 0.62;
      holder.add(sac);
    }
    const vesicles = this.instanced(this.sphere(), material, 6, target);
    for (let index = 0; index < 6; index += 1) {
      const side = index % 2 === 0 ? 1 : -1;
      const point = new THREE.Vector3(side * stack.size * (0.52 + 0.06 * index), (index - 2.5) * spacing * 0.5, 0.04 * index - 0.1);
      vesicles.setMatrixAt(index, new THREE.Matrix4().compose(point, new THREE.Quaternion(), new THREE.Vector3().setScalar(stack.size * 0.06)));
    }
    holder.add(vesicles);
  }

  /** Mitochondria, chloroplasts, lysosomes and ribosomes, one instanced batch per kind. */
  private drawScattered(group: THREE.Group, cell: CellSceneCell, target: (organelle: string) => string, hidden: ReadonlySet<string>): void {
    const byKind = new Map<CellSceneOrganelleKind, CellSceneOrganelle[]>();
    for (const organelle of cell.organelles) {
      if (hidden.has(`${cell.id}:${organelle.id}`)) continue;
      const list = byKind.get(organelle.organelle) ?? [];
      list.push(organelle);
      byKind.set(organelle.organelle, list);
    }
    const random = seededRandom(cell.body.seed + 29);
    for (const [kind, organelles] of byKind) {
      const { geometry, material } = this.scatteredLook(kind);
      const batch = this.instanced(geometry, material, organelles.length, target(kind));
      batch.name = `cell-${cell.id}-${kind}`;
      const matrices = organelles.map(placement);
      matrices.forEach((matrix, index) => batch.setMatrixAt(index, matrix));
      group.add(batch);
      // Phones skip moving the many tiny ribosomes.
      const sway = kind === "ribosome" && this.lowQuality ? null : this.addSway(batch, matrices, SWAY_DRIFT[kind], random);
      if (kind === "chloroplast") group.add(this.chloroplastGrana(cell, organelles, target(kind), sway));
    }
  }

  /** Make an instanced batch drift and turn gently around its placements. */
  private addSway(mesh: THREE.InstancedMesh, matrices: readonly THREE.Matrix4[], drift: number, random: () => number): SwayingBatch {
    const items = matrices.map((matrix) => {
      const position = new THREE.Vector3();
      const rotation = new THREE.Quaternion();
      const scale = new THREE.Vector3();
      matrix.decompose(position, rotation, scale);
      const spin = new THREE.Vector3(random() * 2 - 1, random() * 2 - 1, random() * 2 - 1).normalize();
      return { position, rotation, scale, phase: random() * Math.PI * 2, spin };
    });
    const batch: SwayingBatch = { mesh, items, drift, current: matrices.map((matrix) => matrix.clone()) };
    this.swaying.push(batch);
    return batch;
  }

  private scatteredLook(kind: CellSceneOrganelleKind): { geometry: THREE.BufferGeometry; material: THREE.Material } {
    switch (kind) {
      case "mitochondrion": {
        // Capsule lying along +x, one unit long overall.
        const geometry = this.own(new THREE.CapsuleGeometry(0.5, 1, 6, Math.round(this.segments / 2)));
        geometry.rotateZ(-Math.PI / 2);
        geometry.scale(0.5, 1, 1);
        return { geometry, material: this.solid(COLOR.mitochondrion, { roughness: 0.45, clearcoat: 0.5, map: this.texture("cristae") }) };
      }
      case "chloroplast":
        return {
          geometry: this.sphere(),
          material: this.solid(COLOR.chloroplast, { roughness: 0.5, clearcoat: 0.35, transparent: true, opacity: 0.88, map: this.texture("mottle") }),
        };
      case "lysosome":
        return { geometry: this.sphere(), material: this.solid(COLOR.lysosome, { roughness: 0.4, clearcoat: 0.6, map: this.texture("speckle") }) };
      case "ribosome":
        // Detail 1 keeps them round when the camera zooms right into a cell.
        return { geometry: this.own(new THREE.IcosahedronGeometry(0.5, 1)), material: this.solid(COLOR.ribosome, { roughness: 0.7 }) };
    }
  }

  /** Dark grana showing through each small chloroplast; they ride along as the chloroplasts sway. */
  private chloroplastGrana(cell: CellSceneCell, chloroplasts: readonly CellSceneOrganelle[], target: string, sway: SwayingBatch | null): THREE.InstancedMesh {
    const spots = [-0.26, 0, 0.26];
    const geometry = this.own(new THREE.CylinderGeometry(0.5, 0.5, 1, 10));
    const batch = this.instanced(geometry, this.solid(COLOR.grana, { roughness: 0.6 }), chloroplasts.length * spots.length, target);
    batch.name = `cell-${cell.id}-chloroplast-grana`;
    const locals: THREE.Matrix4[] = [];
    const parentIndex: number[] = [];
    chloroplasts.forEach((chloroplast, index) => {
      const outer = placement(chloroplast);
      spots.forEach((spot, offset) => {
        const local = new THREE.Matrix4().compose(new THREE.Vector3(spot, 0, 0), new THREE.Quaternion(), new THREE.Vector3(0.16, 0.55, 0.32));
        locals.push(local);
        parentIndex.push(index);
        batch.setMatrixAt(index * spots.length + offset, outer.clone().multiply(local));
      });
    });
    if (sway) {
      this.swaying.push({ mesh: batch, items: [], drift: 0, follow: { parent: sway, parentIndex, local: locals }, current: [] });
    }
    return batch;
  }

  // --- detail models ---------------------------------------------------------

  private drawMitochondrionDetail(detail: CellSceneDetail): void {
    const holder = this.detailHolder(detail);
    const length = detail.length;
    const radius = length * 0.22;
    const target = (part: OrganelleDetailPart) => organelleDetailTarget(detail.id, part);
    const gap = detail.cutaway ? CUTAWAY_GAP : 0;

    const outer = this.mesh(this.capsuleLathe(length, radius, gap), this.solid(COLOR.mitoOuter, { side: THREE.DoubleSide, roughness: 0.45, clearcoat: 0.5 }), target("outer-membrane"));
    const innerRadius = radius * 0.84;
    const inner = this.mesh(this.capsuleLathe(length - (radius - innerRadius) * 2, innerRadius, gap), this.solid(COLOR.mitoInner, { side: THREE.DoubleSide, roughness: 0.5 }), target("inner-membrane"));
    const matrixRadius = innerRadius * 0.97;
    const matrix = this.mesh(this.capsuleLathe(length - (radius - matrixRadius) * 2, matrixRadius, 0), this.solid(COLOR.matrix, { side: THREE.BackSide, roughness: 0.85 }), target("matrix"));
    holder.add(outer, inner, matrix);

    // Cristae: shelves folding in from the inner membrane, alternately from above and below.
    const cristaeMaterial = this.solid(COLOR.cristae, { side: THREE.DoubleSide, roughness: 0.55 });
    const straight = length / 2 - radius;
    const count = 9;
    for (let index = 0; index < count; index += 1) {
      const x = -straight - innerRadius * 0.5 + ((straight * 2 + innerRadius) * index) / (count - 1);
      const along = Math.max(0, Math.abs(x) - straight);
      const local = Math.sqrt(Math.max(0, innerRadius * innerRadius - along * along)) * 0.97;
      if (local < innerRadius * 0.35) continue;
      const shelf = this.mesh(this.crista(local, index % 2 === 0 ? 1 : -1, length * 0.018), cristaeMaterial, target("cristae"));
      shelf.rotation.y = Math.PI / 2;
      shelf.position.x = x;
      holder.add(shelf);
    }
  }

  private drawChloroplastDetail(detail: CellSceneDetail): void {
    const holder = this.detailHolder(detail);
    const length = detail.length;
    const radii = new THREE.Vector3(length / 2, length * 0.2, length * 0.3);
    const target = (part: OrganelleDetailPart) => organelleDetailTarget(detail.id, part);
    const gap = detail.cutaway ? CUTAWAY_GAP : 0;

    const shell = (scale: number, color: number, part: OrganelleDetailPart, side: THREE.Side, cut: number, opacity = 1) => {
      const mesh = this.mesh(
        this.ellipsoidLathe(cut),
        this.solid(color, { side, roughness: side === THREE.BackSide ? 0.85 : 0.45, clearcoat: 0.4, transparent: opacity < 1, opacity }),
        target(part),
      );
      mesh.scale.copy(radii).multiplyScalar(scale);
      return mesh;
    };
    holder.add(
      shell(1, COLOR.chloroOuter, "outer-membrane", THREE.DoubleSide, gap, 0.92),
      shell(0.94, COLOR.chloroInner, "inner-membrane", THREE.DoubleSide, gap),
      shell(0.92, COLOR.stroma, "stroma", THREE.BackSide, 0),
    );

    // Grana: stacks of round thylakoid discs, joined by thin stroma lamellae.
    const disc = this.own(new THREE.CylinderGeometry(1, 1, 1, this.segments));
    const stacks: THREE.Vector3[] = [];
    for (const [u, w] of [[-0.62, -0.3], [-0.6, 0.32], [-0.3, 0], [0, -0.42], [0, 0.4], [0.02, -0.02], [0.32, 0.24], [0.34, -0.3], [0.62, 0.02]] as const) {
      stacks.push(new THREE.Vector3(u * radii.x * 0.92, 0, w * radii.z * 0.92));
    }
    const discRadius = length * 0.055;
    const discHeight = length * 0.011;
    const discGap = length * 0.006;
    const placements: THREE.Matrix4[] = [];
    for (const centre of stacks) {
      const room = radii.y * 0.85 * Math.sqrt(Math.max(0, 1 - (centre.x / radii.x) ** 2 - (centre.z / radii.z) ** 2));
      const count = Math.max(3, Math.min(9, Math.floor((room * 2) / (discHeight + discGap))));
      for (let index = 0; index < count; index += 1) {
        const y = (index - (count - 1) / 2) * (discHeight + discGap);
        placements.push(new THREE.Matrix4().compose(new THREE.Vector3(centre.x, y, centre.z), new THREE.Quaternion(), new THREE.Vector3(discRadius, discHeight, discRadius)));
      }
    }
    const grana = this.instanced(disc, this.solid(COLOR.grana, { roughness: 0.55, clearcoat: 0.3 }), placements.length, target("grana"));
    placements.forEach((matrix, index) => grana.setMatrixAt(index, matrix));
    holder.add(grana);

    const lamellaMaterial = this.solid(COLOR.lamella, { roughness: 0.6 });
    const lamella = this.own(new THREE.BoxGeometry(1, 1, 1));
    for (let index = 0; index < stacks.length; index += 1) {
      const from = stacks[index] as THREE.Vector3;
      const to = stacks[(index + 1) % stacks.length] as THREE.Vector3;
      const span = from.distanceTo(to);
      if (span > radii.x * 0.8) continue;
      const link = new THREE.Mesh(lamella, lamellaMaterial);
      link.position.copy(from).add(to).multiplyScalar(0.5);
      link.scale.set(span, discHeight * 0.5, discRadius * 0.5);
      link.rotation.y = -Math.atan2(to.z - from.z, to.x - from.x);
      holder.add(link);
    }
  }

  private drawDetail(detail: CellSceneDetail): void {
    switch (detail.organelle) {
      case "mitochondrion":
        return this.drawMitochondrionDetail(detail);
      case "chloroplast":
        return this.drawChloroplastDetail(detail);
      case "cell-wall":
        return this.drawWallDetail(detail);
      case "cell-membrane":
        return this.drawMembraneDetail(detail);
      case "nucleus":
        return this.drawNucleusDetail(detail);
      case "ribosome":
        return this.drawRibosomeDetail(detail);
      case "endoplasmic-reticulum":
        return this.drawReticulumDetail(detail);
      case "golgi-apparatus":
        return this.drawGolgiDetail(detail);
      case "lysosome":
        return this.drawLysosomeDetail(detail);
      case "vacuole":
        return this.drawVacuoleDetail(detail);
    }
  }

  /**
   * A section through the walls of two neighbouring plant cells: criss-crossing cellulose fibres in each
   * wall, the middle lamella gluing them together, and plasmodesmata running through both.
   */
  private drawWallDetail(detail: CellSceneDetail): void {
    const holder = this.detailHolder(detail);
    const L = detail.length;
    const target = (part: OrganelleDetailPart) => organelleDetailTarget(detail.id, part);
    const height = L * 0.55;
    const depth = L * 0.34;
    const lamella = L * 0.05;
    const slabWidth = L / 2 - lamella / 2;
    // The wall matrix: a pale, see-through green so the fibres inside show.
    const slabMaterial = this.solid(COLOR.wall, { roughness: 0.8, transparent: true, opacity: 0.32, depthWrite: false, map: this.texture("fibres") });
    for (const side of [-1, 1]) {
      const slab = this.mesh(this.own(new RoundedBoxGeometry(slabWidth, height, depth, 3, L * 0.015)), slabMaterial, target("cellulose-fibres"));
      slab.position.x = side * (lamella / 2 + slabWidth / 2);
      holder.add(slab);
    }
    const middle = this.mesh(this.own(new RoundedBoxGeometry(lamella, height * 1.01, depth * 1.01, 2, lamella * 0.3)), this.solid(COLOR.lamella2, { roughness: 0.7, map: this.texture("speckle") }), target("middle-lamella"));
    holder.add(middle);
    // Cellulose fibres: thin rods lying flat in the wall's plane (y-z), in layers across its thickness, each
    // layer at the opposite angle to the last, like plywood. Each rod is trimmed to the wall's edges.
    const fibre = this.own(new THREE.CylinderGeometry(0.5, 0.5, 1, 6));
    fibre.rotateZ(Math.PI / 2);
    const placements: THREE.Matrix4[] = [];
    const random = seededRandom(31);
    const layers = 4;
    const halfY = height / 2 - L * 0.02;
    const halfZ = depth / 2 - L * 0.02;
    const spacing = L * 0.045;
    for (const side of [-1, 1]) {
      const cx = side * (lamella / 2 + slabWidth / 2);
      for (let layer = 0; layer < layers; layer += 1) {
        const x = cx + ((layer + 0.5) / layers - 0.5) * slabWidth * 0.8;
        const angle = (layer % 2 === 0 ? 1 : -1) * 0.7 + (random() - 0.5) * 0.12;
        const along = new THREE.Vector3(0, Math.sin(angle), Math.cos(angle));
        const across = new THREE.Vector3(0, Math.cos(angle), -Math.sin(angle));
        const rotation = new THREE.Quaternion().setFromUnitVectors(ALONG, along);
        for (let k = -14; k <= 14; k += 1) {
          const centre = across.clone().multiplyScalar(k * spacing + (random() - 0.5) * spacing * 0.3);
          // Where the line through `centre` along `along` enters and leaves the wall's face.
          let t0 = Number.NEGATIVE_INFINITY;
          let t1 = Number.POSITIVE_INFINITY;
          for (const [c, d, half] of [[centre.y, along.y, halfY], [centre.z, along.z, halfZ]] as const) {
            if (Math.abs(d) < 1e-6) {
              if (Math.abs(c) > half) t0 = Number.POSITIVE_INFINITY;
              continue;
            }
            const a = (-half - c) / d;
            const b = (half - c) / d;
            t0 = Math.max(t0, Math.min(a, b));
            t1 = Math.min(t1, Math.max(a, b));
          }
          if (!(t1 - t0 > L * 0.05)) continue;
          const middle = centre.clone().addScaledVector(along, (t0 + t1) / 2);
          middle.x = x;
          placements.push(new THREE.Matrix4().compose(middle, rotation, new THREE.Vector3(t1 - t0, L * 0.011, L * 0.011)));
        }
      }
    }
    const fibres = this.instanced(fibre, this.solid(COLOR.cellulose, { roughness: 0.55, clearcoat: 0.3 }), placements.length, target("cellulose-fibres"));
    placements.forEach((matrix, index) => fibres.setMatrixAt(index, matrix));
    holder.add(fibres);
    // Plasmodesmata: channels through both walls, lined with membrane.
    const channel = this.own(new THREE.CylinderGeometry(1, 1, 1, this.segments, 1, true));
    channel.rotateZ(Math.PI / 2);
    const channelMaterial = this.solid(COLOR.plasmodesma, { roughness: 0.45, clearcoat: 0.5, side: THREE.DoubleSide });
    for (const [y, z] of [[0.16, 0.05], [-0.12, -0.08], [0.02, 0.12]] as const) {
      const tube = this.mesh(channel, channelMaterial, target("plasmodesmata"));
      tube.position.set(0, y * L, z * L);
      tube.scale.set(L * 1.01, L * 0.018, L * 0.018);
      holder.add(tube);
      const core = this.mesh(channel, channelMaterial, target("plasmodesmata"));
      core.position.copy(tube.position);
      core.scale.set(L * 1.012, L * 0.007, L * 0.007);
      holder.add(core);
    }
  }

  /**
   * A patch of cell membrane: a phospholipid bilayer (heads outwards, two fatty tails each pointing in)
   * with proteins set across it, one of them an open channel.
   */
  private drawMembraneDetail(detail: CellSceneDetail): void {
    const holder = this.detailHolder(detail);
    const L = detail.length;
    const target = (part: OrganelleDetailPart) => organelleDetailTarget(detail.id, part);
    const thickness = L * 0.22;
    const headRadius = L * 0.026;
    const columns = 16;
    const rows = 7;
    const width = L;
    const depth = L * 0.45;
    const proteins = [
      { x: -0.22, z: 0.04, r: 0.085, channel: true },
      { x: 0.24, z: -0.06, r: 0.075, channel: false },
      { x: 0.02, z: -0.14, r: 0.06, channel: false },
    ];
    const clear = (x: number, z: number) => proteins.every((p) => Math.hypot(x - p.x * L, z - p.z * L) > p.r * L + headRadius);
    const heads: THREE.Matrix4[] = [];
    const tails: THREE.Matrix4[] = [];
    const random = seededRandom(57);
    const tailLength = thickness / 2 - headRadius * 1.1;
    for (const side of [1, -1]) {
      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          const x = ((column + 0.5 + (row % 2) * 0.5) / columns - 0.5) * width;
          const z = ((row + 0.5) / rows - 0.5) * depth;
          if (Math.abs(x) > width / 2 || !clear(x, z)) continue;
          const y = side * (thickness / 2) + (random() - 0.5) * headRadius * 0.3;
          heads.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3().setScalar(headRadius * 2)));
          for (const offset of [-0.35, 0.35]) {
            const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), (random() - 0.5) * 0.25);
            tails.push(new THREE.Matrix4().compose(new THREE.Vector3(x + offset * headRadius, y - side * (headRadius + tailLength / 2), z), tilt, new THREE.Vector3(headRadius * 0.32, tailLength, headRadius * 0.32)));
          }
        }
      }
    }
    const headMesh = this.instanced(this.sphere(), this.solid(COLOR.lipidHead, { roughness: 0.35, clearcoat: 0.6 }), heads.length, target("phospholipid-heads"));
    heads.forEach((matrix, index) => headMesh.setMatrixAt(index, matrix));
    const tail = this.own(new THREE.CylinderGeometry(0.5, 0.5, 1, 6));
    const tailMesh = this.instanced(tail, this.solid(COLOR.lipidTail, { roughness: 0.6 }), tails.length, target("lipid-tails"));
    tails.forEach((matrix, index) => tailMesh.setMatrixAt(index, matrix));
    holder.add(headMesh, tailMesh);
    // Proteins: lumpy, rounded bodies spanning the bilayer; the channel is an open barrel.
    const proteinMaterial = this.solid(COLOR.protein, { roughness: 0.45, clearcoat: 0.5, map: this.texture("mottle") });
    for (const protein of proteins) {
      const radius = protein.r * L;
      if (protein.channel) {
        const profile: THREE.Vector2[] = [];
        for (let step = 0; step <= 12; step += 1) {
          const t = step / 12;
          const y = (t - 0.5) * thickness * 1.5;
          profile.push(new THREE.Vector2(radius * (0.42 + 0.58 * Math.sin(Math.PI * t) ** 0.6), y));
        }
        for (let step = 12; step >= 0; step -= 1) {
          const t = step / 12;
          profile.push(new THREE.Vector2(radius * 0.36, (t - 0.5) * thickness * 1.5));
        }
        const barrel = this.mesh(this.own(new THREE.LatheGeometry(profile, this.segments)), proteinMaterial, target("membrane-protein"));
        barrel.position.set(protein.x * L, 0, protein.z * L);
        holder.add(barrel);
      } else {
        const body = this.mesh(this.blobGeometry({ x: radius * 2, y: thickness * 1.35, z: radius * 1.8 }, radius * 0.25, Math.round(protein.x * 100) + 7), proteinMaterial, target("membrane-protein"));
        body.position.set(protein.x * L, 0, protein.z * L);
        holder.add(body);
      }
    }
  }

  /** A nucleus cut open: the double envelope with its pores, chromatin threads, and the dense nucleolus. */
  private drawNucleusDetail(detail: CellSceneDetail): void {
    const holder = this.detailHolder(detail);
    const L = detail.length;
    const radius = L * 0.46;
    const target = (part: OrganelleDetailPart) => organelleDetailTarget(detail.id, part);
    const gap = detail.cutaway ? CUTAWAY_GAP * 0.8 : 0;
    const shell = (scale: number, color: number, part: OrganelleDetailPart, side: THREE.Side, cut: number, extra: THREE.MeshPhysicalMaterialParameters = {}) => {
      const mesh = this.mesh(this.ellipsoidLathe(cut), this.solid(color, { side, roughness: 0.5, clearcoat: 0.5, ...extra }), target(part));
      mesh.scale.setScalar(radius * scale);
      // Open the wedge towards the viewer's upper side, where the camera looks from.
      mesh.rotation.x = -0.35;
      return mesh;
    };
    holder.add(
      shell(1, COLOR.nucleus, "nuclear-envelope", THREE.DoubleSide, gap, { map: this.texture("mottle") }),
      shell(0.95, COLOR.nucleusInner, "nuclear-envelope", THREE.DoubleSide, gap),
      shell(0.93, COLOR.nucleoplasm, "chromatin", THREE.BackSide, 0, { roughness: 0.9, map: this.texture("mottle") }),
    );
    // Pores: small rings set into the envelope, away from the open wedge.
    const pores: THREE.Matrix4[] = [];
    const random = seededRandom(73);
    const open = new THREE.Vector3(0, Math.sin(0.35), Math.cos(0.35));
    for (let attempt = 0; attempt < 400 && pores.length < 46; attempt += 1) {
      const direction = new THREE.Vector3(random() * 2 - 1, random() * 2 - 1, random() * 2 - 1);
      if (direction.lengthSq() > 1 || direction.lengthSq() < 0.05) continue;
      direction.normalize();
      if (detail.cutaway && direction.dot(open) > Math.cos(gap / 2 + 0.12)) continue;
      const rotation = new THREE.Quaternion().setFromUnitVectors(UP, direction);
      pores.push(new THREE.Matrix4().compose(direction.clone().multiplyScalar(radius * 1.005), rotation, new THREE.Vector3(radius * 0.07, radius * 0.07, radius * 0.07)));
    }
    const ring = this.own(new THREE.TorusGeometry(0.5, 0.22, 8, 16));
    ring.rotateX(Math.PI / 2);
    const poreMesh = this.instanced(ring, this.solid(COLOR.pore, { roughness: 0.4 }), pores.length, target("nuclear-pore"));
    pores.forEach((matrix, index) => poreMesh.setMatrixAt(index, matrix));
    holder.add(poreMesh);
    // Chromatin: loose, coiled threads.
    const threadMaterial = this.solid(COLOR.chromatin, { roughness: 0.55, clearcoat: 0.3 });
    for (let index = 0; index < 12; index += 1) {
      const points: THREE.Vector3[] = [];
      let point = new THREE.Vector3((random() - 0.5) * radius, (random() - 0.5) * radius, (random() - 0.5) * radius);
      for (let step = 0; step < 9; step += 1) {
        points.push(point.clone());
        point = point.add(new THREE.Vector3(random() - 0.5, random() - 0.5, random() - 0.5).multiplyScalar(radius * 0.38));
        if (point.length() > radius * 0.78) point.multiplyScalar(0.6);
      }
      const thread = this.mesh(this.own(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 48, radius * 0.013, 6)), threadMaterial, target("chromatin"));
      holder.add(thread);
    }
    const nucleolus = this.mesh(this.blobGeometry({ x: radius * 0.64, y: radius * 0.6, z: radius * 0.62 }, radius * 0.05, 19), this.solid(COLOR.nucleolus, { roughness: 0.55, clearcoat: 0.3, map: this.texture("mottle") }), target("nucleolus"));
    nucleolus.position.set(radius * 0.08, radius * 0.05, radius * 0.18);
    holder.add(nucleolus);
  }

  /** A ribosome at work: large and small subunits with messenger RNA running between them and a protein chain coming out. */
  private drawRibosomeDetail(detail: CellSceneDetail): void {
    const holder = this.detailHolder(detail);
    const L = detail.length;
    const target = (part: OrganelleDetailPart) => organelleDetailTarget(detail.id, part);
    const large = this.mesh(this.blobGeometry({ x: L * 0.52, y: L * 0.36, z: L * 0.42 }, L * 0.03, 41), this.solid(COLOR.ribosomeLarge, { roughness: 0.6, map: this.texture("mottle") }), target("large-subunit"));
    large.position.y = L * 0.12;
    const small = this.mesh(this.blobGeometry({ x: L * 0.46, y: L * 0.2, z: L * 0.36 }, L * 0.025, 43), this.solid(COLOR.ribosomeSmall, { roughness: 0.6, map: this.texture("mottle") }), target("small-subunit"));
    small.position.y = -L * 0.14;
    holder.add(large, small);
    // mRNA: a strand threading through the gap between the subunits.
    const strand: THREE.Vector3[] = [];
    for (let step = 0; step <= 16; step += 1) {
      const x = (step / 16 - 0.5) * L * 1.2;
      strand.push(new THREE.Vector3(x, -L * 0.03 + Math.sin(step * 0.9) * L * 0.015, Math.cos(step * 0.7) * L * 0.02));
    }
    holder.add(this.mesh(this.own(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(strand), 80, L * 0.014, 8)), this.solid(COLOR.mrna, { roughness: 0.4, clearcoat: 0.5 }), target("mrna")));
    // The growing protein: a curling chain of beads in many colours (different building blocks).
    const beads: THREE.Matrix4[] = [];
    const tones = [0xe85d75, 0xf2a541, 0x5cb85c, 0x4fa3e0, 0xb57fe0, 0xf06fb0];
    const colors: THREE.Color[] = [];
    for (let index = 0; index < 12; index += 1) {
      const t = index / 11;
      const position = new THREE.Vector3(Math.sin(t * 5) * L * 0.1 + t * L * 0.16, L * 0.3 + t * L * 0.24, Math.cos(t * 5) * L * 0.09);
      beads.push(new THREE.Matrix4().compose(position, new THREE.Quaternion(), new THREE.Vector3().setScalar(L * 0.068)));
      colors.push(new THREE.Color(tones[index % tones.length] as number));
    }
    const chain = this.instanced(this.sphere(), this.solid(0xffffff, { roughness: 0.35, clearcoat: 0.6 }), beads.length, target("protein-chain"));
    beads.forEach((matrix, index) => {
      chain.setMatrixAt(index, matrix);
      chain.setColorAt(index, colors[index] as THREE.Color);
    });
    holder.add(chain);
  }

  /** Rough ER (folded sheets studded with ribosomes) beside smooth ER (a tangle of bare tubes). */
  private drawReticulumDetail(detail: CellSceneDetail): void {
    const holder = this.detailHolder(detail);
    const L = detail.length;
    const target = (part: OrganelleDetailPart) => organelleDetailTarget(detail.id, part);
    const roughMaterial = this.solid(COLOR.reticulum, { roughness: 0.45, clearcoat: 0.5, side: THREE.DoubleSide, map: this.texture("mottle") });
    const studs: THREE.Matrix4[] = [];
    const random = seededRandom(97);
    for (let index = 0; index < 4; index += 1) {
      const sheet = this.own(new THREE.BoxGeometry(L * 0.5, L * 0.035, L * 0.5, 24, 1, 24));
      const position = sheet.getAttribute("position") as THREE.BufferAttribute;
      for (let vertex = 0; vertex < position.count; vertex += 1) {
        const x = position.getX(vertex);
        const z = position.getZ(vertex);
        position.setY(vertex, position.getY(vertex) + Math.sin(x / L * 14 + index) * L * 0.035 + Math.sin(z / L * 9) * L * 0.02);
      }
      sheet.computeVertexNormals();
      const mesh = this.mesh(sheet, roughMaterial, target("rough-er"));
      mesh.position.set(-L * 0.25, (index - 1.5) * L * 0.12, 0);
      holder.add(mesh);
      for (let stud = 0; stud < 70; stud += 1) {
        const x = (random() - 0.5) * L * 0.48;
        const z = (random() - 0.5) * L * 0.48;
        const y = (index - 1.5) * L * 0.12 + Math.sin(x / L * 14 + index) * L * 0.035 + Math.sin(z / L * 9) * L * 0.02 + (random() < 0.5 ? 1 : -1) * L * 0.028;
        studs.push(new THREE.Matrix4().compose(new THREE.Vector3(x - L * 0.25, y, z), new THREE.Quaternion(), new THREE.Vector3().setScalar(L * 0.022)));
      }
    }
    const ribosomes = this.instanced(this.sphere(), this.solid(COLOR.ribosome, { roughness: 0.6 }), studs.length, target("rough-er"));
    studs.forEach((matrix, index) => ribosomes.setMatrixAt(index, matrix));
    holder.add(ribosomes);
    // Smooth ER: branching tubes with no ribosomes.
    const smoothMaterial = this.solid(COLOR.smoothReticulum, { roughness: 0.4, clearcoat: 0.6, map: this.texture("mottle") });
    for (let index = 0; index < 7; index += 1) {
      const points: THREE.Vector3[] = [];
      let point = new THREE.Vector3(L * (0.08 + random() * 0.1), (random() - 0.5) * L * 0.4, (random() - 0.5) * L * 0.4);
      for (let step = 0; step < 6; step += 1) {
        points.push(point.clone());
        point = point.add(new THREE.Vector3(random() * 0.6, random() - 0.5, random() - 0.5).multiplyScalar(L * 0.12));
        point.x = Math.min(point.x, L * 0.5);
      }
      holder.add(this.mesh(this.own(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 40, L * 0.028, 10)), smoothMaterial, target("smooth-er")));
    }
  }

  /** A Golgi stack up close: curved cisternae, lighter on the receiving side, with vesicles budding off the rims. */
  private drawGolgiDetail(detail: CellSceneDetail): void {
    const holder = this.detailHolder(detail);
    const L = detail.length;
    const target = (part: OrganelleDetailPart) => organelleDetailTarget(detail.id, part);
    const sacs = 6;
    const spacing = L * 0.075;
    const shades = [COLOR.golgiCis, COLOR.golgi, COLOR.golgi, COLOR.golgiTrans, COLOR.golgiTrans, COLOR.golgiTrans];
    for (let index = 0; index < sacs; index += 1) {
      const middle = (sacs - 1) / 2;
      const width = L * (0.86 - Math.abs(index - middle) * 0.09);
      const geometry = this.own(new THREE.CylinderGeometry(width / 2, width / 2, spacing * 0.5, this.segments, 1));
      bend(geometry, 2.3 / L);
      const sac = this.mesh(geometry, this.solid(shades[index] as number, { roughness: 0.45, clearcoat: 0.5, map: this.texture("mottle") }), target("cisternae"));
      sac.position.y = (index - middle) * spacing;
      sac.scale.z = 0.55;
      holder.add(sac);
    }
    const vesicles: THREE.Matrix4[] = [];
    const random = seededRandom(23);
    for (let index = 0; index < 14; index += 1) {
      const side = index % 2 === 0 ? 1 : -1;
      const reach = L * (0.46 + random() * 0.14);
      const point = new THREE.Vector3(side * reach, (random() - 0.5) * L * 0.4, (random() - 0.5) * L * 0.3);
      vesicles.push(new THREE.Matrix4().compose(point, new THREE.Quaternion(), new THREE.Vector3().setScalar(L * (0.05 + random() * 0.03))));
    }
    const batch = this.instanced(this.sphere(), this.solid(COLOR.vesicle, { roughness: 0.3, clearcoat: 0.8, transparent: true, opacity: 0.92 }), vesicles.length, target("vesicles"));
    vesicles.forEach((matrix, index) => batch.setMatrixAt(index, matrix));
    holder.add(batch);
  }

  /** A lysosome cut open: its membrane and the digestive enzymes packed inside. */
  private drawLysosomeDetail(detail: CellSceneDetail): void {
    const holder = this.detailHolder(detail);
    const L = detail.length;
    const radius = L * 0.45;
    const target = (part: OrganelleDetailPart) => organelleDetailTarget(detail.id, part);
    const gap = detail.cutaway ? CUTAWAY_GAP * 0.8 : 0;
    const membrane = this.mesh(this.ellipsoidLathe(gap), this.solid(COLOR.lysosome, { side: THREE.DoubleSide, roughness: 0.4, clearcoat: 0.6, map: this.texture("speckle") }), target("lysosome-membrane"));
    membrane.scale.setScalar(radius);
    membrane.rotation.x = -0.35;
    const fluid = this.mesh(this.ellipsoidLathe(0), this.solid(COLOR.lysosomeFluid, { side: THREE.BackSide, roughness: 0.9 }), target("enzymes"));
    fluid.scale.setScalar(radius * 0.95);
    holder.add(membrane, fluid);
    const enzymes: THREE.Matrix4[] = [];
    const colors: THREE.Color[] = [];
    const random = seededRandom(61);
    while (enzymes.length < 70) {
      const point = new THREE.Vector3(random() * 2 - 1, random() * 2 - 1, random() * 2 - 1);
      if (point.length() > 0.85) continue;
      const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(random() * 3, random() * 3, random() * 3));
      enzymes.push(new THREE.Matrix4().compose(point.multiplyScalar(radius), rotation, new THREE.Vector3(1, 0.7 + random() * 0.4, 0.8).multiplyScalar(L * (0.045 + random() * 0.03))));
      colors.push(new THREE.Color(random() < 0.5 ? COLOR.enzymeA : COLOR.enzymeB));
    }
    const batch = this.instanced(this.own(new THREE.IcosahedronGeometry(0.5, 0)), this.solid(0xffffff, { roughness: 0.5, flatShading: true }), enzymes.length, target("enzymes"));
    enzymes.forEach((matrix, index) => {
      batch.setMatrixAt(index, matrix);
      batch.setColorAt(index, colors[index] as THREE.Color);
    });
    holder.add(batch);
  }

  /** A central vacuole cut open: the tonoplast around clear cell sap with dissolved sugars and salts. */
  private drawVacuoleDetail(detail: CellSceneDetail): void {
    const holder = this.detailHolder(detail);
    const L = detail.length;
    const radii = new THREE.Vector3(L * 0.5, L * 0.32, L * 0.36);
    const target = (part: OrganelleDetailPart) => organelleDetailTarget(detail.id, part);
    const gap = detail.cutaway ? CUTAWAY_GAP * 0.8 : 0;
    const tonoplast = this.mesh(this.ellipsoidLathe(gap), this.solid(COLOR.tonoplast, { side: THREE.DoubleSide, roughness: 0.15, clearcoat: 1, transparent: true, opacity: 0.62, map: this.texture("mottle") }), target("tonoplast"));
    tonoplast.scale.copy(radii);
    tonoplast.rotation.x = -0.3;
    const sap = this.mesh(this.ellipsoidLathe(0), this.solid(COLOR.cellSap, { side: THREE.BackSide, roughness: 0.2, transparent: true, opacity: 0.85 }), target("cell-sap"));
    sap.scale.copy(radii).multiplyScalar(0.96);
    holder.add(tonoplast, sap);
    const particles: THREE.Matrix4[] = [];
    const colors: THREE.Color[] = [];
    const random = seededRandom(83);
    while (particles.length < 90) {
      const point = new THREE.Vector3(random() * 2 - 1, random() * 2 - 1, random() * 2 - 1);
      if (point.length() > 0.85) continue;
      point.multiply(radii);
      particles.push(new THREE.Matrix4().compose(point, new THREE.Quaternion(), new THREE.Vector3().setScalar(L * (0.012 + random() * 0.014))));
      colors.push(new THREE.Color(random() < 0.5 ? COLOR.sugar : COLOR.salt));
    }
    const batch = this.instanced(this.sphere(), this.solid(0xffffff, { roughness: 0.3, clearcoat: 0.6 }), particles.length, target("cell-sap"));
    particles.forEach((matrix, index) => {
      batch.setMatrixAt(index, matrix);
      batch.setColorAt(index, colors[index] as THREE.Color);
    });
    holder.add(batch);
  }

  /**
   * Small procedural textures that give surfaces a natural, slightly uneven finish (no image files): `mottle` for
   * soft blotches, `speckle` for fine grains, `fibres` for the wall's woven strands, `cristae` for the folded
   * inner membrane showing through a mitochondrion.
   */
  private texture(kind: "mottle" | "speckle" | "fibres" | "cristae"): THREE.Texture | null {
    const cached = this.textures.get(kind);
    if (cached !== undefined) return cached;
    if (typeof document === "undefined") {
      this.textures.set(kind, null);
      return null;
    }
    const size = 256;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) {
      this.textures.set(kind, null);
      return null;
    }
    const random = seededRandom(kind.length * 977);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, size, size);
    if (kind === "mottle") {
      for (let index = 0; index < 140; index += 1) {
        const r = 6 + random() * 26;
        const shade = Math.round(205 + random() * 50);
        context.fillStyle = `rgba(${shade},${shade},${shade},${0.25 + random() * 0.35})`;
        context.beginPath();
        context.arc(random() * size, random() * size, r, 0, Math.PI * 2);
        context.fill();
      }
    } else if (kind === "speckle") {
      for (let index = 0; index < 900; index += 1) {
        const shade = Math.round(170 + random() * 70);
        context.fillStyle = `rgba(${shade},${shade},${shade},0.7)`;
        context.fillRect(random() * size, random() * size, 1 + random() * 2, 1 + random() * 2);
      }
    } else if (kind === "fibres") {
      context.lineCap = "round";
      for (let index = 0; index < 160; index += 1) {
        const shade = Math.round(200 + random() * 50);
        context.strokeStyle = `rgba(${shade},${shade},${shade},0.8)`;
        context.lineWidth = 1 + random() * 2.5;
        const angle = (random() < 0.5 ? 0.35 : -0.35) + (random() - 0.5) * 0.2;
        const x = random() * size;
        const y = random() * size;
        context.beginPath();
        context.moveTo(x - Math.cos(angle) * 140, y - Math.sin(angle) * 140);
        context.lineTo(x + Math.cos(angle) * 140, y + Math.sin(angle) * 140);
        context.stroke();
      }
    } else {
      // Cristae: wavy folds across the width of the capsule.
      context.strokeStyle = "rgba(150,150,150,0.85)";
      context.lineWidth = 5;
      for (let index = 0; index < 9; index += 1) {
        const x = 14 + index * 28;
        context.beginPath();
        for (let y = 0; y <= size; y += 8) {
          const wobble = Math.sin(y / 18 + index) * 6;
          if (y === 0) context.moveTo(x + wobble, y);
          else context.lineTo(x + wobble, y);
        }
        context.stroke();
      }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    this.textures.set(kind, texture);
    return texture;
  }

  private detailHolder(detail: CellSceneDetail): THREE.Group {
    // The floating part moves; the holder keeps the model's place and turn.
    const anchor = new THREE.Group();
    anchor.name = `detail-${detail.id}-place`;
    anchor.position.set(detail.position.x, detail.position.y, detail.position.z);
    anchor.rotation.y = detail.yaw;
    const holder = new THREE.Group();
    holder.name = `detail-${detail.id}`;
    anchor.add(holder);
    this.root.add(anchor);
    this.floating.push({ object: holder, base: new THREE.Vector3(), rise: detail.length * 0.012, phase: detail.length * 7 });
    return holder;
  }

  /** A capsule revolved about +x, open in a wedge facing +z when `gap` > 0. */
  private capsuleLathe(length: number, radius: number, gap: number): THREE.BufferGeometry {
    const straight = Math.max(0, length / 2 - radius);
    const points: THREE.Vector2[] = [];
    const capSteps = Math.round(this.segments / 4);
    for (let step = 0; step <= capSteps; step += 1) {
      const angle = (Math.PI / 2) * (step / capSteps);
      points.push(new THREE.Vector2(Math.sin(angle) * radius, -straight - Math.cos(angle) * radius));
    }
    for (let step = capSteps; step >= 0; step -= 1) {
      const angle = (Math.PI / 2) * (step / capSteps);
      points.push(new THREE.Vector2(Math.sin(angle) * radius, straight + Math.cos(angle) * radius));
    }
    return this.revolve(points, gap);
  }

  /** A unit sphere revolved about +x (scaled into an ellipsoid by the mesh), open like {@link capsuleLathe}. */
  private ellipsoidLathe(gap: number): THREE.BufferGeometry {
    const points: THREE.Vector2[] = [];
    const steps = Math.round(this.segments / 2);
    for (let step = 0; step <= steps; step += 1) {
      const angle = Math.PI * (step / steps);
      points.push(new THREE.Vector2(Math.sin(angle), -Math.cos(angle)));
    }
    return this.revolve(points, gap);
  }

  private revolve(points: THREE.Vector2[], gap: number): THREE.BufferGeometry {
    // Lathe turns about +y with phi = 0 at +z; centring the gap on phi = 0 opens it towards +z.
    const geometry = new THREE.LatheGeometry(points, this.segments, gap / 2, Math.PI * 2 - gap);
    geometry.rotateZ(-Math.PI / 2);
    return this.own(geometry);
  }

  /** One crista: a thin shelf filling a circle of `radius` from one side to just past the middle. */
  private crista(radius: number, side: 1 | -1, thickness: number): THREE.BufferGeometry {
    const reach = -0.3 * radius;
    const start = Math.asin(reach / radius);
    const shape = new THREE.Shape();
    const steps = 18;
    for (let step = 0; step <= steps; step += 1) {
      const angle = start + ((Math.PI - 2 * start) * step) / steps;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius * side;
      if (step === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: thickness,
      bevelEnabled: true,
      bevelThickness: thickness * 0.4,
      bevelSize: thickness * 0.5,
      bevelSegments: 2,
      curveSegments: 4,
    });
    geometry.translate(0, 0, -thickness / 2);
    return this.own(geometry);
  }

  // --- helpers ---------------------------------------------------------------

  /** An ellipsoid of the given full size with a gently irregular surface. */
  private blobGeometry(size: Position3, wobble: number, seed: number): THREE.BufferGeometry {
    // Welded, so the normals are shared and the surface shades smoothly rather than in facets.
    const geometry = this.own(mergeVertices(new THREE.IcosahedronGeometry(1, this.segments > 24 ? 6 : 4)));
    const random = seededRandom(seed);
    const waves = Array.from({ length: 4 }, () => ({
      direction: new THREE.Vector3(random() * 2 - 1, random() * 2 - 1, random() * 2 - 1).normalize(),
      frequency: 1.5 + random() * 2,
      phase: random() * Math.PI * 2,
      weight: 0.5 + random() * 0.5,
    }));
    const total = waves.reduce((sum, wave) => sum + wave.weight, 0);
    const position = geometry.getAttribute("position") as THREE.BufferAttribute;
    const point = new THREE.Vector3();
    for (let index = 0; index < position.count; index += 1) {
      point.fromBufferAttribute(position, index).normalize();
      let bump = 0;
      for (const wave of waves) bump += wave.weight * Math.sin(wave.frequency * point.dot(wave.direction) * Math.PI + wave.phase);
      const scale = 1 + (bump / total) * (wobble / Math.min(size.x, size.y, size.z)) * 2;
      position.setXYZ(index, (point.x * size.x * scale) / 2, (point.y * size.y * scale) / 2, (point.z * size.z * scale) / 2);
    }
    geometry.computeVertexNormals();
    return geometry;
  }

  /** Shared sphere of diameter 1, rebuilt with each frame. */
  private sphere(): THREE.BufferGeometry {
    this.unitSphere ??= this.own(new THREE.SphereGeometry(0.5, this.segments, Math.round(this.segments / 2)));
    return this.unitSphere;
  }

  private shell(
    color: number,
    opacity: number,
    extra: { side?: THREE.Side; roughness?: number; clearcoat?: number; sheen?: number; map?: THREE.Texture | null } = {},
  ): THREE.MeshPhysicalMaterial {
    return this.solid(color, { roughness: 0.5, ...extra, transparent: true, opacity, depthWrite: false });
  }

  private solid(color: number, params: THREE.MeshPhysicalMaterialParameters = {}): THREE.MeshPhysicalMaterial {
    const material = new THREE.MeshPhysicalMaterial({ color, roughness: 0.5, ...params });
    if (params.sheen) material.sheenColor = new THREE.Color(0xffffff);
    material.userData.baseOpacity = material.opacity;
    material.userData.baseDepthWrite = material.depthWrite;
    this.materials.push(material);
    if (this.collectingCell) this.cellMaterials.push(material);
    return material;
  }

  private own<T extends THREE.BufferGeometry>(geometry: T): T {
    this.geometries.push(geometry);
    return geometry;
  }

  private mesh(geometry: THREE.BufferGeometry, material: THREE.MeshPhysicalMaterial, target: string | null, backdrop = false): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, material);
    if (target) this.register(mesh, material, target, backdrop);
    return mesh;
  }

  private instanced(geometry: THREE.BufferGeometry, material: THREE.Material, count: number, target: string): THREE.InstancedMesh {
    const batch = new THREE.InstancedMesh(geometry, material, Math.max(1, count));
    batch.count = count;
    this.register(batch, material as THREE.MeshPhysicalMaterial, target, false);
    return batch;
  }

  private register(object: THREE.Mesh, material: THREE.MeshStandardMaterial, target: string, backdrop: boolean): void {
    object.userData.interactionTarget = target;
    if (backdrop) object.userData.pickBackdrop = true;
    this.picks.push(object);
    const objects = this.targetObjects.get(target) ?? [];
    objects.push(object);
    this.targetObjects.set(target, objects);
    const list = this.targets.get(target) ?? [];
    if (!list.some((entry) => entry.material === material)) {
      list.push({
        material,
        shell: material.transparent && !material.depthWrite,
        color: material.color.clone(),
        emissive: material.emissive.clone(),
        emissiveIntensity: material.emissiveIntensity,
        opacity: material.opacity,
      });
    }
    this.targets.set(target, list);
  }

  /** Outline and light the highlighted structure, and fade everything else back. */
  private applyHighlight(): void {
    for (const outline of this.outlines) outline.removeFromParent();
    this.outlines = [];
    const active = this.highlightTarget !== null && this.targets.has(this.highlightTarget);
    const dim = new THREE.Color(COLOR.dim);
    const glow = new THREE.Color(COLOR.highlight);
    for (const [target, entries] of this.targets) {
      const on = target === this.highlightTarget;
      for (const entry of entries) {
        const material = entry.material;
        material.color.copy(entry.color);
        if (active && !on) material.color.lerp(dim, DIM_AMOUNT);
        material.emissive.copy(on ? glow : entry.emissive);
        material.emissiveIntensity = on ? (entry.shell ? 0.18 : 0.5) : entry.emissiveIntensity;
        material.opacity = on ? Math.min(1, entry.opacity + (entry.shell ? 0.08 : 0.25)) : active ? entry.opacity * 0.6 : entry.opacity;
        // A lit shell writes depth, so its outline shows only at the rim and not through it.
        if (entry.shell) material.depthWrite = on;
      }
    }
    this.fadeBackdrop();
    if (!active) return;
    for (const object of this.targetObjects.get(this.highlightTarget as string) ?? []) {
      const outline = object instanceof THREE.InstancedMesh
        ? Object.assign(new THREE.InstancedMesh(object.geometry, this.outlineMaterial, object.count), { instanceMatrix: object.instanceMatrix })
        : new THREE.Mesh(object.geometry, this.outlineMaterial);
      if (outline instanceof THREE.InstancedMesh) outline.count = (object as THREE.InstancedMesh).count;
      outline.name = "cell-highlight-outline";
      outline.frustumCulled = false;
      outline.raycast = () => undefined;
      outline.renderOrder = 4;
      object.add(outline);
      this.outlines.push(outline);
    }
  }

  /** While a magnified view shows, the cells behind it fade to a pale ghost; otherwise they look as drawn. */
  private fadeBackdrop(): void {
    const registered = new Set<THREE.Material>();
    for (const entries of this.targets.values()) for (const entry of entries) registered.add(entry.material);
    for (const material of this.cellMaterials) {
      // Registered materials were just reset by the highlight; the rest start from how they were made.
      const opacity = registered.has(material) ? material.opacity : (material.userData.baseOpacity as number);
      if (this.backdrop) {
        material.transparent = true;
        material.opacity = opacity * 0.22;
        material.depthWrite = false;
      } else if (!registered.has(material)) {
        material.opacity = opacity;
        material.depthWrite = material.userData.baseDepthWrite as boolean;
      }
      material.needsUpdate = true;
    }
  }

  private clear(): void {
    // Outlines share their batch's matrices, so they are only detached, never disposed.
    for (const outline of this.outlines) outline.removeFromParent();
    this.outlines = [];
    this.root.traverse((object) => {
      if (object instanceof THREE.InstancedMesh) object.dispose();
    });
    this.driver.removeFromParent();
    this.targetObjects.clear();
    this.swaying = [];
    this.breathing = [];
    this.floating = [];
    for (const child of [...this.root.children]) child.removeFromParent();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.geometries.length = 0;
    this.unitSphere = null;
    this.materials.length = 0;
    this.cellMaterials = [];
    this.picks.length = 0;
    this.targets.clear();
  }
}

/** How far each kind of scattered organelle drifts as it sways, in content units. */
const SWAY_DRIFT: Readonly<Record<CellSceneOrganelleKind, number>> = {
  mitochondrion: 0.045,
  chloroplast: 0.032,
  lysosome: 0.05,
  ribosome: 0.035,
};

/** Transform for a scattered organelle: unit shapes stretched to size, length along its axis. */
function placement(organelle: CellSceneOrganelle): THREE.Matrix4 {
  const axis = new THREE.Vector3(organelle.axis.x, organelle.axis.y, organelle.axis.z).normalize();
  const rotation = new THREE.Quaternion().setFromUnitVectors(ALONG, axis);
  rotation.multiply(new THREE.Quaternion().setFromAxisAngle(ALONG, organelle.roll));
  return new THREE.Matrix4().compose(
    new THREE.Vector3(organelle.position.x, organelle.position.y, organelle.position.z),
    rotation,
    new THREE.Vector3(organelle.size.x, organelle.size.y, organelle.size.z),
  );
}

/** Push a sphere-cap sheet in and out so it looks folded. */
function ripple(geometry: THREE.BufferGeometry, amount: number, frequency: number, phase: number): void {
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  const point = new THREE.Vector3();
  for (let index = 0; index < position.count; index += 1) {
    point.fromBufferAttribute(position, index);
    const radius = point.length();
    const angle = Math.atan2(point.z, point.x);
    const scale = 1 + (amount / radius) * Math.sin(angle * frequency + phase) * Math.sin(point.y * frequency * 2);
    position.setXYZ(index, point.x * scale, point.y * scale, point.z * scale);
  }
  geometry.computeVertexNormals();
}

/** Curve a flat disc (in x-z) into a shallow bowl, like a Golgi sac. */
function bend(geometry: THREE.BufferGeometry, curvature: number): void {
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const z = position.getZ(index);
    position.setY(index, position.getY(index) - curvature * (x * x + z * z) * 0.5);
  }
  geometry.computeVertexNormals();
}

function length(point: Position3): number {
  return Math.hypot(point.x, point.y, point.z);
}
