// The scope object: an ordinary record whose prototype chain is the built-ins layer, then a Proxy
// over the realm's globals that throws ReferenceError for names that exist nowhere and reports first creations.

/** The transform's own calls on `__scope` besides `$peek`; own, non-writable, never shadowed. */
export type Plumbing = {
  readonly __import: (specifier: string) => Promise<unknown>;
  readonly __export: (name: string, from?: string) => void;
};

export type ScopeOptions = {
  readonly builtins: Readonly<Record<string, unknown>>;
  readonly plumbing: Plumbing;
  /** Called when a write creates a string-named property on the record: the moment `definedBy` is learnt. */
  readonly onCreate: (name: string) => void;
};

export type Scope = {
  /** What a cell receives as `__scope`; cell-defined names are its own enumerable data properties. */
  readonly record: Record<string, unknown>;
  /** `$peek(name)`: record → built-ins → globals → undefined; `typeof` of an unknown name never throws. */
  readonly peek: (name: string) => unknown;
  /** The record's own enumerable names in creation order: what `kernel.scope` lists. */
  readonly names: () => readonly string[];
};

const fixed = (value: unknown): PropertyDescriptor => ({
  value,
  writable: false,
  enumerable: false,
  configurable: false,
});

/**
 * The end of the chain: reads fall back to `globalThis` (or throw `ReferenceError` like an unbound name), and a
 * write of a name no layer has defines it on the receiver, the record, so nothing reaches `globalThis`.
 */
function globalsFallback(onCreate: (receiver: unknown, name: string) => void): object {
  const target = {};
  Reflect.setPrototypeOf(target, null);
  return new Proxy(target, {
    get(_target, name) {
      if (typeof name === "symbol") return undefined;
      if (!(name in globalThis)) throw new ReferenceError(`${name} is not defined`);
      const value: unknown = Reflect.get(globalThis, name);
      return value;
    },
    has: (_target, name) => name in globalThis,
    set(_target, name, value, receiver: object) {
      Object.defineProperty(receiver, name, {
        value,
        writable: true,
        enumerable: true,
        configurable: true,
      });
      if (typeof name === "string") onCreate(receiver, name);
      return true;
    },
  });
}

/**
 * Builds the scope with the lookup order (plumbing → record → built-ins → globals →
 * ReferenceError) as a prototype chain, so reads and writes of cell-defined names never run a trap (case 20).
 */
export function createScope(options: ScopeOptions): Scope {
  const record: Record<string, unknown> = {};
  const layer: Record<string, unknown> = {};
  Reflect.setPrototypeOf(
    layer,
    globalsFallback((receiver, name) => {
      if (receiver === record) options.onCreate(name);
    }),
  );
  for (const [name, value] of Object.entries(options.builtins)) {
    Object.defineProperty(layer, name, {
      value,
      writable: true,
      enumerable: false,
      configurable: true,
    });
  }
  Reflect.setPrototypeOf(record, layer);
  const peek = (name: string): unknown => (name in record ? Reflect.get(record, name) : undefined);
  Object.defineProperty(record, "__import", fixed(options.plumbing.__import));
  Object.defineProperty(record, "__export", fixed(options.plumbing.__export));
  Object.defineProperty(record, "$peek", fixed(peek));
  return { record, peek, names: () => Object.keys(record) };
}

/** The registry key of the symbol under which the kernel's `process` holds the scope record: a debugger's
 * evaluation in a paused frame reads the cells' names there, whatever the frame closes over. */
export const scopeKeyName = "jsnb.kernel.scope";

let exposed: Record<string, unknown> | undefined;

/** Puts `record` on `process` under scopeKeyName: a getter that is not enumerable and that no code can redefine or
 * delete; a later realm's record replaces what it answers. */
export function exposeScope(record: Record<string, unknown>): void {
  exposed = record;
  const key = Symbol.for(scopeKeyName);
  if (Object.hasOwn(process, key)) return;
  Object.defineProperty(process, key, {
    get: () => exposed,
    configurable: false,
    enumerable: false,
  });
}
