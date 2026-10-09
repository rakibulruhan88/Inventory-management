import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { staffWorkMetrics } from "@afia/contracts";
import { Button } from "@/components/ui/button";
import { getStaffWorkSummary } from "@/lib/api";
export function StaffWorkSummary({ id }: { id: string }) {
  const [period, setPeriod] = useState<"all" | "month">("all");
  const q = useQuery({
    queryKey: ["staff", id, "summary", period],
    queryFn: () => getStaffWorkSummary(id, period),
    refetchInterval: 60000,
  });
  const data = q.data;
  const metrics = data
    ? staffWorkMetrics.filter(
        (metric) =>
          data.staff.permissions.includes(metric.permission) ||
          data.counts[metric.key] > 0,
      )
    : [];
  const activityQuery = new URLSearchParams({ actorId: id });
  if (data?.from)
    activityQuery.set(
      "from",
      new Date(new Date(data.from).getTime() + 21600000)
        .toISOString()
        .slice(0, 10),
    );
  return (
    <section className="staff-work" aria-labelledby="staff-work-heading">
      <header>
        <div>
          <h3 id="staff-work-heading">Work summary</h3>
          <p>Saved work by this staff member</p>
        </div>
        <div className="team-filter" aria-label="Work summary period">
          {(["all", "month"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={value === period}
              onClick={() => setPeriod(value)}
            >
              {value === "all" ? "All time" : "This month"}
            </button>
          ))}
        </div>
      </header>
      {q.isPending ? (
        <p className="staff-work-feedback" role="status">
          Loading work summary…
        </p>
      ) : q.isError ? (
        <div className="staff-work-feedback" role="alert">
          <p>{q.error.message}</p>
          <Button type="button" variant="outline" onClick={() => q.refetch()}>
            Try again
          </Button>
        </div>
      ) : (
        data && (
          <>
            {metrics.length ? (
              <dl className="staff-work-counts">
                {metrics.map((metric) => (
                  <div key={metric.key}>
                    <dt>
                      {metric.label}
                      {!data.staff.permissions.includes(metric.permission) && (
                        <small>Past access</small>
                      )}
                    </dt>
                    <dd>{data.counts[metric.key].toLocaleString("en-BD")}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="staff-work-feedback">
                No saved work to show yet.
              </p>
            )}
            <div className="staff-work-footer">
              <p>
                {data.lastWorkAt
                  ? `Last recorded work: ${new Date(data.lastWorkAt).toLocaleString("en-GB", { timeZone: "Asia/Dhaka", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}`
                  : "No recorded work in this period."}
              </p>
              <Link to={`/activity?${activityQuery}`}>
                View activity
                <ArrowUpRight size={14} aria-hidden="true" />
              </Link>
            </div>
            <p className="staff-work-note">
              Counts include saved records that were later voided or reversed.
              Money In/Out counts cover manual entries; customer payments appear
              separately. Older work without a recorded person is excluded.
            </p>
          </>
        )
      )}
    </section>
  );
}
