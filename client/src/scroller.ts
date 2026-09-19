// The caption scroll container, held outside React on purpose.
//
// Auto-scroll has to happen when the partial line grows, and the partial line is the one
// component that re-renders constantly. If CaptionStream subscribed to `partial` so it
// could scroll, every partial would re-render the whole finals list — the exact thing
// BUILD_PROMPTS P2 asks us to avoid. So PartialLine scrolls the container directly
// through this module instead, and CaptionStream never learns that partials exist.

let container: HTMLElement | null = null;

/** How far from the bottom still counts as "at the bottom". One line of the largest
 *  caption size, so a click that nudges the list by a few pixels does not read as the
 *  user scrolling away. */
const BOTTOM_THRESHOLD_PX = 64;

export function registerScroller(node: HTMLElement | null): void {
  container = node;
}

export function scrollToLive(): void {
  if (container !== null) container.scrollTop = container.scrollHeight;
}

export function isAtBottom(): boolean {
  if (container === null) return true;
  return container.scrollHeight - container.scrollTop - container.clientHeight <= BOTTOM_THRESHOLD_PX;
}
