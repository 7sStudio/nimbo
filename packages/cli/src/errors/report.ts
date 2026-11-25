// How a failure reads on stderr (03-api §8): `{ code, name, message, data }` under --json, else its name, the
// daemon's message (which names the thing and says what to do) and the issues of INVALID_PARAMS, one per line.
import { ApiError, isJsnbError } from "@jsnb/core";

type ErrorJson = {
  /** The JSON-RPC code of a daemon error (03-api §7.4); null for the CLI's and the client's own errors. */
  readonly code: number | null;
  readonly name: string;
  readonly message: string;
  readonly data: unknown;
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** -32603 carrying a named JsnbError (`data: { name, data }`): that name and its data (03-api §7.4). */
function namedInternal(error: ApiError): { name: string; data: unknown } | undefined {
  if (error.code !== -32603 || typeof error.data.name !== "string") return undefined;
  return { name: error.data.name, data: error.data.data ?? {} };
}

/** The JSON form of any failure. */
function errorJson(error: unknown): ErrorJson {
  if (error instanceof ApiError) {
    const named = namedInternal(error);
    return {
      code: error.code,
      name: named?.name ?? error.name,
      message: error.message,
      data: named?.data ?? error.data,
    };
  }
  if (isJsnbError(error)) {
    return { code: null, name: error.name, message: error.message, data: error.data };
  }
  const name = error instanceof Error ? error.name : "Error";
  const message = error instanceof Error ? error.message : String(error);
  return { code: null, name, message, data: {} };
}

/** INVALID_PARAMS issues, `  - path: message`, one per line. */
function issueLines(data: unknown): string[] {
  if (!isRecord(data) || !Array.isArray(data.issues)) return [];
  return data.issues.filter(isRecord).map((issue) => {
    const path = Array.isArray(issue.path) ? issue.path.map(String).join(".") : "";
    const message = typeof issue.message === "string" ? issue.message : "invalid";
    return path === "" ? `  - ${message}` : `  - ${path}: ${message}`;
  });
}

/** An error thrown that is none of ours: a bug, whose stack says where. */
const unexpected = (error: unknown): string =>
  error instanceof Error && error.stack !== undefined ? error.stack : String(error);

const textOf = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

type Hint = (data: Readonly<Record<string, unknown>>) => string | undefined;

/** A hint that names a notebook path from `data[key]`, or none when the data has no such path. */
const withPath =
  (key: string, hint: (path: string) => string): Hint =>
  (data) => {
    const path = textOf(data[key]);
    return path === undefined ? undefined : hint(path);
  };

/**
 * The CLI's commands for what a daemon message asks with API commands, by the error's name (its catalogue is shared
 * with mcp, so its words name the API); a -32603 carrying a named error is read by that name.
 */
const hints: Readonly<Record<string, Hint>> = {
  NotebookNotFound: (data) =>
    withPath("path", (path) =>
      data.closed === true
        ? `Open it with nimbo notebook open --path ${path} (nimbo open ${path} also shows it in the browser).`
        : `Create it with nimbo notebook create --path ${path} (or nimbo open ${path}).`,
    )(data),
  CellNotFound: () => "List the cells with nimbo ls (-n names the notebook).",
  NotebookExists: withPath("path", (path) => `Open it with nimbo notebook open --path ${path}.`),
  KernelDead: () => "Restart it with nimbo kernel restart (-n names the notebook).",
  InterruptRefused: () => "Stop it with nimbo kernel restart (-n names the notebook).",
  KernelRequestTimedOut: () => "Interrupt it with nimbo kernel interrupt (-n names the notebook).",
  NotebookConflict: withPath(
    "path",
    (path) =>
      `Reload it with nimbo notebook reload -n ${path}, or overwrite it with nimbo notebook save -n ${path} --force.`,
  ),
  RealmNotAttached: (data) => {
    const notebook = textOf(data.notebook);
    if (notebook === undefined) return undefined;
    const open = `Open its page with nimbo open ${notebook}`;
    return data.headless === undefined
      ? `${open}, or run client cells without one: nimbo config set realm.headless true.`
      : `${open}, then run the client cells again.`;
  },
};

/** The CLI's own way to do what a daemon message asks with an API command. */
function hintOf(json: ErrorJson): string[] {
  const hint = hints[json.name]?.(isRecord(json.data) ? json.data : {});
  return hint === undefined ? [] : [hint];
}

/** How a failure is drawn on stderr: colour and the marks (✓ or ASCII). */
export type ErrorStyle = {
  /** Wraps text in an SGR code (`"31"`), or returns it as it is when colour is off. */
  readonly paint: (code: string, text: string) => string;
  readonly unicode: boolean;
};

const red = "31";
const bold = "1";
const dim = "2";

const plainStyle: ErrorStyle = { paint: (_code, text) => text, unicode: false };

/** The install commands' failures, which say what failed and what to do, with no error name in front. */
const friendly = new Set([
  "InstallFailed",
  "InstallBusy",
  "UpgradeElsewhere",
  "ReleaseUnavailable",
  "SqlInstallFailed",
  "SqlPlatformUnsupported",
]);

function friendlyText(json: ErrorJson, style: ErrorStyle): string {
  const { paint } = style;
  const cross = paint(red, style.unicode ? "✗" : "x");
  const data = isRecord(json.data) ? json.data : {};
  const what = textOf(data.what);
  const todo = textOf(data.todo);
  const details = Array.isArray(data.details)
    ? data.details.filter((line) => typeof line === "string")
    : [];
  if (what === undefined || todo === undefined) {
    const extra =
      json.name === "ReleaseUnavailable"
        ? ["Check the network or NIMBO_INSTALL_BASE, then try again."]
        : [];
    return [`${cross} ${json.message}`, ...extra.map((line) => `  ${line}`)].join("\n") + "\n";
  }
  return (
    [
      `${cross} ${paint(bold, what)}`,
      ...details.map((line) => `  ${paint(dim, line)}`),
      `  ${todo}`,
    ].join("\n") + "\n"
  );
}

/** The human form of a failure, newline-terminated. */
function errorText(error: unknown, style: ErrorStyle): string {
  if (!isJsnbError(error)) return `${unexpected(error)}\n`;
  if (friendly.has(errorJson(error).name)) return friendlyText(errorJson(error), style);
  const json = errorJson(error);
  // The message already quotes the first issue; the list is for the rest.
  const issues = issueLines(json.data);
  const lines = [
    `${json.name}: ${json.message}`,
    ...(issues.length > 1 ? issues : []),
    ...hintOf(json),
  ];
  return `${lines.join("\n")}\n`;
}

/** The endings a user chose, which print their own word or nothing, never an error's form. */
const quiet: Readonly<Record<string, string>> = {
  Cancelled: "Cancelled.\n",
  Declined: "",
  Interrupted: "",
  OutputClosed: "",
};

/** What a failure prints on stderr, in the form the command was asked for. */
export function errorReport(
  error: unknown,
  asJson: boolean,
  style: ErrorStyle = plainStyle,
): string {
  const chosen = isJsnbError(error) ? quiet[error.name] : undefined;
  if (chosen !== undefined) return chosen;
  return asJson ? `${JSON.stringify(errorJson(error))}\n` : errorText(error, style);
}
