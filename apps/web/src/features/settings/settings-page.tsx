import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HelpCircle, LoaderCircle, LockKeyhole, Settings } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  changePassword,
  getAccount,
  getSettings,
  updateAccount,
  updateSettings,
} from "@/lib/api";
import { SignOutButton } from "@/features/auth/auth";
const schema = z.object({
  storeName: z.string().min(1),
  logoUrl: z.string().nullable(),
  faviconUrl: z.string().nullable(),
  storePhone: z.string().nullable(),
  storeEmail: z.union([z.email(), z.literal("")]).nullable(),
  storeAddress: z.string().nullable(),
  currency: z.literal("BDT"),
  currencySymbol: z.string(),
  invoicePrefix: z.string().min(1),
  defaultPaymentMethod: z.enum(["CASH", "BANK", "MOBILE_BANKING", "OTHER"]),
  lowStockRollThreshold: z.number().int().min(0),
  lowStockMeterThreshold: z.number().min(0),
  brandAccent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});
type FormData = z.infer<typeof schema>;
export function SettingsPage() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ["settings"], queryFn: getSettings });
  const form = useForm<FormData>({ resolver: zodResolver(schema) });
  const watched = useWatch({ control: form.control });
  useEffect(() => {
    if (query.data) form.reset(query.data as FormData);
  }, [query.data, form]);
  const save = useMutation({
    mutationFn: updateSettings,
    onSuccess: async (x) => {
      await qc.invalidateQueries({ queryKey: ["settings"] });
      document.documentElement.style.setProperty(
        "--brand-accent",
        x.brandAccent,
      );
      toast.success("Settings saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const image = (field: "logoUrl" | "faviconUrl", files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    if (
      !["image/png", "image/jpeg", "image/x-icon"].includes(file.type) ||
      file.size > 150_000
    ) {
      toast.error("Choose a PNG, JPG or ICO image under 150 KB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () =>
      form.setValue(field, String(reader.result), { shouldDirty: true });
    reader.readAsDataURL(file);
  };
  if (query.isLoading)
    return (
      <div className="grid min-h-80 place-items-center">
        <LoaderCircle className="animate-spin" />
      </div>
    );
  return (
    <div className="mx-auto max-w-4xl px-4 pb-28 pt-6 md:px-7 lg:px-10">
      <div className="flex gap-4">
        <span className="grid size-11 place-items-center rounded-xl bg-[var(--surface-warm)] text-[var(--accent)]">
          <Settings className="size-5" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold sm:text-3xl">Settings</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Store details, invoices and stock alerts.
          </p>
        </div>
      </div>
      <form
        className="mt-7 space-y-5"
        onSubmit={form.handleSubmit((v) => save.mutate(v))}
      >
        <Section title="Business / Store">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Store name">
              <Input {...form.register("storeName")} />
            </Field>
            <Field label="Phone">
              <Input {...form.register("storePhone")} />
            </Field>
            <Field label="Email">
              <Input type="email" {...form.register("storeEmail")} />
            </Field>
            <Field label="Address">
              <Input {...form.register("storeAddress")} />
            </Field>
            <ImageField
              label="Store logo"
              preview={watched.logoUrl}
              onChange={(f) => image("logoUrl", f)}
            />
            <ImageField
              label="Browser favicon"
              preview={watched.faviconUrl}
              onChange={(f) => image("faviconUrl", f)}
            />
          </div>
        </Section>
        <Section title="Invoice / Sales">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Currency">
              <Input value="BDT / ৳" disabled />
            </Field>
            <Field label="Invoice prefix">
              <Input {...form.register("invoicePrefix")} />
            </Field>
            <Field label="Default payment method">
              <SearchablePickerSimple
                value={watched.defaultPaymentMethod ?? "CASH"}
                onChange={(v) =>
                  form.setValue(
                    "defaultPaymentMethod",
                    v as FormData["defaultPaymentMethod"],
                  )
                }
              />
            </Field>
          </div>
        </Section>
        <Section title="Inventory">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Low stock Roll threshold">
              <Input
                type="number"
                min="0"
                {...form.register("lowStockRollThreshold", {
                  valueAsNumber: true,
                })}
              />
            </Field>
            <Field label="Low stock Meter threshold">
              <Input
                type="number"
                min="0"
                {...form.register("lowStockMeterThreshold", {
                  valueAsNumber: true,
                })}
              />
            </Field>
          </div>
        </Section>
        <Section title="Appearance">
          <Field label="Logo / brand accent">
            <div className="flex gap-2">
              <span
                className="size-11 rounded-xl border"
                style={{ background: watched.brandAccent }}
              />
              <Input {...form.register("brandAccent")} />
            </div>
            <p className="mt-2 text-xs text-[var(--muted)]">
              Used for your brand identity. Application controls use the
              accessible blue system palette.
            </p>
          </Field>
        </Section>
        <Section title="Install on iPhone">
          <div className="flex gap-3 text-sm text-[var(--ink-soft)]">
            <HelpCircle className="mt-0.5 size-5 shrink-0 text-[var(--accent)]" />
            <ol className="list-decimal space-y-1 pl-4">
              <li>Open Afia Leather in Safari.</li>
              <li>Tap the Share button.</li>
              <li>Choose Add to Home Screen.</li>
              <li>Tap Add.</li>
            </ol>
          </div>
        </Section>
        <Button className="w-full sm:w-auto" disabled={save.isPending}>
          {save.isPending && <LoaderCircle className="size-4 animate-spin" />}{" "}
          Save settings
        </Button>
        <div className="max-w-xs lg:hidden">
          <SignOutButton />
        </div>
      </form>
      <AccountSettings />
    </div>
  );
}

function AccountSettings() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const account = useQuery({ queryKey: ["account"], queryFn: getAccount });
  const [email, setEmail] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const emailMutation = useMutation({
    mutationFn: updateAccount,
    onSuccess: async (result) => {
      setEmail(result.email ?? "");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["account"] }),
        queryClient.invalidateQueries({ queryKey: ["auth"] }),
      ]);
      toast.success("Login email updated");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const passwordMutation = useMutation({
    mutationFn: changePassword,
    onSuccess: () => {
      toast.success("Password changed. Please sign in with your new password.");
      queryClient.setQueryData(["auth"], null);
      window.setTimeout(() => navigate("/login", { replace: true }), 700);
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const submitPassword = (event: React.FormEvent) => {
    event.preventDefault();
    if (newPassword.length < 8) {
      toast.error("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("New passwords do not match.");
      return;
    }
    passwordMutation.mutate({ currentPassword, newPassword });
  };
  return (
    <section className="mt-5 rounded-xl border border-[var(--border)] bg-white p-4 shadow-[var(--shadow-card)] sm:p-5">
      <div className="flex items-center gap-2">
        <LockKeyhole className="size-5 text-[var(--accent)]" />
        <h2 className="font-semibold">Account &amp; Security</h2>
      </div>
      <div className="mt-4 grid gap-5 md:grid-cols-2">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            emailMutation.mutate({
              email: (email ?? account.data?.email ?? "").trim().toLowerCase(),
            });
          }}
          className="rounded-xl bg-[var(--surface-subtle)] p-4"
        >
          <Field label="Username">
            <Input value={account.data?.username ?? ""} disabled />
          </Field>
          <div className="mt-4">
            <Field label="Email">
              <Input
                type="email"
                autoComplete="email"
                placeholder="owner@example.com"
                value={email ?? account.data?.email ?? ""}
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>
          </div>
          <Button
            className="mt-4 w-full sm:w-auto"
            disabled={emailMutation.isPending}
          >
            {emailMutation.isPending && (
              <LoaderCircle className="size-4 animate-spin" />
            )}
            Update Email
          </Button>
        </form>
        <form
          onSubmit={submitPassword}
          className="rounded-xl bg-[var(--surface-subtle)] p-4"
        >
          <Field label="Current Password *">
            <Input
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </Field>
          <div className="mt-4">
            <Field label="New Password *">
              <Input
                type="password"
                minLength={8}
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </Field>
          </div>
          <div className="mt-4">
            <Field label="Confirm New Password *">
              <Input
                type="password"
                minLength={8}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </Field>
          </div>
          <p className="mt-2 text-xs text-[var(--muted)]">
            Use at least 8 characters.
          </p>
          <Button
            className="mt-4 w-full sm:w-auto"
            disabled={
              passwordMutation.isPending ||
              !currentPassword ||
              newPassword.length < 8 ||
              !confirmPassword
            }
          >
            {passwordMutation.isPending && (
              <LoaderCircle className="size-4 animate-spin" />
            )}
            Change Password
          </Button>
        </form>
      </div>
    </section>
  );
}
function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-[var(--border)] bg-white p-4 shadow-[var(--shadow-card)] sm:p-5">
      <h2 className="font-semibold">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="text-sm font-medium">
      <span className="mb-2 block">{label}</span>
      {children}
    </label>
  );
}
function ImageField({
  label,
  preview,
  onChange,
}: {
  label: string;
  preview?: string | null;
  onChange: (f: FileList | null) => void;
}) {
  return (
    <Field label={label}>
      <div className="flex items-center gap-3">
        {preview ? (
          <img
            src={preview}
            className="size-12 rounded-xl border object-contain"
          />
        ) : (
          <span className="grid size-12 place-items-center rounded-xl bg-[var(--surface-warm)] font-bold text-[var(--accent)]">
            A
          </span>
        )}
        <Input
          type="file"
          accept="image/png,image/jpeg,image/x-icon"
          onChange={(e) => onChange(e.target.files)}
        />
      </div>
    </Field>
  );
}
function SearchablePickerSimple({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const opts = [
    ["CASH", "Cash"],
    ["BANK", "Bank"],
    ["MOBILE_BANKING", "Mobile banking"],
    ["OTHER", "Other"],
  ];
  return (
    <div className="grid grid-cols-2 gap-2">
      {opts.map(([v, l]) => (
        <button
          type="button"
          key={v}
          onClick={() => onChange(v)}
          className={`min-h-11 rounded-xl border px-3 text-sm ${value === v ? "border-[var(--accent)] bg-[var(--surface-warm)]" : "border-[var(--border)]"}`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
