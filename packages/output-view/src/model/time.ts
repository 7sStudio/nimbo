// Dates for the viewer: ISO in a given zone, the relative "3 min ago", and ISO text read back; the zone is injectable.
type Wall = {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
};

const formatters = new Map<string, Intl.DateTimeFormat>();

/** One cached formatter per zone (building one costs far more than formatting with it). */
function formatter(timeZone: string | undefined): Intl.DateTimeFormat {
  const key = timeZone ?? "";
  const cached = formatters.get(key);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat("en-US", {
    ...(timeZone === undefined ? {} : { timeZone }),
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  formatters.set(key, created);
  return created;
}

/** The wall-clock fields of an instant in a zone. */
function wallOf(ms: number, timeZone: string | undefined): Wall {
  const parts = new Map(
    formatter(timeZone)
      .formatToParts(ms)
      .map((p) => [p.type, Number(p.value)]),
  );
  const field = (name: Intl.DateTimeFormatPartTypes): number => parts.get(name) ?? 0;
  return {
    year: field("year"),
    month: field("month"),
    day: field("day"),
    hour: field("hour"),
    minute: field("minute"),
    second: field("second"),
  };
}

const utcOf = (wall: Wall): number =>
  Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);

/** The zone's offset from UTC at an instant, in minutes (120 for Paris in summer). */
function offsetMinutes(ms: number, timeZone?: string): number {
  const whole = Math.floor(ms / 1000) * 1000;
  return Math.round((utcOf(wallOf(whole, timeZone)) - whole) / 60_000);
}

const pad = (value: number, width = 2): string => String(Math.abs(value)).padStart(width, "0");

const offsetText = (minutes: number): string =>
  minutes === 0
    ? "Z"
    : `${minutes < 0 ? "-" : "+"}${pad(Math.trunc(minutes / 60))}:${pad(minutes % 60)}`;

const dayText = (wall: Wall): string => `${pad(wall.year, 4)}-${pad(wall.month)}-${pad(wall.day)}`;

const clockText = (wall: Wall): string =>
  `${pad(wall.hour)}:${pad(wall.minute)}:${pad(wall.second)}`;

/** ISO 8601 in a zone with its offset, `2026-10-10T16:02:11.000+02:00` (`Z` when the offset is 0). */
export function localIso(ms: number, timeZone?: string): string {
  const wall = wallOf(ms, timeZone);
  const millis = pad(((ms % 1000) + 1000) % 1000, 3);
  return `${dayText(wall)}T${clockText(wall)}.${millis}${offsetText(offsetMinutes(ms, timeZone))}`;
}

/** `2026-10-10 14:05:24`: the date and time in a zone, as the unix-time hint shows it. */
export function localDateTime(ms: number, timeZone?: string): string {
  const wall = wallOf(ms, timeZone);
  return `${dayText(wall)} ${clockText(wall)}`;
}

const units: readonly (readonly [number, number, string, string])[] = [
  [60, 1, "s", "s"],
  [3600, 60, "min", "min"],
  [86_400, 3600, "h", "h"],
  [2_592_000, 86_400, "day", "days"],
  [31_536_000, 2_592_000, "mo", "mo"],
  [Number.POSITIVE_INFINITY, 31_536_000, "y", "y"],
];

/** "3 min ago", "in 2 h", "just now" (under 10 s either way). */
export function relativeTime(ms: number, now: number): string {
  const seconds = (now - ms) / 1000;
  const size = Math.abs(seconds);
  if (size < 10) return "just now";
  const [, divisor, one, many] = units.find(([limit]) => size < limit) ?? [0, 1, "s", "s"];
  const count = Math.floor(size / divisor);
  const text = `${String(count)} ${count === 1 ? one : many}`;
  return seconds > 0 ? `${text} ago` : `in ${text}`;
}

const isoPattern =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:?\d{2})?$/i;

const zoneMinutes = (zone: string): number => {
  if (zone.toUpperCase() === "Z") return 0;
  const digits = zone.replace(":", "");
  const minutes = Number(digits.slice(1, 3)) * 60 + Number(digits.slice(3, 5));
  return zone.startsWith("-") ? -minutes : minutes;
};

/** A wall time that names a real day and time (no 2026-02-30, no 25:00). */
const isValidWall = (wall: Wall): boolean => {
  const date = new Date(utcOf(wall));
  return date.getUTCMonth() === wall.month - 1 && date.getUTCDate() === wall.day && wall.hour < 24;
};

const wallFrom = (match: RegExpExecArray): Wall => {
  const at = (index: number): number => Number(match[index] ?? 0);
  return { year: at(1), month: at(2), day: at(3), hour: at(4), minute: at(5), second: at(6) };
};

/** The instant an ISO date-time string names, with its offset or else in `timeZone`; undefined for any other text. */
export function parseIsoText(text: string, timeZone?: string): number | undefined {
  const match = isoPattern.exec(text);
  if (match === null) return undefined;
  const wall = wallFrom(match);
  if (!isValidWall(wall) || wall.minute > 59 || wall.second > 59) return undefined;
  const local = utcOf(wall) + Math.round(Number(`0.${match[7] ?? "0"}`) * 1000);
  const zone = match[8];
  if (zone !== undefined) return local - zoneMinutes(zone) * 60_000;
  const guess = local - offsetMinutes(local, timeZone) * 60_000;
  return local - offsetMinutes(guess, timeZone) * 60_000;
}
