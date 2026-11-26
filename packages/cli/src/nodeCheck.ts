// The Node the CLI runs on: 26 or later. An installed release brings its own; a checkout runs on
// whatever `node` is first on PATH. Kept free of imports, since it runs before anything else loads.

const minimumMajor = 26;

/** The refusal for a Node older than 26, or undefined when `version` is recent enough. */
export function nodeTooOld(version: string, execPath: string): string | undefined {
  if (Number.parseInt(version, 10) >= minimumMajor) return undefined;
  return `This needs Node ${String(minimumMajor)} or later; it was started with Node ${version} (${execPath}). Run it with Node ${String(minimumMajor)}, or install the release, which brings its own Node.\n`;
}
