import { describe, expect, it } from "vitest";
import {
  activeFilterLabels,
  filterError,
  readLedgerParams,
} from "./sales-filter-state";

describe("sales filter state", () => {
  it("restores search, exact dates, combined filters, sort and pagination from the URL", () => {
    expect(
      readLedgerParams(
        new URLSearchParams(
          "search=L100&customer=Rahim&phone=017&invoice=AF-001&product=Pine&date=specific&from=2026-10-07&status=PARTIAL&method=BANK&minTotal=0&maxDue=200&sort=highest-due&page=2",
        ),
      ),
    ).toEqual({
      search: "L100",
      customer: "Rahim",
      phone: "017",
      invoice: "AF-001",
      product: "Pine",
      date: "specific",
      from: "2026-10-07",
      status: "PARTIAL",
      method: "BANK",
      minTotal: 0,
      maxDue: 200,
      sort: "highest-due",
      page: 2,
    });
  });
  it("does not crash on unknown enum values or invalid numeric URL input", () => {
    const q = readLedgerParams(
      new URLSearchParams(
        "status=bad&method=bad&sort=bad&date=bad&page=NaN&minDue=bad",
      ),
    );
    expect(q).toEqual({});
    expect(activeFilterLabels(q)).toEqual([]);
  });
  it("validates missing, reversed and negative ranges before applying", () => {
    expect(filterError({ date: "specific" })).toBeTruthy();
    expect(filterError({ date: "range", from: "2026-10-07" })).toBeTruthy();
    expect(
      filterError({ date: "range", from: "2026-10-07", to: "2026-10-06" }),
    ).toBeTruthy();
    expect(filterError({ minTotal: 10, maxTotal: 0 })).toBeTruthy();
    expect(filterError({ minDue: -1 })).toBeTruthy();
    expect(
      filterError({
        date: "range",
        from: "2026-10-07",
        to: "2026-10-07",
        minDue: 0,
        maxDue: 0,
      }),
    ).toBe("");
  });
  it("includes zero-valued boundaries and all active filters in compact indicators", () => {
    const chips = activeFilterLabels({
      date: "range",
      from: "2026-10-01",
      to: "2026-10-07",
      customer: "Rahim",
      phone: "017",
      invoice: "AF",
      product: "Pine",
      status: "UNPAID",
      method: "CASH",
      minTotal: 0,
      maxTotal: 200,
      minDue: 0,
      maxDue: 100,
      sort: "highest-due",
    });
    expect(chips).toHaveLength(12);
    expect(chips.find((c) => c.key === "date")?.label).toContain(
      "2026-10-01 – 2026-10-07",
    );
    expect(chips.find((c) => c.key === "minDue")?.label).toBe(
      "Min invoice due: 0",
    );
    expect(
      activeFilterLabels({ search: "query", sort: "newest", page: 2 }),
    ).toEqual([]);
  });
});
