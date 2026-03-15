import { useMemo } from "react";
import { NavLink, useLocation } from "@/lib/router";
import {
  House,
  CircleDot,
  SquarePen,
  Users,
  Inbox,
  User,
  LogOut,
} from "lucide-react";
import { useCompany } from "../context/CompanyContext";
import { useDialog } from "../context/DialogContext";
import { cn } from "../lib/utils";
import { useInboxBadge } from "../hooks/useInboxBadge";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@/lib/router";
import { authApi } from "../api/auth";
import { healthApi } from "../api/health";
import { queryKeys } from "../lib/queryKeys";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface MobileBottomNavProps {
  visible: boolean;
}

interface MobileNavLinkItem {
  type: "link";
  to: string;
  label: string;
  icon: typeof House;
  badge?: number;
}

interface MobileNavActionItem {
  type: "action";
  label: string;
  icon: typeof SquarePen;
  onClick: () => void;
}

type MobileNavItem = MobileNavLinkItem | MobileNavActionItem;

function deriveInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export function MobileBottomNav({ visible }: MobileBottomNavProps) {
  const location = useLocation();
  const { selectedCompanyId } = useCompany();
  const { openNewIssue } = useDialog();
  const inboxBadge = useInboxBadge(selectedCompanyId);
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

  const isAuthenticated = health?.deploymentMode === "authenticated" && !!session?.user;

  async function handleSignOut() {
    try { await authApi.signOut(); } catch { /* ignore */ }
    queryClient.clear();
    navigate("/auth");
  }

  const items = useMemo<MobileNavItem[]>(
    () => [
      { type: "link", to: "/dashboard", label: "Home", icon: House },
      { type: "link", to: "/issues", label: "Issues", icon: CircleDot },
      { type: "action", label: "Create", icon: SquarePen, onClick: () => openNewIssue() },
      { type: "link", to: "/agents/all", label: "Agents", icon: Users },
      {
        type: "link",
        to: "/inbox",
        label: "Inbox",
        icon: Inbox,
        badge: inboxBadge.inbox,
      },
    ],
    [openNewIssue, inboxBadge.inbox],
  );

  return (
    <nav
      className={cn(
        "fixed bottom-0 left-0 right-0 z-30 border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85 transition-transform duration-200 ease-out md:hidden pb-[env(safe-area-inset-bottom)]",
        visible ? "translate-y-0" : "translate-y-full",
      )}
      aria-label="Mobile navigation"
    >
      <div className={cn("grid h-16 px-1", isAuthenticated ? "grid-cols-6" : "grid-cols-5")}>
        {items.map((item) => {
          if (item.type === "action") {
            const Icon = item.icon;
            const active = /\/issues\/new(?:\/|$)/.test(location.pathname);
            return (
              <button
                key={item.label}
                type="button"
                onClick={item.onClick}
                className={cn(
                  "relative flex min-w-0 flex-col items-center justify-center gap-1 rounded-md text-[10px] font-medium transition-colors",
                  active
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-[18px] w-[18px]" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          }

          const Icon = item.icon;
          return (
            <NavLink
              key={item.label}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  "relative flex min-w-0 flex-col items-center justify-center gap-1 rounded-md text-[10px] font-medium transition-colors",
                  isActive
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span className="relative">
                    <Icon className={cn("h-[18px] w-[18px]", isActive && "stroke-[2.3]")} />
                    {item.badge != null && item.badge > 0 && (
                      <span className="absolute -right-2 -top-2 rounded-full bg-primary px-1.5 py-0.5 text-[10px] leading-none text-primary-foreground">
                        {item.badge > 99 ? "99+" : item.badge}
                      </span>
                    )}
                  </span>
                  <span className="truncate">{item.label}</span>
                </>
              )}
            </NavLink>
          );
        })}
        {isAuthenticated && session?.user && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="relative flex min-w-0 flex-col items-center justify-center gap-1 rounded-md text-[10px] font-medium text-muted-foreground hover:text-foreground transition-colors"
                aria-label="User menu"
              >
                <Avatar size="xs">
                  {session.user.image && <AvatarImage src={session.user.image} alt={session.user.name || "User"} />}
                  <AvatarFallback className="text-[8px]">{deriveInitials(session.user.name || "User")}</AvatarFallback>
                </Avatar>
                <span className="truncate">Me</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="end" sideOffset={8} className="w-48">
              <div className="px-2 py-1.5">
                <p className="text-sm font-medium">{session.user.name || "User"}</p>
                {session.user.email && (
                  <p className="text-xs text-muted-foreground truncate">{session.user.email}</p>
                )}
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => navigate(`/account`)}>
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
        )}
      </div>
    </nav>
  );
}
