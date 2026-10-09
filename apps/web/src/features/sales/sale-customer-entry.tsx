import { Permit } from "@/features/auth/permit";
import { useState } from "react";
import { SearchablePicker } from "@/components/searchable-picker";
import { InlinePartyFields, type InlinePartyValues, type PartySuggestion } from "@/components/inline-party-fields";
import { Button } from "@/components/ui/button";
import { formatSaleMoney } from "./new-sale-presentation";

type Props = {
  values: InlinePartyValues;
  suggestions: PartySuggestion[];
  searching: boolean;
  symbol: string;
  nameError?: string;
  phoneError?: string;
  onSearch: (value: string) => void;
  onFieldChange: (field: keyof InlinePartyValues, value: string) => void;
  onSelect: (party: PartySuggestion) => void;
  onClear: () => void;
  validateDraft: () => Promise<boolean>;
};

export function SaleCustomerEntry(props: Props) {
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  if (editing) return <div className="sale-customer-draft">
    <InlinePartyFields kind="Customer" dense transactionPresentation
      values={props.values} suggestions={props.suggestions} searching={props.searching}
      currencySymbol={props.symbol} nameError={props.nameError} phoneError={props.phoneError}
      onSearch={props.onSearch} onFieldChange={props.onFieldChange}
      onSelect={props.onSelect} onClear={props.onClear} />
    <Button type="button" variant="outline" onClick={async () => {
      if (await props.validateDraft()) { setDraftReady(true); setEditing(false); }
    }}>Use customer</Button>
  </div>;
  if (draftReady) return <div className="sale-customer-summary">
    <div><span className="sale-caption">New customer</span>
      <p className="sale-identity">{props.values.name}{props.values.phone ? ` · ${props.values.phone}` : ""}</p>
    </div>
    <Button type="button" variant="ghost" onClick={() => setEditing(true)}>Edit</Button>
  </div>;
  return <div className="sale-customer-search">
    <div className="min-w-0"><p className="sale-caption">Customer</p>
      <SearchablePicker label="Customer" placeholder="Search customer…" searchPlaceholder="Search name, phone or email…"
        options={props.suggestions.map(party => ({ value: party.id, label: party.name,
          description: [party.phone, party.due !== undefined ? `Previous Outstanding ${formatSaleMoney(party.due, props.symbol)}` : ""].filter(Boolean).join("\n"),
          keywords: [party.email, party.address] }))}
        onSearchChange={value => { setSearch(value); props.onSearch(value); }} purchasePresentation wrapOptionDescriptions
        popoverClassName="min-w-80 max-w-[calc(100vw-24px)]"
        emptyMessage={props.searching ? "Searching…" : search.trim().length >= 2 ? "No matching customer." : "Search with at least 2 characters."}
        triggerClassName="sale-customer-search-trigger"
        onChange={id => { const party = props.suggestions.find(p => p.id === id); if (party) props.onSelect(party); }} />
      {props.nameError && <p role="alert" className="text-xs text-[var(--danger)]">{props.nameError}</p>}
    </div>
    <Permit permission="customers.manage"><Button type="button" variant="ghost" className="sale-new-customer" onClick={() => setEditing(true)}>New customer</Button></Permit>
  </div>;
}
