import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LogIn, LogOut } from "lucide-react";
import { useEffect, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getMe, login, logout } from "@/lib/api";
import { AuthContext, useAuth } from "./auth-context";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ["auth"], queryFn: getMe, retry: false });
  useEffect(() => {
    const clear = () => queryClient.setQueryData(["auth"], null);
    window.addEventListener("afia:unauthorized", clear);
    return () => window.removeEventListener("afia:unauthorized", clear);
  }, [queryClient]);
  return (
    <AuthContext.Provider
      value={{ user: me.data?.user ?? null, loading: me.isLoading }}
    >
      {children}
    </AuthContext.Provider>
  );
}
export function Protected({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const location = useLocation();
  if (auth.loading)
    return (
      <div className="grid min-h-svh place-items-center text-sm text-[var(--muted)]">
        Opening your store…
      </div>
    );
  return auth.user ? (
    children
  ) : (
    <Navigate to="/login" state={{ from: location.pathname }} replace />
  );
}
export function SignOutButton() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const mutation = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      queryClient.setQueryData(["auth"], null);
      navigate("/login");
      toast.success("Signed out");
    },
  });
  return (
    <button
      className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-sm text-[var(--muted)] hover:bg-white"
      onClick={() => mutation.mutate()}
    >
      <LogOut className="size-[18px]" /> Sign Out
    </button>
  );
}
export function LoginPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const mutation = useMutation({
    mutationFn: login,
    onSuccess: (data) => {
      queryClient.setQueryData(["auth"], data);
      navigate(
        (location.state as { from?: string } | null)?.from || "/dashboard",
        { replace: true },
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });
  if (auth.user) return <Navigate to="/dashboard" replace />;
  return (
    <main className="relative grid min-h-svh place-items-center overflow-hidden bg-[var(--page)] p-5">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(circle_at_top,rgb(37_99_235/0.16),transparent_68%)]" />
      <div className="pointer-events-none absolute -right-24 top-20 size-72 rounded-full bg-indigo-200/25 blur-3xl" />
      <form
        className="relative w-full max-w-sm rounded-2xl border border-[var(--border)] bg-white p-6 shadow-[0_24px_60px_rgb(15_23_42/0.10)] sm:p-8"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate({ identifier, password });
        }}
      >
        <img
          src="/apple-touch-icon.png"
          alt="Afia Leather logo"
          className="mx-auto size-14 rounded-xl object-contain shadow-lg shadow-slate-200/70"
        />
        <h1 className="mt-5 text-center text-2xl font-bold">Afia Leather</h1>
        <p className="mt-1 text-center text-sm text-[var(--muted)]">
          Sign in to manage the store
        </p>
        <label className="mt-6 block text-sm font-medium">
          Email or Username
          <Input
            className="mt-2"
            autoComplete="username"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
          />
        </label>
        <label className="mt-4 block text-sm font-medium">
          Password
          <Input
            className="mt-2"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <Button
          variant="premium"
          className="mt-6 w-full"
          disabled={
            !identifier.trim() || password.length < 8 || mutation.isPending
          }
        >
          {mutation.isPending ? (
            "Signing in…"
          ) : (
            <>
              <LogIn className="size-4" /> Sign In
            </>
          )}
        </Button>
      </form>
    </main>
  );
}
