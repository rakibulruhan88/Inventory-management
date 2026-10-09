import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search, ShieldCheck, UserRound } from "lucide-react";
import type { StaffAccount } from "@afia/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getStaff } from "@/lib/api";
import { StaffEditor } from "./staff-editor";
import "./team.css";
export function TeamPage() {
  const q = useQuery({ queryKey: ["staff"], queryFn: getStaff });
  const [search, setSearch] = useState("");
  const [selection, setSelection] = useState<StaffAccount | "new" | null>(null);
  const [filter, setFilter] = useState<"all" | "active" | "inactive">("all");
  const accounts = q.data ?? [];
  const rows = accounts.filter(
    (a) =>
      `${a.name} ${a.username ?? ""}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (filter === "all" || a.isActive === (filter === "active")),
  );
  return (
    <div className="team-page">
      <header className="team-page-header">
        <div>
          <p className="team-eyebrow">AFIA LEATHER / ADMINISTRATION</p>
          <h1>Team & Access</h1>
          <p>Give each person the right access to your store.</p>
        </div>
        <Button onClick={() => setSelection("new")}>
          <Plus size={17} />
          Add staff
        </Button>
      </header>
      <div className="team-summary">
        <ShieldCheck size={18} aria-hidden="true" />
        <p>
          <strong>Admin controls</strong>
          <span>
            {accounts.filter((a) => a.isActive).length} active staff ·{" "}
            {accounts.filter((a) => !a.isActive).length} inactive
          </span>
        </p>
        <span>Saved work is tracked in Activity</span>
      </div>
      <div className={`team-workspace ${selection ? "has-editor" : ""}`}>
        <section className="team-directory" aria-label="Staff directory">
          <div className="team-toolbar">
            <div className="team-search">
              <Search size={16} aria-hidden="true" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name or username"
                aria-label="Search staff"
              />
            </div>
            <div className="team-filter" aria-label="Account status">
              {(["all", "active", "inactive"] as const).map((value) => (
                <button
                  type="button"
                  key={value}
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value)}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>
          <div className="team-directory-heading">
            <span>Staff member</span>
            <span>Access</span>
          </div>
          {q.isPending ? (
            <div role="status" className="team-feedback">
              Loading staff accounts…
            </div>
          ) : q.isError ? (
            <div role="alert" className="team-feedback">
              <p>{q.error.message}</p>
              <Button variant="outline" onClick={() => q.refetch()}>
                Try again
              </Button>
            </div>
          ) : !rows.length ? (
            <div className="team-feedback">
              <UserRound size={24} aria-hidden="true" />
              <h2>
                {accounts.length
                  ? "No matching staff"
                  : "Your team starts here"}
              </h2>
              <p>
                {accounts.length
                  ? "Try a different name or status."
                  : "Create a staff account and choose what they can access."}
              </p>
              {!accounts.length && (
                <Button variant="outline" onClick={() => setSelection("new")}>
                  Add your first staff member
                </Button>
              )}
            </div>
          ) : (
            <div className="team-list">
              {rows.map((a) => (
                <button
                  type="button"
                  className={`team-row ${selection !== "new" && selection?.id === a.id ? "selected" : ""}`}
                  key={a.id}
                  onClick={() => setSelection(a)}
                >
                  <span className="team-avatar" aria-hidden="true">
                    {a.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="team-person">
                    <strong>{a.name}</strong>
                    <small>@{a.username ?? "No username"}</small>
                  </span>
                  <span className="team-row-meta">
                    <span
                      className={`team-badge ${a.isActive ? "active" : ""}`}
                    >
                      {a.isActive ? "Active" : "Inactive"}
                    </span>
                    <small>{a.permissions.length} permissions</small>
                  </span>
                </button>
              ))}
            </div>
          )}
          <p className="team-directory-note">
            Admin accounts are protected. Deleting staff keeps their business
            history.
          </p>
        </section>
        {selection && (
          <StaffEditor
            key={selection === "new" ? "new" : selection.id}
            account={selection === "new" ? null : selection}
            onSaved={setSelection}
            onCancel={() => setSelection(null)}
          />
        )}
      </div>
    </div>
  );
}
