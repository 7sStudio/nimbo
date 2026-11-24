// Waits on the page's own event order, never for a duration (09-testing §1.4): the next frame, the timers queued before.

/** Resolves in the next frame, after the frame callbacks registered before it. */
export const nextFrame = (): Promise<number> =>
  new Promise((resolve) => requestAnimationFrame(resolve));

/**
 * Resolves after the timers queued before it with the same delay, since timers of equal delay fire in order. Only ever
 * called with the delay the code under test already queued, never a margin.
 */
export const afterTimers = (delayMs: number): Promise<unknown> =>
  new Promise((resolve) => setTimeout(resolve, delayMs));
