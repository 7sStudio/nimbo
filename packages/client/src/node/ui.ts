// The daemon's `--ui` arguments (02-architecture §7), shared by the CLI and the MCP server so a daemon either one starts
// serves the same UI: NIMBO_UI_DIR when it is an absolute path to an existing folder, else `@jsnb/ui`'s build as the
// caller resolves it (the caller depends on `@jsnb/ui`, this package cannot), else none, which the daemon answers at
// /ui/ with a page naming the build. Node only: the `./node` export, never the page's.
import { stat } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";

export const uiVariable = "NIMBO_UI_DIR";

export type UiArguments =
  | { readonly ok: true; readonly args: readonly string[] }
  | { readonly ok: false; readonly message: string };

const isKind = async (path: string, kind: "file" | "directory"): Promise<boolean> => {
  try {
    const found = await stat(path);
    return kind === "file" ? found.isFile() : found.isDirectory();
  } catch {
    // Missing or unreadable: not a build the daemon can serve.
    return false;
  }
};

async function packagedUi(resolveIndex: () => string): Promise<string | undefined> {
  let index: string;
  try {
    index = resolveIndex();
  } catch {
    return undefined; // @jsnb/ui is not installed beside the caller: no UI to serve
  }
  return (await isKind(index, "file")) ? dirname(index) : undefined;
}

/** `resolveIndex` gives the path of `@jsnb/ui/index.html` as Node resolves it from the caller, or throws. */
export async function daemonUiArguments(
  env: Readonly<Record<string, string | undefined>>,
  resolveIndex: () => string,
): Promise<UiArguments> {
  const chosen = env[uiVariable];
  if (chosen === undefined || chosen === "") {
    const packaged = await packagedUi(resolveIndex);
    return { ok: true, args: packaged === undefined ? [] : ["--ui", packaged] };
  }
  if (isAbsolute(chosen) && (await isKind(chosen, "directory"))) {
    return { ok: true, args: ["--ui", chosen] };
  }
  return {
    ok: false,
    message: `${uiVariable} must be the absolute path of a built UI folder; ${JSON.stringify(chosen)} is not one. Unset it to use the installed UI.`,
  };
}
