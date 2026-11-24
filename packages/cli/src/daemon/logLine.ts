// The daemon's pino JSON lines as one readable terminal line each; daemon.log keeps them whole.

import type { Paint } from "../io/colour.js";
import { sgr } from "../io/colour.js";

const hidden = new Set(["level", "time", "pid", "hostname", "msg"]);

const pad = (value: number): string => String(value).padStart(2, "0");

function clockOf(time: unknown, now: () => Date = () => new Date()): string {
  const parsed = typeof time === "string" ? new Date(time) : now();
  const at = Number.isNaN(parsed.getTime()) ? now() : parsed;
  return `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`;
}

function scalarText(value: string | number | boolean): string {
  const text = String(value);
  return /[\s"=]/u.test(text) || text === "" ? JSON.stringify(text) : text;
}

/** `~/…` for a path under the home folder. */
function homeShort(text: string, home: string | undefined): string {
  if (home === undefined || home === "" || home === "/") return text;
  if (text === home) return "~";
  return text.startsWith(`${home}/`) ? `~${text.slice(home.length)}` : text;
}

function valueText(value: unknown, home?: string): string | undefined {
  if (typeof value === "string") return scalarText(homeShort(value, home));
  if (typeof value === "number" || typeof value === "boolean") return scalarText(value);
  if (Array.isArray(value)) {
    const parts = value.filter(
      (item): item is string | number | boolean =>
        typeof item === "string" || typeof item === "number" || typeof item === "boolean",
    );
    return parts.length === value.length ? scalarText(parts.join(",")) : undefined;
  }
  if (typeof value === "object" && value !== null && "message" in value) {
    const { message } = value;
    return typeof message === "string" ? scalarText(message) : undefined;
  }
  return undefined;
}

export type LineStyle = {
  readonly paint?: Paint;
  /** The home folder, shown as `~` in path values. */
  readonly home?: string;
};

const levelCodes: Readonly<Record<string, string>> = {
  TRACE: sgr.dim,
  DEBUG: sgr.dim,
  INFO: sgr.green,
  WARN: sgr.yellow,
  ERROR: sgr.boldRed,
  FATAL: sgr.boldRed,
};

export function logLineText(
  entry: Readonly<Record<string, unknown>>,
  style: LineStyle = {},
): string {
  const paint: Paint = style.paint ?? ((_code, text) => text);
  const level = typeof entry.level === "string" ? entry.level.toUpperCase() : "LOG";
  // a package manager's multi-line output stays on one line
  const message =
    typeof entry.msg === "string"
      ? entry.msg
          .split("\n")
          .map((part) => part.trim())
          .filter((part) => part !== "")
          .join(" · ")
      : "";
  const fields = Object.entries(entry).flatMap(([key, value]) => {
    if (hidden.has(key)) return [];
    const text = valueText(value, style.home);
    return text === undefined ? [] : [`${paint(sgr.dim, `${key}=`)}${text}`];
  });
  const tail = fields.length === 0 ? "" : `  ${fields.join(" ")}`;
  const failed = level === "ERROR" || level === "FATAL";
  const levelText = paint(levelCodes[level] ?? sgr.bold, level.padEnd(5));
  return `${paint(sgr.dim, clockOf(entry.time))} ${levelText} ${failed ? paint(sgr.red, message) : message}${tail}\n`;
}
