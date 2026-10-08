import type { ActivityDetail } from "@afia/contracts";
import { ArrowUpRight, Copy, X } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  activityDateLabel,
  activityMoney,
  activityTime,
} from "./activity-domain";
export function ActivityDetails({
  event,
  close,
}: {
  event: ActivityDetail;
  close: () => void;
}) {
  return (
    <div className="activity-detail-content">
      <div className="activity-detail-heading">
        <span>Activity details</span>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close activity details"
          onClick={close}
        >
          <X size={18} />
        </Button>
      </div>
      <span className="activity-category">{event.category}</span>
      <h2>{event.title}</h2>
      <p className="activity-detail-date">
        {activityDateLabel(event.createdAt)} · {activityTime(event.createdAt)} ·
        Bangladesh time
      </p>
      <dl className="activity-facts">
        <div>
          <dt>Done by</dt>
          <dd>
            {event.actor?.name ?? "Not recorded"}
            {event.actor?.role && (
              <small>{event.actor.role === "OWNER" ? "Owner" : "Staff"}</small>
            )}
          </dd>
        </div>
        <div>
          <dt>Record</dt>
          <dd>{event.reference}</dd>
        </div>
        {event.label && (
          <div>
            <dt>Name / Item</dt>
            <dd>{event.label}</dd>
          </div>
        )}
        {event.amount !== null && (
          <div>
            <dt>Amount</dt>
            <dd>{activityMoney(event.amount)}</dd>
          </div>
        )}
      </dl>
      {event.reason && (
        <section className="activity-detail-section">
          <h3>Reason / Note</h3>
          <p>{event.reason}</p>
        </section>
      )}
      {!!event.changes.length && (
        <section className="activity-detail-section">
          <h3>What changed</h3>
          <div className="activity-changes">
            {event.changes.map((change) => (
              <div key={change.label}>
                <strong>{change.label}</strong>
                <p>
                  <span className="activity-before">{change.before}</span>
                  <span aria-hidden="true">→</span>
                  <span>{change.after}</span>
                </p>
              </div>
            ))}
          </div>
        </section>
      )}
      {!!event.details.length && (
        <section className="activity-detail-section">
          <h3>Recorded details</h3>
          <dl className="activity-facts">
            {event.details.map((detail) => (
              <div key={detail.label}>
                <dt>{detail.label}</dt>
                <dd>{detail.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      {!event.hasSnapshot && !event.details.length && (
        <p className="activity-history-note">
          This older record does not include change details. The original
          activity is preserved.
        </p>
      )}
      <div className="activity-detail-actions">
        {event.href && (
          <Button asChild variant="outline">
            <Link to={event.href}>
              Open record <ArrowUpRight size={15} />
            </Link>
          </Button>
        )}
        <Button
          variant="ghost"
          onClick={() => {
            void navigator.clipboard
              .writeText(event.id)
              .then(() => toast.success("Activity ID copied."))
              .catch(() => toast.error("Could not copy. Please try again."));
          }}
        >
          <Copy size={14} /> Copy Activity ID
        </Button>
      </div>
      <p className="activity-history-note">
        Activity ID <span>{event.id}</span>
        <br />
        Activity records cannot be edited or deleted here.
      </p>
    </div>
  );
}
