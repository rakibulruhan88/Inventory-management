import { describe, expect, it } from "vitest";
import {
  customerAccountPath,
  prioritizeDueCustomers,
  readPaymentsParams,
  receiptDetailPath,
  receivePaymentPath,
} from "./payments-navigation";
import type { CustomerSummary } from "@afia/contracts";
const customer = (
  id: string,
  name: string,
  totalDue: number,
): CustomerSummary => ({
  id,
  name,
  totalDue,
  totalPaid: 0,
  totalSales: totalDue,
  phone: null,
  email: null,
  address: null,
});
describe("Payments navigation and customer search", () => {
  it("defaults to outstanding without losing a customer search", () => {
    expect(readPaymentsParams(new URLSearchParams("search=Rahim"))).toEqual({
      view: "outstanding",
      search: "Rahim",
      page: 1,
    });
  });
  it("restores receipt view and pagination from the URL", () => {
    expect(
      readPaymentsParams(
        new URLSearchParams("view=receipts&page=3&search=017"),
      ),
    ).toEqual({ view: "receipts", search: "017", page: 3 });
  });
  it.each(["-1", "0", "bad", "Infinity"])(
    "keeps invalid page %s at page one",
    (page) =>
      expect(readPaymentsParams(new URLSearchParams({ page })).page).toBe(1),
  );
  it("bounds page and search inputs before sending the API request", () => {
    const state = readPaymentsParams(
      new URLSearchParams({
        page: "9999999",
        search: "a".repeat(201),
        view: "unknown",
      }),
    );
    expect(state.page).toBe(1000000);
    expect(state.search).toHaveLength(200);
    expect(state.view).toBe("outstanding");
  });
  it("links both entry points to the same existing customer payment route", () => {
    expect(receivePaymentPath("c1")).toBe("/customers/c1/receive-payment");
    expect(customerAccountPath("c1")).toBe("/customers/c1");
    expect(receiptDetailPath("c1", "r1")).toBe("/customers/c1/receipts/r1");
  });
  it("encodes route identities without interpreting embedded separators", () => {
    expect(receiptDetailPath("c/x", "r?y")).toBe(
      "/customers/c%2Fx/receipts/r%3Fy",
    );
  });
  it("prioritizes due customers while retaining zero-due identities and original data", () => {
    const rows = [
      customer("a", "A settled", 0),
      customer("b", "Z due", 2000),
      customer("c", "B due", 1),
    ];
    const sorted = prioritizeDueCustomers(rows);
    expect(sorted.map((c) => c.id)).toEqual(["c", "b", "a"]);
    expect(rows.map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(sorted.map((c) => c.totalDue)).toEqual([1, 2000, 0]);
  });
});
