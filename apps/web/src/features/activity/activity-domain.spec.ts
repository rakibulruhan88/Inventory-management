import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import {
  activityDateRange,
  activityFilters,
  activityTime,
} from "./activity-domain";
import { ActivityDetails } from "./activity-details";
import type { ActivityDetail } from "@afia/contracts";

describe("Activity filters and saved details", () => {
  it("uses Bangladesh days even near UTC midnight", () => {
    const now = new Date("2026-10-08T18:01:00Z");
    expect(activityDateRange("today", now)).toEqual({
      from: "2026-10-09",
      to: "2026-10-09",
    });
    expect(activityDateRange("week", now)).toEqual({
      from: "2026-10-03",
      to: "2026-10-09",
    });
    expect(activityDateRange("month", now)).toEqual({
      from: "2026-10-01",
      to: "2026-10-09",
    });
    expect(activityDateRange("all", now)).toEqual({
      from: undefined,
      to: undefined,
    });
    expect(activityTime(now.toISOString())).toContain("12:01");
  });
  it("restores filters from a shared URL and bounds page/search values", () => {
    expect(
      activityFilters(
        new URLSearchParams("category=Stock&page=2&actorId=owner&sort=oldest"),
      ),
    ).toMatchObject({
      category: "Stock",
      page: 2,
      actorId: "owner",
      sort: "oldest",
    });
    expect(
      activityFilters(new URLSearchParams("category=bad&page=-2")),
    ).toMatchObject({ category: undefined, page: 1 });
    expect(
      activityFilters(new URLSearchParams({ search: "x".repeat(300) })).search,
    ).toHaveLength(200);
  });
  const event: ActivityDetail = {
    id: "audit",
    action: "RECORD_UPDATED",
    title: "Customer updated",
    category: "Customers",
    entityType: "Customer",
    entityId: "customer",
    reference: "customer",
    label: "<script>bad()</script>",
    createdAt: "2026-10-09T06:00:00Z",
    actor: { id: "owner", name: "Shop Owner", role: "OWNER" },
    reason: "Correct phone",
    amount: null,
    href: "/customers/customer",
    hasSnapshot: true,
    changes: [{ label: "Phone", before: "01700000000", after: "01800000000" }],
    details: [],
  };
  const html = (value: ActivityDetail) =>
    renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(ActivityDetails, { event: value, close: () => {} }),
      ),
    );
  it("shows the saved actor, exact changes and source link without raw HTML", () => {
    const result = html(event);
    expect(result).toContain("Shop Owner");
    expect(result).toContain("01700000000");
    expect(result).toContain("01800000000");
    expect(result).toContain('href="/customers/customer"');
    expect(result).not.toContain("<script>");
  });
  it("labels missing historical details instead of inventing changes", () => {
    const result = html({
      ...event,
      actor: null,
      hasSnapshot: false,
      changes: [],
    });
    expect(result).toContain("Not recorded");
    expect(result).toContain("older record does not include change details");
  });
});
