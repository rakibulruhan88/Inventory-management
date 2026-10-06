import type { PurchaseDocumentSummary } from "@afia/contracts";
import { Button } from "@/components/ui/button";
import { documentContentUrl } from "@/lib/api";

export function SourceDocument({
  document,
}: {
  document: PurchaseDocumentSummary;
}) {
  return (
    <section
      aria-label="Source Commercial Invoice"
      className="mt-4 border-t border-[var(--border)] pt-3"
    >
      <h3 className="text-sm font-semibold">Source document</h3>
      <p className="mt-1 break-words text-sm">{document.originalFileName}</p>
      <p className="mt-1 text-xs text-[var(--muted)]">
        Commercial Invoice ·{" "}
        {document.mimeType === "application/pdf" ? "PDF" : "Image"}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button asChild variant="outline">
          <a
            href={documentContentUrl(document.id)}
            target="_blank"
            rel="noopener noreferrer"
          >
            View Source Invoice
          </a>
        </Button>
        <Button asChild variant="ghost">
          <a href={documentContentUrl(document.id, true)}>Download</a>
        </Button>
      </div>
    </section>
  );
}
