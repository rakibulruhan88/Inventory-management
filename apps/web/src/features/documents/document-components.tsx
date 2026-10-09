import type { ReactNode } from "react";
import type { StoreSettingsContract } from "@afia/contracts";
import { formatLedgerDate } from "@/features/sales/ledger-components";
import "./documents.css";

export function DocumentHeader({
  settings,
  title,
  number,
  date,
  numberLabel,
  creatorName,
}: {
  settings?: StoreSettingsContract;
  title: string;
  number: string;
  date: string;
  numberLabel?: string;
  creatorName?: string | null;
}) {
  return (
    <header className="document-header">
      <div className="document-brand">
        {settings?.logoUrl && (
          <img src={settings.logoUrl} alt="" className="document-logo" />
        )}
        <div>
          <p className="document-store">
            {settings?.storeName ?? "Afia Leather"}
          </p>
          <div className="document-contact">
            {[
              settings?.storeAddress,
              settings?.storePhone,
              settings?.storeEmail,
            ]
              .filter(Boolean)
              .map((value, i) => (
                <p key={i}>{value}</p>
              ))}
          </div>
        </div>
      </div>
      <div className="document-identity">
        <h1>{title}</h1>
        <dl>
          <div>
            <dt>
              {numberLabel ??
                (title === "Invoice" ? "Invoice No" : "Receipt No")}
            </dt>
            <dd>{number}</dd>
          </div>
          <div>
            <dt>Date</dt>
            <dd>{formatLedgerDate(date)}</dd>
          </div>
          <div><dt>Prepared by</dt><dd>{creatorName ?? "Not recorded"}</dd></div>
        </dl>
      </div>
    </header>
  );
}
export function DocumentCustomer({
  name,
  phone,
  address,
  email,
}: {
  name: ReactNode;
  phone?: string | null;
  address?: string | null;
  email?: string | null;
}) {
  return (
    <section className="document-customer" aria-label="Customer">
      <h2>Customer</h2>
      <p className="document-customer-name">{name}</p>
      {phone && <p>Phone: {phone}</p>}
      {address && <p>{address}</p>}
      {email && <p>{email}</p>}
    </section>
  );
}
export function AmountRow({
  label,
  children,
  strong = false,
}: {
  label: string;
  children: ReactNode;
  strong?: boolean;
}) {
  return (
    <div
      className={`document-amount${strong ? " document-amount-strong" : ""}`}
    >
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function DocumentSignatures({
  left = "Customer Signature",
  right = "Authorized Signature",
}: {
  left?: string;
  right?: string;
}) {
  return (
    <div className="document-signatures">
      <div>
        <span>{left}</span>
      </div>
      <div>
        <span>{right}</span>
      </div>
    </div>
  );
}
