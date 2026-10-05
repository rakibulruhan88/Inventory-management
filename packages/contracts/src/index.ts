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
  colorCode: string;
  size: string | null;
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
  totalRolls: number;
  totalMeters: number;
  colorCount: number;
  containerCount: number;
  variants: InventoryColorVariant[];
};
export type UpdateProductRequest = { itemCode: string; name?: string };
export type UpdateVariantRequest = {
  color: string;
  colorCode?: string;
  size?: string;
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
  color: string | null;
  colorCode: string;
  size: string | null;
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
export type ReceivePurchaseItem = {
  itemCode: string;
  name?: string;
  color: string;
  colorCode: string;
  size?: string;
  rolls: number;
  totalMeter?: number;
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
  color: string;
  colorCode: string;
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
