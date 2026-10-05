import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LoaderCircle, X } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Drawer } from "vaul";
import { z } from "zod";
import type { SupplierSummary } from "@afia/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createSupplier } from "@/lib/api";

const supplierSchema = z.object({
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

type SupplierForm = z.infer<typeof supplierSchema>;

type NewSupplierDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (supplier: SupplierSummary) => void;
};

export function NewSupplierDrawer({
  open,
  onOpenChange,
  onCreated,
}: NewSupplierDrawerProps) {
  const queryClient = useQueryClient();
  const form = useForm<SupplierForm>({
    resolver: zodResolver(supplierSchema),
    defaultValues: { name: "", phone: "", email: "", address: "", notes: "" },
  });
  const createMutation = useMutation({
    mutationFn: createSupplier,
    onSuccess: async (supplier) => {
      await queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      onCreated(supplier);
      form.reset();
      onOpenChange(false);
      toast.success("Supplier added");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-50 bg-slate-950/35 backdrop-blur-[2px]" />
        <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-2xl rounded-t-[26px] border border-[var(--border)] bg-white outline-none">
          <div className="mx-auto mt-3 h-1.5 w-10 rounded-full bg-[var(--border-strong)]" />
          <div className="flex items-start justify-between px-5 pb-3 pt-4 sm:px-7">
            <div>
              <Drawer.Title className="text-lg font-semibold text-[var(--ink)]">
                Add supplier
              </Drawer.Title>
              <Drawer.Description className="mt-1 text-sm text-[var(--muted)]">
                Save once, then search and reuse this supplier.
              </Drawer.Description>
            </div>
            <button
              type="button"
              aria-label="Close"
              onClick={() => onOpenChange(false)}
              className="grid size-10 place-items-center rounded-full bg-[var(--surface-warm)] text-[var(--muted)]"
            >
              <X className="size-4" />
            </button>
          </div>

          <form
            onSubmit={form.handleSubmit((values) =>
              createMutation.mutate(values),
            )}
            className="space-y-4 px-5 pb-[max(24px,env(safe-area-inset-bottom))] pt-3 sm:px-7"
          >
            <label className="block text-sm font-medium">
              Supplier name
              <Input
                className="mt-2"
                placeholder="e.g. Rahman Leather Export"
                {...form.register("name")}
              />
              {form.formState.errors.name ? (
                <span className="mt-1.5 block text-xs text-[var(--danger)]">
                  {form.formState.errors.name.message}
                </span>
              ) : null}
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
                  placeholder="Phone number"
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
                  placeholder="accounts@example.com"
                  {...form.register("email")}
                />
                {form.formState.errors.email ? (
                  <span className="mt-1.5 block text-xs text-[var(--danger)]">
                    {form.formState.errors.email.message}
                  </span>
                ) : null}
              </label>
            </div>
            <label className="block text-sm font-medium">
              Address{" "}
              <span className="font-normal text-[var(--muted)]">
                (optional)
              </span>
              <Input
                className="mt-2"
                placeholder="City or address"
                {...form.register("address")}
              />
            </label>
            <label className="block text-sm font-medium">
              Notes{" "}
              <span className="font-normal text-[var(--muted)]">
                (optional)
              </span>
              <textarea
                className="mt-2 min-h-24 w-full rounded-xl border border-[var(--border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
                placeholder="Anything useful to remember"
                {...form.register("notes")}
              />
            </label>
            <Button
              type="submit"
              className="w-full"
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : null}
              Save supplier
            </Button>
          </form>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
