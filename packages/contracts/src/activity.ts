export const activityCategories = [
  "Sales",
  "Purchases",
  "Stock",
  "Payments",
  "Customers",
  "Suppliers",
  "Containers",
  "Settings",
  "Account",
  "Imports",
] as const;
export type ActivityCategory = (typeof activityCategories)[number];
export type ActivityQuery = {
  search?: string;
  category?: ActivityCategory;
  action?: string;
  actorId?: string;
  from?: string;
  to?: string;
  sort?: "newest" | "oldest";
  page?: number;
  pageSize?: number;
};
export type ActivityRow = {
  id: string;
  action: string;
  title: string;
  category: ActivityCategory;
  entityType: string;
  entityId: string;
  reference: string;
  label: string;
  createdAt: string;
  actor: { id: string; name: string; role: string } | null;
  reason: string | null;
  amount: string | null;
  href: string | null;
};
export type ActivityPage = {
  items: ActivityRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  summary: {
    total: number;
    changes: number;
    reversals: number;
    people: number;
  };
};
export type ActivityDetail = ActivityRow & {
  details: { label: string; value: string }[];
  changes: { label: string; before: string; after: string }[];
  hasSnapshot: boolean;
};
export type ActivityOptions = {
  actors: { id: string; name: string; role: string }[];
  actions: { value: string; label: string }[];
};
