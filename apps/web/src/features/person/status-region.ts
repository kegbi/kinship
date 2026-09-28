/**
 * Who makes a person section's state line a live region (REL-052).
 *
 * The workspace keeps the initial fan-out silent (UXD-003B): the lines drawn
 * while it loads ship inert and are promoted in one step once it settles. A
 * section that mounts after that step — its zone opened later — renders a
 * fresh line the promotion never sees, so it owns the region itself, from its
 * first commit. Either way each line has exactly one owner of its role.
 */

/** The attributes a state line spreads: a polite status region, or none. */
export type StatusRegionProps =
  | { readonly "aria-live": "polite"; readonly role: "status" }
  | { readonly "aria-live"?: never; readonly role?: never };

const LIVE: StatusRegionProps = { "aria-live": "polite", role: "status" };
const INERT: StatusRegionProps = {};

/**
 * The region a section mounting now gives its state lines: live when the
 * workspace's promotion has already run (`statesLive` answers true), inert
 * otherwise. Read once, at mount, so a later render never adds a second
 * owner to a line the promotion owns.
 */
export function statusRegion(
  props: { readonly statesLive?: (() => boolean) | undefined },
): StatusRegionProps {
  return props.statesLive?.() ? LIVE : INERT;
}
