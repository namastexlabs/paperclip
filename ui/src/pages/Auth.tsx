import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "@/lib/router";
import { authApi } from "../api/auth";
import { healthApi } from "../api/health";
import { queryKeys } from "../lib/queryKeys";
import { Button } from "@/components/ui/button";
import { AsciiArtAnimation } from "@/components/AsciiArtAnimation";
import { Sparkles } from "lucide-react";

type AuthMode = "sign_in" | "sign_up" | "forgot";

export function AuthPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [mode, setMode] = useState<AuthMode>("sign_in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [forgotSent, setForgotSent] = useState(false);
  const [resetDone, setResetDone] = useState(false);

  const nextPath = useMemo(() => searchParams.get("next") || "/", [searchParams]);
  const resetToken = useMemo(() => searchParams.get("token") || "", [searchParams]);
  const isResetMode = searchParams.get("mode") === "reset" && resetToken.length > 0;

  const { data: session, isLoading: isSessionLoading } = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
    retry: false,
  });

  const healthQuery = useQuery({
    queryKey: queryKeys.health,
    queryFn: () => healthApi.get(),
    retry: false,
  });

  const hasUsers = healthQuery.data?.hasUsers ?? true;
  const emailConfigured = healthQuery.data?.emailConfigured ?? false;

  useEffect(() => {
    if (healthQuery.data && !healthQuery.data.hasUsers && !isResetMode) {
      setMode("sign_up");
    }
  }, [healthQuery.data, isResetMode]);

  useEffect(() => {
    if (session && !isResetMode) {
      navigate(nextPath, { replace: true });
    }
  }, [session, navigate, nextPath, isResetMode]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (mode === "sign_in") {
        await authApi.signInEmail({ email: email.trim(), password });
        return;
      }
      await authApi.signUpEmail({
        name: name.trim(),
        email: email.trim(),
        password,
      });
    },
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.auth.session });
      await queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
      navigate(nextPath, { replace: true });
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Authentication failed");
    },
  });

  const forgotMutation = useMutation({
    mutationFn: () => authApi.forgotPassword(email.trim()),
    onSuccess: () => {
      setError(null);
      setForgotSent(true);
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Failed to send reset email");
    },
  });

  const resetMutation = useMutation({
    mutationFn: () => authApi.resetPassword(resetToken, newPassword),
    onSuccess: () => {
      setError(null);
      setResetDone(true);
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Failed to reset password");
    },
  });

  const canSubmit =
    mode === "forgot"
      ? email.trim().length > 0
      : email.trim().length > 0 &&
        password.trim().length >= 8 &&
        (mode === "sign_in" || name.trim().length > 0);

  if (isSessionLoading || healthQuery.isLoading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading\u2026</p>
      </div>
    );
  }

  if (isResetMode) {
    if (resetDone) {
      return (
        <div className="fixed inset-0 flex bg-background">
          <div className="w-full md:w-1/2 flex flex-col overflow-y-auto">
            <div className="w-full max-w-md mx-auto my-auto px-8 py-12">
              <div className="flex items-center gap-2 mb-8">
                <Sparkles className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Paperclip</span>
              </div>
              <h1 className="text-xl font-semibold">Password reset successful</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Your password has been updated. You can now sign in with your new password.
              </p>
              <Button className="mt-4 w-full" onClick={() => navigate("/auth", { replace: true })}>
                Go to Sign In
              </Button>
            </div>
          </div>
          <div className="hidden md:block w-1/2 overflow-hidden">
            <AsciiArtAnimation />
          </div>
        </div>
      );
    }

    return (
      <div className="fixed inset-0 flex bg-background">
        <div className="w-full md:w-1/2 flex flex-col overflow-y-auto">
          <div className="w-full max-w-md mx-auto my-auto px-8 py-12">
            <div className="flex items-center gap-2 mb-8">
              <Sparkles className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Paperclip</span>
            </div>
            <h1 className="text-xl font-semibold">Set your new password</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Enter a new password (minimum 8 characters).
            </p>
            <form
              className="mt-6 space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                resetMutation.mutate();
              }}
            >
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">New Password</label>
                <input
                  className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  autoComplete="new-password"
                  autoFocus
                />
              </div>
              {error && <p className="text-xs text-destructive">{error}</p>}
              <Button
                type="submit"
                disabled={newPassword.length < 8 || resetMutation.isPending}
                className="w-full"
              >
                {resetMutation.isPending ? "Resetting\u2026" : "Reset Password"}
              </Button>
            </form>
          </div>
        </div>
        <div className="hidden md:block w-1/2 overflow-hidden">
          <AsciiArtAnimation />
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 flex bg-background">
      <div className="w-full md:w-1/2 flex flex-col overflow-y-auto">
        <div className="w-full max-w-md mx-auto my-auto px-8 py-12">
          <div className="flex items-center gap-2 mb-8">
            <Sparkles className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Paperclip</span>
          </div>

          <h1 className="text-xl font-semibold">
            {mode === "forgot"
              ? "Reset your password"
              : !hasUsers
                ? "Welcome to Paperclip"
                : mode === "sign_in"
                  ? "Sign in to Paperclip"
                  : "Create your Paperclip account"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {mode === "forgot"
              ? "Enter your email and we\u2019ll send you a reset link."
              : !hasUsers
                ? "Create the first account to get started."
                : mode === "sign_in"
                  ? "Use your email and password to access this instance."
                  : "Create an account for this instance. Email confirmation is not required in v1."}
          </p>

          {mode === "forgot" && forgotSent ? (
            <div className="mt-6">
              <div className="rounded-md border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
                Check your email for a password reset link. If you don\u2019t see it, check your spam folder.
              </div>
              <button
                type="button"
                className="mt-4 text-sm font-medium text-foreground underline underline-offset-2"
                onClick={() => {
                  setForgotSent(false);
                  setMode("sign_in");
                }}
              >
                Back to sign in
              </button>
            </div>
          ) : (
            <form
              className="mt-6 space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (mode === "forgot") {
                  forgotMutation.mutate();
                } else {
                  mutation.mutate();
                }
              }}
            >
              {mode === "sign_up" && (
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Name</label>
                  <input
                    className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    autoComplete="name"
                    autoFocus
                  />
                </div>
              )}
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Email</label>
                <input
                  className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  autoFocus={mode === "sign_in" || mode === "forgot"}
                />
              </div>
              {mode !== "forgot" && (
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Password</label>
                  <input
                    className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete={mode === "sign_in" ? "current-password" : "new-password"}
                  />
                </div>
              )}
              {mode === "forgot" && !emailConfigured && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Email is not configured on this instance. Password reset emails cannot be sent.
                </p>
              )}
              {error && <p className="text-xs text-destructive">{error}</p>}
              <Button
                type="submit"
                disabled={
                  !canSubmit ||
                  (mode === "forgot" ? forgotMutation.isPending : mutation.isPending)
                }
                className="w-full"
              >
                {mode === "forgot"
                  ? forgotMutation.isPending
                    ? "Sending\u2026"
                    : "Send Reset Link"
                  : mutation.isPending
                    ? "Working\u2026"
                    : mode === "sign_in"
                      ? "Sign In"
                      : "Create Account"}
              </Button>
            </form>
          )}

          {mode !== "forgot" && (
            <div className="mt-5 text-sm text-muted-foreground">
              {mode === "sign_in" ? "Need an account?" : "Already have an account?"}{" "}
              <button
                type="button"
                className="font-medium text-foreground underline underline-offset-2"
                onClick={() => {
                  setError(null);
                  setMode(mode === "sign_in" ? "sign_up" : "sign_in");
                }}
              >
                {mode === "sign_in" ? "Create one" : "Sign in"}
              </button>
            </div>
          )}

          {mode === "sign_in" && hasUsers && (
            <div className="mt-2">
              <button
                type="button"
                className="text-sm text-muted-foreground underline underline-offset-2"
                onClick={() => {
                  setError(null);
                  setMode("forgot");
                }}
              >
                Forgot password?
              </button>
            </div>
          )}

          {mode === "forgot" && !forgotSent && (
            <div className="mt-3">
              <button
                type="button"
                className="text-sm text-muted-foreground underline underline-offset-2"
                onClick={() => {
                  setError(null);
                  setForgotSent(false);
                  setMode("sign_in");
                }}
              >
                Back to sign in
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="hidden md:block w-1/2 overflow-hidden">
        <AsciiArtAnimation />
      </div>
    </div>
  );
}
