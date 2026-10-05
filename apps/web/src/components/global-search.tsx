import { useQuery } from "@tanstack/react-query";
import {
  Boxes,
  Container,
  ReceiptText,
  Search,
  ShoppingBag,
  Truck,
  Users,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Drawer } from "vaul";
import { globalSearch } from "@/lib/api";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
const icons = {
  product: Boxes,
  sale: ReceiptText,
  purchase: ShoppingBag,
  container: Container,
  customer: Users,
  supplier: Truck,
};
export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const nav = useNavigate();
  const results = useQuery({
    queryKey: ["global-search", q],
    queryFn: () => globalSearch(q),
    enabled: q.trim().length >= 2,
  });
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, []);
  const choose = (path: string) => {
    setOpen(false);
    nav(path);
  };
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-11 w-full min-w-0 items-center gap-3 rounded-lg border border-[var(--input)] bg-white px-3 text-left text-sm text-[var(--muted)] shadow-sm outline-none transition hover:border-[var(--primary-border)] focus-visible:border-[var(--primary)] focus-visible:ring-2 focus-visible:ring-[rgb(37_99_235/0.16)] sm:px-4"
      >
        <Search className="size-4 text-[var(--accent)]" />
        <span className="min-w-0 flex-1 truncate">
          <span className="sm:hidden">Search...</span>
          <span className="hidden sm:inline">
            Search item, customer, container, invoice...
          </span>
        </span>
        <kbd className="hidden rounded border px-1.5 py-0.5 text-[10px] md:block">
          ⌘K
        </kbd>
      </button>
      <Drawer.Root open={open} onOpenChange={setOpen}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-50 bg-slate-950/35 backdrop-blur-[2px]" />
          <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 max-h-[92svh] rounded-t-2xl border-t border-[var(--border)] bg-white p-4 shadow-[var(--shadow-float)] outline-none md:left-1/2 md:top-24 md:bottom-auto md:max-w-xl md:-translate-x-1/2 md:rounded-xl md:border">
            <div className="mx-auto max-w-xl">
              <div className="flex items-center gap-2">
                <Search className="size-5 text-[var(--accent)]" />
                <Input
                  autoFocus
                  className="border-0 shadow-none"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search anything..."
                />
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setOpen(false)}
                >
                  <X className="size-4" />
                </Button>
              </div>
              <div className="mt-3 max-h-[65svh] space-y-2 overflow-auto">
                {q.length < 2 ? (
                  <p className="py-10 text-center text-sm text-[var(--muted)]">
                    Type at least two characters.
                  </p>
                ) : results.isLoading ? (
                  <p className="py-10 text-center text-sm text-[var(--muted)]">
                    Searching...
                  </p>
                ) : results.data?.length ? (
                  results.data.map((r) => {
                    const Icon = icons[r.type];
                    return (
                      <button
                        key={`${r.type}-${r.id}`}
                        type="button"
                        onClick={() => choose(r.path)}
                        className="flex min-h-15 w-full min-w-0 items-center gap-3 rounded-lg border border-transparent p-3 text-left transition hover:border-[var(--primary-border)] hover:bg-[var(--primary-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                      >
                        <span className="grid size-9 place-items-center rounded-lg bg-[var(--surface-warm)] text-[var(--accent)]">
                          <Icon className="size-4" />
                        </span>
                        <span>
                          <strong className="block text-sm">{r.title}</strong>
                          <span className="text-xs text-[var(--muted)]">
                            {r.subtitle}
                          </span>
                        </span>
                      </button>
                    );
                  })
                ) : (
                  <p className="py-10 text-center text-sm text-[var(--muted)]">
                    No matching records.
                  </p>
                )}
              </div>
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    </>
  );
}
