import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, Eye, EyeOff, KeyRound, LogOut, Mail } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/features/auth/auth-context";
import { changePassword, getAccount, logout, updateAccount } from "@/lib/api";
import { SettingsField, SettingsLoading, SettingsPanel, SettingsRetry } from "./settings-components";

const emailSchema = z.object({ email: z.union([z.email("Enter a valid login email."), z.literal("")]) });
const passwordSchema = z.object({
  currentPassword: z.string().min(8, "Enter your current password (at least 8 characters)."),
  newPassword: z.string().min(8, "Use at least 8 characters."),
  confirmPassword: z.string().min(1, "Confirm your new password."),
}).refine((values) => values.newPassword === values.confirmPassword, { path: ["confirmPassword"], message: "New passwords do not match." });
type PasswordData = z.infer<typeof passwordSchema>;

export function AccountSettings({ active, storeDirty, onDirtyChange }: { active: boolean; storeDirty: boolean; onDirtyChange: (dirty: boolean) => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { user } = useAuth();
  const account = useQuery({ queryKey: ["account"], queryFn: getAccount, enabled: active });
  const email = useForm<{ email: string }>({ resolver: zodResolver(emailSchema), defaultValues: { email: "" } });
  const password = useForm<PasswordData>({ resolver: zodResolver(passwordSchema), defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" }, mode: "onBlur" });
  const emailDirty = email.formState.isDirty;
  const passwordDirty = password.formState.isDirty;
  useEffect(() => { onDirtyChange(emailDirty || passwordDirty); }, [emailDirty, passwordDirty, onDirtyChange]);
  useEffect(() => { if (account.data && !emailDirty) email.reset({ email: account.data.email ?? "" }); }, [account.data, email, emailDirty]);
  const watchedNew = password.watch("newPassword");
  const watchedConfirm = password.watch("confirmPassword");
  const emailSave = useMutation({ mutationFn: updateAccount, onSuccess: (result) => {
    qc.setQueryData(["account"], result);
    email.reset({ email: result.email ?? "" });
    void qc.invalidateQueries({ queryKey: ["auth"] });
    toast.success("Login email updated");
  }, onError: (error: Error) => toast.error(error.message) });
  const passwordSave = useMutation({ mutationFn: changePassword, onSuccess: () => {
    password.reset();
    toast.success("Password changed. Please sign in with your new password.");
    qc.setQueryData(["auth"], null);
    navigate("/login", { replace: true });
  }, onError: (error: Error) => toast.error(error.message) });

  if (account.isError) return <SettingsRetry message={account.error.message} retry={() => void account.refetch()} busy={account.isFetching} />;
  if (!account.data) return <SettingsLoading />;
  return <div className="settings-account-sections"><SettingsPanel title="Your account" description="Your store login and profile information." tag={user?.role === "OWNER" ? "Owner" : "Staff"}>
    <div className="settings-account-identity"><span>{(account.data.name || "A").slice(0, 1).toUpperCase()}</span><div><strong>{account.data.name}</strong><p>{account.data.username || "No username set"}</p></div></div>
    <form noValidate onSubmit={email.handleSubmit((values) => emailSave.mutate({ email: values.email.trim().toLowerCase() }))}><fieldset disabled={emailSave.isPending}><div className="settings-form-grid"><SettingsField id="account-username" label="Username" hint="Your existing username remains available for sign in."><Input id="account-username" value={account.data.username ?? ""} readOnly /></SettingsField><SettingsField id="account-email" label="Login email" hint="Separate from the store contact email." error={email.formState.errors.email?.message}><Input id="account-email" type="email" autoComplete="email" {...email.register("email")} aria-invalid={!!email.formState.errors.email} aria-describedby="account-email-hint account-email-error" /></SettingsField></div></fieldset>{emailSave.isError && <p className="settings-inline-error" role="alert">{emailSave.error.message}</p>}<div className="settings-account-actions"><Button disabled={!emailDirty || emailSave.isPending}><Mail size={15} aria-hidden="true" />{emailSave.isPending ? "Updating…" : "Update Email"}</Button><Button type="button" variant="ghost" disabled={!emailDirty || emailSave.isPending} onClick={() => { email.reset({ email: account.data.email ?? "" }); emailSave.reset(); }}>Discard</Button>{emailSave.isSuccess && !emailDirty && <span className="settings-inline-success"><Check size={14} aria-hidden="true" />Email updated</span>}</div></form>
  </SettingsPanel><SettingsPanel title="Change password" description="Use at least 8 characters. You will sign in again after a successful change.">
    <form noValidate onSubmit={password.handleSubmit((values) => { if (!storeDirty && !emailDirty) passwordSave.mutate({ currentPassword: values.currentPassword, newPassword: values.newPassword }); })}><fieldset disabled={passwordSave.isPending}><div className="settings-password-grid">{([
      ["currentPassword", "Current password", "current-password"], ["newPassword", "New password", "new-password"], ["confirmPassword", "Confirm new password", "new-password"],
    ] as const).map(([field, label, autocomplete]) => <SettingsField key={field} id={`account-${field}`} label={label} required error={password.formState.errors[field]?.message}><PasswordInput id={`account-${field}`} autoComplete={autocomplete} {...password.register(field)} aria-invalid={!!password.formState.errors[field]} aria-describedby={password.formState.errors[field] ? `account-${field}-error` : undefined} /></SettingsField>)}</div><div className="settings-password-rules"><span className={watchedNew.length >= 8 ? "complete" : ""}><Check size={13} aria-hidden="true" />At least 8 characters</span><span className={watchedConfirm && watchedNew === watchedConfirm ? "complete" : ""}><Check size={13} aria-hidden="true" />New passwords match</span></div></fieldset>{passwordSave.isError && <p className="settings-inline-error" role="alert">{passwordSave.error.message}</p>}{(storeDirty || emailDirty) && <p className="settings-hint settings-account-note">Save or discard pending store and email changes before changing your password.</p>}<div className="settings-account-actions"><Button disabled={!passwordDirty || passwordSave.isPending || storeDirty || emailDirty}><KeyRound size={15} aria-hidden="true" />{passwordSave.isPending ? "Changing…" : "Change Password"}</Button><Button type="button" variant="ghost" disabled={!passwordDirty || passwordSave.isPending} onClick={() => { password.reset(); passwordSave.reset(); }}>Clear fields</Button></div></form>
  </SettingsPanel></div>;
}

function PasswordInput(props: React.ComponentProps<typeof Input>) {
  const [visible, setVisible] = useState(false);
  return <div className="settings-password-input"><Input {...props} type={visible ? "text" : "password"} /><button type="button" aria-label={`${visible ? "Hide" : "Show"} password`} aria-pressed={visible} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}</button></div>;
}
export function SettingsSignOut({ dirty }: { dirty: boolean }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const signOut = useMutation({ mutationFn: logout, onSuccess: () => { qc.setQueryData(["auth"], null); navigate("/login", { replace: true }); toast.success("Signed out"); }, onError: (error: Error) => toast.error(error.message) });
  return <div className="settings-signout"><div><h3>Sign out of this device</h3><p>{dirty ? "Save or discard pending changes before signing out." : "Sign in again to continue working in your store."}</p>{signOut.isError && <p className="settings-field-error" role="alert">{signOut.error.message}</p>}</div><Button variant="outline" disabled={dirty || signOut.isPending} onClick={() => signOut.mutate()}><LogOut size={15} aria-hidden="true" />{signOut.isPending ? "Signing out…" : "Sign Out"}</Button></div>;
}
