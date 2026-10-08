import { useAutoAnimate } from "@formkit/auto-animate/react";
import * as Popover from "@radix-ui/react-popover";
import { Command } from "cmdk";
import { Check, ChevronsUpDown, Search, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Drawer } from "vaul";
import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";

export type SearchablePickerOption = {
  value: string;
  label: string;
  description?: string;
  keywords?: string[];
};

type SearchablePickerProps = {
  label: string;
  triggerId?: string;
  placeholder: string;
  searchPlaceholder?: string;
  options: SearchablePickerOption[];
  value?: string;
  onChange: (value: string) => void;
  onSearchChange?: (search: string) => void;
  compact?: boolean;
  triggerClassName?: string;
  purchasePresentation?: boolean;
  nestedDrawer?: boolean;
  emptyMessage?: string;
  wrapOptionDescriptions?: boolean;
  triggerContent?: ReactNode;
  popoverClassName?: string;
};

function PickerCommand({
  options,
  value,
  searchPlaceholder,
  onSelect,
  onSearchChange,
  purchasePresentation = false,
  emptyMessage,
  wrapOptionDescriptions,
}: Pick<
  SearchablePickerProps,
  "options" | "value" | "searchPlaceholder" | "onSearchChange" | "purchasePresentation" | "emptyMessage" | "wrapOptionDescriptions"
> & {
  onSelect: (value: string) => void;
}) {
  const [resultsParent] = useAutoAnimate<HTMLDivElement>();

  return (
    <Command
      className="flex min-h-0 flex-1 flex-col"
      loop
      shouldFilter={!onSearchChange}
    >
      <div className="flex items-center gap-3 border-b border-[var(--border)] px-4">
        <Search className="size-4 shrink-0 text-[var(--muted)]" />
        <Command.Input
          autoFocus
          aria-label={searchPlaceholder ?? "Type to search..."}
          className={cn(
            "w-full bg-transparent text-[15px] text-[var(--ink)] outline-none placeholder:text-[var(--muted)]",
            purchasePresentation ? "my-2 h-9 min-w-0 rounded-sm border border-transparent px-2" : "h-13",
          )}
          placeholder={searchPlaceholder ?? "Type to search..."}
          onValueChange={onSearchChange}
        />
      </div>
      <Command.List className={cn("overflow-y-auto p-2", purchasePresentation ? "min-h-0 max-h-72 flex-1 overscroll-contain" : "max-h-[min(420px,60vh)]")}>
        <Command.Empty className="px-4 py-10 text-center text-sm text-[var(--muted)]">
          {emptyMessage ?? "Nothing found. Try another name or code."}
        </Command.Empty>
        <Command.Group heading="Results">
          <div ref={resultsParent}>
            {options.map((option) => (
              <Command.Item
                key={option.value}
                value={[
                  option.label,
                  option.description,
                  ...(option.keywords ?? []),
                ]
                  .filter(Boolean)
                  .join(" ")}
                onSelect={() => onSelect(option.value)}
                className={cn(
                  "group flex cursor-pointer items-center gap-3 outline-none data-[selected=true]:bg-[var(--primary-soft)]",
                  purchasePresentation ? "min-h-11 rounded-md px-2.5 py-2" : "rounded-lg px-3 py-3.5",
                )}
              >
                {purchasePresentation ? null : <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-white text-[var(--accent)]">
                  <Check
                    className={cn(
                      "size-4",
                      value === option.value ? "opacity-100" : "opacity-0",
                    )}
                  />
                </span>}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-[var(--ink)]">
                    {option.label}
                  </span>
                  {option.description ? (
                    <span className={cn("mt-0.5 block text-xs text-[var(--muted)]", wrapOptionDescriptions ? "whitespace-pre-line break-words" : "truncate")}>
                      {option.description}
                    </span>
                  ) : null}
                </span>
                {purchasePresentation && value === option.value ? (
                  <Check aria-hidden="true" className="size-4 shrink-0 text-[var(--accent)]" />
                ) : null}
              </Command.Item>
            ))}
          </div>
        </Command.Group>
      </Command.List>
    </Command>
  );
}

export function SearchablePicker({
  label,
  triggerId,
  placeholder,
  searchPlaceholder,
  options,
  value,
  onChange,
  onSearchChange,
  compact = false,
  triggerClassName,
  purchasePresentation = false,
  nestedDrawer = false,
  emptyMessage,
  wrapOptionDescriptions,
  triggerContent,
  popoverClassName,
}: SearchablePickerProps) {
  const [open, setOpen] = useState(false);
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const selected = options.find((option) => option.value === value);
  const selectValue = (nextValue: string) => {
    onChange(nextValue);
    setOpen(false);
  };

  const trigger = (
    <button
      type="button"
      id={triggerId}
      aria-label={label}
      className={cn(
        "flex items-center rounded-lg border border-[var(--input)] bg-white text-left shadow-sm outline-none transition hover:border-[var(--primary-border)] focus-visible:border-[var(--primary)] focus-visible:ring-2 focus-visible:ring-[rgb(37_99_235/0.16)]",
        compact ? "size-11 justify-center" : "min-h-13 w-full gap-3 px-4",
        triggerClassName,
      )}
    >
      {triggerContent ?? (
        <>
          <Search className="size-5 shrink-0 text-[var(--accent)]" />
          {compact ? null : (
            <>
              <span className={cn("min-w-0 flex-1 truncate text-sm", selected ? "font-medium text-[var(--ink)]" : "text-[var(--muted)]")}>
                {selected?.label ?? placeholder}
              </span>
              <ChevronsUpDown className="size-4 shrink-0 text-[var(--muted)]" />
            </>
          )}
        </>
      )}
    </button>
  );

  if (isDesktop) {
    return (
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>{trigger}</Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="start"
            side="bottom"
            sideOffset={purchasePresentation ? 4 : 8}
            collisionPadding={purchasePresentation ? 12 : undefined}
            className={cn(
              "z-50 w-[var(--radix-popover-trigger-width)] overflow-hidden border border-[var(--border)] bg-white",
              purchasePresentation
                ? "purchase-form-controls flex max-h-[min(360px,var(--radix-popover-content-available-height))] flex-col rounded-md shadow-md"
                : "min-w-100 rounded-xl shadow-[var(--shadow-float)]",
              popoverClassName,
            )}
          >
            <PickerCommand
              emptyMessage={emptyMessage}
              wrapOptionDescriptions={wrapOptionDescriptions}
              options={options}
              value={value}
              searchPlaceholder={searchPlaceholder}
              onSearchChange={onSearchChange}
              onSelect={selectValue}
              purchasePresentation={purchasePresentation}
            />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    );
  }

  const MobileDrawerRoot = nestedDrawer ? Drawer.NestedRoot : Drawer.Root;
  return (
    <MobileDrawerRoot open={open} onOpenChange={setOpen}>
      <Drawer.Trigger asChild>{trigger}</Drawer.Trigger>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-50 bg-slate-950/35 backdrop-blur-[2px]" />
        <Drawer.Content className={cn("fixed inset-x-0 bottom-0 z-50 flex max-h-[88svh] flex-col rounded-t-2xl border-t border-[var(--border)] bg-white outline-none", purchasePresentation && "purchase-form-controls")}>
          <div className="mx-auto mt-3 h-1.5 w-10 rounded-full bg-[var(--border-strong)]" />
          <div className="flex items-center justify-between px-5 py-4">
            <Drawer.Title className="font-semibold text-[var(--ink)]">
              {label}
            </Drawer.Title>
            <button
              type="button"
              aria-label="Close picker"
              className="flex size-10 items-center justify-center rounded-full bg-[var(--surface-warm)] text-[var(--muted)]"
              onClick={() => setOpen(false)}
            >
              <X className="size-4" />
            </button>
          </div>
          <PickerCommand
            emptyMessage={emptyMessage}
              wrapOptionDescriptions={wrapOptionDescriptions}
            options={options}
            value={value}
            searchPlaceholder={searchPlaceholder}
            onSearchChange={onSearchChange}
            onSelect={selectValue}
            purchasePresentation={purchasePresentation}
          />
          <div className="h-[max(16px,env(safe-area-inset-bottom))]" />
        </Drawer.Content>
      </Drawer.Portal>
    </MobileDrawerRoot>
  );
}
