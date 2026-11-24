// The seq rule of a workspace subscription (03-api §2: seq is monotonic per notebook): a duplicate is dropped, and a
// gap is reported while delivery goes on, since there is no single state to fetch again (03-api §7.6).

/** The last seq seen per notebook value (`""` for workspace-level events such as settings.changed). */
export type SeqByNotebook = ReadonlyMap<string, number>;

/** Events of a notebook went missing between `expected` and `received` (exclusive). */
export type SeqGap = {
  readonly notebook: string;
  readonly expected: number;
  readonly received: number;
};

export type Tracked = {
  readonly seen: SeqByNotebook;
  readonly deliver: boolean;
  readonly gap?: SeqGap;
};

/** One event arrives; the first event of a notebook sets where it starts. */
export function track(
  seen: SeqByNotebook,
  event: { readonly notebook: string; readonly seq: number },
): Tracked {
  const last = seen.get(event.notebook);
  if (last !== undefined && event.seq <= last) return { seen, deliver: false };
  const next = new Map(seen).set(event.notebook, event.seq);
  if (last === undefined || event.seq === last + 1) return { seen: next, deliver: true };
  return {
    seen: next,
    deliver: true,
    gap: { notebook: event.notebook, expected: last + 1, received: event.seq },
  };
}
