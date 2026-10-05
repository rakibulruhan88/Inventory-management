import { createContext, useContext } from "react";
import type { AuthUser } from "@afia/contracts";
export const AuthContext = createContext<{
  user: AuthUser | null;
  loading: boolean;
}>({ user: null, loading: true });
export const useAuth = () => useContext(AuthContext);
