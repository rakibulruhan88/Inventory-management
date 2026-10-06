import { CheckCircle2, X } from "lucide-react";
import { Input } from "@/components/ui/input";

export type InlinePartyValues = {
  name: string;
  email: string;
  phone: string;
  address: string;
};

export type PartySuggestion = InlinePartyValues & {
  id: string;
  due?: number;
};

type Props = {
  kind: "Customer" | "Supplier";
  dense?: boolean;
  autoComplete?: "on" | "off";
  values: InlinePartyValues;
  selected?: PartySuggestion;
  suggestions: PartySuggestion[];
  searching?: boolean;
  currencySymbol?: string;
  nameError?: string;
  onFieldChange: (field: keyof InlinePartyValues, value: string) => void;
  onSearch: (value: string) => void;
  onSelect: (party: PartySuggestion) => void;
  onClear: () => void;
};

export function InlinePartyFields({
  kind,
  dense = false,
  autoComplete,
  values,
  selected,
  suggestions,
  searching,
  currencySymbol = "৳",
  nameError,
  onFieldChange,
  onSearch,
  onSelect,
  onClear,
}: Props) {
  const field = (
    key: keyof InlinePartyValues,
    label: string,
    options?: { required?: boolean; type?: string; placeholder?: string },
  ) => (
    <label className={dense ? `min-w-0 text-xs font-medium ${key === "name" || key === "address" ? "col-span-2 sm:col-span-1" : ""}` : "min-w-0 text-sm font-medium"}>
      {label} {options?.required ? "*" : null}
      <Input
        className={dense ? "mt-1 h-11 w-full" : "mt-2 w-full"}
        type={options?.type}
        autoComplete={autoComplete}
        placeholder={options?.placeholder}
        value={values[key]}
        onFocus={() => onSearch(values[key])}
        onChange={(event) => {
          onFieldChange(key, event.target.value);
          if (key !== "address") onSearch(event.target.value);
        }}
      />
      {key === "name" && nameError ? (
        <span className="mt-1 block text-xs text-[var(--danger)]">
          {nameError}
        </span>
      ) : null}
    </label>
  );

  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between gap-3">
        <h2 className={dense ? "text-sm font-semibold" : "font-semibold"}>{kind} Information</h2>
        {selected ? (
          <button
            type="button"
            className="flex min-h-10 items-center gap-1.5 text-xs font-semibold text-[var(--accent)]"
            onClick={onClear}
          >
            <X className="size-3.5" /> Change
          </button>
        ) : null}
      </div>
      {selected ? (
        <div className={dense ? "mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 border-l-2 border-[var(--success)] py-1 pl-3 text-xs text-[var(--success)]" : "mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-green-200 bg-[var(--success-soft)] px-3 py-2 text-sm text-green-800"}>
          <span className="flex items-center gap-1.5 font-semibold">
            <CheckCircle2 className="size-4" /> Using existing{" "}
            {kind.toLowerCase()}
          </span>
          {selected.due !== undefined ? (
            <span>
              Current Due: {currencySymbol}
              {selected.due.toLocaleString()}
            </span>
          ) : null}
        </div>
      ) : null}
      <div className={dense ? "mt-3 grid min-w-0 grid-cols-2 gap-3" : "mt-4 grid min-w-0 gap-4 sm:grid-cols-2 mb-3"}>
        {field("name", `${kind} Name`, {
          required: true,
          placeholder: kind === "Customer" ? "Rahim Traders" : "Supplier name",
        })}
        {field("email", "Email", {
          type: "email",
          placeholder: "name@example.com",
        })}
        {field("phone", "Phone", { type: "tel", placeholder: "01712345678" })}
        {field("address", "Address", { placeholder: "Dhaka" })}
      </div>
      {!selected && (suggestions.length > 0 || searching) ? (
        <div className={dense ? "mt-3 w-full overflow-hidden border border-[var(--border)] bg-[var(--surface)]" : "mt-3 w-full overflow-hidden rounded-xl border border-[var(--border)] bg-white shadow-[var(--shadow-float)]"}>
          <div className="border-b border-[var(--border)] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
            {searching ? "Searching…" : `Existing ${kind.toLowerCase()}s`}
          </div>
          <div className="max-h-64 overflow-y-auto p-2">
            {suggestions.map((party) => (
              <button
                type="button"
                key={party.id}
                className={`flex min-h-16 w-full min-w-0 flex-col items-start ${dense ? "rounded-sm" : "rounded-xl"} px-3 py-2 text-left outline-none hover:bg-[var(--surface-warm)] focus-visible:bg-[var(--surface-warm)] focus-visible:ring-2 focus-visible:ring-[var(--ring)]`}
                onClick={() => onSelect(party)}
              >
                <span className="font-semibold">{party.name}</span>
                <span className="w-full truncate text-xs text-[var(--muted)]">
                  {[party.phone, party.email, party.address]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
