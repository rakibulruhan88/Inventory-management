import { ArrowLeft } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { financeLabels, type ManualFinanceType } from "@afia/contracts";
import { useAuth } from "@/features/auth/auth-context";
import { FinanceEntryForm } from "./finance-entry-form";
import { FinanceNavigation } from "./finance-navigation";
import "./finance.css";
const explanations: Record<ManualFinanceType, string> = {
  OTHER_IN:
    "Record money received outside a sale, such as an owner deposit or refund.",
  EXPENSE: "Record a business cost, such as transport, rent, loading or wages.",
  SUPPLIER_PAYMENT:
    "Record money paid to a supplier. A Purchase or Container link is optional.",
  OTHER_OUT: "Record money paid out outside a supplier payment or expense.",
};
export function FinanceCreatePage({ type }: { type: ManualFinanceType }) {
  const navigate = useNavigate(),
    canWrite = useAuth().user?.role === "OWNER";
  return (
    <div className="finance-page">
      <Link to="/cashbook" className="finance-back">
        <ArrowLeft size={15} />
        Cashbook
      </Link>
      <header className="finance-page-header">
        <div>
          <p className="finance-eyebrow">New money record</p>
          <h1>{financeLabels[type]}</h1>
          <p className="finance-subtitle">{explanations[type]}</p>
        </div>
      </header>
      <FinanceNavigation />
      {!canWrite ? (
        <div className="finance-feedback">Only the owner can save entries.</div>
      ) : (
        <div className="finance-form-layout">
          <section className="finance-form-panel">
            <h2>Payment Details</h2>
            <FinanceEntryForm
              type={type}
              onCancel={() => navigate("/cashbook")}
              onSaved={(id) =>
                navigate(`/cashbook/entries/${id}`, { replace: true })
              }
            />
          </section>
          <aside className="finance-form-aside">
            <h2>Keep a clear record</h2>
            <p>
              Check the amount, method and date before saving. After saving, you
              can print this record.
            </p>
            <Link to="/cashbook">View all money records →</Link>
          </aside>
        </div>
      )}
    </div>
  );
}
