import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupplierInput, SupplierSummary } from "@afia/contracts";
import { format } from "date-fns";
import {
  Archive,
  ArrowLeft,
  Edit3,
  LoaderCircle,
  Mail,
  MapPin,
  Phone,
  Plus,
  Search,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Drawer } from "vaul";
import { z } from "zod";
import {
  formatMoney,
  LedgerError,
  LedgerLoading,
} from "@/features/sales/ledger-components";
import "@/features/records/customers.css";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  archiveSupplier,
  createSupplier,
  getSupplier,
  getSuppliers,
  updateSupplier,
} from "@/lib/api";

const schema = z.object({
  name: z.string().trim().min(2, "Enter the supplier name."),
  phone: z.string().trim().optional(),
  email: z
    .string()
    .trim()
    .email("Enter a valid email address.")
    .or(z.literal(""))
    .optional(),
  address: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});
type FormValues = z.infer<typeof schema>;

const clean = (values: FormValues): SupplierInput => ({
  name: values.name.trim(),
  phone: values.phone?.trim() || undefined,
  email: values.email?.trim().toLowerCase() || undefined,
  address: values.address?.trim() || undefined,
  notes: values.notes?.trim() || undefined,
});

function SupplierForm({
  open,
  onOpenChange,
  supplier,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  supplier?: SupplierSummary;
}) {
  const queryClient = useQueryClient();
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", phone: "", email: "", address: "", notes: "" },
  });
  useEffect(() => {
    if (!open) return;
    form.reset({
      name: supplier?.name ?? "",
      phone: supplier?.phone ?? "",
      email: supplier?.email ?? "",
      address: supplier?.address ?? "",
      notes: supplier?.notes ?? "",
    });
  }, [form, open, supplier]);
  const save = useMutation({
    mutationFn: (values: FormValues) =>
      supplier
        ? updateSupplier(supplier.id, clean(values))
        : createSupplier(clean(values)),
    onSuccess: async (saved) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["suppliers"] }),
        queryClient.invalidateQueries({ queryKey: ["supplier", saved.id] }),
      ]);
      onOpenChange(false);
      toast.success(supplier ? "Supplier updated" : "Supplier added");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-50 bg-slate-950/35 backdrop-blur-[2px]" />
        <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-2xl max-h-[90dvh] overflow-y-auto rounded-t-lg border border-[var(--border)] bg-[var(--surface)] outline-none">
          <div className="mx-auto mt-3 h-1.5 w-10 rounded-full bg-[var(--border-strong)]" />
          <form
            className="px-5 pb-[max(24px,env(safe-area-inset-bottom))] pt-5 sm:px-7"
            onSubmit={form.handleSubmit((values) => save.mutate(values))}
          >
            <Drawer.Title className="text-lg font-semibold">
              {supplier ? "Edit supplier" : "Add supplier"}
            </Drawer.Title>
            <Drawer.Description className="mt-1 text-sm text-[var(--muted)]">
              Only the supplier name is required.
            </Drawer.Description>
            <div className="mt-5 space-y-4">
              <label className="block text-sm font-medium">
                Supplier Name *
                <Input className="mt-2" autoFocus {...form.register("name")} />
                {form.formState.errors.name && (
                  <span className="mt-1 block text-xs text-[var(--danger)]">
                    {form.formState.errors.name.message}
                  </span>
                )}
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm font-medium">
                  Phone{" "}
                  <span className="font-normal text-[var(--muted)]">
                    (optional)
                  </span>
                  <Input
                    className="mt-2"
                    inputMode="tel"
                    {...form.register("phone")}
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
                    {...form.register("email")}
                  />
                  {form.formState.errors.email && (
                    <span className="mt-1 block text-xs text-[var(--danger)]">
                      {form.formState.errors.email.message}
                    </span>
                  )}
                </label>
              </div>
              <label className="block text-sm font-medium">
                Address{" "}
                <span className="font-normal text-[var(--muted)]">
                  (optional)
                </span>
                <Input className="mt-2" {...form.register("address")} />
              </label>
              <label className="block text-sm font-medium">
                Notes{" "}
                <span className="font-normal text-[var(--muted)]">
                  (optional)
                </span>
                <textarea
                  className="mt-2 min-h-24 w-full rounded-xl border border-[var(--border)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
                  {...form.register("notes")}
                />
              </label>
            </div>
            {save.error && (
              <p role="alert" className="mt-3 text-sm text-[var(--danger)]">
                {save.error.message}
              </p>
            )}
            <div className="mt-5 flex gap-3">
              <Button
                className="flex-1"
                type="submit"
                disabled={save.isPending}
              >
                {save.isPending && (
                  <LoaderCircle className="size-4 animate-spin" />
                )}{" "}
                Save supplier
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={save.isPending}
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
            </div>
          </form>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

export function SuppliersPage() {
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const suppliers = useQuery({
    queryKey: ["suppliers", search],
    queryFn: () => getSuppliers(search),
  });
  const rows = suppliers.data ?? [];
  return (
    <div className="mx-auto max-w-350 px-4 pb-28 pt-6 md:px-7 lg:px-10">
      <header className="customers-header">
        <div>
          <p className="customers-eyebrow">Afia Leather · Supply partners</p>
          <h1>Suppliers</h1>
          <p>Contacts, purchase records and shipments in one place.</p>
        </div>
        <Button onClick={() => setAdding(true)}>
          <Plus className="size-4" />
          Add Supplier
        </Button>
      </header>
      <div className="customers-toolbar">
        <label className="customers-search">
          <span className="sr-only">
            Search suppliers by name, phone or email
          </span>
          <Search className="size-4" aria-hidden="true" />
          <Input
            type="search"
            maxLength={200}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name, phone or email…"
          />
        </label>
        <p className="compact-results">
          {suppliers.isSuccess
            ? `${rows.length} suppliers shown`
            : "Supplier directory"}
        </p>
      </div>
      <section
        className="customers-directory compact-directory"
        aria-label="Supplier directory"
        aria-busy={suppliers.isFetching}
      >
        {suppliers.isError ? (
          <LedgerError
            message={suppliers.error.message}
            retry={() => void suppliers.refetch()}
          />
        ) : suppliers.isPending ? (
          <LedgerLoading />
        ) : !rows.length ? (
          <div className="customers-empty">
            <h2>{search ? "No matching suppliers" : "No suppliers yet"}</h2>
            <p>
              {search
                ? "Try another supplier name, phone or email."
                : "Add a supplier to keep their contact and purchase history together."}
            </p>
            <Button
              variant="outline"
              onClick={() => (search ? setSearch("") : setAdding(true))}
            >
              {search ? "Clear Search" : "Add Supplier"}
            </Button>
          </div>
        ) : (
          <>
            <table className="customers-table compact-suppliers-table">
              <caption className="sr-only">
                Supplier contacts and purchase records
              </caption>
              <thead>
                <tr>
                  {[
                    "Supplier",
                    "Contact",
                    "Purchases",
                    "Total Purchases",
                    "",
                  ].map((label, i) => (
                    <th key={i} scope="col">
                      {label || <span className="sr-only">Actions</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <Link className="customer-name" to={`/suppliers/${s.id}`}>
                        {s.name}
                      </Link>
                      {s.address && (
                        <p className="customer-address">{s.address}</p>
                      )}
                    </td>
                    <td>
                      <p className="compact-contact">{s.phone || "No phone"}</p>
                      {s.email && <p className="customer-contact">{s.email}</p>}
                    </td>
                    <td className="customer-amount">{s.purchaseCount}</td>
                    <td className="customer-amount">
                      {formatMoney(s.totalPurchases)}
                    </td>
                    <td>
                      <Button asChild variant="outline" className="text-xs">
                        <Link to={`/suppliers/${s.id}`}>View Supplier</Link>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="customers-mobile">
              {rows.map((s) => (
                <article key={s.id}>
                  <Link className="customer-name" to={`/suppliers/${s.id}`}>
                    {s.name}
                  </Link>
                  <p className="customer-contact">
                    {s.phone || s.email || "No contact details"}
                  </p>
                  {s.address && <p className="customer-address">{s.address}</p>}
                  <div className="compact-mobile-footer">
                    <dl className="customer-mobile-money">
                      <div>
                        <dt>Purchases</dt>
                        <dd>{s.purchaseCount}</dd>
                      </div>
                      <div>
                        <dt>Total Purchases</dt>
                        <dd>{formatMoney(s.totalPurchases)}</dd>
                      </div>
                    </dl>
                    <Button asChild variant="outline" className="text-xs">
                      <Link to={`/suppliers/${s.id}`}>View Supplier</Link>
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
        {suppliers.isSuccess && (
          <footer className="customers-list-footer">
            <span>
              {suppliers.isFetching
                ? "Updating…"
                : "Open a supplier for contacts and purchase history."}
            </span>
            <span>Search to find more · Up to 50 results</span>
          </footer>
        )}
      </section>
      <SupplierForm open={adding} onOpenChange={setAdding} />
    </div>
  );
}

export function SupplierDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const supplier = useQuery({
    queryKey: ["supplier", id],
    queryFn: () => getSupplier(id),
    enabled: !!id,
  });
  const archive = useMutation({
    mutationFn: () => archiveSupplier(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      toast.success("Supplier archived");
      navigate("/suppliers");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const data = supplier.data;
  if (supplier.isLoading)
    return (
      <div className="grid min-h-80 place-items-center text-sm text-[var(--muted)]">
        Loading supplier…
      </div>
    );
  if (supplier.isError)
    return (
      <div className="mx-auto max-w-5xl px-4 py-6">
        <LedgerError
          message={supplier.error.message}
          retry={() => void supplier.refetch()}
        />
      </div>
    );
  if (!data)
    return (
      <div className="grid min-h-80 place-items-center text-sm text-[var(--muted)]">
        Supplier not found.
      </div>
    );

  return (
    <div className="mx-auto max-w-5xl px-4 pb-28 pt-5 md:px-7 lg:px-10">
      <Link
        to="/suppliers"
        className="flex min-h-11 items-center gap-2 text-sm text-[var(--muted)]"
      >
        <ArrowLeft className="size-4" /> Suppliers
      </Link>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="break-words text-2xl font-semibold">{data.name}</h1>
            {data.archivedAt && (
              <span className="rounded-full bg-[var(--surface-muted)] px-2.5 py-1 text-xs text-[var(--muted)]">
                Archived
              </span>
            )}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-[var(--muted)]">
            {data.phone && (
              <a className="flex items-center gap-2" href={`tel:${data.phone}`}>
                <Phone className="size-4" />
                {data.phone}
              </a>
            )}
            {data.email && (
              <a
                className="flex items-center gap-2"
                href={`mailto:${data.email}`}
              >
                <Mail className="size-4" />
                {data.email}
              </a>
            )}
            {data.address && (
              <span className="flex items-center gap-2">
                <MapPin className="size-4" />
                {data.address}
              </span>
            )}
          </div>
        </div>
        {!data.archivedAt && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setEditing(true)}>
              <Edit3 className="size-4" /> Edit
            </Button>
            <Button
              variant="outline"
              className="text-[var(--danger)]"
              onClick={() => setConfirmArchive(true)}
            >
              <Archive className="size-4" /> Archive
            </Button>
          </div>
        )}
      </div>
      {data.notes && (
        <p className="mt-5 rounded-md border border-[var(--primary-border)] bg-[var(--primary-soft)] p-4 text-sm text-[var(--ink-soft)]">
          {data.notes}
        </p>
      )}
      <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <article className="rounded-md border border-[var(--border)] bg-white p-4">
          <p className="text-xs text-[var(--muted)]">Total Purchases</p>
          <p className="mt-2 text-2xl font-semibold">
            ৳{data.totalPurchases.toLocaleString()}
          </p>
        </article>
        <article className="rounded-md border border-[var(--border)] bg-white p-4">
          <p className="text-xs text-[var(--muted)]">Purchase Records</p>
          <p className="mt-2 text-2xl font-semibold">{data.purchaseCount}</p>
        </article>
        <article className="col-span-2 rounded-md border border-[var(--border)] bg-white p-4 sm:col-span-1">
          <p className="text-xs text-[var(--muted)]">Containers / Shipments</p>
          <p className="mt-2 text-2xl font-semibold">{data.shipments.length}</p>
        </article>
      </section>
      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <section className="rounded-md border border-[var(--border)] bg-white p-4">
          <h2 className="font-semibold">Recent Purchases</h2>
          <div className="mt-3 space-y-2">
            {data.recentPurchases.map((purchase) => (
              <div
                key={purchase.id}
                className="flex items-center justify-between gap-3 rounded-md bg-[var(--surface-subtle)] p-3 text-sm"
              >
                <div>
                  <strong>{purchase.purchaseNumber}</strong>
                  <p className="text-xs text-[var(--muted)]">
                    {format(new Date(purchase.purchasedAt), "d MMM yyyy")} ·{" "}
                    {purchase.containerNumber}
                  </p>
                </div>
                <span>{purchase.totalRolls} Rolls</span>
              </div>
            ))}
            {!data.recentPurchases.length && (
              <p className="py-7 text-center text-sm text-[var(--muted)]">
                No purchases yet.
              </p>
            )}
          </div>
        </section>
        <section className="rounded-md border border-[var(--border)] bg-white p-4">
          <h2 className="font-semibold">Containers / Shipments</h2>
          <div className="mt-3 space-y-2">
            {data.shipments.map((shipment) => (
              <div
                key={shipment.id}
                className="flex items-center justify-between rounded-md bg-[var(--surface-subtle)] p-3 text-sm"
              >
                <strong>{shipment.containerNumber}</strong>
                <span className="text-[var(--muted)]">
                  {shipment.status.replace("_", " ")}
                </span>
              </div>
            ))}
            {!data.shipments.length && (
              <p className="py-7 text-center text-sm text-[var(--muted)]">
                No shipments yet.
              </p>
            )}
          </div>
        </section>
      </div>
      <section className="mt-5 rounded-md border border-[var(--border)] bg-white p-4">
        <h2 className="font-semibold">Purchase History</h2>
        <div className="mt-3 overflow-x-auto rounded-lg border border-[var(--border)]">
          <table className="w-full min-w-150 text-left text-sm">
            <thead className="bg-[var(--surface-muted)] text-xs text-[var(--muted)]">
              <tr>
                <th className="px-3 py-3 font-medium">Purchase</th>
                <th className="px-3 py-3 font-medium">Date</th>
                <th className="px-3 py-3 font-medium">Container</th>
                <th className="px-3 py-3 text-right font-medium">
                  Stock received
                </th>
                <th className="px-3 py-3 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.purchaseHistory.map((purchase) => (
                <tr
                  key={purchase.id}
                  className="border-t border-[var(--border)] transition hover:bg-[var(--primary-soft)]"
                >
                  <td className="px-3 py-3 font-medium">
                    {purchase.purchaseNumber}
                  </td>
                  <td className="px-3 py-3">
                    {format(new Date(purchase.purchasedAt), "d MMM yyyy")}
                  </td>
                  <td className="px-3 py-3">{purchase.containerNumber}</td>
                  <td className="px-3 py-3 text-right">
                    {purchase.totalRolls} Rolls ·{" "}
                    {purchase.totalMeters.toLocaleString()}m
                  </td>
                  <td className="px-3 py-3 text-right">
                    ৳{purchase.totalAmount.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.purchaseHistory.length && (
            <p className="py-8 text-center text-sm text-[var(--muted)]">
              Purchase history will appear here.
            </p>
          )}
        </div>
      </section>
      <SupplierForm open={editing} onOpenChange={setEditing} supplier={data} />
      <Drawer.Root open={confirmArchive} onOpenChange={setConfirmArchive}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-50 bg-slate-950/35 backdrop-blur-[2px]" />
          <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 rounded-t-2xl border-t border-[var(--border)] bg-white p-5 shadow-[var(--shadow-float)]">
            <div className="mx-auto max-w-lg">
              <Drawer.Title className="text-lg font-semibold">
                Archive {data.name}?
              </Drawer.Title>
              <Drawer.Description className="mt-2 text-sm text-[var(--muted)]">
                The supplier will no longer appear when creating purchases. All
                purchases, containers and accounting history will remain safe.
              </Drawer.Description>
              <div className="mt-5 grid grid-cols-2 gap-3">
                <Button
                  variant="outline"
                  onClick={() => setConfirmArchive(false)}
                >
                  Keep supplier
                </Button>
                <Button
                  variant="danger"
                  disabled={archive.isPending}
                  onClick={() => archive.mutate()}
                >
                  {archive.isPending && (
                    <LoaderCircle className="size-4 animate-spin" />
                  )}{" "}
                  Archive
                </Button>
              </div>
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    </div>
  );
}
