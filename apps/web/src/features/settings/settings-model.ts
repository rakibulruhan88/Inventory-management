import { z } from "zod";
import { Building2, ReceiptText, Package, Palette, UserRound, Smartphone } from "lucide-react";

const brandImage = z.string().nullable().refine((value) => {
  if (!value) return true;
  if (value.startsWith("data:")) return /^data:image\/(png|jpeg|x-icon);base64,/i.test(value) && value.length <= 210000;
  try { return ["https:", "http:"].includes(new URL(value).protocol); } catch { return false; }
}, "Use a PNG, JPG or ICO file up to 150 KB, or a valid http/https image URL.");
export const settingsSchema = z.object({
  storeName: z.string().trim().min(1, "Enter your store name."),
  logoUrl: brandImage,
  faviconUrl: brandImage,
  storePhone: z.string().nullable(),
  storeEmail: z.union([z.email("Enter a valid store email."), z.literal("")]).nullable(),
  storeAddress: z.string().nullable(),
  currency: z.literal("BDT"),
  currencySymbol: z.string(),
  invoicePrefix: z.string().trim().min(1, "Enter an invoice prefix."),
  defaultPaymentMethod: z.enum(["CASH", "BANK", "MOBILE_BANKING", "OTHER"], { error: "Choose a payment method." }),
  lowStockRollThreshold: z.number({ error: "Enter a valid Rolls limit." }).int("Rolls must be a whole number.").min(0, "Rolls cannot be negative."),
  lowStockMeterThreshold: z.number({ error: "Enter a valid Meter limit." }).min(0, "Meter cannot be negative."),
  brandAccent: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a six-digit color code, such as #895332."),
});
export type SettingsFormData = z.infer<typeof settingsSchema>;
export const settingsSections = [
  { id: "business", title: "Business details", description: "Store name & contact information", icon: Building2, fields: ["storeName", "storePhone", "storeEmail", "storeAddress"] },
  { id: "sales", title: "Invoices & sales", description: "Invoice prefix & payment default", icon: ReceiptText, fields: ["invoicePrefix", "defaultPaymentMethod", "currency", "currencySymbol"] },
  { id: "inventory", title: "Stock alerts", description: "Rolls & Meter review limits", icon: Package, fields: ["lowStockRollThreshold", "lowStockMeterThreshold"] },
  { id: "appearance", title: "Store branding", description: "Logo, favicon & brand color", icon: Palette, fields: ["logoUrl", "faviconUrl", "brandAccent"] },
  { id: "account", title: "Account & password", description: "Login email & password", icon: UserRound, fields: [] },
  { id: "app", title: "App & device", description: "Install guide & connection", icon: Smartphone, fields: [] },
] as const;
export type SettingsSectionId = (typeof settingsSections)[number]["id"];
export const paymentOptions = [
  { value: "CASH", label: "Cash" }, { value: "BANK", label: "Bank" },
  { value: "MOBILE_BANKING", label: "Mobile Banking" }, { value: "OTHER", label: "Other" },
];
export const brandPresets = [
  { label: "Cognac", color: "#895332" }, { label: "Chestnut", color: "#704127" },
  { label: "Espresso", color: "#514032" }, { label: "Olive", color: "#596343" },
];
