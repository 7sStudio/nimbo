// The words of a Home row: the relative modified time and the size.
import { describe, expect, it } from "vitest";

import { relativeTime, sizeText } from "./rows.js";

const now = Date.parse("2026-11-10T12:00:00.000Z");
const ago = (ms: number) => new Date(now - ms).toISOString();

describe("relativeTime and sizeText", () => {
  it("reads a time as a person says it, then as a date", () => {
    expect(relativeTime(null, now)).toBe("");
    expect(relativeTime(ago(5_000), now)).toBe("just now");
    expect(relativeTime(ago(-5_000), now)).toBe("just now");
    expect(relativeTime(ago(3 * 60_000), now)).toBe("3 min ago");
    expect(relativeTime(ago(2 * 3_600_000), now)).toBe("2 h ago");
    expect(relativeTime(ago(30 * 3_600_000), now)).toBe("yesterday");
    expect(relativeTime(ago(4 * 86_400_000), now)).toBe("4 days ago");
    expect(relativeTime("2026-10-12T10:00:00.000Z", now)).toBe("12 Oct");
    expect(relativeTime("2025-10-12T10:00:00.000Z", now)).toBe("12 Oct 2025");
  });

  it("writes bytes, KB and MB", () => {
    expect(sizeText(null)).toBe("");
    expect(sizeText(812)).toBe("812 B");
    expect(sizeText(4300)).toBe("4.2 KB");
    expect(sizeText(1_363_149)).toBe("1.3 MB");
  });
});
