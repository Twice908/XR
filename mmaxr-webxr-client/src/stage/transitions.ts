/** Which kind of page a hash path shows, for picking transitions. */
export type View =
  | { readonly name: "login" }
  | { readonly name: "dashboard" }
  | { readonly name: "experiment"; readonly id: string }
  | { readonly name: "other" };

/** How the app moves between two pages. */
export type Transition =
  /** First page after loading: fade in from black. */
  | { readonly kind: "open" }
  /** Sign-in to experiments: jump to light speed and arrive. */
  | { readonly kind: "launch" }
  /** Experiments to sign-in (sign out): pull away quickly. */
  | { readonly kind: "depart" }
  /** Experiments to a lab: fall into its planet. */
  | { readonly kind: "dive"; readonly experimentId: string }
  /** Lab back to experiments: rise out of its planet. */
  | { readonly kind: "surface"; readonly experimentId: string }
  /** Anything else, such as sign-in to register: a colour crossfade. */
  | { readonly kind: "fade" };

const SIGN_IN_PATHS = new Set(["/login", "/register", "/forgot"]);

/** The view for a hash path such as `/lab/abc`. Null stays null (first page after loading). */
export function viewOf(path: string | null): View | null {
  if (path === null) return null;
  if (SIGN_IN_PATHS.has(path)) return { name: "login" };
  if (path === "/experiments") return { name: "dashboard" };
  const lab = /^\/lab\/([^/]+)$/.exec(path);
  if (lab?.[1]) {
    try {
      return { name: "experiment", id: decodeURIComponent(lab[1]) };
    } catch {
      return { name: "other" };
    }
  }
  return { name: "other" };
}

/** Pick the transition for a page change. `from` is null on the first page after loading. */
export function transitionFor(from: View | null, to: View): Transition {
  if (!from) return { kind: "open" };
  if (from.name === "login" && to.name === "dashboard") return { kind: "launch" };
  if (from.name === "dashboard" && to.name === "login") return { kind: "depart" };
  if (from.name === "dashboard" && to.name === "experiment") return { kind: "dive", experimentId: to.id };
  if (from.name === "experiment" && to.name === "dashboard") return { kind: "surface", experimentId: from.id };
  return { kind: "fade" };
}
