import { hasPermission, type Permission } from "@afia/contracts";
import { useAuth } from "./auth-context";
export function Permit({
  permission,
  children,
}: {
  permission: Permission;
  children: React.ReactNode;
}) {
  return hasPermission(useAuth().user, permission) ? children : null;
}
