import type { ButtonHTMLAttributes } from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition-[background,color,border-color,box-shadow,transform] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:pointer-events-none disabled:opacity-50 active:translate-y-px",
  {
    variants: {
      variant: {
        primary:
          "bg-[var(--primary)] text-[var(--primary-foreground)] shadow-sm hover:bg-[var(--primary-hover)] hover:shadow-md",
        premium:
          "bg-[image:var(--gradient-primary)] text-white shadow-[0_10px_24px_rgb(37_99_235/0.2)] hover:brightness-95 hover:shadow-lg",
        outline:
          "border border-[var(--input)] bg-white text-[var(--foreground-secondary)] shadow-sm hover:border-[var(--primary-border)] hover:bg-[var(--primary-soft)] hover:text-[var(--primary-hover)]",
        ghost:
          "text-[var(--muted-foreground)] hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]",
        danger:
          "bg-[var(--danger)] text-white shadow-sm hover:bg-[var(--danger-hover)]",
        success: "bg-[var(--success)] text-white shadow-sm hover:brightness-95",
      },
      size: {
        default: "h-11 px-4",
        icon: "size-11 p-0",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  },
);

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

function Button({ className, variant, size, asChild, ...props }: ButtonProps) {
  const Component = asChild ? Slot : "button";

  return (
    <Component
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { Button };
