// Helpers for the viewer's Chromium tests, here and in its test host (tests/output-view, which imports this file): frames
// to wait on (layout and the engines' answers land on later frames, never after a fixed time) and a value output.

/** The next animation frame. */
export const frame = (): Promise<number> => new Promise(requestAnimationFrame);

/** Waits frame by frame until `check` passes, for at most 60 frames, then lets it fail. */
export async function frames(check: () => void): Promise<void> {
  for (let round = 0; round < 60; round += 1) {
    try {
      check();
      return;
    } catch {
      await frame();
    }
  }
  check();
}

/** A value output of `json`. */
export const value = (json: unknown) => ({ kind: "value", json, repr: "", truncated: false });
