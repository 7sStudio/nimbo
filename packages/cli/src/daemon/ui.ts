// Where the built UI the daemon serves at /ui/ is (02-architecture §7): `@jsnb/ui`'s build found at run time
// through its ./index.html export, never imported, or NIMBO_UI_DIR when it is an absolute path to an existing folder;
// anything else is refused. No build found is no `--ui`: the daemon then answers /ui/ with a page naming the build.
import { stat } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

import { InvalidArguments } from "../errors/cli.js";

const uiVariable = "NIMBO_UI_DIR";

const isKind = async (path: string, kind: "file" | "directory"): Promise<boolean> => {
  try {
    const found = await stat(path);
    return kind === "file" ? found.isFile() : found.isDirectory();
  } catch {
    // Missing or unreadable: not a build the daemon can serve.
    return false;
  }
};

/** The folder of `@jsnb/ui`'s dist/index.html as Node resolves it from here, when that build exists. */
async function packagedUi(
  resolveIndex: () => string = () => fileURLToPath(import.meta.resolve("@jsnb/ui/index.html")),
): Promise<string | undefined> {
  let index: string;
  try {
    index = resolveIndex();
  } catch {
    return undefined; // @jsnb/ui is not installed beside the CLI: no UI to serve
  }
  return (await isKind(index, "file")) ? dirname(index) : undefined;
}

/** The daemon's `--ui` arguments: NIMBO_UI_DIR when set and usable, else the packaged build, else none. */
export async function uiArguments(
  env: Readonly<Record<string, string | undefined>>,
  command: string,
): Promise<readonly string[]> {
  const chosen = env[uiVariable];
  if (chosen === undefined || chosen === "") {
    const packaged = await packagedUi();
    return packaged === undefined ? [] : ["--ui", packaged];
  }
  if (isAbsolute(chosen) && (await isKind(chosen, "directory"))) return ["--ui", chosen];
  throw new InvalidArguments(
    { argument: uiVariable, command },
    `${uiVariable} must be the absolute path of a built UI folder; ${JSON.stringify(chosen)} is not one. Unset it to use the installed UI.`,
  );
}
