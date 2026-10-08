import {
  customerPhoneError,
  saleLineAmount,
  meterSaleLineAmount,
} from "@afia/contracts";
import { z } from "zod";
const saleLine = z
  .object({
    mode: z.enum(["FULL_ROLL", "BY_METER"]).optional(),
    unitPricePerMeter: z.number().optional(),
    entryKey: z.string().optional(),
    variantId: z.string().min(1, "Choose an item and color."),
    rollsSold: z.number().int().min(0, "Rolls cannot be negative."),
    meterSold: z
      .number()
      .min(0, "Meter cannot be negative.")
      .max(9999999999.99)
      .refine(
        (value) => /^\d+(?:\.\d{1,2})?$/.test(String(value)),
        "Use at most two decimal places.",
      ),
    unitPricePerRoll: z.number().optional(),
  })
  .superRefine((line, context) => {
    if (line.mode !== "BY_METER" && line.rollsSold < 1) {
      context.addIssue({ code: "custom", path: ["rollsSold"], message: "Enter at least one roll." });
      return;
    }
    if (line.mode === "BY_METER" && line.meterSold <= 0) {
      context.addIssue({ code: "custom", path: ["meterSold"], message: "Enter Meter greater than zero." });
      return;
    }
    try {
      if (line.mode === "BY_METER") {
        if (line.rollsSold !== 0) throw new Error("Meter sales must sell zero Rolls.");
        meterSaleLineAmount(line.meterSold, line.unitPricePerMeter ?? 0);
      } else saleLineAmount(line.rollsSold, line.unitPricePerRoll ?? 0);
    } catch (error) {
      context.addIssue({
        code: "custom",
        path: [line.mode === "BY_METER" ? "unitPricePerMeter" : "unitPricePerRoll"],
        message: error instanceof Error ? error.message : "Invalid unit price.",
      });
    }
  });
const saleItem = z.object({
  productId: z.string().min(1, "Choose an item."),
  colors: z.array(saleLine).min(1),
});
export const newSaleSchema = z
  .object({
    customer: z.object({
      id: z.string().optional(),
      name: z.string().trim().min(1, "Customer name is required."),
      email: z.union([z.email("Enter a valid email."), z.literal("")]),
      phone: z.string(),
      address: z.string(),
    }),
    soldAt: z.string().min(1),
    discountAmount: z.number().min(0),
    receivedAmount: z.number().min(0),
    paymentMethod: z.enum(["CASH", "BANK", "MOBILE_BANKING", "OTHER"]),
    emailInvoice: z.boolean(),
    notes: z.string().optional(),
    items: z.array(saleItem).min(1),
  })
  .superRefine((sale, context) => {
    const phoneError = !sale.customer.id
      ? customerPhoneError(sale.customer.phone)
      : null;
    if (phoneError)
      context.addIssue({
        code: "custom",
        path: ["customer", "phone"],
        message: phoneError,
      });
    const products = new Set<string>();
    sale.items.forEach((item, index) => {
      if (!item.productId) return;
      if (products.has(item.productId)) {
        context.addIssue({
          code: "custom",
          path: ["items", index, "productId"],
          message:
            "This item is already included above. Add another color there.",
        });
      }
      products.add(item.productId);
    });
  });
export type NewSaleFormData = z.infer<typeof newSaleSchema>;
