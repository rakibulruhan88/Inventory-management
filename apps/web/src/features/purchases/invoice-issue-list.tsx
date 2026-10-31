import { ArrowRight } from "lucide-react";
import type { InvoiceImportIssue, InvoiceImportReview } from "@afia/contracts";
import { issueCopy, reviewIssueTargets, type ReviewIssueSelection } from "./invoice-review-issues";

export function InvoiceIssueList({ issues, review, onSelect, disabled = false }: {
  issues: InvoiceImportIssue[];
  review: InvoiceImportReview;
  onSelect: (selection: ReviewIssueSelection) => void;
  disabled?: boolean;
}) {
  if (!issues.length) return null;
  return <section aria-label="Invoice details to check" className="border border-[var(--border)] border-l-2 border-l-[var(--warning)] rounded-md">
    <div className="border-b border-[var(--border)] px-3 py-3 sm:px-4">
      <h4 className="text-sm font-semibold">{issues.length} {issues.length === 1 ? "detail needs" : "details need"} checking</h4>
      <p className="mt-1 text-xs text-[var(--muted)]">Click a detail to go to the right place. Save your changes to check what is left.</p>
    </div>
    <ol className="divide-y divide-[var(--border)]">
      {issues.map((issue, index) => {
        const copy = issueCopy(issue);
        return <li key={`${issue.code}-${issue.field}-${issue.page}-${issue.line}-${index}`} className="px-2 py-1">
              {reviewIssueTargets(issue, review).map((target) => <button key={target.path} type="button" disabled={disabled}
                onClick={() => onSelect({ issue, index, target })}
                className="flex min-h-11 w-full cursor-pointer items-start gap-3 rounded-md px-2 py-3 text-left transition-colors hover:bg-[var(--primary-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-50">
                <span className="w-5 shrink-0 pt-0.5 text-xs font-semibold text-[var(--warning)]" aria-hidden="true">{index + 1}.</span>
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-sm font-medium text-[var(--ink)]">{copy.title}</span>
                  <span className="mt-1 block break-words text-xs font-semibold text-[var(--primary)]">{target.label}{issue.page !== undefined ? ` · Invoice page ${issue.page}` : ""}</span>
                </span>
                <ArrowRight aria-hidden="true" className="mt-1 size-4 shrink-0 text-[var(--primary)]" />
              </button>)}
        </li>;
      })}
    </ol>
  </section>;
}
