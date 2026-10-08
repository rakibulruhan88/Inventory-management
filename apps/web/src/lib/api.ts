import type {
  InvoiceImportConfirmationResponse,
  PurchaseDetails,
  InvoiceImportReviewInput,
  InvoiceImportIssue,
  InvoiceImportDraftResponse,
  InvoiceImportUploadResponse,
  InvoiceImportLimits,
  CreateSupplierRequest,
  CustomerInput,
  CustomerSummary,
  ContainerSummary,
  ContainerUpdateInput,
  HealthResponse,
  InventoryItemSummary,
  InventorySummary,
  ProductSearchResult,
  ReceivePurchaseRequest,
  ReceivePurchaseResponse,
  SaleSummary,
  SaleInvoice,
  PurchaseSummary,
  CreateSaleRequest,
  CreateSaleResponse,
  GlobalSearchGroup,
  ReceivePaymentRequest,
  StoreSettingsContract,
  SupplierSummary,
  SupplierDetails,
  SupplierInput,
  UpdateProductRequest,
  UpdateVariantRequest,
  AuthUser,
  LoginRequest,
  LoginResponse,
  AccountDetails,
  UpdateAccountRequest,
  ChangePasswordRequest,
  CustomerDetails,
  StockAdjustmentRequest,
  VoidSaleRequest,
} from "@afia/contracts";

const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3000/api";

export async function getApiHealth(): Promise<HealthResponse> {
  const response = await fetch(`${apiUrl}/health`);

  if (!response.ok) {
    throw new Error("API is not available");
  }

  return response.json() as Promise<HealthResponse>;
}

export class ApiResponseError extends Error { status: number; constructor(message: string, status: number) { super(message); this.status = status; } }

export class ApiFieldError extends Error {
  fieldErrors: InvoiceImportIssue[];
  constructor(message: string, fieldErrors: InvoiceImportIssue[]) { super(message); this.fieldErrors = fieldErrors; }
}

export class CustomerPhoneConflictError extends Error {
  existingCustomer: import("@afia/contracts").CustomerPhoneConflict["existingCustomer"];
  constructor(conflict: import("@afia/contracts").CustomerPhoneConflict) {
    super(conflict.message);
    this.existingCustomer = conflict.existingCustomer;
  }
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  if (init?.method && init.method !== "GET" && !navigator.onLine) {
    throw new Error(
      "You’re offline. Please reconnect and try again.",
    );
  }
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...init?.headers,
    },
  });

  if (!response.ok) {
    if (response.status === 401 && !path.startsWith("/auth/login"))
      window.dispatchEvent(new Event("afia:unauthorized"));
    const body = (await response.json().catch(() => null)) as {
      message?: string | string[];
      fieldErrors?: InvoiceImportIssue[];
      blockingIssues?: InvoiceImportIssue[];
      code?: string;
      existingCustomer?: import('@afia/contracts').CustomerPhoneConflict['existingCustomer'];
    } | null;
    const message = Array.isArray(body?.message)
      ? body.message[0]
      : body?.message;
    if (body?.code === "CUSTOMER_PHONE_CONFLICT" && body.existingCustomer)
      throw new CustomerPhoneConflictError({
        code: "CUSTOMER_PHONE_CONFLICT",
        message: message ?? "Phone already belongs to an existing customer.",
        existingCustomer: body.existingCustomer,
      });
    if (body?.blockingIssues) throw new ApiFieldError(message ?? "Review the blocking issues.", body.blockingIssues);
    if (body?.fieldErrors) throw new ApiFieldError(message ?? "Check the review fields.", body.fieldErrors);
    throw new ApiResponseError(message ?? "Something went wrong. Please try again.", response.status);
  }

  return response.json() as Promise<T>;
}

export function getInventorySummary() {
  return apiRequest<InventorySummary>("/inventory/summary");
}

export function getInventoryItems(search = "") {
  const query = new URLSearchParams({ search });
  return apiRequest<InventoryItemSummary[]>(`/inventory/items?${query}`);
}

export function updateInventoryItem(id: string, input: UpdateProductRequest) {
  return apiRequest(`/inventory/items/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function archiveInventoryItem(id: string) {
  return apiRequest(`/inventory/items/${id}`, { method: "DELETE" });
}

export function updateInventoryVariant(
  id: string,
  input: UpdateVariantRequest,
) {
  return apiRequest(`/inventory/variants/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function archiveInventoryVariant(id: string) {
  return apiRequest(`/inventory/variants/${id}`, { method: "DELETE" });
}

export function getCustomers(search = "") {
  return apiRequest<CustomerSummary[]>(
    `/customers?${new URLSearchParams({ search })}`,
  );
}
export function getCustomer(id: string) {
  return apiRequest<CustomerDetails>(`/customers/${id}`);
}
export function createCustomer(input: CustomerInput) {
  return apiRequest("/customers", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
export function updateCustomer(id: string, input: CustomerInput) {
  return apiRequest(`/customers/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}
export function archiveCustomer(id: string) {
  return apiRequest(`/customers/${id}`, { method: "DELETE" });
}
export function getContainers(search = "") {
  return apiRequest<ContainerSummary[]>(
    `/containers?${new URLSearchParams({ search })}`,
  );
}
export function updateContainer(id: string, input: ContainerUpdateInput) {
  return apiRequest(`/containers/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}
export function archiveContainer(id: string) {
  return apiRequest(`/containers/${id}`, { method: "DELETE" });
}
export function getSales(search = "") {
  return apiRequest<SaleSummary[]>(`/sales?${new URLSearchParams({ search })}`);
}
export function getSaleDetails(id: string) {
  return apiRequest<SaleInvoice>(`/sales/${id}`);
}
export async function downloadSaleInvoicePdf(id: string) {
  const response = await fetch(`${apiUrl}/sales/${id}/pdf`, {
    credentials: "include",
  });
  if (!response.ok) {
    if (response.status === 401)
      window.dispatchEvent(new Event("afia:unauthorized"));
    const body = (await response.json().catch(() => null)) as {
      message?: string | string[];
      fieldErrors?: InvoiceImportIssue[];
      blockingIssues?: InvoiceImportIssue[];
      code?: string;
      existingCustomer?: import('@afia/contracts').CustomerPhoneConflict['existingCustomer'];
    } | null;
    throw new Error(
      Array.isArray(body?.message)
        ? body.message[0]
        : body?.message ?? "The invoice PDF could not be downloaded.",
    );
  }
  const disposition = response.headers.get("Content-Disposition");
  const filename = disposition?.match(/filename\*?=(?:UTF-8''|["']?)([^"';]+)/i)?.[1];
  return {
    blob: await response.blob(),
    filename: filename ? decodeURIComponent(filename.trim()) : null,
  };
}
export function createSale(input: CreateSaleRequest) {
  return apiRequest<CreateSaleResponse>("/sales", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
export function getPurchases(search = "") {
  return apiRequest<PurchaseSummary[]>(
    `/purchases?${new URLSearchParams({ search })}`,
  );
}
export function receiveCustomerPayment(
  id: string,
  input: ReceivePaymentRequest,
) {
  return apiRequest<import("@afia/contracts").PaymentReceipt>(`/customers/${id}/payments`, {
    method: "POST",
    headers: { "X-Afia-Payment": "receive-payment" },
    body: JSON.stringify(input),
  });
}
export function voidSale(id: string, input: VoidSaleRequest) {
  return apiRequest(`/sales/${id}/void`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}
export function emailSaleInvoice(id: string) {
  return apiRequest<{ sent: true; recipient: string; filename: string }>(
    `/sales/${id}/email`,
    { method: "POST" },
  );
}
export function adjustStock(input: StockAdjustmentRequest) {
  return apiRequest("/inventory/adjustments", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
export function reversePurchase(id: string, reason: string) {
  return apiRequest(`/purchases/${id}/reverse`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}
export function login(input: LoginRequest) {
  return apiRequest<LoginResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
export function logout() {
  return apiRequest<{ signedOut: true }>("/auth/logout", { method: "POST" });
}
export function getMe() {
  return apiRequest<{ user: AuthUser }>("/auth/me");
}
export function getAccount() {
  return apiRequest<AccountDetails>("/auth/account");
}
export function updateAccount(input: UpdateAccountRequest) {
  return apiRequest<AccountDetails>("/auth/account", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}
export function changePassword(input: ChangePasswordRequest) {
  return apiRequest<{ passwordChanged: true }>("/auth/change-password", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
export function globalSearch(q: string) {
  return apiRequest<GlobalSearchGroup[]>(
    `/search?${new URLSearchParams({ q })}`,
  );
}
export function getSettings() {
  return apiRequest<StoreSettingsContract>("/settings");
}
export function updateSettings(input: StoreSettingsContract) {
  return apiRequest<StoreSettingsContract>("/settings", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function getSuppliers(search = "") {
  const query = new URLSearchParams({ search });
  return apiRequest<SupplierSummary[]>(`/suppliers?${query}`);
}

export function getSupplier(id: string) {
  return apiRequest<SupplierDetails>(`/suppliers/${id}`);
}

export function updateSupplier(id: string, input: SupplierInput) {
  return apiRequest<SupplierSummary>(`/suppliers/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function archiveSupplier(id: string) {
  return apiRequest<{ id: string; archived: true }>(`/suppliers/${id}`, {
    method: "DELETE",
  });
}

export function getProducts(search = "") {
  const query = new URLSearchParams({ search });
  return apiRequest<ProductSearchResult[]>(`/products?${query}`);
}

export function createSupplier(input: CreateSupplierRequest) {
  return apiRequest<SupplierSummary>("/suppliers", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function receivePurchase(input: ReceivePurchaseRequest) {
  return apiRequest<ReceivePurchaseResponse>("/purchases/receive", {
    method: "POST",
    body: JSON.stringify(input),
  });
}


export function getInvoiceImportLimits() {
  return apiRequest<InvoiceImportLimits>("/invoice-imports/limits");
}
export function uploadInvoiceImport(file: File) {
  const body = new FormData();
  body.append("file", file);
  return apiRequest<InvoiceImportUploadResponse>("/invoice-imports", {
    method: "POST", body, headers: { "X-Afia-Invoice-Import": "1" },
  });
}
export function parseInvoiceImport(id: string) {
  return apiRequest<InvoiceImportDraftResponse>(`/invoice-imports/${encodeURIComponent(id)}/parse`, {
    method: "POST", headers: { "X-Afia-Invoice-Import": "1" },
  });
}
export function getInvoiceImport(id: string) {
  return apiRequest<InvoiceImportDraftResponse>(`/invoice-imports/${encodeURIComponent(id)}`);
}

export function saveInvoiceReview(id: string, input: InvoiceImportReviewInput) {
  return apiRequest<InvoiceImportDraftResponse>(`/invoice-imports/${encodeURIComponent(id)}/review`, {
    method: "PUT", headers: { "X-Afia-Invoice-Import": "1" }, body: JSON.stringify(input),
  });
}
export function resetInvoiceReview(id: string) {
  return apiRequest<InvoiceImportDraftResponse>(`/invoice-imports/${encodeURIComponent(id)}/review/reset`, {
    method: "POST", headers: { "X-Afia-Invoice-Import": "1" }, body: JSON.stringify({}),
  });
}

export function confirmInvoiceImport(id: string) {
  return apiRequest<InvoiceImportConfirmationResponse>(`/invoice-imports/${encodeURIComponent(id)}/confirm`, { method: "POST", headers: { "X-Afia-Invoice-Import": "1" }, body: JSON.stringify({}) });
}
export function getPurchase(id: string) { return apiRequest<PurchaseDetails>(`/purchases/${encodeURIComponent(id)}`); }
export function documentContentUrl(id: string, download = false) {
  return `${apiUrl}/documents/${encodeURIComponent(id)}/content${download ? '?download=true' : ''}`;
}

export function getSalesLedger(
  query: import("@afia/contracts").SalesLedgerQuery,
) {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== "") params.set(key, String(value));
  });
  return apiRequest<
    import("@afia/contracts").LedgerPage<
      import("@afia/contracts").SalesLedgerRow
    >
  >(`/sales/ledger?${params}`);
}
export function getCustomerAccount(id: string, page = 1) {
  return apiRequest<import("@afia/contracts").CustomerAccount>(
    `/customers/${encodeURIComponent(id)}/account?page=${page}&pageSize=25`,
  );
}

export function getPaymentContext(id: string) { return apiRequest<import("@afia/contracts").PaymentContext>(`/customers/${id}/payment-context`); }
export function getPaymentReceipt(id: string, receiptId: string) { return apiRequest<import("@afia/contracts").PaymentReceipt>(`/customers/${id}/payment-receipts/${receiptId}`); }

export function getOutstandingCustomers(query: import('@/features/payments/payments-types').PaymentListQuery) {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => { if (value !== undefined && value !== '') params.set(key, String(value)); });
  return apiRequest<import('@/features/payments/payments-types').OutstandingCustomersPage>(`/payments/outstanding-customers?${params}`);
}
export function getRecentPaymentReceipts(query: import('@/features/payments/payments-types').PaymentListQuery) {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => { if (value !== undefined && value !== '') params.set(key, String(value)); });
  return apiRequest<import('@afia/contracts').LedgerPage<import('@/features/payments/payments-types').ReceiptLedgerRow>>(`/payments/receipts?${params}`);
}

export function saveOpeningDue(id: string | undefined, input: import("@afia/contracts").CustomerWithOpeningDueRequest) {
  return apiRequest<{customerId: string; openingDue: import("@afia/contracts").OpeningDue}>(
    id ? `/customers/${encodeURIComponent(id)}/opening-due` : "/customers/with-opening-due", {
      method: "POST", headers: {"X-Afia-Payment": "receive-payment"},
      body: JSON.stringify(id ? input.openingDue : input),
    });
}

export function getFinance(query: import('@afia/contracts').FinanceQuery) {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key,value])=> {if(value !== undefined && value !== '') params.set(key,String(value));});
  return apiRequest<import('@afia/contracts').FinancePage>(`/finance?${params}`);
}
export function createFinanceEntry(input: import('@afia/contracts').CreateFinanceEntry) {
  return apiRequest<import('@afia/contracts').FinanceEntryDetail>('/finance/entries',{method:'POST',headers:{'X-Afia-Finance':'1'},body:JSON.stringify(input)});
}
export function getFinanceEntry(id:string) { return apiRequest<import('@afia/contracts').FinanceEntryDetail>(`/finance/entries/${encodeURIComponent(id)}`); }
export function voidFinanceEntry(id:string,reason:string) { return apiRequest<import('@afia/contracts').FinanceEntryDetail>(`/finance/entries/${encodeURIComponent(id)}/void`,{method:'POST',headers:{'X-Afia-Finance':'1'},body:JSON.stringify({reason})}); }
