/*
 * The physics behind the Simple Machines lab, apart from the drawing so it can be checked on its own.
 * Every machine is ideal: no friction and no weight of its own. What a machine gives in force it takes back in distance.
 */

/** Effort needed to balance a load on a lever: effort × effort arm = load × load arm. */
export const leverEffort = (load: number, loadArm: number, effortArm: number): number => (effortArm > 0 ? (load * loadArm) / effortArm : 0)

/** The three classes, from where the fulcrum, load and effort sit along the bar. Positions are measured along the bar. */
export function leverClass(fulcrum: number, load: number, effort: number): 1 | 2 | 3 {
  const between = (a: number, x: number, b: number) => Math.min(a, b) < x && x < Math.max(a, b)
  if (between(load, fulcrum, effort)) return 1
  if (between(fulcrum, load, effort)) return 2
  return 3
}

/** Pulleys: n rope sections hold the load. */
export const pulleyEffort = (load: number, n: number): number => load / Math.max(1, n)
export const ropePulled = (height: number, n: number): number => height * Math.max(1, n)

/** Wheel and axle: effort at the rim of the wheel to lift a load hung from the axle. */
export const wheelEffort = (load: number, axleRadius: number, wheelRadius: number): number => (wheelRadius > 0 ? (load * axleRadius) / wheelRadius : 0)
/** Turns of the wheel needed to raise the load by `height` (the rope winds onto the axle). */
export const turnsToLift = (height: number, axleRadius: number): number => height / (2 * Math.PI * axleRadius)

/** Smooth inclined plane: effort along the slope to push a load up to `height` along a ramp of `length`. */
export const rampEffort = (load: number, height: number, length: number): number => (length > 0 ? (load * height) / length : 0)

/** Work done by the effort over the distance it moves. */
export const work = (force: number, distance: number): number => force * distance
