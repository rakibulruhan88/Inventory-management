import { Permit } from "@/features/auth/permit";
import {
  formatMoney,
  LedgerError,
  LedgerLoading,
} from "@/features/sales/ledger-components";
import "./customers.css";
import { customerPhoneError } from "@afia/contracts";
import { SourceDocument } from "@/features/purchases/source-document";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ContainerSummary, CustomerSummary } from "@afia/contracts";
import { Edit3, Plus, Search, Trash2, X } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Drawer } from "vaul";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  CustomerPhoneConflictError,
  archiveContainer,
  archiveCustomer,
  createCustomer,
  getContainers,
  getCustomers,
  updateContainer,
  updateCustomer,
} from "@/lib/api";
export function CustomersPage() {
  const [params] = useSearchParams();
  const qc = useQueryClient();
  const [search, setSearch] = useState(params.get("search") ?? "");
  const [dueFilter, setDueFilter] = useState("all");
  const [editing, setEditing] = useState<CustomerSummary | "new" | null>(null);
  const [confirm, setConfirm] = useState<CustomerSummary | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const customers = useQuery({
    queryKey: ["customers", search],
    queryFn: () => getCustomers(search),
  });
  const phoneError = customerPhoneError(phone);
  const emailValid = !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const save = useMutation({
    mutationFn: () =>
      editing === "new"
        ? createCustomer({ name, phone, email, address })
        : updateCustomer(editing!.id, { name, phone, email, address }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["customers"] });
      setEditing(null);
      toast.success("Customer saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: archiveCustomer,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["customers"] });
      setConfirm(null);
      toast.success("Customer archived");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const open = (c: CustomerSummary | "new") => {
    save.reset();
    setEditing(c);
    setName(c === "new" ? "" : c.name);
    setPhone(c === "new" ? "" : (c.phone ?? ""));
    setEmail(c === "new" ? "" : (c.email ?? ""));
    setAddress(c === "new" ? "" : (c.address ?? ""));
  };
  const rows = (customers.data ?? []).filter((c) =>
    dueFilter === "due"
      ? c.totalDue > 0
      : dueFilter === "clear"
        ? c.totalDue <= 0
        : true,
  );
  const customerActions = (c: CustomerSummary) => (
    <div className="customer-row-actions">
      <Button asChild variant="outline" className="text-xs">
        <Link to={`/customers/${c.id}`}>View Account</Link>
      </Button>
      {c.totalDue > 0 && (
        <Permit permission="payments.receive"><Button asChild variant="outline" className="text-xs">
          <Link to={`/customers/${c.id}/receive-payment`}>Receive Payment</Link>
        </Button></Permit>
      )}
      <Permit permission="customers.manage"><Button
        size="icon"
        variant="ghost"
        aria-label={`Edit ${c.name}`}
        onClick={() => open(c)}
      >
        <Edit3 className="size-4" />
      </Button></Permit>
      <Permit permission="customers.archive"><Button
        size="icon"
        variant="ghost"
        aria-label={`Archive ${c.name}`}
        className="text-[var(--muted)]"
        onClick={() => setConfirm(c)}
      >
        <Trash2 className="size-4" />
      </Button></Permit>
    </div>
  );
  return (
    <Page>
      <header className="customers-header">
        <div>
          <p className="customers-eyebrow">Afia Leather · Customer accounts</p>
          <h1>Customers</h1>
          <p>Find an account, check its due and receive payments.</p>
        </div>
        <Permit permission="customers.manage"><Button asChild>
          <Link to="/customers/new">
            <Plus className="size-4" />
            Add Customer
          </Link>
        </Button></Permit>
      </header>
      <div className="customers-toolbar">
        <label className="customers-search">
          <span className="sr-only">
            Search customers by name, phone or email
          </span>
          <Search className="size-4" aria-hidden="true" />
          <Input
            type="search"
            maxLength={200}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, phone or email…"
          />
        </label>
        <div
          className="customers-filters"
          role="group"
          aria-label="Customer due filter"
        >
          {[
            ["all", "All Customers"],
            ["due", "With Due"],
            ["clear", "Clear"],
          ].map(([value, label]) => (
            <button
              key={value}
              aria-pressed={dueFilter === value}
              onClick={() => setDueFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <section
        className="customers-directory"
        aria-label="Customer accounts"
        aria-busy={customers.isFetching}
      >
        {customers.isError ? (
          <LedgerError
            message={customers.error.message}
            retry={() => void customers.refetch()}
          />
        ) : customers.isPending ? (
          <LedgerLoading />
        ) : !rows.length ? (
          <div className="customers-empty">
            <h2>No customers found</h2>
            <p>
              {search || dueFilter !== "all"
                ? "Try another search or show all customer accounts."
                : "Add your first customer, with old due if needed."}
            </p>
            {search || dueFilter !== "all" ? (
              <Button
                variant="outline"
                onClick={() => {
                  setSearch("");
                  setDueFilter("all");
                }}
              >
                Clear Filters
              </Button>
            ) : (
              <Permit permission="customers.manage"><Button asChild>
                <Link to="/customers/new">Add Customer</Link>
              </Button></Permit>
            )}
          </div>
        ) : (
          <>
            <table className="customers-table">
              <caption className="sr-only">
                Customer sales, payments and remaining due
              </caption>
              <thead>
                <tr>
                  {[
                    "Customer",
                    "Sales",
                    "Payments",
                    "Total Due",
                    "Actions",
                  ].map((label) => (
                    <th key={label} scope="col">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link className="customer-name" to={`/customers/${c.id}`}>
                        {c.name}
                      </Link>
                      <p className="customer-contact">
                        {c.phone || c.email || "No contact details"}
                      </p>
                      {c.address && (
                        <p className="customer-address">{c.address}</p>
                      )}
                    </td>
                    <td className="customer-amount">
                      {formatMoney(c.totalSales)}
                    </td>
                    <td className="customer-amount">
                      {formatMoney(c.totalPaid)}
                    </td>
                    <td className="customer-amount">
                      <strong className={c.totalDue > 0 ? "customer-due" : ""}>
                        {formatMoney(c.totalDue)}
                      </strong>
                      <span className="customer-due-caption">
                        {c.totalDue > 0 ? "Due remaining" : "Clear"}
                      </span>
                    </td>
                    <td>{customerActions(c)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="customers-mobile">
              {rows.map((c) => (
                <article key={c.id}>
                  <div className="customer-mobile-heading">
                    <div>
                      <Link className="customer-name" to={`/customers/${c.id}`}>
                        {c.name}
                      </Link>
                      <p className="customer-contact">
                        {c.phone || c.email || "No contact details"}
                      </p>
                    </div>
                    <div className="customer-mobile-due">
                      <span>Total Due</span>
                      <strong className={c.totalDue > 0 ? "customer-due" : ""}>
                        {formatMoney(c.totalDue)}
                      </strong>
                    </div>
                  </div>
                  {c.address && <p className="customer-address">{c.address}</p>}
                  <dl className="customer-mobile-money">
                    <div>
                      <dt>Sales</dt>
                      <dd>{formatMoney(c.totalSales)}</dd>
                    </div>
                    <div>
                      <dt>Payments</dt>
                      <dd>{formatMoney(c.totalPaid)}</dd>
                    </div>
                  </dl>
                  {customerActions(c)}
                </article>
              ))}
            </div>
          </>
        )}
        {customers.isSuccess && (
          <footer className="customers-list-footer">
            <span>
              {rows.length} customers shown
              {customers.isFetching ? " · Updating…" : ""}
            </span>
            <span>Search to find more · Up to 50 results</span>
          </footer>
        )}
      </section>
      <Drawer.Root
        open={!!editing}
        onOpenChange={(v) => !v && setEditing(null)}
      >
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-50 bg-slate-950/35 backdrop-blur-[2px]" />
          <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 max-h-[90dvh] overflow-y-auto rounded-t-lg bg-[var(--surface)] p-5">
            <div className="mx-auto max-w-lg">
              <div className="flex items-center justify-between gap-3">
                <Drawer.Title className="text-lg font-semibold">
                  {editing === "new" ? "New customer" : "Edit customer"}
                </Drawer.Title>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Close customer form"
                  disabled={save.isPending}
                  onClick={() => setEditing(null)}
                >
                  <X className="size-4" />
                </Button>
              </div>
              <div className="mt-4 space-y-3">
                <label className="block text-sm font-medium">
                  Customer Name *
                  <Input
                    className="mt-2"
                    placeholder="Rahim Traders"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <label className="block text-sm font-medium">
                  Phone{" "}
                  <span className="font-normal text-[var(--muted)]">
                    (optional)
                  </span>
                  <Input
                    className="mt-2"
                    type="tel"
                    aria-invalid={!!phoneError}
                    aria-describedby={
                      phoneError ? "customer-phone-error" : undefined
                    }
                    value={phone}
                    onChange={(e) => {
                      setPhone(e.target.value);
                      save.reset();
                    }}
                  />
                </label>
                {phoneError && (
                  <p
                    id="customer-phone-error"
                    className="text-xs text-[var(--danger)]"
                  >
                    {phoneError}
                  </p>
                )}
                <label className="block text-sm font-medium">
                  Email{" "}
                  <span className="font-normal text-[var(--muted)]">
                    (optional)
                  </span>
                  <Input
                    className="mt-2"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                  {!emailValid && (
                    <span className="mt-1 block text-xs text-[var(--danger)]">
                      Enter a valid email address.
                    </span>
                  )}
                </label>
                <label className="block text-sm font-medium">
                  Address{" "}
                  <span className="font-normal text-[var(--muted)]">
                    (optional)
                  </span>
                  <Input
                    className="mt-2"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                  />
                </label>
              </div>
              {save.error instanceof CustomerPhoneConflictError && (
                <div
                  role="alert"
                  className="mt-4 border-l-2 border-[var(--warning)] pl-3 text-sm"
                >
                  <p>{save.error.message}</p>
                  <Button asChild variant="outline" className="mt-2">
                    <Link
                      to={`/customers/${save.error.existingCustomer.id}`}
                      onClick={() => setEditing(null)}
                    >
                      View existing customer
                    </Link>
                  </Button>
                </div>
              )}
              <Button
                className="mt-5 w-full"
                disabled={
                  !name.trim() || !emailValid || !!phoneError || save.isPending
                }
                onClick={() => save.mutate()}
              >
                Save customer
              </Button>
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
      {confirm && (
        <Confirm
          title={`Archive ${confirm.name}?`}
          body={
            confirm.totalDue > 0
              ? `This customer still has ৳${confirm.totalDue.toLocaleString()} due and cannot be archived.`
              : "Sales history will remain available."
          }
          blocked={confirm.totalDue > 0}
          onClose={() => setConfirm(null)}
          onConfirm={() => remove.mutate(confirm.id)}
        />
      )}
    </Page>
  );
}
export function ContainersPage() {
  const [params] = useSearchParams();
  const qc = useQueryClient();
  const [search, setSearch] = useState(params.get("search") ?? "");
  const [stockFilter, setStockFilter] = useState("all");
  const [edit, setEdit] = useState<ContainerSummary | null>(null);
  const [confirm, setConfirm] = useState<ContainerSummary | null>(null);
  const [number, setNumber] = useState("");
  const [notes, setNotes] = useState("");
  const q = useQuery({
    queryKey: ["containers", search],
    queryFn: () => getContainers(search),
  });
  const save = useMutation({
    mutationFn: () =>
      updateContainer(edit!.id, { containerNumber: number, notes }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["containers"] });
      setEdit(null);
      toast.success("Container updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: archiveContainer,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["containers"] });
      setConfirm(null);
      toast.success("Container archived");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const rows = (q.data ?? []).filter((c) =>
    stockFilter === "stock"
      ? c.totalRolls > 0 || c.totalMeters > 0
      : stockFilter === "empty"
        ? c.totalRolls <= 0 && c.totalMeters <= 0
        : true,
  );
  const actions = (c: ContainerSummary) => (
    <div className="customer-row-actions">
      <Permit permission="containers.manage"><Button
        variant="outline"
        className="text-xs"
        onClick={() => {
          save.reset();
          setEdit(c);
          setNumber(c.containerNumber);
          setNotes(c.notes ?? "");
        }}
      >
        Edit
      </Button></Permit>
      <Permit permission="containers.manage"><Button
        size="icon"
        variant="ghost"
        aria-label={`Archive container ${c.containerNumber}`}
        onClick={() => setConfirm(c)}
      >
        <Trash2 className="size-4" />
      </Button></Permit>
    </div>
  );
  const documents = (c: ContainerSummary) =>
    c.documents?.length ? (
      <details className="compact-documents">
        <summary>Source documents ({c.documents.length})</summary>
        {c.documents.map((document) => (
          <SourceDocument key={document.id} document={document} />
        ))}
      </details>
    ) : null;
  const received = (c: ContainerSummary) =>
    c.receivedAt
      ? new Intl.DateTimeFormat("en-GB", {
          timeZone: "Asia/Dhaka",
          day: "2-digit",
          month: "short",
          year: "numeric",
        }).format(new Date(c.receivedAt))
      : "Not received yet";
  return (
    <Page>
      <header className="customers-header">
        <div>
          <p className="customers-eyebrow">Afia Leather · Shipments & stock</p>
          <h1>Containers</h1>
          <p>Container records, suppliers and remaining stock.</p>
        </div>
        <Permit permission="purchases.receive"><Button asChild>
          <Link to="/purchases/new">
            <Plus className="size-4" />
            Receive Purchase
          </Link>
        </Button></Permit>
      </header>
      <div className="customers-toolbar">
        <label className="customers-search">
          <span className="sr-only">
            Search container, supplier or item code
          </span>
          <Search className="size-4" aria-hidden="true" />
          <Input
            type="search"
            maxLength={200}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Container, supplier or item code…"
          />
        </label>
        <div
          className="customers-filters"
          role="group"
          aria-label="Container stock filter"
        >
          {[
            ["all", "All Containers"],
            ["stock", "In Stock"],
            ["empty", "Empty"],
          ].map(([value, label]) => (
            <button
              key={value}
              aria-pressed={stockFilter === value}
              onClick={() => setStockFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <section
        className="customers-directory compact-directory"
        aria-label="Container records"
        aria-busy={q.isFetching}
      >
        {q.isError ? (
          <LedgerError
            message={q.error.message}
            retry={() => void q.refetch()}
          />
        ) : q.isPending ? (
          <LedgerLoading />
        ) : !rows.length ? (
          <div className="customers-empty">
            <h2>No containers found</h2>
            <p>
              {search || stockFilter !== "all"
                ? "Try another search or show all containers."
                : "Receive a purchase to record a container and its stock."}
            </p>
            {search || stockFilter !== "all" ? (
              <Button
                variant="outline"
                onClick={() => {
                  setSearch("");
                  setStockFilter("all");
                }}
              >
                Clear Filters
              </Button>
            ) : (
              <Permit permission="purchases.receive"><Button asChild>
                <Link to="/purchases/new">Receive Purchase</Link>
              </Button></Permit>
            )}
          </div>
        ) : (
          <>
            <table className="customers-table compact-containers-table">
              <caption className="sr-only">
                Container suppliers and remaining Rolls and Meter
              </caption>
              <thead>
                <tr>
                  {[
                    "Container",
                    "Supplier",
                    "Items",
                    "Rolls",
                    "Meter",
                    "Actions",
                  ].map((label) => (
                    <th key={label} scope="col">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <strong className="customer-name">
                        {c.containerNumber}
                      </strong>
                      <p className="customer-contact">{received(c)}</p>
                      <span className="compact-status">
                        {c.status.replaceAll("_", " ")}
                      </span>
                      {c.notes && <p className="customer-address">{c.notes}</p>}
                      {documents(c)}
                    </td>
                    <td>{c.supplierName}</td>
                    <td className="customer-amount">{c.totalItems}</td>
                    <td className="customer-amount">
                      <strong>{c.totalRolls.toLocaleString()}</strong>
                    </td>
                    <td className="customer-amount">
                      {c.totalMeters.toLocaleString()}
                    </td>
                    <td>{actions(c)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="customers-mobile">
              {rows.map((c) => (
                <article key={c.id}>
                  <div className="customer-mobile-heading">
                    <div>
                      <h2 className="customer-name">{c.containerNumber}</h2>
                      <p className="customer-contact">{c.supplierName}</p>
                    </div>
                    <span className="compact-status">
                      {c.status.replaceAll("_", " ")}
                    </span>
                  </div>
                  <p className="customer-contact">{received(c)}</p>
                  <dl className="customer-mobile-money">
                    <div>
                      <dt>Items</dt>
                      <dd>{c.totalItems}</dd>
                    </div>
                    <div>
                      <dt>Rolls</dt>
                      <dd>{c.totalRolls.toLocaleString()}</dd>
                    </div>
                    <div>
                      <dt>Meter</dt>
                      <dd>{c.totalMeters.toLocaleString()}</dd>
                    </div>
                  </dl>
                  {c.notes && (
                    <p className="customer-address mb-3">{c.notes}</p>
                  )}
                  {actions(c)}
                  {documents(c)}
                </article>
              ))}
            </div>
          </>
        )}
        {q.isSuccess && (
          <footer className="customers-list-footer">
            <span>
              {rows.length} containers shown{q.isFetching ? " · Updating…" : ""}
            </span>
            <span>Search to find more · Up to 50 results</span>
          </footer>
        )}
      </section>
      <Drawer.Root open={!!edit} onOpenChange={(v) => !v && setEdit(null)}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-50 bg-slate-950/35 backdrop-blur-[2px]" />
          <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 max-h-[90dvh] overflow-y-auto rounded-t-lg bg-[var(--surface)] p-5">
            <div className="mx-auto max-w-lg">
              <Drawer.Title className="text-lg font-semibold">
                Edit container
              </Drawer.Title>
              <label className="mt-4 block text-sm font-medium">
                Container Number *
                <Input
                  className="mt-2"
                  value={number}
                  onChange={(e) => setNumber(e.target.value)}
                />
              </label>
              <label className="mt-4 block text-sm font-medium">
                Note (optional)
                <Input
                  className="mt-2"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </label>
              {save.error && (
                <p role="alert" className="mt-3 text-sm text-[var(--danger)]">
                  {save.error.message}
                </p>
              )}
              <div className="mt-5 flex gap-3">
                <Button
                  disabled={!number.trim() || save.isPending}
                  onClick={() => save.mutate()}
                >
                  {save.isPending ? "Saving…" : "Save Changes"}
                </Button>
                <Button
                  variant="outline"
                  disabled={save.isPending}
                  onClick={() => setEdit(null)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
      {confirm && (
        <Confirm
          title={`Archive ${confirm.containerNumber}?`}
          body={
            confirm.totalRolls > 0 || confirm.totalMeters > 0
              ? `This container still has ${confirm.totalRolls} Rolls and ${confirm.totalMeters.toLocaleString()} Meter in stock.`
              : "Purchase history will remain available."
          }
          blocked={confirm.totalRolls > 0 || confirm.totalMeters > 0}
          onClose={() => setConfirm(null)}
          onConfirm={() => remove.mutate(confirm.id)}
        />
      )}
    </Page>
  );
}
function Page({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-350 px-4 pb-28 pt-6 md:px-7 lg:px-10">
      {children}
    </div>
  );
}
function Confirm({
  title,
  body,
  blocked,
  onClose,
  onConfirm,
}: {
  title: string;
  body: string;
  blocked: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-60 grid place-items-center bg-slate-950/35 p-4 backdrop-blur-[2px]">
      <div className="w-full max-w-sm rounded-xl border border-[var(--border)] bg-white p-5 shadow-[var(--shadow-float)]">
        <button className="float-right" onClick={onClose}>
          <X className="size-4" />
        </button>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="mt-2 text-sm text-[var(--muted)]">{body}</p>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" disabled={blocked} onClick={onConfirm}>
            {blocked ? "Stock / due remains" : "Archive"}
          </Button>
        </div>
      </div>
    </div>
  );
}
