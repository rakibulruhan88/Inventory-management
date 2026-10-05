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
  Truck,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Drawer } from "vaul";
import { z } from "zod";
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
        <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-2xl rounded-t-[26px] border border-[var(--border)] bg-white outline-none">
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
            <Button
              className="mt-5 w-full"
              type="submit"
              disabled={save.isPending}
            >
              {save.isPending && (
                <LoaderCircle className="size-4 animate-spin" />
              )}{" "}
              Save supplier
            </Button>
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
  return (
    <div className="mx-auto max-w-350 px-4 pb-28 pt-7 md:px-7 lg:px-10">
      <div className="flex items-start justify-between gap-4">
        <div className="flex gap-4">
          <span className="grid size-11 place-items-center rounded-xl bg-[var(--surface-warm)] text-[var(--accent)]">
            <Truck className="size-5" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold sm:text-3xl">Suppliers</h1>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Contacts, shipments and purchase history.
            </p>
          </div>
        </div>
        <Button onClick={() => setAdding(true)}>
          <Plus className="size-4" /> Add supplier
        </Button>
      </div>
      <label className="relative mt-6 block">
        <Search className="absolute left-4 top-1/2 size-5 -translate-y-1/2 text-[var(--accent)]" />
        <Input
          className="h-13 pl-12"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search name, phone or email..."
        />
      </label>
      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {suppliers.data?.map((supplier) => (
          <Link
            key={supplier.id}
            to={`/suppliers/${supplier.id}`}
            className="rounded-xl border border-[var(--border)] bg-white p-5 shadow-[var(--shadow-card)] transition hover:border-[var(--primary-border)] hover:shadow-md"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold">{supplier.name}</h2>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  {supplier.phone || supplier.email || "No contact details"}
                </p>
              </div>
              <span className="rounded-full bg-[var(--surface-warm)] px-2.5 py-1 text-xs text-[var(--accent)]">
                {supplier.purchaseCount} purchases
              </span>
            </div>
            <div className="mt-4 border-t border-[var(--border)] pt-3 text-sm">
              <span className="text-[var(--muted)]">Total purchases</span>
              <strong className="float-right">
                ৳{supplier.totalPurchases.toLocaleString()}
              </strong>
            </div>
          </Link>
        ))}
        {suppliers.data?.length === 0 && (
          <p className="col-span-full py-12 text-center text-sm text-[var(--muted)]">
            No suppliers found.
          </p>
        )}
      </div>
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
            <h1 className="text-2xl font-semibold sm:text-3xl">{data.name}</h1>
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
        <p className="mt-5 rounded-xl border border-[var(--primary-border)] bg-[var(--primary-soft)] p-4 text-sm text-[var(--ink-soft)]">
          {data.notes}
        </p>
      )}
      <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <article className="rounded-xl border border-[var(--border)] bg-white p-5 shadow-[var(--shadow-card)]">
          <p className="text-xs text-[var(--muted)]">Total Purchases</p>
          <p className="mt-2 text-2xl font-semibold">
            ৳{data.totalPurchases.toLocaleString()}
          </p>
        </article>
        <article className="rounded-xl border border-[var(--border)] bg-white p-5 shadow-[var(--shadow-card)]">
          <p className="text-xs text-[var(--muted)]">Purchase Records</p>
          <p className="mt-2 text-2xl font-semibold">{data.purchaseCount}</p>
        </article>
        <article className="col-span-2 rounded-xl border border-[var(--border)] bg-white p-5 shadow-[var(--shadow-card)] sm:col-span-1">
          <p className="text-xs text-[var(--muted)]">Containers / Shipments</p>
          <p className="mt-2 text-2xl font-semibold">{data.shipments.length}</p>
        </article>
      </section>
      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <section className="rounded-xl border border-[var(--border)] bg-white p-5 shadow-[var(--shadow-card)]">
          <h2 className="font-semibold">Recent Purchases</h2>
          <div className="mt-3 space-y-2">
            {data.recentPurchases.map((purchase) => (
              <div
                key={purchase.id}
                className="flex items-center justify-between gap-3 rounded-xl bg-[var(--surface-subtle)] p-3 text-sm"
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
        <section className="rounded-xl border border-[var(--border)] bg-white p-5 shadow-[var(--shadow-card)]">
          <h2 className="font-semibold">Containers / Shipments</h2>
          <div className="mt-3 space-y-2">
            {data.shipments.map((shipment) => (
              <div
                key={shipment.id}
                className="flex items-center justify-between rounded-xl bg-[var(--surface-subtle)] p-3 text-sm"
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
      <section className="mt-5 rounded-xl border border-[var(--border)] bg-white p-5 shadow-[var(--shadow-card)]">
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
