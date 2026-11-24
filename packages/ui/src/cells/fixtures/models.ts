// The page every card shares (cells/card.ts), with each field a test may change, for the tests that build the cards'
// models from the stores.
import type { CardPage } from "../card.js";

export const cardPage = (patch: Partial<CardPage> = {}): CardPage => ({
  mac: true,
  host: {
    engines: undefined,
    fetchFullValue: () => Promise.resolve(new Blob()),
    tabUrl: (execution, index) => `/ui/demo/out/${execution}/${String(index)}`,
  },
  maxHeight: 400,
  sevenLines: false,
  wordWrap: true,
  tabSize: 2,
  words: () => [{ label: "paymentIntent", detail: "name" }],
  off: false,
  loadMore: () => Promise.resolve({ json: [], total: 0, truncated: false }),
  definedBy: (cell, by) => (cell === by ? "this cell" : "cell 2"),
  functionSource: () => undefined,
  ...patch,
});
