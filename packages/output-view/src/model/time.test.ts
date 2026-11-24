// Tests time.ts: ISO in a zone, the relative time and ISO text read back, all on a fixed clock and named zones.
import { beforeAll, describe, expect, it } from "vitest";

import { localDateTime, localIso, parseIsoText, relativeTime } from "./time.js";

// ICU loads its time zone data on a process's first DateTimeFormat (about 12 ms): setup, not any one test's time.
beforeAll(() => {
  localIso(0, "Europe/Paris");
});

const at = Date.parse("2026-10-10T14:02:11.250Z");

describe("localIso", () => {
  it("writes the instant in the zone with its offset", () => {
    expect(localIso(at, "UTC")).toBe("2026-10-10T14:02:11.250Z");
    expect(localIso(at, "Europe/Paris")).toBe("2026-10-10T16:02:11.250+02:00");
    expect(localIso(at, "America/New_York")).toBe("2026-10-10T10:02:11.250-04:00");
    expect(localIso(at, "Asia/Kolkata")).toBe("2026-10-10T19:32:11.250+05:30");
  });

  it("follows daylight saving time", () => {
    expect(localIso(Date.parse("2026-01-15T12:00:00Z"), "Europe/Paris")).toBe(
      "2026-01-15T13:00:00.000+01:00",
    );
  });

  it("uses the runtime's zone when none is given", () => {
    expect(localIso(at)).toMatch(/^2026-10-1\dT\d\d:\d\d:11\.250(Z|[+-]\d\d:\d\d)$/);
  });
});

describe("localDateTime", () => {
  it("writes the date and time in the zone, without an offset", () => {
    expect(localDateTime(at, "Europe/Paris")).toBe("2026-10-10 16:02:11");
  });
});

describe("relativeTime", () => {
  const now = Date.parse("2026-10-12T09:00:00Z");
  const ago = (seconds: number): string => relativeTime(now - seconds * 1000, now);

  it("counts back in the largest unit that fits", () => {
    expect([
      ago(5),
      ago(42),
      ago(180),
      ago(3 * 3600),
      ago(86_400),
      ago(3 * 86_400),
      ago(60 * 86_400),
      ago(400 * 86_400),
    ]).toEqual([
      "just now",
      "42 s ago",
      "3 min ago",
      "3 h ago",
      "1 day ago",
      "3 days ago",
      "2 mo ago",
      "1 y ago",
    ]);
  });

  it("counts forward for the future", () => {
    expect(ago(-120)).toBe("in 2 min");
  });
});

describe("parseIsoText", () => {
  it("reads a time with an offset as that instant", () => {
    expect(parseIsoText("2026-10-10T14:02:11.250Z")).toBe(at);
    expect(parseIsoText("2026-10-10T16:02:11.25+02:00")).toBe(at);
    expect(parseIsoText("2026-10-10T16:02:11.25+0200")).toBe(at);
    expect(parseIsoText("2026-10-10t14:02:11.250z")).toBe(at);
  });

  it("reads a time without an offset in the given zone", () => {
    expect(parseIsoText("2026-10-10 16:02:11.250", "Europe/Paris")).toBe(at);
    expect(parseIsoText("2026-10-10T14:02", "UTC")).toBe(Date.parse("2026-10-10T14:02:00Z"));
    expect(parseIsoText("2026-01-15 13:00:00", "Europe/Paris")).toBe(
      Date.parse("2026-01-15T12:00:00Z"),
    );
  });

  it("refuses text that is not a real date and time", () => {
    expect(
      [
        "2026-02-30T10:00:00Z",
        "2026-10-10T24:00:00Z",
        "2026-10-10T10:60:00Z",
        "2026-10-10T10:00:61Z",
        "2026-10-10",
        "pi_123",
        "",
      ].map((t) => parseIsoText(t)),
    ).toEqual([undefined, undefined, undefined, undefined, undefined, undefined, undefined]);
  });
});
