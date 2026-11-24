// The color each cell type's icon takes wherever it shows (a cell header, the outline, the add buttons): server teal,
// client blue, markdown ochre. The word beside the icon always names the type; the color only repeats it.
import type { CellType } from "@jsnb/core";

export const typeTone: Readonly<Record<CellType, string>> = {
  server: "ui:text-server",
  client: "ui:text-client",
  markdown: "ui:text-md",
};
