import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type InputProps = InputHTMLAttributes<HTMLInputElement>;

export function Input({ className, ...props }: InputProps) {
  return (
    <input
      className={cn(
        "h-12 w-full rounded-lg border border-[var(--input)] bg-white px-3.5 text-sm text-[var(--foreground)] shadow-sm outline-none transition placeholder:text-[var(--muted-foreground)] hover:border-slate-400 focus:border-[var(--primary)] focus:ring-2 focus:ring-[rgb(37_99_235/0.16)] disabled:cursor-not-allowed disabled:bg-[var(--surface-muted)] disabled:text-[var(--muted-foreground)] disabled:opacity-80",
        className,
      )}
      {...props}
    />
  );
}
