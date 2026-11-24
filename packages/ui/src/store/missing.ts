// What a run's error asks the user to do. The packages a run found missing (03-api §4.3.1, 04-kernel §4): a run that imports a package the workspace lacks ends
// with MissingPackage and the names in its error's data; the cell and the Packages panel offer to install them.
import type { ErrorInfo } from "@jsnb/core";

/** The names a MissingPackage error carries; none for any other error or a malformed one. */
export function missingNames(error: ErrorInfo | undefined): readonly string[] {
  if (error?.name !== "MissingPackage") return [];
  const names: unknown = error.data?.names;
  return Array.isArray(names)
    ? names.filter((name): name is string => typeof name === "string")
    : [];
}

/** Every missing name across `errors`, once each, in the order the cells list them. */
export const allMissing = (errors: readonly (ErrorInfo | undefined)[]): readonly string[] => [
  ...new Set(errors.flatMap(missingNames)),
];

/** The client cell a server cell's last run found it needs (DefinedInClient, 05-bridge §7): the name
 * and the place, for the card's "Switch this cell to client"; null for any other ending. */
export function inClientOf(
  error: ErrorInfo | undefined,
): { readonly name: string; readonly index: number } | null {
  if (error?.name !== "DefinedInClient") return null;
  const name: unknown = error.data?.name;
  const index: unknown = error.data?.index;
  return typeof name === "string" && typeof index === "number" ? { name, index } : null;
}
