// The records value the grid tests render (model/fixtures/values.ts), and its grid.
import { valueCases } from "../../model/fixtures/values.js";
import type { Grid } from "../../model/records.js";
import { gridOf } from "../../model/records.js";

export const records = valueCases.find((entry) => entry.name === "records")?.json;
export const grid: Grid = gridOf(records) ?? {
  shape: "records",
  columns: [],
  rows: [],
  omitted: 0,
};
