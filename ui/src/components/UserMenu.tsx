import { useNavigate } from "@/lib/router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { User, LogOut } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Identity } from "./Identity";
import { authApi } from "../api/auth";
import { healthApi } from "../api/health";
import { queryKeys } from "../lib/queryKeys";

export function UserMenu() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: health } = useQuery({
    queryKey: queryKeys.health,
    queryFn: () => healthApi.get(),
    retry: false,
  });

  const { data: session } = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
    enabled: health?.deploymentMode === "authenticated",
    retry: false,
  });

  // Hide in local_trusted mode (no auth)
  if (health?.deploymentMode !== "authenticated") return null;
  if (!session?.user) return null;

  const userName = session.user.name || "User";
  const userEmail = session.user.email || "";

  async function handleSignOut() {
    try {
      await authApi.signOut();
    } catch {
      // ignore
    }
    queryClient.clear();
    navigate("/auth");
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 px-3 py-2 hover:bg-accent/50 rounded-md transition-colors cursor-pointer w-full text-left"
        >
          <Identity name={userName} size="sm" />
          <div className="flex-1 min-w-0">
            {userEmail && (
              <p className="text-xs text-muted-foreground truncate">{userEmail}</p>
            )}
          </div>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-56">
        <DropdownMenuItem onClick={() => navigate("/account")}>
          <User className="h-4 w-4 mr-2" />
          Account Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleSignOut}>
          <LogOut className="h-4 w-4 mr-2" />
          Sign Out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
