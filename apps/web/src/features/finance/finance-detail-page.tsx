import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { useReactToPrint } from "react-to-print";
import { ArrowLeft, Download, Printer } from "lucide-react";
import {
  type FinanceEntryDetail as Entry,
  type StoreSettingsContract,
} from "@afia/contracts";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/features/auth/auth-context";
import { getFinanceEntry, getSettings } from "@/lib/api";
import {
  AmountRow,
  DocumentHeader,
  DocumentSignatures,
} from "@/features/documents/document-components";
import { cashMoney, methodNames } from "./financial-summary";
import { FinanceEntryDetail } from "./finance-entry-detail";
import "./finance.css";
export const financeDocumentNames = {
  OTHER_IN: "Money In Receipt",
  SUPPLIER_PAYMENT: "Supplier Payment",
  EXPENSE: "Expense Voucher",
  OTHER_OUT: "Payment Voucher",
};
export function FinanceDocument({
  entry: e,
  settings,
}: {
  entry: Entry;
  settings?: StoreSettingsContract;
}) {
  const isIn = e.direction === "IN";
  return (
    <article
      className={`document-sheet finance-document ${e.type === "EXPENSE" ? "expense-voucher" : e.type === "SUPPLIER_PAYMENT" ? "supplier-voucher" : isIn ? "receipt-sheet" : "payment-voucher"}`}
    >
      <DocumentHeader
        settings={settings}
        title={financeDocumentNames[e.type]}
        number={e.id}
        numberLabel="Entry ID"
        date={e.occurredAt}
      />
      {e.voidedAt && (
        <p className="document-void">
          <strong>VOIDED</strong> · {e.voidReason}
        </p>
      )}
      <div className="voucher-amount">
        <span>{isIn ? "Money Received" : "Money Paid"}</span>
        <strong>{cashMoney(e.amount)}</strong>
        <p>
          {e.expenseType ??
            (e.type === "SUPPLIER_PAYMENT"
              ? "Supplier Payment"
              : isIn
                ? "Other Money In"
                : "Other Money Out")}
        </p>
      </div>
      {e.supplierName && (
        <section className="document-customer">
          <h2>Paid To</h2>
          <p className="document-customer-name">{e.supplierName}</p>
        </section>
      )}
      <section className="voucher-details">
        <dl>
          <AmountRow label="Method">{methodNames[e.method]}</AmountRow>
          {e.expenseType && (
            <AmountRow label="Expense Type">{e.expenseType}</AmountRow>
          )}
          {e.reference && (
            <AmountRow label="Reference">{e.reference}</AmountRow>
          )}
          {e.purchaseNumber && (
            <AmountRow label="Purchase">{e.purchaseNumber}</AmountRow>
          )}
          {e.containerNumber && (
            <AmountRow label="Container">{e.containerNumber}</AmountRow>
          )}
        </dl>
      </section>
      {e.note && (
        <section className="document-note">
          <h2>{isIn ? "Received For" : "Paid For"}</h2>
          <p>{e.note}</p>
        </section>
      )}
      <DocumentSignatures
        left={isIn ? "Received By" : "Prepared By"}
        right={
          isIn
            ? "Paid By"
            : e.type === "SUPPLIER_PAYMENT"
              ? "Supplier Signature"
              : "Approved By"
        }
      />
      <footer className="document-footer">
        Recorded by {e.creatorName} ·{" "}
        {isIn ? "Money received record" : "Money paid record"}
      </footer>
    </article>
  );
}
export function FinanceDetailPage() {
  const { entryId = "" } = useParams(),
    printable = useRef<HTMLDivElement>(null),
    canWrite = useAuth().user?.role === "OWNER";
  const q = useQuery({
      queryKey: ["finance", "entry", entryId],
      queryFn: () => getFinanceEntry(entryId),
    }),
    settings = useQuery({ queryKey: ["settings"], queryFn: getSettings });
  const print = useReactToPrint({
    contentRef: printable,
    documentTitle: q.data
      ? `${financeDocumentNames[q.data.type]}-${entryId}`
      : "Money Record",
  });
  const canPrint = !!q.data && !!settings.data && !settings.isError;
  return (
    <div className="finance-page document-page">
      <Link className="finance-back invoice-actions" to="/cashbook">
        <ArrowLeft size={15} />
        Cashbook
      </Link>
      <header className="finance-page-header invoice-actions">
        <div>
          <p className="finance-eyebrow">Saved money record</p>
          <h1>
            {q.data ? financeDocumentNames[q.data.type] : "Payment Details"}
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={!canPrint}
            onClick={() => print()}
          >
            <Download size={16} />
            Save PDF
          </Button>
          <Button disabled={!canPrint} onClick={() => print()}>
            <Printer size={16} />
            Print
          </Button>
        </div>
      </header>
      {q.isPending ? (
        <p role="status" className="finance-feedback">
          Loading record…
        </p>
      ) : q.isError ? (
        <div role="alert" className="finance-feedback">
          <p>{q.error.message}</p>
          <Button onClick={() => q.refetch()}>Try again</Button>
        </div>
      ) : (
        <div className="finance-entry-paper-layout">
          <div ref={printable}>
            <FinanceDocument entry={q.data} settings={settings.data} />
          </div>
          <aside className="invoice-actions">
            <FinanceEntryDetail id={entryId} canWrite={canWrite} />
            {q.data.supplierId && (
              <Link
                className="finance-back"
                to={`/suppliers/${q.data.supplierId}`}
              >
                View Supplier →
              </Link>
            )}
            {q.data.purchaseId && (
              <Link
                className="finance-back"
                to={`/purchases/${q.data.purchaseId}`}
              >
                View Purchase →
              </Link>
            )}
            <p className="finance-footnote">
              For a PDF copy, choose Save as PDF in the print window.
            </p>
          </aside>
        </div>
      )}
      {settings.isError && (
        <div role="alert" className="finance-feedback invoice-actions">
          Business details could not load.
          <Button variant="outline" onClick={() => settings.refetch()}>
            Try again
          </Button>
        </div>
      )}
    </div>
  );
}
