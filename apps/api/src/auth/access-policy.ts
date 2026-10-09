import { hasPermission, type AuthUser, type Permission } from '@afia/contracts';
// Explicit controller + handler allowlist: newly added endpoints deny staff until reviewed.
const policy: Record<
  string,
  Record<string, Permission | Permission[] | 'owner' | 'signed-in'>
> = {
  AuthController: {
    me: 'signed-in',
    account: 'signed-in',
    updateAccount: 'signed-in',
    changePassword: 'signed-in',
    logout: 'signed-in',
  },
  StaffController: {
    summary: 'owner',
    list: 'owner',
    create: 'owner',
    update: 'owner',
    remove: 'owner',
  },
  ActivityController: {
    list: 'owner',
    detail: 'owner',
    options: 'owner',
    filters: 'owner',
  },
  SettingsController: { get: 'signed-in', update: 'owner' },
  SearchController: { search: 'signed-in' },
  InventoryController: {
    summary: 'overview.view',
    items: 'inventory.view',
    updateProduct: 'inventory.manage',
    updateVariant: 'inventory.manage',
    archiveProduct: 'inventory.archive',
    archiveVariant: 'inventory.archive',
    adjust: 'inventory.adjust',
  },
  ProductsController: { search: 'inventory.view' },
  SalesController: {
    list: 'sales.view',
    ledger: 'sales.view',
    details: 'sales.view',
    pdf: 'sales.view',
    create: 'sales.create',
    email: 'sales.email',
    void: 'sales.void',
  },
  CustomersController: {
    list: 'customers.view',
    details: 'customers.view',
    account: 'customers.view',
    paymentContext: 'payments.receive',
    receipt: 'payments.view',
    create: 'customers.manage',
    update: 'customers.manage',
    archive: 'customers.archive',
    payment: 'payments.receive',
    createWithOpeningDue: 'payments.opening',
    openingDue: 'payments.opening',
  },
  PaymentsController: {
    outstanding: 'payments.view',
    receipts: 'payments.view',
  },
  SuppliersController: {
    search: 'suppliers.view',
    details: 'suppliers.view',
    create: 'suppliers.manage',
    update: 'suppliers.manage',
    archive: 'suppliers.archive',
  },
  ContainersController: {
    list: 'containers.view',
    update: 'containers.manage',
    archive: 'containers.manage',
  },
  PurchasesController: {
    list: 'purchases.view',
    get: 'purchases.view',
    receive: 'purchases.receive',
    reverse: 'purchases.reverse',
  },
  PurchaseDocumentsController: {
    get: 'purchases.view',
    content: 'purchases.view',
  },
  InvoiceImportsController: {
    limits: 'purchases.receive',
    parse: 'purchases.receive',
    updateReview: 'purchases.receive',
    resetReview: 'purchases.receive',
    upload: 'purchases.receive',
    get: 'purchases.receive',
    review: 'purchases.receive',
    confirm: 'purchases.receive',
    content: 'purchases.receive',
  },
  FinanceController: {
    list: 'finance.view',
    detail: 'finance.view',
    create: 'finance.create',
    void: 'finance.void',
  },
};
export function canAccessEndpoint(
  user: AuthUser,
  controller: string,
  handler: string,
): boolean {
  if (user.role === 'OWNER') return true;
  const required = policy[controller]?.[handler];
  if (!required || required === 'owner') return false;
  if (required === 'signed-in') return true;
  return (Array.isArray(required) ? required : [required]).every((p) =>
    hasPermission(user, p),
  );
}
