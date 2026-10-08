import { describe, expect, it } from "vitest";
import { dhakaDate, withDhakaTime } from "./business-time";
describe("Bangladesh business timestamps", () => {
  it("crosses the business date at Bangladesh midnight, independent of device timezone", () => {
    const before = new Date("2026-10-07T17:59:59.987Z");
    const after = new Date("2026-10-07T18:00:00.123Z");
    expect(dhakaDate(before)).toBe("2026-10-07");
    expect(dhakaDate(after)).toBe("2026-10-08");
    expect(withDhakaTime(dhakaDate(after), after)).toBe(
      "2026-10-08T00:00:00.123+06:00",
    );
    expect(
      new Date(withDhakaTime(dhakaDate(before), before)).toISOString(),
    ).toBe(before.toISOString());
  });
  it("preserves a selected past date while recording the current Bangladesh clock time", () => {
    const now = new Date("2026-10-08T22:51:05.456Z");
    expect(dhakaDate(now)).toBe("2026-10-09");
    expect(withDhakaTime("2026-09-01", now)).toBe(
      "2026-09-01T04:51:05.456+06:00",
    );
  });
});
