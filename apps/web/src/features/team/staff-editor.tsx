import { StaffWorkSummary } from "./staff-work-summary";
import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, Save, ShieldCheck, Trash2 } from "lucide-react";
import {
  expandPermissions,
  permissionGroups,
  permissionDependencies,
  staffPresets,
  type Permission,
  type StaffAccount,
  type StaffInput,
} from "@afia/contracts";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveStaff, deleteStaff } from "@/lib/api";
import { Drawer } from "vaul";
export function StaffEditor({
  account,
  onSaved,
  onCancel,
}: {
  account: StaffAccount | null;
  onSaved: (account: StaffAccount) => void;
  onCancel: () => void;
}) {
  const qc = useQueryClient();
  const [input, setInput] = useState<StaffInput>({
    name: "",
    username: "",
    password: "",
    isActive: true,
    permissions: [],
  });
  const [showPassword, setShowPassword] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setInput(
      account
        ? {
            name: account.name,
            username: account.username ?? "",
            password: "",
            isActive: account.isActive,
            permissions: account.permissions,
          }
        : {
            name: "",
            username: "",
            password: "",
            isActive: true,
            permissions: [],
          },
    );
    setShowPassword(false);
    setError("");
  }, [account]);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["staff"] });
    void qc.invalidateQueries({ queryKey: ["activity"] });
  };
  const save = useMutation({
    mutationFn: () =>
      saveStaff(account?.id, {
        ...input,
        name: input.name.trim(),
        username: input.username.trim(),
        password: input.password || undefined,
      }),
    onSuccess: (result) => {
      refresh();
      toast.success(
        account ? "Staff account updated" : "Staff account created",
      );
      setInput((p) => ({ ...p, password: "" }));
      onSaved(result);
    },
    onError: (e: Error) => setError(e.message),
  });
  const remove = useMutation({
    mutationFn: () => deleteStaff(account!.id),
    onSuccess: () => {
      refresh();
      toast.success("Staff account deleted");
      setConfirmDelete(false);
      onCancel();
    },
    onError: (e: Error) => {
      setConfirmDelete(false);
      setError(e.message);
    },
  });
  function toggle(key: Permission, enabled: boolean) {
    setInput((prev) => {
      if (enabled)
        return {
          ...prev,
          permissions: expandPermissions([...prev.permissions, key]),
        };
      let selected = prev.permissions.filter((p) => p !== key);
      // Removing a prerequisite also removes actions that depend on it.
      let changed = true;
      while (changed) {
        const next = selected.filter((p) =>
          (permissionDependencies[p] ?? []).every((dep) =>
            selected.includes(dep),
          ),
        );
        changed = next.length !== selected.length;
        selected = next;
      }
      return { ...prev, permissions: selected };
    });
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (
      !input.name.trim() ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,49}$/.test(input.username)
    ) {
      setError(
        "Enter a name and a username with 3–50 letters, numbers, dots, dashes or underscores.",
      );
      return;
    }
    if (
      (!account || input.password) &&
      ((input.password?.length ?? 0) < 8 || (input.password?.length ?? 0) > 72)
    ) {
      setError("Use a password with 8–72 characters.");
      return;
    }
    if (!save.isPending) save.mutate();
  }
  return (
    <section className="team-editor" aria-labelledby="staff-editor-title">
      <header className="team-editor-header">
        <div>
          <p className="team-eyebrow">
            {account ? "STAFF ACCOUNT" : "NEW ACCOUNT"}
          </p>
          <h2 id="staff-editor-title">
            {account ? account.name : "Add staff"}
          </h2>
        </div>
        <Button
          variant="ghost"
          onClick={onCancel}
          disabled={save.isPending || remove.isPending}
        >
          Close
        </Button>
      </header>
      {account && <StaffWorkSummary id={account.id} />}
      <form onSubmit={submit}>
        <fieldset
          disabled={save.isPending || remove.isPending}
          className="team-form"
        >
          <div className="team-credentials">
            <label htmlFor="staff-name">
              Full name
              <Input
                id="staff-name"
                value={input.name}
                required
                maxLength={100}
                autoComplete="off"
                onChange={(e) =>
                  setInput((p) => ({ ...p, name: e.target.value }))
                }
              />
            </label>
            <label htmlFor="staff-username">
              Username
              <Input
                id="staff-username"
                value={input.username}
                required
                minLength={3}
                maxLength={50}
                autoCapitalize="none"
                autoComplete="off"
                spellCheck={false}
                onChange={(e) =>
                  setInput((p) => ({ ...p, username: e.target.value }))
                }
              />
              <small>
                Used to sign in. Letters, numbers, dots, dashes and underscores.
              </small>
            </label>
            <label htmlFor="staff-password">
              {account ? "Reset password (optional)" : "Initial password"}
              <div className="team-password">
                <Input
                  id="staff-password"
                  type={showPassword ? "text" : "password"}
                  value={input.password}
                  autoComplete="new-password"
                  required={!account}
                  minLength={8}
                  maxLength={72}
                  onChange={(e) =>
                    setInput((p) => ({ ...p, password: e.target.value }))
                  }
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </Button>
              </div>
              <small>
                {account
                  ? "Leave blank to keep the current password."
                  : "At least 8 characters. Share the login details with this staff member."}
              </small>
            </label>
          </div>
          <label className="team-status-control">
            <input
              type="checkbox"
              checked={input.isActive}
              onChange={(e) =>
                setInput((p) => ({ ...p, isActive: e.target.checked }))
              }
            />
            <span>
              <strong>Account active</strong>
              <small>
                Inactive staff cannot sign in or use existing sessions.
              </small>
            </span>
          </label>
          <section
            className="team-access"
            aria-labelledby="staff-access-heading"
          >
            <div className="team-access-heading">
              <div>
                <h3 id="staff-access-heading">Access permissions</h3>
                <p>Choose the work this person can do.</p>
              </div>
              <span>{input.permissions.length} enabled</span>
            </div>
            <div className="team-presets" aria-label="Permission presets">
              {staffPresets.map((p) => (
                <Button
                  key={p.name}
                  type="button"
                  variant="outline"
                  onClick={() =>
                    setInput((prev) => ({
                      ...prev,
                      permissions: [...p.permissions],
                    }))
                  }
                >
                  {p.name}
                </Button>
              ))}
              <Button
                type="button"
                variant="ghost"
                onClick={() => setInput((p) => ({ ...p, permissions: [] }))}
              >
                Clear access
              </Button>
            </div>
            <p className="team-access-note">
              <ShieldCheck size={16} aria-hidden="true" /> Staff management,
              Activity and store settings remain admin-only. Required viewing
              access is included with each action.
            </p>
            <div className="team-permission-groups">
              {permissionGroups.map((group) => (
                <fieldset key={group.label} className="team-permission-group">
                  <legend>{group.label}</legend>
                  {group.permissions.map((p) => (
                    <label key={p.key}>
                      <input
                        type="checkbox"
                        checked={input.permissions.includes(p.key)}
                        onChange={(e) => toggle(p.key, e.target.checked)}
                      />
                      <span>{p.label}</span>
                    </label>
                  ))}
                </fieldset>
              ))}
            </div>
          </section>
          {error && (
            <p role="alert" className="team-error">
              {error}
            </p>
          )}
          <footer className="team-save-bar">
            <p>
              {account
                ? "Saving signs this staff member out on every device."
                : "Only the selected access will be available after sign-in."}
            </p>
            <Button type="submit">
              <Save size={16} />
              {save.isPending
                ? "Saving…"
                : account
                  ? "Save changes"
                  : "Create staff"}
            </Button>
          </footer>
          {account && (
            <div className="team-delete-area">
              <div>
                <strong>Delete staff account</strong>
                <p>
                  Access ends immediately. Invoices, payments and activity
                  history are retained.
                </p>
              </div>
              <Button
                type="button"
                variant="danger"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 size={16} />
                Delete staff
              </Button>
            </div>
          )}
        </fieldset>
      </form>
      <Drawer.Root
        open={confirmDelete}
        onOpenChange={(open) => {
          if (!remove.isPending) setConfirmDelete(open);
        }}
      >
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-50 bg-black/35" />
          <Drawer.Content className="team-delete-dialog fixed inset-x-0 bottom-0 z-50 border-t border-[var(--border)] bg-[var(--surface)] p-6 outline-none">
            <div className="mx-auto max-w-lg">
              <Drawer.Title className="text-xl font-semibold">
                Delete {account?.name}?
              </Drawer.Title>
              <Drawer.Description className="my-4 text-sm text-[var(--muted)]">
                This person will lose access immediately. Their saved work and
                document attribution remain in your business history.
              </Drawer.Description>
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  disabled={remove.isPending}
                  onClick={() => setConfirmDelete(false)}
                >
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate()}
                >
                  {remove.isPending ? "Deleting…" : "Delete staff account"}
                </Button>
              </div>
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    </section>
  );
}
