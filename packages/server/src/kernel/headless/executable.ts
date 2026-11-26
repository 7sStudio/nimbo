// The browser the headless realm runs: the setting realm.headlessBrowser, else CHROME_PATH (the
// variable chrome-launcher and Lighthouse read), else the usual installs of Chrome, Chromium and Edge on macOS and
// Linux. Nothing is downloaded; with none found, the answer lists every place looked at.
import { accessSync, constants, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

export type Found =
  | { readonly found: true; readonly path: string }
  | { readonly found: false; readonly looked: readonly string[] };

const macApps = [
  "Google Chrome.app/Contents/MacOS/Google Chrome",
  "Chromium.app/Contents/MacOS/Chromium",
  "Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
];

const linuxNames = [
  "google-chrome-stable",
  "google-chrome",
  "chromium",
  "chromium-browser",
  "microsoft-edge-stable",
  "microsoft-edge",
];

const linuxFixed = ["/opt/google/chrome/chrome", "/snap/bin/chromium"];

/** Whether `path` is an executable regular file. */
function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** The places looked at in order, for `platform` with `env`'s PATH. */
function candidates(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
  if (platform === "darwin")
    return [
      ...macApps.map((app) => join("/Applications", app)),
      ...macApps.map((app) => join(homedir(), "Applications", app)),
    ];
  const path = (env.PATH ?? "").split(delimiter).filter((dir) => dir !== "");
  return [...linuxNames.flatMap((name) => path.map((dir) => join(dir, name))), ...linuxFixed];
}

/** The browser to launch: `setting` when given (it must be executable), else CHROME_PATH, else the first install. */
export function findBrowser(
  setting: string | null,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  executable: (path: string) => boolean = isExecutable,
): Found {
  if (setting !== null)
    return executable(setting)
      ? { found: true, path: setting }
      : { found: false, looked: [setting] };
  const fromEnv = env.CHROME_PATH;
  const looked = [
    ...(fromEnv === undefined || fromEnv === "" ? [] : [fromEnv]),
    ...candidates(platform, env),
  ];
  const path = looked.find((each) => executable(each));
  return path === undefined ? { found: false, looked } : { found: true, path };
}
