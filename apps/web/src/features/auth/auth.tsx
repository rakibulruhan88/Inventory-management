import { canOpenPage, firstAccessiblePage } from "@afia/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LoaderCircle, LogOut } from "lucide-react";
import { useEffect } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { getMe, logout } from "@/lib/api";
import { AuthContext, useAuth } from "./auth-context";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ["auth"], queryFn: ({ signal }) => getMe(signal), retry: false, networkMode: "always", refetchInterval: 30000, refetchOnWindowFocus: "always" });
  useEffect(() => {
    const clear = () => { queryClient.removeQueries({ predicate: query => query.queryKey[0] !== "auth" }); queryClient.setQueryData(["auth"], { user: null }); };
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
export function SignOutButton({ compact = false }: { compact?: boolean }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const mutation = useMutation({
    mutationFn: logout,
    onSuccess: async () => {
      await queryClient.cancelQueries({ queryKey: ["auth"] });
      queryClient.removeQueries({ predicate: query => query.queryKey[0] !== "auth" });
      queryClient.setQueryData(["auth"], { user: null });
      navigate("/login");
      toast.success("Signed out");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  return (
    <button
      type="button"
      className={compact ? "desktop-signout" : "flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-sm text-[var(--muted)] hover:bg-white"}
      aria-label={mutation.isPending ? "Signing out" : "Sign Out"}
      title={mutation.isPending ? "Signing out…" : "Sign Out"}
      disabled={mutation.isPending}
      onClick={() => mutation.mutate()}
    >
      {mutation.isPending ? <LoaderCircle aria-hidden="true" className="size-[18px] animate-spin" /> : <LogOut aria-hidden="true" className="size-[18px]" />}{!compact && (mutation.isPending ? "Signing out…" : "Sign Out")}
    </button>
  );
}
export { LoginPage } from "./login-page";

export function AccessBoundary({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { pathname } = useLocation();
  if (pathname === '/') return <Navigate to={firstAccessiblePage(user)} replace />;
  if (!canOpenPage(user, pathname)) return <div className="p-6"><h1 className="text-xl font-semibold">Access unavailable</h1><p className="my-3 text-sm text-[var(--muted)]">Ask your admin to enable access to this page.</p><a className="text-sm text-[var(--primary)] underline" href={firstAccessiblePage(user)}>Go to your workspace</a></div>;
  return children;
}
