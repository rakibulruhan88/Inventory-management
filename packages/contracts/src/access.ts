export const permissionGroups = [
  {
    label: "Overview & reports",
    permissions: [
      { key: "overview.view", label: "View overview" },
      { key: "reports.view", label: "View reports" },
    ],
  },
  {
    label: "Sales",
    permissions: [
      { key: "sales.view", label: "View sales & invoices" },
      { key: "sales.create", label: "Create sales" },
      { key: "sales.email", label: "Email invoices" },
      { key: "sales.void", label: "Void sales" },
    ],
  },
  {
    label: "Customers & payments",
    permissions: [
      { key: "customers.view", label: "View customers & accounts" },
      { key: "customers.manage", label: "Add & edit customers" },
      { key: "customers.archive", label: "Archive customers" },
      { key: "payments.view", label: "View payment history" },
      { key: "payments.receive", label: "Receive customer payments" },
      { key: "payments.opening", label: "Add Opening Due" },
    ],
  },
  {
    label: "Inventory",
    permissions: [
      { key: "inventory.view", label: "View stock" },
      { key: "inventory.manage", label: "Edit items & colors" },
      { key: "inventory.adjust", label: "Adjust stock" },
      { key: "inventory.archive", label: "Archive items & colors" },
    ],
  },
  {
    label: "Purchases & suppliers",
    permissions: [
      { key: "purchases.view", label: "View purchases & documents" },
      {
        key: "purchases.receive",
        label: "Receive purchases & import invoices",
      },
      { key: "purchases.reverse", label: "Reverse purchases" },
      { key: "suppliers.view", label: "View suppliers" },
      { key: "suppliers.manage", label: "Add & edit suppliers" },
      { key: "suppliers.archive", label: "Archive suppliers" },
      { key: "containers.view", label: "View containers" },
      { key: "containers.manage", label: "Edit & archive containers" },
    ],
  },
  {
    label: "Cashbook",
    permissions: [
      { key: "finance.view", label: "View money records" },
      { key: "finance.create", label: "Record Money In & Money Out" },
      { key: "finance.void", label: "Void money entries" },
    ],
  },
] as const;
export type Permission =
  (typeof permissionGroups)[number]["permissions"][number]["key"];
export const permissions: Permission[] = permissionGroups.flatMap((g) =>
  g.permissions.map((p) => p.key),
);
export const permissionDependencies: Partial<Record<Permission, Permission[]>> =
  {
    "sales.create": ["sales.view", "inventory.view", "customers.view"],
    "sales.email": ["sales.view"],
    "sales.void": ["sales.view"],
    "customers.manage": ["customers.view"],
    "customers.archive": ["customers.view"],
    "payments.view": ["customers.view"],
    "payments.receive": ["payments.view"],
    "payments.opening": ["customers.manage", "payments.view"],
    "inventory.manage": ["inventory.view"],
    "inventory.adjust": ["inventory.view"],
    "inventory.archive": ["inventory.view"],
    "purchases.receive": [
      "purchases.view",
      "inventory.view",
      "suppliers.manage",
      "containers.view",
    ],
    "purchases.reverse": ["purchases.view"],
    "suppliers.manage": ["suppliers.view"],
    "suppliers.archive": ["suppliers.view"],
    "containers.manage": ["containers.view"],
    "finance.create": [
      "finance.view",
      "suppliers.view",
      "purchases.view",
      "containers.view",
    ],
    "finance.void": ["finance.view"],
    "overview.view": [
      "inventory.view",
      "sales.view",
      "customers.view",
      "payments.view",
      "finance.view",
    ],
    "reports.view": [
      "overview.view",
      "purchases.view",
      "suppliers.view",
      "containers.view",
    ],
  };
export function expandPermissions(input: readonly Permission[]): Permission[] {
  const result = new Set(input);
  for (const p of result)
    for (const dep of permissionDependencies[p] ?? []) result.add(dep);
  return permissions.filter((p) => result.has(p));
}
export function hasPermission(
  user: { role: string; permissions?: readonly string[] } | null | undefined,
  permission: Permission,
): boolean {
  return (
    !!user &&
    (user.role === "OWNER" || !!user.permissions?.includes(permission))
  );
}
export const staffPresets = [
  {
    name: "Sales staff",
    permissions: expandPermissions([
      "sales.create",
      "sales.email",
      "customers.manage",
    ]),
  },
  {
    name: "Cashier",
    permissions: expandPermissions(["payments.receive", "finance.create"]),
  },
  {
    name: "Stock staff",
    permissions: expandPermissions([
      "purchases.receive",
      "inventory.manage",
      "suppliers.manage",
    ]),
  },
] as const;
export type StaffAccount = {
  id: string;
  name: string;
  username: string | null;
  email: string | null;
  isActive: boolean;
  permissions: Permission[];
  createdAt: string;
  updatedAt: string;
};
export type StaffInput = {
  name: string;
  username: string;
  password?: string;
  isActive: boolean;
  permissions: Permission[];
};
export function pagePermission(path: string): Permission | "owner" | null {
  if (path.startsWith("/team") || path.startsWith("/activity")) return "owner";
  if (path.startsWith("/settings")) return null;
  if (path.startsWith("/dashboard")) return "overview.view";
  if (path.startsWith("/reports")) return "reports.view";
  if (path.startsWith("/sales/new")) return "sales.create";
  if (path.startsWith("/sales")) return "sales.view";
  if (path.startsWith("/purchases/new")) return "purchases.receive";
  if (path.startsWith("/purchases")) return "purchases.view";
  if (path.startsWith("/inventory")) return "inventory.view";
  if (path.includes("/receipts/")) return "payments.view";
  if (
    path.includes("/opening-due") ||
    path.includes("/add-customer") ||
    path.includes("/add-old-customer")
  )
    return "payments.opening";
  if (path.includes("/receive-payment")) return "payments.receive";
  if (path.startsWith("/customers/new")) return "customers.manage";
  if (path.startsWith("/customers")) return "customers.view";
  if (path.startsWith("/payments")) return "payments.view";
  if (path.startsWith("/cashbook") && path.endsWith("/new"))
    return "finance.create";
  if (path.startsWith("/cashbook")) return "finance.view";
  if (path.startsWith("/suppliers")) return "suppliers.view";
  if (path.startsWith("/containers")) return "containers.view";
  return null;
}
export function canOpenPage(
  user: { role: string; permissions?: readonly string[] } | null | undefined,
  path: string,
) {
  const permission = pagePermission(path);
  return permission === "owner"
    ? user?.role === "OWNER"
    : permission === null || hasPermission(user, permission);
}
export function firstAccessiblePage(
  user: { role: string; permissions?: readonly string[] } | null | undefined,
) {
  return [
    "/dashboard",
    "/sales",
    "/inventory",
    "/payments",
    "/cashbook",
    "/purchases",
    "/customers",
    "/suppliers",
    "/containers",
    "/reports",
    "/settings?section=account",
  ].find((p) => canOpenPage(user, p))!;
}

export const staffWorkMetrics = [
  { key: "sales", label: "Sales created", permission: "sales.create" },
  {
    key: "customers",
    label: "Customers added",
    permission: "customers.manage",
  },
  {
    key: "payments",
    label: "Payments received",
    permission: "payments.receive",
  },
  { key: "moneyIn", label: "Money In recorded", permission: "finance.create" },
  {
    key: "moneyOut",
    label: "Money Out recorded",
    permission: "finance.create",
  },
  {
    key: "purchases",
    label: "Purchases received",
    permission: "purchases.receive",
  },
  {
    key: "suppliers",
    label: "Suppliers added",
    permission: "suppliers.manage",
  },
  {
    key: "adjustments",
    label: "Stock adjustments",
    permission: "inventory.adjust",
  },
] as const;
export type StaffWorkMetric = (typeof staffWorkMetrics)[number]["key"];
export type StaffWorkSummary = {
  staff: StaffAccount;
  period: "all" | "month";
  from: string | null;
  to: string;
  counts: Record<StaffWorkMetric, number>;
  lastWorkAt: string | null;
};
