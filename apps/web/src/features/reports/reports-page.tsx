import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { BarChart3 } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getSales } from "@/lib/api";
export function ReportsPage() {
  const sales = useQuery({
    queryKey: ["sales", "reports"],
    queryFn: () => getSales(),
  });
  const byDay = new Map<string, number>();
  for (const sale of sales.data ?? []) {
    const day = format(new Date(sale.soldAt), "MMM d");
    byDay.set(day, (byDay.get(day) ?? 0) + sale.totalAmount);
  }
  const data = Array.from(byDay, ([day, total]) => ({ day, total }))
    .reverse()
    .slice(-14);
  return (
    <div className="mx-auto max-w-350 px-4 pb-28 pt-7 md:px-7 lg:px-10">
      <div className="flex gap-4">
        <span className="grid size-11 place-items-center rounded-xl bg-[var(--surface-warm)] text-[var(--accent)]">
          <BarChart3 className="size-5" />
        </span>
        <div>
          <h1 className="text-3xl font-semibold">Reports</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            A clear view of recent sales performance.
          </p>
        </div>
      </div>
      <section className="mt-7 rounded-xl border border-[var(--border)] bg-white p-4 shadow-[var(--shadow-card)] sm:p-5">
        <h2 className="font-semibold">Sales by day</h2>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Completed sales from the latest records
        </p>
        <div className="mt-5 h-72">
          {data.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data}>
                <CartesianGrid vertical={false} stroke="#e2e8f0" />
                <XAxis
                  dataKey="day"
                  tickLine={false}
                  axisLine={false}
                  fontSize={12}
                />
                <YAxis tickLine={false} axisLine={false} fontSize={12} />
                <Tooltip
                  formatter={(value) => `৳${Number(value).toLocaleString()}`}
                />
                <Bar
                  dataKey="total"
                  fill="var(--primary)"
                  radius={[7, 7, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="grid h-full place-items-center text-sm text-[var(--muted)]">
              Sales will appear here after the first completed sale.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
