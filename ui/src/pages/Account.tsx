import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { User } from "lucide-react";
import { Identity } from "../components/Identity";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api } from "../api/client";
import { queryKeys } from "../lib/queryKeys";
import { AvatarCropDialog } from "../components/AvatarCropDialog";

type UserProfile = {
  id: string;
  name: string;
  email: string;
  image: string | null;
  createdAt: string;
  memberships: Array<{
    companyId: string;
    membershipRole: string | null;
    status: string;
  }>;
};

type SessionInfo = {
  id: string;
  createdAt: string;
  expiresAt: string;
  ipAddress: string | null;
  userAgent: string | null;
  isCurrent: boolean;
};

function roleBadgeColor(role: string | null) {
  switch (role) {
    case "owner": return "bg-amber-500/10 text-amber-500 border-amber-500/20";
    case "admin": return "bg-blue-500/10 text-blue-500 border-blue-500/20";
    case "contributor": return "bg-green-500/10 text-green-500 border-green-500/20";
    case "viewer": return "bg-gray-500/10 text-gray-400 border-gray-500/20";
    default: return "bg-gray-500/10 text-gray-400 border-gray-500/20";
  }
}

function parseUserAgent(ua: string | null): string {
  if (!ua) return "Unknown device";
  if (ua.includes("Chrome")) return "Chrome";
  if (ua.includes("Firefox")) return "Firefox";
  if (ua.includes("Safari")) return "Safari";
  if (ua.includes("Edge")) return "Edge";
  return ua.slice(0, 40);
}

export function Account() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Avatar crop state
  const [cropFile, setCropFile] = useState<File | null>(null);

  // Profile state
  const [editName, setEditName] = useState<string | null>(null);
  const [editEmail, setEditEmail] = useState<string | null>(null);
  const [profileMsg, setProfileMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Password state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordMsg, setPasswordMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const profileQuery = useQuery({
    queryKey: ["users", "me"],
    queryFn: () => api.get<UserProfile>("/users/me"),
  });

  const sessionsQuery = useQuery({
    queryKey: ["users", "me", "sessions"],
    queryFn: () => api.get<SessionInfo[]>("/users/me/sessions"),
  });

  const updateProfile = useMutation({
    mutationFn: (body: { name?: string; email?: string }) =>
      api.patch<UserProfile>("/users/me", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users", "me"] });
      queryClient.invalidateQueries({ queryKey: queryKeys.auth.session });
      setEditName(null);
      setEditEmail(null);
      setProfileMsg({ type: "success", text: "Profile updated" });
    },
    onError: (err) => {
      setProfileMsg({ type: "error", text: err instanceof Error ? err.message : "Update failed" });
    },
  });

  const uploadAvatar = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return api.postForm<{ avatarUrl: string }>("/users/me/avatar", form);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users", "me"] });
      queryClient.invalidateQueries({ queryKey: queryKeys.auth.session });
    },
  });

  const changePassword = useMutation({
    mutationFn: (body: { currentPassword: string; newPassword: string }) =>
      api.post<{ success: boolean }>("/users/me/change-password", body),
    onSuccess: () => {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordMsg({ type: "success", text: "Password changed" });
    },
    onError: (err) => {
      setPasswordMsg({ type: "error", text: err instanceof Error ? err.message : "Failed" });
    },
  });

  const revokeSession = useMutation({
    mutationFn: (sessionId: string) =>
      api.post<{ revoked: boolean }>(`/users/me/sessions/${sessionId}/revoke`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users", "me", "sessions"] });
    },
  });

  const revokeAll = useMutation({
    mutationFn: () => api.post<{ revoked: boolean }>("/users/me/sessions/revoke-all", {}),
    onSuccess: () => {
      window.location.href = "/auth";
    },
  });

  const profile = profileQuery.data;
  const sessions = sessionsQuery.data ?? [];

  const isDirty =
    (editName !== null && editName !== (profile?.name ?? "")) ||
    (editEmail !== null && editEmail !== (profile?.email ?? ""));

  function handleProfileSave() {
    const updates: { name?: string; email?: string } = {};
    if (editName !== null) updates.name = editName;
    if (editEmail !== null) updates.email = editEmail;
    updateProfile.mutate(updates);
  }

  function handlePasswordChange() {
    setPasswordMsg(null);
    if (newPassword !== confirmPassword) {
      setPasswordMsg({ type: "error", text: "Passwords do not match" });
      return;
    }
    changePassword.mutate({ currentPassword, newPassword });
  }

  function handleAvatarClick() {
    fileInputRef.current?.click();
  }

  function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) setCropFile(file);
    // Reset input so the same file can be selected again after crop/cancel
    e.target.value = "";
  }

  function handleCropConfirm(blob: Blob) {
    const file = new File([blob], "avatar.jpg", { type: "image/jpeg" });
    uploadAvatar.mutate(file);
    setCropFile(null);
  }

  if (profileQuery.isLoading) {
    return <div className="max-w-2xl mx-auto p-6 text-sm text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 p-6">
      {/* Page header */}
      <div className="flex items-center gap-2">
        <User className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-lg font-semibold">Account Settings</h1>
      </div>

      {/* Profile section */}
      <div className="space-y-3">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Profile
        </div>
        <div className="rounded-md border border-border px-4 py-4 space-y-4">
          <div className="flex items-center gap-4">
            <Identity
              name={profile?.name ?? "User"}
              avatarUrl={profile?.image}
              size="lg"
            />
            <div>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleAvatarClick}
              >
                Change Avatar
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={handleAvatarChange}
              />
            </div>
          </div>

          <div>
            <label htmlFor="account-name" className="text-xs text-muted-foreground mb-1 block">Name</label>
            <input
              id="account-name"
              autoComplete="name"
              className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
              value={editName ?? profile?.name ?? ""}
              onChange={(e) => setEditName(e.target.value)}
            />
          </div>

          <div>
            <label htmlFor="account-email" className="text-xs text-muted-foreground mb-1 block">Email</label>
            <input
              id="account-email"
              autoComplete="email"
              className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
              value={editEmail ?? profile?.email ?? ""}
              onChange={(e) => setEditEmail(e.target.value)}
            />
          </div>

          {isDirty && (
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={handleProfileSave} disabled={updateProfile.isPending}>
                {updateProfile.isPending ? "Saving..." : "Save"}
              </Button>
              {profileMsg && (
                <span className={`text-xs ${profileMsg.type === "error" ? "text-destructive" : "text-muted-foreground"}`}>
                  {profileMsg.text}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Password section */}
      <div className="space-y-3">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Password
        </div>
        <div className="rounded-md border border-border px-4 py-4 space-y-4">
          <div>
            <label htmlFor="account-current-password" className="text-xs text-muted-foreground mb-1 block">Current password</label>
            <input
              id="account-current-password"
              type="password"
              autoComplete="current-password"
              className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="account-new-password" className="text-xs text-muted-foreground mb-1 block">New password</label>
            <input
              id="account-new-password"
              type="password"
              autoComplete="new-password"
              className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="account-confirm-password" className="text-xs text-muted-foreground mb-1 block">Confirm new password</label>
            <input
              id="account-confirm-password"
              type="password"
              autoComplete="new-password"
              className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={handlePasswordChange}
              disabled={!currentPassword || !newPassword || !confirmPassword || changePassword.isPending}
            >
              {changePassword.isPending ? "Changing..." : "Change Password"}
            </Button>
            {passwordMsg && (
              <span className={`text-xs ${passwordMsg.type === "error" ? "text-destructive" : "text-muted-foreground"}`}>
                {passwordMsg.text}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Active Sessions section */}
      <div className="space-y-3">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Active Sessions
        </div>
        <div className="rounded-md border border-border px-4 py-4 space-y-3">
          {sessionsQuery.isLoading && (
            <p className="text-sm text-muted-foreground">Loading sessions...</p>
          )}
          {sessions.map((s) => (
            <div
              key={s.id}
              className="rounded-md border border-border p-3 flex items-center justify-between"
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{parseUserAgent(s.userAgent)}</span>
                  {s.isCurrent && (
                    <Badge variant="outline" className="text-green-500 border-green-500/20">
                      Current
                    </Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  {s.ipAddress ?? "Unknown IP"} &middot; Active since{" "}
                  {new Date(s.createdAt).toLocaleDateString()}
                </div>
              </div>
              {!s.isCurrent && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
                  onClick={() => revokeSession.mutate(s.id)}
                  disabled={revokeSession.isPending}
                >
                  Revoke
                </Button>
              )}
            </div>
          ))}
          {sessions.length > 1 && (
            <Button
              size="sm"
              variant="destructive"
              onClick={() => revokeAll.mutate()}
              disabled={revokeAll.isPending}
            >
              Sign Out Everywhere
            </Button>
          )}
        </div>
      </div>

      {/* Avatar crop dialog */}
      <AvatarCropDialog
        file={cropFile}
        onConfirm={handleCropConfirm}
        onCancel={() => setCropFile(null)}
      />

      {/* Company Memberships section */}
      {profile?.memberships && profile.memberships.length > 0 && (
        <div className="space-y-3">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Company Memberships
          </div>
          <div className="rounded-md border border-border px-4 py-4 space-y-2">
            {profile.memberships.map((m) => (
              <div
                key={m.companyId}
                className="flex items-center justify-between py-1"
              >
                <span className="text-sm font-medium">{m.companyId}</span>
                <span
                  className={`rounded-full border px-2 py-0.5 text-xs font-medium ${roleBadgeColor(m.membershipRole)}`}
                >
                  {m.membershipRole ?? "unknown"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
