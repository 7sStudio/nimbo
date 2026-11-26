// The cases of fixtures/values/output-view.json: each a server-cell expression, or (kernel: false) one built with encode options no kernel uses, whose `source` stays out of the JSON.
import type { EncodeOptions } from "@jsnb/core";

export type CorpusCase = {
  readonly name: string;
  readonly source: string;
  readonly kernel: boolean;
  readonly options?: EncodeOptions;
};

/** util.inspect options (depth 3, 50 array items, 500-character strings; the 4 KB cap never bites). */
export const inspectOptions = { depth: 3, maxArrayLength: 50, maxStringLength: 500 } as const;

const event = (id: string, type: string, created: number, object: string): string =>
  `{ id: "${id}", object: "event", type: "${type}", created: ${String(created)}, livemode: false, data: { object: ${object} } }`;

const kernelCases: readonly (readonly [string, string])[] = [
  ["string", `"hello"`],
  ["emptyString", `""`],
  ["stringWithEscapes", String.raw`"line one\nline \"two\"\ttab"`],
  ["url", `"https://dashboard.stripe.com/test/payments/pi_3Q4fK2"`],
  [
    "jsonString",
    `'{"type":"invoice.paid","id":"evt_1Q4eZ1","data":{"object":{"amount_paid":12900,"$type":"x"}}}'`,
  ],
  ["jsonArrayString", `"[1, 2, 3]"`],
  ["notJsonString", `"{not json}"`],
  [
    "longString",
    `"-----BEGIN CERTIFICATE-----\\n" + "MIIDdzCCAl+gAwIBAgIEAgAAuTANBgkqhkiG9w0BAQUFADBaMQswCQYDVQQGEwJJ".repeat(39)`,
  ],
  ["isoDateString", `"2026-10-10T14:02:11.000Z"`],
  ["localDateString", `"2026-10-10 14:05:24"`],
  ["integer", "124500"],
  ["float", "1.5"],
  ["negative", "-42"],
  ["unixSeconds", "1760105124"],
  ["unixMillis", "1760105124000"],
  ["oldUnixSeconds", "1000000000"],
  ["elevenDigits", "12345678901"],
  ["true", "true"],
  ["false", "false"],
  ["null", "null"],
  ["nan", "NaN"],
  ["infinity", "Infinity"],
  ["negativeInfinity", "-Infinity"],
  ["negativeZero", "-0"],
  ["bigint", "12345678901234567890n"],
  ["date", `new Date("2026-10-10T14:02:11.000Z")`],
  ["invalidDate", "new Date(NaN)"],
  ["regexp", "/^pi_/i"],
  ["function", "(function createIntent(amount) { return amount; })"],
  ["asyncFunction", "(async function createIntent(amount) { return amount; })"],
  ["arrowFunction", "(() => 1)"],
  // An error's repr is its stack; each error sets its stack to its first line so the repr is the same in any kernel.
  [
    "error",
    `(() => { const error = new TypeError("Cannot read properties of undefined (reading 'email')"); error.stack = String(error); return error; })()`,
  ],
  [
    "errorInObject",
    `(() => { const error = new Error("nope"); error.stack = String(error); return { ok: false, error }; })()`,
  ],
  [
    "bytes",
    "new Uint8Array([0x1f, 0x8b, 0x08, 0, 0, 0, 0, 0, 0, 3, 0xcb, 0x48, 0xcd, 0xc9, 0xc9, 0x07])",
  ],
  ["bytesShort", "new Uint8Array([104, 105, 33])"],
  ["emptyBytes", "new Uint8Array(0)"],
  ["arrayBuffer", "new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]).buffer"],
  ["buffer", `Buffer.from("hello world")`],
  [
    "paymentIntent",
    `({ id: "pi_3Q4fK2Lk9XyT1a0b", object: "payment_intent", amount: 2000, currency: "usd", customer: "cus_Nq2vT8", status: "requires_payment_method", metadata: { order: "A-1042", source: "notebook" }, payment_method_options: { card: { request_three_d_secure: "automatic" }, link: null, us_bank_account: null }, created: 1760105124, livemode: false })`,
  ],
  [
    "classInstance",
    `new (class PaymentIntent { constructor() { this.id = "pi_1"; this.amount = 2000; this.currency = "usd"; } })()`,
  ],
  [
    "stripeClient",
    `new (class Stripe { constructor() { this.apiVersion = "2026-09-30"; this.resources = new (class Resources { constructor() { this.paymentIntents = {}; } })(); } })()`,
  ],
  ["nestedObject", "({ a: { b: { c: { d: 1 } } } })"],
  ["emptyObject", "({})"],
  ["nullPrototype", "Object.assign(Object.create(null), { a: 1 })"],
  ["map", `new Map([["a", 1], ["b", { nested: true }]])`],
  ["mapObjectKeys", `new Map([[{ id: 1 }, "first"], [[1, 2], "second"]])`],
  ["set", `new Set(["pi", "ch", "cus"])`],
  ["emptyContainers", "({ o: {}, a: [], m: new Map(), s: new Set() })"],
  [
    "records",
    `[{ id: "evt_1", type: "payment_intent.succeeded", created: 1760103669, amount: 2000, status: "succeeded" }, { id: "evt_2", type: "charge.succeeded", created: 1760103669, amount: 2000, status: "succeeded" }, { id: "evt_3", type: "customer.created", created: 1760101960, amount: null, status: null }]`,
  ],
  [
    "recordsSparse",
    `[{ id: 1, name: "a", email: "a@example.com", plan: "pro" }, { id: 2, name: "b", email: "b@example.com", team: "core" }, { id: 3, name: "c", email: "c@example.com" }]`,
  ],
  ["recordsBelowThreshold", "[{ id: 1, a: 1, b: 2 }, { id: 2, c: 3, d: 4 }]"],
  ["singleRecord", `[{ id: 1, name: "only" }]`],
  [
    "recordInstances",
    '(() => { class Price { constructor(amount) { this.amount = amount; this.currency = "eur"; } } return [new Price(100), new Price(250)]; })()',
  ],
  [
    "repeatedRecords",
    `(() => { const row = { id: 1, name: "same" }; return [row, row, { id: 2, name: "other" }]; })()`,
  ],
  [
    "eventList",
    `[${event("evt_1", "charge.succeeded", 1760103669, `{ id: "ch_1", object: "charge", amount: 2000, paid: true }`)}, ${event("evt_2", "customer.created", 1760101960, `{ id: "cus_1", object: "customer", email: "user1@example.com" }`)}, ${event("evt_3", "invoice.paid", 1760100168, `{ id: "in_1", object: "invoice", total: 12900 }`)}]`,
  ],
  [
    "listResponse",
    `({ object: "list", url: "/v1/events", has_more: true, data: [${event("evt_4", "payment_intent.succeeded", 1760103669, `{ id: "pi_1", amount: 2000, status: "succeeded" }`)}, ${event("evt_5", "payment_intent.created", 1760103662, `{ id: "pi_1", amount: 2000, status: "requires_payment_method" }`)}] })`,
  ],
  ["matrix", "[[1, 2, 3], [4, 5, 6]]"],
  ["raggedRows", "[[1, 2], [3]]"],
  ["mixedArray", `[1, "two", { three: 3 }, [4]]`],
  ["numberArray", "[3, 1, 2]"],
  ["emptyArray", "[]"],
  ["cycle", `(() => { const node = { name: "cycle" }; node.self = node; return node; })()`],
  [
    "repeatedReference",
    `(() => { const shared = { id: "shared" }; return { a: shared, b: shared, c: [shared] }; })()`,
  ],
  [
    "repeatedInMap",
    `(() => { const shared = { id: "shared" }; return { first: shared, map: new Map([["a", shared]]) }; })()`,
  ],
  ["dollarKeys", `({ $type: "user", $class: "x", $: 1, $$: 2, plain: "p" })`],
  ["symbols", `({ [Symbol("hidden")]: 1, kept: 1, dropped: Symbol("v"), list: [Symbol("s")] })`],
  ["undefinedInArray", "[1, undefined, 2]"],
  ["undefinedProperty", "({ a: undefined, b: 1 })"],
  [
    "specialValues",
    `(() => { const error = new Error("nope"); error.stack = String(error); return { map: new Map([["a", 1]]), set: new Set(["pi"]), date: new Date("2026-10-10T14:02:11.000Z"), big: 12345678901234567890n, bytes: new Uint8Array([31, 139, 8]), re: /^pi_/i, fn: function createIntent() {}, error, nan: NaN, inf: -Infinity, nothing: undefined }; })()`,
  ],
  [
    "deepNesting",
    "(() => { let node = { leaf: true }; for (let i = 0; i < 12; i += 1) node = { child: node }; return node; })()",
  ],
];

/** Cases no cell produces exactly: `undefined` (no value output) and encode budgets below the kernel's. */
const builtCases: readonly CorpusCase[] = [
  { name: "undefined", source: "undefined", kernel: false },
  {
    name: "truncatedNodes",
    source: "Array.from({ length: 30 }, (_, i) => ({ id: i }))",
    kernel: false,
    options: { maxNodes: 20 },
  },
  {
    name: "truncatedBytes",
    source: `({ note: "x".repeat(200), more: "y" })`,
    kernel: false,
    options: { maxBytes: 100 },
  },
  {
    name: "truncatedDepth",
    source: "({ a: { b: { c: 1 } }, d: [[[1]]] })",
    kernel: false,
    options: { maxDepth: 2 },
  },
];

export const corpus: readonly CorpusCase[] = [
  ...kernelCases.map(([name, source]) => ({ name, source, kernel: true })),
  ...builtCases,
];
