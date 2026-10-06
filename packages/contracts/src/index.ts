/** Shared API contracts for Afia Leather clients. */
export type InventorySummary = {
  totalItems: number;
  totalRolls: number;
  totalMeters: number;
  openRolls: number;
  totalCustomerDue: number;
  todaySales: number;
};
export type InventoryBatchSummary = {
  batchId: string;
  containerNumber: string;
  availableRolls: number;
  availableMeter: number;
};
export type InventoryColorVariant = {
  variantId: string;
  color: string;
  totalRolls: number;
  totalMeters: number;
  openRolls: number;
  rolls: never[];
  batches: InventoryBatchSummary[];
};
export type InventoryItemSummary = {
  productId: string;
  itemCode: string;
  name: string | null;
  description: string | null;
  totalRolls: number;
  totalMeters: number;
  colorCount: number;
  containerCount: number;
  variants: InventoryColorVariant[];
};
export type UpdateProductRequest = {
  itemCode: string;
  name?: string;
  description?: string;
};
export type UpdateVariantRequest = {
  color: string;
};
export type HealthResponse = {
  status: "ok";
  service: "afia-inventory-api";
  timestamp: string;
};
export type SupplierSummary = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  archivedAt: string | null;
  purchaseCount: number;
  totalPurchases: number;
};
export type SupplierPurchaseHistory = {
  id: string;
  purchaseNumber: string;
  containerId: string;
  containerNumber: string;
  status: string;
  purchasedAt: string;
  totalAmount: number;
  totalRolls: number;
  totalMeters: number;
};
export type SupplierShipment = {
  id: string;
  containerNumber: string;
  status: string;
  shippedAt: string | null;
  receivedAt: string | null;
  purchaseId: string | null;
};
export type SupplierDetails = SupplierSummary & {
  recentPurchases: SupplierPurchaseHistory[];
  purchaseHistory: SupplierPurchaseHistory[];
  shipments: SupplierShipment[];
};
export type CustomerSummary = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  totalSales: number;
  totalPaid: number;
  totalDue: number;
};
export type PaymentHistory = {
  id: string;
  receivedAt: string;
  amount: number;
  method: string;
  reference: string | null;
  notes: string | null;
  invoiceNumber: string | null;
  saleId: string | null;
};
export type CustomerDetails = CustomerSummary & {
  payments: PaymentHistory[];
  sales: SaleSummary[];
};
export type ContainerSummary = {
  documents?: PurchaseDocumentSummary[];
  id: string;
  containerNumber: string;
  supplierName: string;
  status: string;
  receivedAt: string | null;
  totalItems: number;
  totalRolls: number;
  totalMeters: number;
  notes: string | null;
};
export type SaleSummary = {
  id: string;
  invoiceNumber: string;
  customerName: string;
  soldAt: string;
  totalAmount: number;
  paidAmount: number;
  dueAmount: number;
  status: string;
};
export type PurchaseSummary = {
  documents?: PurchaseDocumentSummary[];
  id: string;
  purchaseNumber: string;
  supplierName: string;
  containerNumber: string;
  purchasedAt: string;
  totalRolls: number;
  totalMeters: number;
  status: string;
};
export type CustomerInput = {
  name: string;
  phone?: string;
  email?: string;
  address?: string;
};
export type ContainerUpdateInput = { containerNumber: string; notes?: string };
export type ProductSearchResult = {
  productId: string;
  variantId: string;
  itemCode: string;
  name: string | null;
  description: string | null;
  color: string | null;
  availableRolls: number;
  availableMeter: number;
};
export type SupplierInput = {
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
};
export type InlinePartyInput = {
  id?: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
};
export type CreateSupplierRequest = SupplierInput;
export type ReceivePurchaseColor = {
  color: string;
  rolls: number;
  totalMeter?: number;
};
export type ReceivePurchaseItem = {
  itemCode: string;
  description?: string;
  colors: ReceivePurchaseColor[];
};
export type ReceivePurchaseRequest = {
  purchaseNumber: string;
  supplierId?: string;
  supplier?: InlinePartyInput;
  containerNumber: string;
  purchasedAt: string;
  notes?: string;
  items: ReceivePurchaseItem[];
};
export type ReceivePurchaseResponse = {
  id: string;
  purchaseNumber: string;
  containerNumber: string;
  totalRolls: number;
  totalMeter: number;
  reusedItemCodes: string[];
};
export type CreateSaleLine = {
  variantId: string;
  rollsSold: number;
  meterSold?: number;
  lineTotal: number;
};
export type CreateSaleRequest = {
  customerId?: string;
  customer?: InlinePartyInput;
  soldAt: string;
  discountAmount: number;
  receivedAmount: number;
  paymentMethod?: "CASH" | "BANK" | "MOBILE_BANKING" | "OTHER";
  emailInvoice?: boolean;
  notes?: string;
  lines: CreateSaleLine[];
};
export type CreateSaleResponse = {
  id: string;
  invoiceNumber: string;
  subtotal: number;
  discountAmount: number;
  totalAmount: number;
  receivedAmount: number;
  paidAmount: number;
  dueAmount: number;
  changeAmount: number;
  emailStatus?: "sent" | "failed" | "not_requested";
  emailRecipient?: string | null;
};
export type SaleInvoiceLine = {
  id: string;
  itemCode: string;
  itemName: string | null;
  description: string | null;
  color: string;
  rollsSold: number;
  meterSold: number | null;
  lineTotal: number;
};
export type SaleInvoice = {
  id: string;
  invoiceNumber: string;
  soldAt: string;
  status: string;
  voidedAt: string | null;
  voidReason: string | null;
  customerId: string;
  currentCustomerEmail: string | null;
  customer: {
    name: string;
    phone: string | null;
    email: string | null;
    address: string | null;
  };
  lines: SaleInvoiceLine[];
  subtotal: number;
  discountAmount: number;
  totalAmount: number;
  receivedAmount: number;
  paidAmount: number;
  dueAmount: number;
  changeAmount: number;
  notes: string | null;
  settings: StoreSettingsContract;
  payments: PaymentHistory[];
  lastEmailedAt: string | null;
};
export type ReceivePaymentRequest = {
  amount: number;
  method?: "CASH" | "BANK" | "MOBILE_BANKING" | "OTHER";
  reference?: string;
  notes?: string;
};
export type StockAdjustmentRequest = {
  variantId: string;
  rollsChange: number;
  meterChange: number;
  reason: string;
};
export type VoidSaleRequest = { reason: string };
export type ReversePurchaseRequest = { reason: string };
export type AuthUser = {
  id: string;
  name: string;
  username: string | null;
  email: string | null;
  role: string;
};
export type LoginRequest = { identifier: string; password: string };
export type LoginResponse = { user: AuthUser };
export type AccountDetails = Pick<AuthUser, "name" | "username" | "email">;
export type UpdateAccountRequest = { email?: string };
export type ChangePasswordRequest = {
  currentPassword: string;
  newPassword: string;
};
export type GlobalSearchGroup = {
  type: "product" | "sale" | "purchase" | "container" | "customer" | "supplier";
  id: string;
  title: string;
  subtitle: string;
  path: string;
};
export type StoreSettingsContract = {
  storeName: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  storePhone: string | null;
  storeEmail: string | null;
  storeAddress: string | null;
  currency: string;
  currencySymbol: string;
  invoicePrefix: string;
  defaultPaymentMethod: string;
  lowStockRollThreshold: number;
  lowStockMeterThreshold: number;
  brandAccent: string;
};


// Commercial invoice import is a temporary review pipeline; it cannot receive stock.
export type InvoiceImportStatus = "UPLOADED" | "PARSING" | "REVIEW" | "FAILED" | "CONFIRMED" | "EXPIRED";
export type InvoiceParsingMethod = "PDF_TEXT" | "OCR" | "HYBRID";
export type InvoiceImportIssue = {
  code: string;
  message: string;
  field?: string;
  page?: number;
  line?: number;
};
export type InvoiceImportColor = {
  color: string;
  rolls: number | null;
  meter: number | null;
  matchedVariantId: string | null;
  matchStatus: "NEW" | "MATCHED" | "AMBIGUOUS";
  source: { page: number; line: number; method: "PDF_TEXT" | "OCR" } | null;
};
export type InvoiceImportItem = {
  itemCode: string;
  description: string | null;
  matchedProductId: string | null;
  existingDescription: string | null;
  matchStatus: "NEW" | "MATCHED" | "DESCRIPTION_CONFLICT";
  descriptionMissingInExisting: boolean;
  colors: InvoiceImportColor[];
};
export type InvoiceImportUnassignedRow = {
  itemCode: string | null;
  description: string | null;
  color: string | null;
  rolls: number | null;
  meter: number | null;
  text: string;
  reason: string;
  source: NonNullable<InvoiceImportColor["source"]>;
};
export type InvoiceImportReview = {
  purchasedAt?: string | null;
  purchaseNumber?: string | null;
  parserVersion: number;
  draftId: string;
  parsingMethod: InvoiceParsingMethod;
  supplier: {
    detectedName: string | null;
    phone: string | null;
    address: string | null;
    contactPerson: string | null;
    fax: string | null;
    matchedSupplierId: string | null;
    matchStatus: "NEW" | "MATCHED" | "AMBIGUOUS" | "NOT_DETECTED";
  };
  containerNumber: string | null;
  items: InvoiceImportItem[];
  unassignedRows: InvoiceImportUnassignedRow[];
  invoiceTotals: { rolls: number | null; meter: number | null };
  parsedTotals: { rolls: number; meter: number };
  totalsMatch: { rolls: boolean | null; meter: boolean | null };
  validationPassed: boolean;
  warnings: InvoiceImportIssue[];
};
// Only editable business fields; totals and matching metadata are server-owned.
export type InvoiceImportReviewInput = {
  purchasedAt?: string | null;
  purchaseNumber?: string | null;
  supplier: { name: string; phone: string | null; fax: string | null; address: string | null; contactPerson: string | null };
  containerNumber: string;
  items: {
    itemCode: string;
    description: string | null;
    colors: { color: string; rolls: number | null; meter: number | null; sourceRow?: { item: number; color: number } }[];
  }[];
};
export type InvoiceImportDraftResponse = {
  confirmedPurchaseId?: string | null;
  originalExtractedData: InvoiceImportReview | null;
  hasReviewedChanges: boolean;
  validationPassed: boolean;
  readyForConfirmation: boolean;
  blockingIssues: InvoiceImportIssue[];
  id: string;
  originalFileName: string;
  mimeType: string;
  fileSize: number;
  status: InvoiceImportStatus;
  parsingMethod: InvoiceParsingMethod | null;
  review: InvoiceImportReview | null;
  requiresReparse: boolean;
  warnings: InvoiceImportIssue[];
  errors: InvoiceImportIssue[];
  createdAt: string;
  expiresAt: string;
};
export type InvoiceImportUploadResponse = InvoiceImportDraftResponse & {
  duplicateFile: boolean;
  previousDraftId: string | null;
};
export type InvoiceImportLimits = { maxFileBytes: number; supportedMimeTypes: string[] };

export type PurchaseDocumentSummary = {
  id: string; purchaseId: string; containerId: string; documentType: "COMMERCIAL_INVOICE";
  originalFileName: string; mimeType: string; fileSize: number; sha256Hash: string; createdAt: string;
};
export type PurchaseDetails = PurchaseSummary & {
  containerId: string;
  documents: PurchaseDocumentSummary[];
  lines: { id: string; itemCode: string; description: string | null; color: string; rolls: number; meter: number }[];
};
export type InvoiceImportConfirmationResponse = {
  purchase: ReceivePurchaseResponse; containerId: string; document: PurchaseDocumentSummary;
  itemCount: number; colorCount: number; alreadyConfirmed: boolean; purchaseStatus: string;
};
// The existing editable manual reference default, shared with import review.
export function defaultPurchaseNumber(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `PUR-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}
export function validPurchaseDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0, 4)) < 1900) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

// Additive read-only ledger contracts; existing list/detail responses remain intact.
export type SalesLedgerQuery = {
  search?: string; customer?: string; phone?: string; customerId?: string;
  invoice?: string; product?: string;
  date?: "today" | "yesterday" | "week" | "month" | "specific" | "range";
  from?: string; to?: string;
  status?: "PAID" | "PARTIAL" | "UNPAID" | "VOIDED";
  method?: "CASH" | "BANK" | "MOBILE_BANKING" | "OTHER";
  minTotal?: number; maxTotal?: number; minDue?: number; maxDue?: number;
  sort?: "newest" | "oldest" | "highest-total" | "lowest-total" | "highest-due";
  page?: number; pageSize?: number;
};
export type SalesLedgerRow = SaleSummary & { customerId: string; customerPhone: string | null };
export type LedgerPage<T> = { items: T[]; page: number; pageSize: number; total: number };
export type CustomerAccount = CustomerSummary & {
  sales: LedgerPage<SalesLedgerRow>;
  outstandingInvoices: LedgerPage<SalesLedgerRow>;
  payments: LedgerPage<PaymentHistory>;
};
export const SALES_BUSINESS_TIMEZONE = "Asia/Dhaka";
