// The serialization corpus (the devalue cases plus ours), reused by kernel-node and output-view.

class Price {
  readonly amount: number;
  readonly currency = "eur";
  constructor(amount: number) {
    this.amount = amount;
  }
  format(): string {
    return `${String(this.amount)} ${this.currency}`;
  }
}

const shared = { id: "shared" };
const cycle: { name: string; self?: unknown } = { name: "cycle" };
cycle.self = cycle;
const repeated = new Map<unknown, unknown>([["a", shared]]);

/** Every case has a stable name, a value and (in values.json) its golden output-mode form. */
export const corpus: readonly { readonly name: string; readonly value: unknown }[] = [
  { name: "primitives", value: { s: "text", n: 1.5, t: true, f: false, nil: null } },
  { name: "undefined", value: undefined },
  { name: "undefinedInArray", value: [1, undefined, 2] },
  { name: "undefinedProperty", value: { a: undefined } },
  { name: "nan", value: Number.NaN },
  { name: "negativeZero", value: -0 },
  { name: "infinities", value: [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY] },
  { name: "bigint", value: 12345678901234567890n },
  { name: "date", value: new Date("2026-10-10T14:02:11.000Z") },
  { name: "invalidDate", value: new Date(Number.NaN) },
  { name: "regexp", value: /a+b/gi },
  {
    name: "map",
    value: new Map<unknown, unknown>([
      ["k", 1],
      [2, "two"],
    ]),
  },
  { name: "set", value: new Set([1, "two", null]) },
  { name: "nested", value: { list: [{ deep: new Map([["s", new Set([1])]]) }] } },
  { name: "cycle", value: cycle },
  { name: "repeatedReference", value: { a: shared, b: shared, c: [shared] } },
  { name: "repeatedInMap", value: { first: shared, map: repeated } },
  { name: "classInstance", value: new Price(2000) },
  { name: "error", value: new TypeError("boom") },
  {
    name: "function",
    value: function createIntent() {
      return 1;
    },
  },
  { name: "arrow", value: () => 1 },
  { name: "bytes", value: new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]) },
  { name: "arrayBuffer", value: new Uint8Array([104, 105]).buffer },
  {
    name: "symbols",
    value: { [Symbol("hidden")]: 1, kept: 1, dropped: Symbol("v"), list: [Symbol("s")] },
  },
  { name: "dollarKeys", value: { $type: "user", $class: "x", $: 1, $$: 2, plain: "p" } },
  { name: "emptyContainers", value: { o: {}, a: [], m: new Map(), s: new Set() } },
  { name: "nullPrototype", value: Object.assign(Object.create(null), { a: 1 }) },
];
