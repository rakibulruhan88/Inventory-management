import { SourceDocument } from "@/features/purchases/source-document";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ContainerSummary,
  CustomerSummary,
} from "@afia/contracts";
import {
  Container,
  Edit3,
  Plus,
  Search,
  Trash2,
  Users,
  WalletCards,
  X,
} from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Drawer } from "vaul";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  archiveContainer,
  archiveCustomer,
  createCustomer,
  getContainers,
  getCustomers,
  receiveCustomerPayment,
  updateContainer,
  updateCustomer,
} from "@/lib/api";
function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <label className="relative mt-6 block">
      <Search className="absolute left-4 top-1/2 size-5 -translate-y-1/2 text-[var(--accent)]" />
      <Input
        className="h-13 pl-12"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}
function Title({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: typeof Users;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex gap-4">
      <span className="grid size-11 place-items-center rounded-xl bg-[var(--surface-warm)] text-[var(--accent)]">
        <Icon className="size-5" />
      </span>
      <div>
        <h1 className="text-2xl font-semibold sm:text-3xl">{title}</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">{subtitle}</p>
      </div>
    </div>
  );
}
export function CustomersPage() {
  const [params] = useSearchParams();
  const qc = useQueryClient();
  const [search, setSearch] = useState(params.get("search") ?? "");
  const [editing, setEditing] = useState<CustomerSummary | "new" | null>(null);
  const [payment, setPayment] = useState<CustomerSummary | null>(null);
  const [confirm, setConfirm] = useState<CustomerSummary | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [amount, setAmount] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState<
    "CASH" | "BANK" | "MOBILE_BANKING" | "OTHER"
  >("CASH");
  const [paymentNotes, setPaymentNotes] = useState("");
  const customers = useQuery({
    queryKey: ["customers", search],
    queryFn: () => getCustomers(search),
  });
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
  const pay = useMutation({
    mutationFn: () =>
      receiveCustomerPayment(payment!.id, {
        amount,
        method: paymentMethod,
        notes: paymentNotes,
      }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["customers"] }),
        qc.invalidateQueries({ queryKey: ["inventory-summary"] }),
      ]);
      setPayment(null);
      setAmount(0);
      setPaymentNotes("");
      toast.success("Payment received");
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
    setEditing(c);
    setName(c === "new" ? "" : c.name);
    setPhone(c === "new" ? "" : (c.phone ?? ""));
    setEmail(c === "new" ? "" : (c.email ?? ""));
    setAddress(c === "new" ? "" : (c.address ?? ""));
  };
  return (
    <Page>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <Title
          icon={Users}
          title="Customers"
          subtitle="Sales, payments and customer outstanding."
        />
        <Button onClick={() => open("new")}>
          <Plus className="size-4" /> Add customer
        </Button>
      </div>
      <SearchBox
        value={search}
        onChange={setSearch}
        placeholder="Search name, phone or email..."
      />
      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {customers.data?.map((c) => (
          <article
            key={c.id}
            className="rounded-xl border border-[var(--border)] bg-white p-5 shadow-[var(--shadow-card)] transition hover:border-[var(--primary-border)]"
          >
            <div className="flex justify-between">
              <div>
                <h2 className="font-semibold"><Link className="hover:underline focus-visible:outline-2 focus-visible:outline-[var(--accent)]" to={`/customers/${c.id}`}>{c.name}</Link></h2>
                <p className="text-sm text-[var(--muted)]">
                  {c.phone || c.email || "No contact details"}
                </p>
                <Link
                  className="mt-2 inline-block text-xs font-medium text-[var(--accent)]"
                  to={`/customers/${c.id}`}
                >
                  View account
                </Link>
              </div>
              <div>
                <Button size="icon" variant="ghost" onClick={() => open(c)}>
                  <Edit3 className="size-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="text-[var(--danger)]"
                  onClick={() => setConfirm(c)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 rounded-xl bg-[var(--surface-subtle)] p-3 text-center text-xs">
              <span>
                Sales
                <br />
                <strong>৳{c.totalSales.toLocaleString()}</strong>
              </span>
              <span>
                Paid
                <br />
                <strong>৳{c.totalPaid.toLocaleString()}</strong>
              </span>
              <span>
                Outstanding
                <br />
                <strong className="text-[var(--warning)]">
                  ৳{c.totalDue.toLocaleString()}
                </strong>
              </span>
            </div>
            {c.totalDue > 0 && (
              <Button
                variant="outline"
                className="mt-3 w-full"
                onClick={() => {
                  setPayment(c);
                  setAmount(c.totalDue);
                }}
              >
                <WalletCards className="size-4" /> Receive Payment
              </Button>
            )}
          </article>
        ))}
      </div>
      <Drawer.Root
        open={!!editing}
        onOpenChange={(v) => !v && setEditing(null)}
      >
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-50 bg-slate-950/35 backdrop-blur-[2px]" />
          <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 rounded-t-2xl bg-white p-5">
            <div className="mx-auto max-w-lg">
              <Drawer.Title className="text-lg font-semibold">
                {editing === "new" ? "New customer" : "Edit customer"}
              </Drawer.Title>
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
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </label>
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
              <Button
                className="mt-5 w-full"
                disabled={!name.trim() || !emailValid || save.isPending}
                onClick={() => save.mutate()}
              >
                Save customer
              </Button>
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
      <Drawer.Root
        open={!!payment}
        onOpenChange={(v) => !v && setPayment(null)}
      >
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-50 bg-slate-950/35 backdrop-blur-[2px]" />
          <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 rounded-t-2xl bg-white p-5">
            <div className="mx-auto max-w-lg">
              <Drawer.Title className="text-lg font-semibold">
                Receive payment from {payment?.name}
              </Drawer.Title>
              <p className="mt-1 text-sm text-[var(--muted)]">
                Current due ৳{payment?.totalDue.toLocaleString()}
              </p>
              <Input
                className="mt-4"
                type="number"
                min="0.01"
                max={payment?.totalDue}
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value))}
              />
              <p className="mt-4 text-sm font-medium">Payment method</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {(
                  [
                    ["CASH", "Cash"],
                    ["BANK", "Bank"],
                    ["MOBILE_BANKING", "Mobile Banking"],
                    ["OTHER", "Other"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    type="button"
                    key={value}
                    onClick={() => setPaymentMethod(value)}
                    className={`min-h-11 rounded-xl border px-3 text-sm ${paymentMethod === value ? "border-[var(--accent)] bg-[var(--surface-warm)]" : "border-[var(--border)]"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <Input
                className="mt-3"
                placeholder="Notes (optional)"
                value={paymentNotes}
                onChange={(e) => setPaymentNotes(e.target.value)}
              />
              <Button
                className="mt-4 w-full"
                disabled={amount <= 0 || pay.isPending}
                onClick={() => pay.mutate()}
              >
                Receive ৳{amount.toLocaleString()}
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
  return (
    <Page>
      <Title
        icon={Container}
        title="Containers"
        subtitle="Shipment history and remaining stock."
      />
      <SearchBox
        value={search}
        onChange={setSearch}
        placeholder="Search container, supplier or item..."
      />
      <div className="mt-5 grid gap-3 md:grid-cols-2">
        {q.data?.map((c) => (
          <article
            key={c.id}
            className="rounded-xl border border-[var(--border)] bg-white p-5 shadow-[var(--shadow-card)] transition hover:border-[var(--primary-border)]"
          >
            <div className="flex justify-between">
              <div>
                <h2 className="font-semibold">{c.containerNumber}</h2>
                <p className="text-sm text-[var(--muted)]">{c.supplierName}</p>
              </div>
              <div>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => {
                    setEdit(c);
                    setNumber(c.containerNumber);
                    setNotes(c.notes ?? "");
                  }}
                >
                  <Edit3 className="size-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="text-[var(--danger)]"
                  onClick={() => setConfirm(c)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-3 rounded-xl bg-[var(--surface-subtle)] p-3 text-center text-xs">
              <span>{c.totalItems} Items</span>
              <span>{c.totalRolls} Rolls</span>
              <span>{c.totalMeters} Meter</span>
            </div>
            {c.documents?.map(document => <SourceDocument key={document.id} document={document} />)}
          </article>
        ))}
      </div>
      <Drawer.Root open={!!edit} onOpenChange={(v) => !v && setEdit(null)}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-50 bg-slate-950/35 backdrop-blur-[2px]" />
          <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 rounded-t-2xl bg-white p-5">
            <div className="mx-auto max-w-lg">
              <Drawer.Title className="text-lg font-semibold">
                Edit container
              </Drawer.Title>
              <Input
                className="mt-4"
                value={number}
                onChange={(e) => setNumber(e.target.value)}
              />
              <Input
                className="mt-3"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
              <Button className="mt-4 w-full" onClick={() => save.mutate()}>
                Save changes
              </Button>
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
