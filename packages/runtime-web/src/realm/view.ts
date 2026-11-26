// A run's scope view: the Proxy a cell receives as `__scope`.
// Lookup: plumbing → record → this run's bridge layer → this run's builtins → window → ReferenceError.

export type ViewParts = {
  /** The realm's one record of names cells define (null prototype). */
  readonly record: Record<string, unknown>;
  /** This run's bridge layer: stubs, snapshots and error getters. */
  readonly bridge: Readonly<Record<string, unknown>>;
  readonly builtins: Readonly<Record<string, unknown>>;
  readonly importModule: (specifier: string) => Promise<unknown>;
  /** A name the run assigned while it is in progress (`defines`). */
  readonly onDefine: (name: string) => void;
};

type Found = { readonly value: unknown } | undefined;

/** Exports cross from the server to the page only: a client cell's `export` has no reader. */
const ignoreExport = (): undefined => undefined;

function find(parts: ViewParts, plumbing: Readonly<Record<string, unknown>>, name: string): Found {
  if (Object.hasOwn(plumbing, name)) return { value: plumbing[name] };
  if (Object.hasOwn(parts.record, name)) return { value: parts.record[name] };
  // A getter here throws NotTransferable or KernelRestarted, which is the point of reading it.
  if (Object.hasOwn(parts.bridge, name)) return { value: Reflect.get(parts.bridge, name) };
  if (Object.hasOwn(parts.builtins, name)) return { value: parts.builtins[name] };
  return name in window ? { value: Reflect.get(window, name) } : undefined;
}

/** The scope a cell's code runs against; writes land in the record, never on `window`. */
export function createView(parts: ViewParts): Record<string, unknown> {
  const plumbing: Record<string, unknown> = {
    __import: parts.importModule,
    __export: ignoreExport,
    // `typeof x` of an unknown name must not throw.
    $peek: (name: unknown) =>
      typeof name === "string" ? find(parts, plumbing, name)?.value : undefined,
  };
  return new Proxy(parts.record, {
    get(_record, name) {
      if (typeof name !== "string") return undefined;
      const found = find(parts, plumbing, name);
      if (found === undefined) throw new ReferenceError(`${name} is not defined`);
      return found.value;
    },
    set(record, name, value) {
      if (typeof name !== "string") return true;
      record[name] = value;
      parts.onDefine(name);
      return true;
    },
    has: () => true,
  });
}
