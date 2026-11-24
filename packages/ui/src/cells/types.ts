// The three cell types as the page names them.
import type { CellType } from "@jsnb/core";

export const typeName: Readonly<Record<CellType, string>> = {
  server: "Server",
  client: "Client",
  markdown: "Markdown",
};
