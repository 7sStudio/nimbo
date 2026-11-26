// The identifiers a cell may not declare at top level: the transform's own names.
export const reservedNames = ["__scope", "__import", "__export", "$peek"] as const;
export type ReservedIdentifier = (typeof reservedNames)[number];

/** True when `name` is one of the transform's reserved identifiers. */
export function isReservedName(name: string): name is ReservedIdentifier {
  return reservedNames.some((reserved) => reserved === name);
}
