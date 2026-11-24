// The built-in layers as TypeScript sees them: one virtual declaration file
// per realm, from the real signatures in kernel-node's builtinsLayer.ts and runtime-web's realm/builtins.ts.
// console and the timers are the realm's own globals, so they are not declared here.

/** The server built-ins a cell file imports from `nimbo:server` (kernel-node's layer, less console and the timers). */
export const serverBuiltinNames = [
  "env",
  "display",
  "route",
  "routeUrl",
  "emit",
  "dispose",
  "require",
] as const;

/** The client built-ins a cell file imports from `nimbo:client` (runtime-web's layer, less the globals it wraps). */
export const clientBuiltinNames = ["env", "display", "dispose", "on"] as const;

/** A property key as TypeScript accepts it: an identifier as it is, anything else quoted. */
const key = (name: string): string =>
  /^[A-Za-z_$][\w$]*$/u.test(name) ? name : JSON.stringify(name);

/** `env`'s type: the names the daemon knows as string properties, `has`, and any other name as a string. */
function envType(names: readonly string[]): string {
  const known = names.map((name) => `readonly ${key(name)}: string;`).join(" ");
  return `{ readonly [name: string]: string } & { ${known} has(name: string): boolean }`;
}

/** The server realm's display built-in (04-kernel §5.5). */
const serverDisplay = `  export const display: {
    /** Shows HTML under the cell. */
    html(html: unknown): void;
    /** Shows a value as a JSON tree under the cell. */
    json(value: unknown): void;
    /** Shows rows as a grid under the cell; \`columns\` picks and orders the keys shown. */
    table(rows: readonly unknown[] | Readonly<Record<string, unknown>> | Map<unknown, unknown>, options?: { readonly columns?: readonly string[] }): void;
    /** Shows an image: bytes (a Buffer), a data: or https URL, SVG markup, or a file path in the workspace. */
    image(source: Uint8Array | ArrayBuffer | string, options?: { readonly mime?: string }): void;
  };`;

/** The declaration file of the server realm's built-ins. */
export function serverBuiltins(env: readonly string[]): string {
  return `/** A fetched body's JSON is untyped in server cells as lib.dom has it in client cells (Node's types say unknown). */
interface Body {
  json(): Promise<any>;
}
interface Response {
  json(): Promise<any>;
}
declare module "nimbo:server" {
  /** The workspace .env, re-read per run. Reading a name .env does not set throws EnvNotSet. */
  export const env: ${envType(env)};
${serverDisplay}
  /** The request a route's handler gets: the Fetch Request, its JSON body untyped as a webhook's payload is. */
  export interface RouteRequest extends Request {
    json(): Promise<any>;
  }
  /** Serves \`handler\` at \`/n/<notebook>/path\` for "METHOD /path"; returns a function that removes the route. */
  export function route(
    spec: string,
    handler: (
      req: RouteRequest,
    ) => Response | object | string | void | Promise<Response | object | string | void>,
  ): () => void;
  /** The public URL of a route path. */
  export function routeUrl(path: string): string;
  /** Pushes an event to the page's \`on(name, cb)\` (v1.x). */
  export function emit(name: string, data?: unknown): void;
  /** Registers a cleanup that runs before the cell runs again, and when it is deleted. */
  export function dispose(cleanup: () => unknown): void;
  /** \`createRequire\` of the workspace's package.json, for CommonJS packages. */
  export const require: NodeJS.Require;
}
`;
}

/** The declaration file of the client realm's built-ins and of the bridge's types. */
export function clientBuiltins(env: readonly string[]): string {
  return `declare module "nimbo:client" {
  /** The public env: PUBLIC_* and *_PUBLISHABLE_KEY names only. */
  export const env: ${envType(env)};
  export const display: {
    /** The cell's container, created once and emptied when the cell runs again. */
    div(): HTMLElement;
    /** Sets the container's HTML. */
    html(html: unknown): void;
    /** Replaces the container's content with a sandboxed iframe and returns it. */
    iframe(options?: { readonly src?: string; readonly height?: number }): HTMLIFrameElement;
  };
  /** Registers a cleanup that runs before the cell runs again, and when it is deleted. */
  export function dispose(cleanup: () => unknown): void;
  /** Listens to a server cell's \`emit(name, data)\` (v1.x). */
  export function on(name: string, callback: (data: unknown) => void): void;
}
declare module "nimbo:bridge" {
  /** A server export as a client cell receives it: a function answers through a promise, data crosses as it is. */
  export type Remote<T> = T extends (...args: infer A) => infer R ? (...args: A) => Promise<Awaited<R>> : T;
}
`;
}
