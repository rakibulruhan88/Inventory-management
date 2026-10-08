import type { FinanceSummary } from "@afia/contracts";
export const cashMoney = (value: string) => {
  const [whole, fraction = "00"] = value.split(".");
  return `৳${whole.startsWith("-") ? "-" : ""}${BigInt(whole.replace("-", "")).toLocaleString("en-BD")}.${fraction.padEnd(2, "0")}`;
};
export const methodNames = {
  CASH: "Cash",
  BANK: "Bank",
  MOBILE_BANKING: "Mobile Banking",
  OTHER: "Other",
};
export function FinancialSummary({
  summary: s,
  expanded = false,
}: {
  summary: FinanceSummary;
  expanded?: boolean;
}) {
  return (
    <section className="finance-summary" aria-label="Financial summary">
      <dl className="finance-totals">
        {[
          ["Sales", s.sales, "sales"],
          ["Money In", s.moneyIn, "in"],
          ["Money Out", s.moneyOut, "out"],
          ["Net Money", s.netMoney, "net"],
        ].map(([label, value, kind]) => (
          <div key={label} className={`finance-total ${kind}`}>
            <dt>{label}</dt>
            <dd>{cashMoney(value)}</dd>
          </div>
        ))}
      </dl>
      <details className="finance-breakdown" open={expanded}>
        <summary>
          View money breakdown<span>Sale payments, old due and expenses</span>
        </summary>
        <div className="finance-breakdown-content">
          <div>
            <h3>Money In</h3>
            <dl>
              {[
                ["Sale Payments", s.byType.SALE_PAYMENT],
                ["Old Due Collected", s.oldDue],
                ["Other Money In", s.byType.OTHER_IN],
                ...(Number(s.byType.LEGACY_PAYMENT) > 0
                  ? [["Older Payments", s.byType.LEGACY_PAYMENT]]
                  : []),
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{cashMoney(value)}</dd>
                </div>
              ))}
            </dl>
            {Number(s.byType.LEGACY_PAYMENT) > 0 && (
              <p className="finance-footnote">
                Older payments count in Money In. Their type needs review.
              </p>
            )}
          </div>
          <div>
            <h3>Money Out</h3>
            <dl>
              {[
                ["Supplier Payments", s.byType.SUPPLIER_PAYMENT],
                ["Expenses", s.byType.EXPENSE],
                ["Other Money Out", s.byType.OTHER_OUT],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{cashMoney(value)}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div>
            <h3>By Method</h3>
            <table>
              <thead>
                <tr>
                  <th>Method</th>
                  <th>In</th>
                  <th>Out</th>
                </tr>
              </thead>
              <tbody>
                {s.methods.map((m) => (
                  <tr key={m.method}>
                    <th>{methodNames[m.method]}</th>
                    <td>{cashMoney(m.moneyIn)}</td>
                    <td>{cashMoney(m.moneyOut)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </details>
    </section>
  );
}

export function SectionFinancialSummary({
  summary: s,
  mode,
  total,
}: {
  summary: FinanceSummary;
  mode: "income" | "expenses" | "suppliers" | "out";
  total: number;
}) {
  const incoming = mode === "income";
  const label = incoming
    ? "Total Received"
    : mode === "expenses"
      ? "Total Expenses"
      : mode === "suppliers"
        ? "Paid to Suppliers"
        : "Other Money Out";
  const breakdown = incoming
    ? [
        ["Sale Payments", s.byType.SALE_PAYMENT],
        ["Old Due Collected", s.oldDue],
        ["Other Money In", s.byType.OTHER_IN],
        ["Older Payments", s.byType.LEGACY_PAYMENT],
      ]
    : Object.entries(methodNames).map(([method, name]) => [
        name,
        s.methods.find((m) => m.method === method)?.moneyOut ?? "0.00",
      ]);
  return (
    <section className={`finance-section-summary ${mode}`} aria-label={label}>
      <div className="finance-section-total">
        <p>{label}</p>
        <strong>{cashMoney(incoming ? s.moneyIn : s.moneyOut)}</strong>
        <span>
          {total} matching {mode === "expenses" ? "expenses" : "payments"}
        </span>
      </div>
      <dl className="finance-section-breakdown">
        {breakdown.map(([name, amount]) => (
          <div key={name}>
            <dt>{name}</dt>
            <dd>{cashMoney(amount)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
