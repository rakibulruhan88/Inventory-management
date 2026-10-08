import { NavLink } from "react-router-dom";
import type { ManualFinanceType } from "@afia/contracts";
export const financeSections = [
  { path: "/cashbook", label: "All Money" },
  {
    path: "/cashbook/money-in",
    label: "Money In",
    type: "OTHER_IN",
    direction: "IN",
  },
  { path: "/cashbook/expenses", label: "Expenses", type: "EXPENSE" },
  {
    path: "/cashbook/supplier-payments",
    label: "Supplier Payments",
    type: "SUPPLIER_PAYMENT",
  },
  { path: "/cashbook/money-out", label: "Other Money Out", type: "OTHER_OUT" },
  { path: "/cashbook/receive-payment", label: "Receive Payment" },
] as const;
export const financeNewPaths: Record<ManualFinanceType, string> = {
  OTHER_IN: "/cashbook/money-in/new",
  EXPENSE: "/cashbook/expenses/new",
  SUPPLIER_PAYMENT: "/cashbook/supplier-payments/new",
  OTHER_OUT: "/cashbook/money-out/new",
};
export function FinanceNavigation() {
  return (
    <nav aria-label="Cashbook sections" className="finance-tabs">
      {financeSections.map((s) => (
        <NavLink key={s.path} to={s.path} end={s.path === "/cashbook"}>
          {s.label}
        </NavLink>
      ))}
    </nav>
  );
}
