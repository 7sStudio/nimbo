// Path helpers shared by the nimbo rules: matches a linted file against a directory pattern, OS-independent.

/** Normalises a file path to forward slashes so the same regexes work on every OS. */
export const posix = (filename) => filename.replaceAll("\\", "/");

/** True when `filename` sits under one of the given `packages/<pkg>/src/<dir>` prefixes. */
export const isUnder = (filename, prefixes) => {
  const path = posix(filename);
  return prefixes.some((prefix) => path.includes(`/${prefix}/`));
};
