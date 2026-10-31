import { formatSaleMoney } from "./new-sale-presentation";
import { saleInputNumber } from "./new-sale-domain";
import type { DeepPartialSkipArrayKey, UseFormReturn } from "react-hook-form";
import type { SearchablePickerOption } from "@/components/searchable-picker";
import { SearchablePicker } from "@/components/searchable-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, ChevronsUpDown } from "lucide-react";
import type { NewSaleFormData } from "./new-sale-form";
import {
  colorOptions,
  previewAmount,
  remainingBeforeRow,
  type StockColor,
} from "./new-sale-domain";

type ProductStock = StockColor & {
  productId: string;
  itemCode: string;
  description: string | null;
};
type Props = {
  itemKey: string;
  itemIndex: number;
  items: DeepPartialSkipArrayKey<NewSaleFormData["items"]>;
  products: ProductStock[];
  productOptions: SearchablePickerOption[];
  form: UseFormReturn<NewSaleFormData>;
  symbol: string;
  canRemove: boolean;
  inventoryErrors: Map<string, { rolls?: string; meter?: string }>;
  selectProduct: (value: string) => void;
  selectColor: (index: number, value: string) => void;
  addColor: () => void;
  removeColor: (index: number) => void;
  removeItem: () => void;
};
export function SaleItemGroup({
  itemKey,
  itemIndex,
  items,
  products,
  productOptions,
  form,
  symbol,
  canRemove,
  inventoryErrors,
  selectProduct,
  selectColor,
  addColor,
  removeColor,
  removeItem,
}: Props) {
  const item = items?.[itemIndex];
  const selectedProduct = products?.find(
    (product) => product.productId === item?.productId,
  );
  const selectedProductIds = new Set(
    (items ?? [])
      .filter((_, index) => index !== itemIndex)
      .map((candidate) => candidate.productId),
  );
  const availableProductOptions = productOptions.filter(
    (option) => !selectedProductIds.has(option.value),
  );
  const itemStock = products.filter(
    (product) => product.productId === item?.productId,
  );
  const baseColorOptions = colorOptions(itemStock);
  const error = form.formState.errors.items?.[itemIndex];
  return (
    <section
      key={itemKey}
      className="sale-item border-b border-[var(--border)] pb-1"
    >
      <div className="sale-item-header flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <label htmlFor={`sale-item-${itemIndex}`} className="sale-item-caption">Item code</label>
          <SearchablePicker
            triggerId={`sale-item-${itemIndex}`}
            label={`Search or change item ${itemIndex + 1}${selectedProduct ? `: ${selectedProduct.itemCode}` : ""}`}
            placeholder="Search item code…"
            searchPlaceholder="Search stock…"
            options={availableProductOptions}
            value={item?.productId}
            triggerClassName="sale-item-picker min-h-11 px-3 shadow-none rounded-md focus-visible:ring-[var(--ring)]"
            triggerContent={
              selectedProduct ? (
                <>
                  <span className="min-w-0 flex-1 break-words text-sm font-semibold">
                    {selectedProduct.itemCode}
                  </span>
                  <ChevronsUpDown aria-hidden="true" className="size-4 shrink-0 text-[var(--muted)]" />
                </>
              ) : undefined
            }
            purchasePresentation
            popoverClassName="min-w-72 max-w-[calc(100vw-24px)]"
            onChange={(value) => selectProduct(value)}
          />
          {selectedProduct?.description && (
            <p className="sale-item-description">
              <span className="text-[var(--muted)]">Description / Size</span>
              <span>{selectedProduct.description}</span>
            </p>
          )}
          {error?.productId && (
            <p role="alert" className="text-xs text-[var(--danger)]">
              {error.productId.message}
            </p>
          )}
        </div>
        {canRemove && (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label={`Remove item ${itemIndex + 1}`}
            onClick={() => removeItem()}
          >
            <Trash2 className="size-4" />
          </Button>
        )}
      </div>
      <div className="sale-ledger-head" aria-hidden="true">
        <span>Color</span>
        <span>Stock</span>
        <span>Sell By</span>
        <span className="text-right">Rolls</span>
        <span className="text-right">Meter</span>
        <span className="text-right">Unit Price</span>
        <span className="text-right">Amount</span>
        <span />
      </div>
      <div className="divide-y divide-[var(--border)]">
        {(item?.colors ?? []).map((color, colorIndex) => {
          const selectedColor = products?.find(
            (product) => product.variantId === color.variantId,
          );
          const preceding = (items ?? []).flatMap((candidate, index) =>
            index < itemIndex
              ? (candidate.colors ?? [])
              : index === itemIndex
                ? (candidate.colors ?? []).slice(0, colorIndex)
                : [],
          );
          const remaining = selectedColor
            ? remainingBeforeRow(selectedColor, preceding)
            : null;
          const colorError = error?.colors?.[colorIndex];
          const stockError = inventoryErrors.get(color.variantId ?? "");
          const meterMode = color.mode === "BY_METER";
          const priceField = meterMode ? "unitPricePerMeter" : "unitPricePerRoll";
          const priceError = meterMode ? colorError?.unitPricePerMeter : colorError?.unitPricePerRoll;
          const rowId = color.entryKey ?? `${itemKey}-${colorIndex}`;
          return (
            <div key={rowId} className={`sale-color-row ${meterMode ? "sale-meter-mode" : ""}`}>
              <div className="sale-color-identity min-w-0">
                <label htmlFor={`sale-color-${itemIndex}-${colorIndex}`} className="sale-field-label text-[var(--muted)]">Color</label>
                <SearchablePicker
                  triggerId={`sale-color-${itemIndex}-${colorIndex}`}
                  label={`Item ${itemIndex + 1}, color row ${colorIndex + 1}${selectedColor ? `: ${selectedColor.color}` : ""}`}
                  placeholder={
                    item?.productId ? "Choose color…" : "Choose item first"
                  }
                  searchPlaceholder="Search colors…"
                  disabled={!item?.productId}
                  options={baseColorOptions}
                  value={color.variantId}
                  purchasePresentation
                  popoverClassName="min-w-72 max-w-[calc(100vw-24px)]"
                  triggerClassName="sale-color-picker min-h-11 px-3 shadow-none rounded-md focus-visible:ring-[var(--ring)]"
                  triggerContent={
                    selectedColor ? (
                      <>
                        <span className="min-w-0 flex-1 break-words text-sm font-medium">
                          {selectedColor.color}
                        </span>
                        <ChevronsUpDown
                          aria-hidden="true"
                          className="size-3.5 shrink-0 text-[var(--muted)]"
                        />
                      </>
                    ) : undefined
                  }
                  onChange={(value) => selectColor(colorIndex, value)}
                />
                {colorError?.variantId && (
                  <p role="alert" className="text-xs text-[var(--danger)]">
                    {colorError.variantId.message}
                  </p>
                )}
              </div>
              <div
                className={`sale-availability text-xs text-[var(--muted)] ${remaining?.repeated ? "sale-remaining" : ""}`}
              >
                {remaining && (
                  <>
                    <span className="sale-availability-label">
                      {remaining.repeated ? "Remaining" : "Available"}{" "}
                    </span>
                    <span className="sale-stock-long">
                      <span><strong>{remaining.rolls}</strong> Rolls</span>
                      <span><strong>{remaining.meter.toLocaleString("en-US")}</strong> Meter</span>
                    </span>
                  </>
                )}
              </div>
              <div role="group" aria-label="Sell By" className="sale-mode">
                <span className="sale-field-label">Sell By</span>
                <div className="sale-mode-buttons">
                {(["FULL_ROLL", "BY_METER"] as const).map((mode) => (
                  <Button key={mode} type="button"
                    variant="ghost"
                    aria-pressed={(color.mode ?? "FULL_ROLL") === mode}
                    onClick={() => {
                      if ((color.mode ?? "FULL_ROLL") === mode) return;
                      const path = `items.${itemIndex}.colors.${colorIndex}` as const;
                      form.setValue(`${path}.mode`, mode, { shouldDirty: true });
                      form.setValue(`${path}.rollsSold`, mode === "BY_METER" ? 0 : 1);
                      form.setValue(`${path}.unitPricePerRoll`, undefined);
                      form.setValue(`${path}.unitPricePerMeter`, undefined);
                      form.clearErrors(path);
                    }}>
                    {mode === "BY_METER" ? "Meter" : "Roll"}
                  </Button>
                ))}
                </div>
              </div>
              {meterMode ? <div className="sale-rolls" aria-hidden="true" /> : <label className="sale-rolls min-w-0 text-xs font-medium">
                <span className="sale-field-label">Rolls</span>
                <Input
                  className="sale-number-input h-10 bg-white text-right"
                  inputMode="numeric"
                  aria-invalid={Boolean(
                    colorError?.rollsSold || stockError?.rolls,
                  )}
                  aria-describedby={`${rowId}-rolls-error`}
                  {...form.register(
                    `items.${itemIndex}.colors.${colorIndex}.rollsSold`,
                    { setValueAs: saleInputNumber },
                  )}
                />
                {(colorError?.rollsSold || stockError?.rolls) && (
                  <span
                    role="alert"
                    id={`${rowId}-rolls-error`}
                    className="mt-1 block text-xs text-[var(--danger)]"
                  >
                    {stockError?.rolls || colorError?.rollsSold?.message}
                  </span>
                )}
              </label>}
              <label className="sale-meter min-w-0 text-xs font-medium">
                <span className="sale-field-label">Meter</span>
                <Input
                  className="sale-number-input h-10 bg-white text-right"
                  inputMode="decimal"
                  placeholder="—"
                  aria-invalid={Boolean(
                    colorError?.meterSold || stockError?.meter,
                  )}
                  aria-describedby={`${rowId}-meter-error`}
                  {...form.register(
                    `items.${itemIndex}.colors.${colorIndex}.meterSold`,
                    { setValueAs: saleInputNumber },
                  )}
                />
                {(colorError?.meterSold || stockError?.meter) && (
                  <span
                    role="alert"
                    id={`${rowId}-meter-error`}
                    className="mt-1 block text-xs text-[var(--danger)]"
                  >
                    {stockError?.meter || colorError?.meterSold?.message}
                  </span>
                )}
              </label>
              <label className="sale-price min-w-0 text-xs font-medium">
                <span className="sale-field-label">Unit Price / {meterMode ? "Meter" : "Roll"}</span>
                <div className="sale-price-input relative">
                  <span
                    aria-hidden="true"
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]"
                  >
                    {symbol}
                  </span>
                  <Input
                    key={priceField}
                    className="h-10 bg-white pl-7 pr-14 text-right"
                    inputMode="decimal"
                    aria-invalid={Boolean(priceError)}
                    aria-describedby={`${rowId}-price-error`}
                    {...form.register(
                      `items.${itemIndex}.colors.${colorIndex}.${priceField}`,
                      { setValueAs: saleInputNumber },
                    )}
                  />
                  <span aria-hidden="true" className="sale-price-basis">/ {meterMode ? "Meter" : "Roll"}</span>
                </div>
                {priceError && (
                  <span
                    role="alert"
                    id={`${rowId}-price-error`}
                    className="mt-1 block text-xs text-[var(--danger)]"
                  >
                    {priceError.message}
                  </span>
                )}
              </label>
              <div className="sale-row-amount text-sm">
                <span className="sale-field-label text-xs text-[var(--muted)]">
                  Amount
                </span>
                <output
                  aria-label={`Item ${itemIndex + 1}, color row ${colorIndex + 1} amount`}
                  className="font-semibold tabular-nums"
                >
                  {formatSaleMoney(previewAmount(color), symbol)}
                </output>
              </div>
              <div className="sale-remove">
                {(item?.colors?.length ?? 0) > 1 && (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="sale-remove-button"
                    aria-label={`Remove item ${itemIndex + 1}, color row ${colorIndex + 1}`}
                    onClick={() => removeColor(colorIndex)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <Button
        type="button"
        variant="ghost"
        className="sale-add-action px-2 text-xs text-[var(--accent)]"
        disabled={!item?.productId || !baseColorOptions.length}
        onClick={() => addColor()}
      >
        <Plus className="size-4" /> Add color
      </Button>
    </section>
  );
}
