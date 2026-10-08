import type { ComponentPropsWithRef } from "react";
import { cn } from "@/lib/utils";

type InputProps = ComponentPropsWithRef<"input">;

export function Input({ className, ...props }: InputProps) {
  return (
    <input
      className={cn(
        "h-12 w-full rounded-md border border-[var(--input)] bg-white px-3.5 text-sm text-[var(--foreground)] outline-none transition placeholder:text-[var(--muted-foreground)] hover:border-[var(--foreground-secondary)] focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary-border)] disabled:cursor-not-allowed disabled:bg-[var(--surface-muted)] disabled:text-[var(--muted-foreground)] disabled:opacity-80",
        className,
      )}
      {...props}
    />
  );
}
