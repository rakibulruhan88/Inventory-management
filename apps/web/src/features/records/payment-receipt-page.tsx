import { useQuery } from "@tanstack/react-query";
import { useRef } from "react";
import { Link, useParams } from "react-router-dom";
import { useReactToPrint } from "react-to-print";
import { Download, Printer } from "lucide-react";
import type { PaymentReceipt, StoreSettingsContract } from "@afia/contracts";
import { Button } from "@/components/ui/button";
import { getPaymentReceipt, getSettings } from "@/lib/api";
import {
  AmountRow,
  DocumentCustomer,
  DocumentHeader,
  DocumentSignatures,
} from "@/features/documents/document-components";
import {
  documentMoney,
  paymentMethod,
} from "@/features/documents/document-data";
import {
  formatLedgerDate,
  ledgerLink,
  LedgerError,
  LedgerLoading,
} from "@/features/sales/ledger-components";

export function ReceiptSheet({
  receipt: r,
  settings,
}: {
  receipt: PaymentReceipt;
  settings?: StoreSettingsContract;
}) {
  // Receipt balances are stored posting-time snapshots; never sum partial display rows.
  // Receipt does not snapshot store/currency details. Existing receipt amounts use BDT.
  return (
    <article className="document-sheet receipt-sheet">
      <DocumentHeader
        settings={settings}
        title="Payment Receipt"
        number={r.receiptNumber}
        date={r.paidAt}
      />
      <div className="receipt-amount">
        <span>Amount Received</span>
        <strong>{documentMoney(r.totalAmount)}</strong>
        <p>{paymentMethod(r.method)}</p>
      </div>
      <DocumentCustomer
        name={
          <Link className={ledgerLink} to={`/customers/${r.customerId}`}>
            {r.customerName}
          </Link>
        }
        phone={r.customerPhone}
      />
      <section
        className="document-payment receipt-method"
        aria-label="Payment details"
      >
        <p>
          Payment Method: <strong>{paymentMethod(r.method)}</strong>
        </p>
        {r.reference && <p>Reference: {r.reference}</p>}
      </section>
      <section aria-labelledby="paid-against-heading">
        <h2 id="paid-against-heading">Paid Against</h2>
        <table className="document-table receipt-items">
          <caption className="sr-only">Due paid by this receipt</caption>
          <colgroup>
            <col style={{ width: "34%" }} />
            <col style={{ width: "22%" }} />
            <col style={{ width: "22%" }} />
            <col style={{ width: "22%" }} />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">Paid Against</th>
              {["Due Before", "Paid Now", "Due Left"].map((label) => (
                <th scope="col" className="number" key={label}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {r.allocations.map((a, index) => (
              <tr key={`${a.saleId ?? a.openingBalanceId}-${index}`}>
                <td className="receipt-source">
                  {a.saleId ? (
                    <Link
                      className={ledgerLink}
                      to={`/sales/${a.saleId}/invoice`}
                    >
                      Invoice {a.invoiceNumber ?? "—"}
                    </Link>
                  ) : (
                    <strong>Opening Due</strong>
                  )}
                  <span className="document-caption block">
                    {formatLedgerDate(a.soldAt)}
                  </span>
                </td>
                <td className="number" data-label="Due Before">
                  {documentMoney(a.previousDue)}
                </td>
                <td className="number" data-label="Paid Now">
                  <strong>{documentMoney(a.amount)}</strong>
                </td>
                <td className="number" data-label="Due Left">
                  {documentMoney(a.remainingDue)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!r.allocations.length && (
          <p className="document-note">
            Paid against details are not available.
          </p>
        )}
      </section>
      <section className="receipt-totals" aria-label="Receipt totals">
        <dl>
          <AmountRow label="Total Due Before">
            {documentMoney(r.outstandingBefore)}
          </AmountRow>
          <AmountRow label="Total Paid" strong>
            {documentMoney(r.totalAmount)}
          </AmountRow>
          <AmountRow label="Due After Payment">
            {documentMoney(r.outstandingAfter)}
          </AmountRow>
        </dl>
      </section>
      {r.notes && (
        <section className="document-note">
          <h2>Notes</h2>
          <p>{r.notes}</p>
        </section>
      )}
      <DocumentSignatures left="Received By" right="Customer Signature" />
      <footer className="document-footer">Thank you for your payment.</footer>
    </article>
  );
}
export function PaymentReceiptPage() {
  const { id = "", receiptId = "" } = useParams();
  const printable = useRef<HTMLDivElement>(null);
  const q = useQuery({
    queryKey: ["customers", "receipt", id, receiptId],
    queryFn: () => getPaymentReceipt(id, receiptId),
    enabled: !!id && !!receiptId,
  });
  const settings = useQuery({ queryKey: ["settings"], queryFn: getSettings });
  const print = useReactToPrint({
    contentRef: printable,
    documentTitle: q.data?.receiptNumber ?? "Receipt",
  });
  return (
    <div className="document-page invoice-page px-4 pb-28 pt-5 md:px-7">
      <nav
        aria-label="Receipt navigation"
        className="invoice-actions mx-auto mb-5 flex max-w-[210mm] flex-wrap items-center justify-between gap-3"
      >
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="ghost">
            <Link to="/payments?view=receipts">Payments</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to={`/customers/${id}?tab=payments`}>Customer Account</Link>
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={!q.data || settings.isPending || settings.isError}
            onClick={() => print()}
          >
            <Download className="size-4" /> Save as PDF
          </Button>
          <Button
            disabled={!q.data || settings.isPending || settings.isError}
            onClick={() => print()}
          >
            <Printer className="size-4" /> Print Receipt
          </Button>
        </div>
      </nav>
      {settings.isError && (
        <div className="invoice-actions mx-auto mb-4 max-w-[210mm]">
          <LedgerError
            message="Business details could not be loaded."
            retry={() => void settings.refetch()}
          />
        </div>
      )}
      {q.isError ? (
        <LedgerError message={q.error.message} retry={() => void q.refetch()} />
      ) : !q.data ? (
        <LedgerLoading />
      ) : (
        <>
          <p className="invoice-actions mx-auto mb-4 max-w-[210mm] text-xs text-[var(--muted)]">
            Save as PDF: choose “Save as PDF” in the print window.
          </p>
          <div ref={printable}>
            <ReceiptSheet receipt={q.data} settings={settings.data} />
          </div>
        </>
      )}
    </div>
  );
}
