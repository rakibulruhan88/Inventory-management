import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { ArrowRight, ChevronDown, Eye, EyeOff, HelpCircle, KeyRound, LoaderCircle, LockKeyhole, Package, ReceiptText, UserRound, UsersRound, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { login } from "@/lib/api";
import { useAuth } from "./auth-context";
import "./login.css";

type LoginErrors = { identifier?: string; password?: string };
const identifierError = (value: string) => value.trim() ? undefined : "Enter your email or username.";
const passwordError = (value: string) => value.length >= 8 ? undefined : value ? "Your password must have at least 8 characters." : "Enter your password.";

export function LoginPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [errors, setErrors] = useState<LoginErrors>({});
  const [online, setOnline] = useState(navigator.onLine);
  const identifierRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  const mutation = useMutation({
    mutationFn: login,
    onSuccess: (data) => {
      queryClient.setQueryData(["auth"], data);
      navigate((location.state as { from?: string } | null)?.from || "/dashboard", { replace: true });
    },
  });
  const busy = auth.loading || mutation.isPending || mutation.isSuccess;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !online) return;
    const next = { identifier: identifierError(identifier), password: passwordError(password) };
    setErrors(next);
    if (next.identifier) { identifierRef.current?.focus(); return; }
    if (next.password) { passwordRef.current?.focus(); return; }
    mutation.mutate({ identifier, password });
  };
  const checkCapsLock = (event: KeyboardEvent<HTMLInputElement>) => setCapsLock(event.getModifierState("CapsLock"));
  if (auth.user) return <Navigate to="/dashboard" replace />;

  return <main className="login-page">
    <header className="login-page-header"><div className="login-wordmark"><span className="login-monogram" aria-hidden="true">A<span>·</span></span><div><strong>Afia Leather</strong><span>Store workspace</span></div></div><p>Bangladesh <span aria-hidden="true">/</span> ৳ BDT</p></header>
    <div className="login-workspace">
      <aside className="login-brand-panel" aria-label="Afia Leather inventory workspace"><div className="login-brand-label"><span className="login-brand-rule" />INVENTORY & FINANCE</div><div className="login-brand-title"><p>Afia<span>Leather.</span></p><div className="login-brand-divider" /><h2>Stock, sales<br />and customer due.</h2><p className="login-brand-copy">Your shop’s daily records,<br />together in one workspace.</p></div><div className="login-brand-topics">{[
        { icon: Package, title: "Inventory", detail: "Item codes, colors, Rolls & Meter" },
        { icon: ReceiptText, title: "Sales & invoices", detail: "Sale records and payment details" },
        { icon: UsersRound, title: "Customer accounts", detail: "Due balances and payment history" },
      ].map(({ icon: Icon, title, detail }) => <div key={title}><Icon size={18} aria-hidden="true" /><div><strong>{title}</strong><span>{detail}</span></div></div>)}</div><div className="login-brand-footer"><span>AFIA LEATHER</span><span>BUSINESS WORKSPACE</span></div></aside>
      <section className="login-form-panel" aria-labelledby="login-heading"><div className="login-form-container"><div className="login-form-heading"><p>WELCOME BACK</p><h1 id="login-heading">Sign in to your store</h1><span>Use your email or username to continue.</span></div>
        <form onSubmit={submit} noValidate aria-busy={busy}><fieldset disabled={busy}>
          <div className="login-field"><label htmlFor="login-identifier">Email or username</label><div className={`login-input ${errors.identifier ? "has-error" : ""}`}><UserRound size={17} aria-hidden="true" /><Input id="login-identifier" ref={identifierRef} autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} required value={identifier} placeholder="Enter email or username" aria-invalid={!!errors.identifier} aria-describedby={errors.identifier ? "login-identifier-error" : undefined} onChange={(event) => { setIdentifier(event.target.value); if (errors.identifier) setErrors((current) => ({ ...current, identifier: identifierError(event.target.value) })); if (mutation.isError) mutation.reset(); }} onBlur={() => setErrors((current) => ({ ...current, identifier: identifierError(identifier) }))} /></div>{errors.identifier && <p className="login-field-error" id="login-identifier-error" role="alert">{errors.identifier}</p>}</div>
          <div className="login-field"><label htmlFor="login-password">Password</label><div className={`login-input login-password ${errors.password ? "has-error" : ""}`}><KeyRound size={17} aria-hidden="true" /><Input id="login-password" ref={passwordRef} type={visible ? "text" : "password"} autoComplete="current-password" required minLength={8} value={password} placeholder="Enter your password" aria-invalid={!!errors.password} aria-describedby={[errors.password ? "login-password-error" : "", capsLock ? "login-caps-lock" : ""].filter(Boolean).join(" ") || undefined} onChange={(event) => { setPassword(event.target.value); if (errors.password) setErrors((current) => ({ ...current, password: passwordError(event.target.value) })); if (mutation.isError) mutation.reset(); }} onKeyDown={checkCapsLock} onKeyUp={checkCapsLock} onBlur={() => { setCapsLock(false); setErrors((current) => ({ ...current, password: passwordError(password) })); }} /><button type="button" aria-label={visible ? "Hide password" : "Show password"} aria-pressed={visible} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}</button></div>{errors.password && <p className="login-field-error" id="login-password-error" role="alert">{errors.password}</p>}{capsLock && <p className="login-caps-lock" id="login-caps-lock" role="status">Caps Lock is on.</p>}</div>
        </fieldset>
        {mutation.isError && <div className="login-error-message" role="alert"><strong>Sign-in unsuccessful</strong><p>{mutation.error.message}</p></div>}
        {!online && <div className="login-offline-message" role="status"><WifiOff size={16} aria-hidden="true" /><p>You’re offline. Reconnect to sign in.</p></div>}
        <Button type="submit" className="login-submit" disabled={busy || !online}>{busy ? <><LoaderCircle size={17} className="animate-spin" aria-hidden="true" />{auth.loading ? "Checking saved sign-in…" : mutation.isSuccess ? "Opening your store…" : "Signing in…"}</> : <>Sign In<ArrowRight size={17} aria-hidden="true" /></>}</Button>
        {busy && <p className="sr-only" role="status">{auth.loading ? "Checking your saved session" : "Signing in and opening your store"}</p>}
        </form>
        <div className="login-session-note"><LockKeyhole size={16} aria-hidden="true" /><div><strong>This device remembers your sign-in</strong><p>Sign out when you finish on a shared device.</p></div></div>
        <details className="login-help"><summary><HelpCircle size={15} aria-hidden="true" /><span>Need help signing in?</span><ChevronDown size={14} className="login-help-chevron" aria-hidden="true" /></summary><div><p>Use your assigned username or the login email saved in Account settings.</p><p>If you’ve forgotten your password, contact the person who manages your store account.</p></div></details>
      </div></section>
    </div>
    <footer className="login-page-footer"><span>Afia Leather · Inventory & finance</span><span>Store access for authorised users</span></footer>
  </main>;
}
