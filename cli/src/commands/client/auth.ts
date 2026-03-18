import { Command } from "commander";
import pc from "picocolors";
import readline from "node:readline";
import { readContext, resolveProfile, upsertProfile } from "../../client/context.js";
import { PaperclipApiClient } from "../../client/http.js";
import { addCommonClientOptions, handleCommandError, printOutput, resolveCommandContext, type BaseClientOptions } from "./common.js";

function prompt(label: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    rl.question(label, (answer) => { rl.close(); resolve(answer.trim()); });
  });
}

function extractSessionToken(res: Response): string | null {
  const cookies = res.headers.getSetCookie?.() ?? [res.headers.get("set-cookie") ?? ""];
  for (const c of cookies) {
    const m = c.match(/better-auth\.session_token=([^;]+)/);
    if (m) return m[1];
  }
  return null;
}

export function registerAuthClientCommands(auth: Command): void {
  // login
  addCommonClientOptions(
    auth.command("login").description("Authenticate with email and password")
      .option("--email <email>", "Email (omit to be prompted)")
      .option("--password <password>", "Password (omit to be prompted)")
  ).action(async (opts: BaseClientOptions & { email?: string; password?: string }) => {
    try {
      const email = opts.email || (await prompt("Email: "));
      const password = opts.password || (await prompt("Password: "));
      if (!email || !password) throw new Error("Email and password are required");

      const context = readContext(opts.context);
      const { profile } = resolveProfile(context, opts.profile);
      const apiBase = opts.apiBase?.trim() || process.env.PAPERCLIP_API_URL?.trim() || profile.apiBase || "http://localhost:3100";

      const response = await new PaperclipApiClient({ apiBase }).rawPost("/api/auth/sign-in/email", { email, password });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as Record<string, string>;
        const msg = body?.message || body?.error || "Invalid credentials";
        if (response.status === 404 || /not found|no user/i.test(msg))
          throw new Error("User not found — sign up via the Paperclip UI first, then use `auth login`.");
        throw new Error(msg);
      }

      const sessionToken = extractSessionToken(response);
      if (!sessionToken) throw new Error("Login succeeded but no session token was returned.");

      const userInfo = await new PaperclipApiClient({ apiBase, sessionToken }).get<{ name?: string; email?: string }>("/api/users/me");
      const { name: profileName } = resolveProfile(context, opts.profile);
      upsertProfile(profileName, { sessionToken, apiBase }, opts.context);
      console.log(pc.green(`Logged in as ${userInfo?.name || email} (${userInfo?.email || email})`));
    } catch (e) { handleCommandError(e); }
  });

  // create-key
  addCommonClientOptions(
    auth.command("create-key").description(
      "Create a Personal Access Token (PAT).\n" +
        "  Examples:\n" +
        "    paperclipai auth create-key --name my-key                     # create + store in profile\n" +
        "    paperclipai auth create-key --name ci-token --json            # JSON output for scripting",
    )
      .requiredOption("--name <name>", "Name for the API key")
  ).action(async (opts: BaseClientOptions & { name: string }) => {
    try {
      const ctx = resolveCommandContext(opts);
      const result = await ctx.api.post<any>("/api/users/me/api-keys", { name: opts.name });
      upsertProfile(ctx.profileName, { apiKey: result.key }, opts.context);

      // Best-effort membership check — warn if user has no company membership
      let membershipWarning: string | null = null;
      if (ctx.companyId) {
        try {
          const perms = await ctx.api.get<{ membershipRole: string | null; permissions: string[] }>(
            `/api/companies/${ctx.companyId}/my-permissions`,
          );
          if (perms && perms.membershipRole === null) {
            membershipWarning =
              "You have no company membership. This key won't have permissions for " +
              "agent management. Use `paperclipai member set-role` to fix.";
          }
        } catch {
          // Permission check is best-effort — don't fail key creation
        }
      }

      if (ctx.json) {
        const output: Record<string, unknown> = { ...result };
        if (membershipWarning) output.warning = membershipWarning;
        printOutput(output, { json: true });
        return;
      }
      console.log(pc.green(`Created API key: ${result.key}`));
      console.log(pc.dim(`Key stored in profile '${ctx.profileName}'. This key will not be shown again.`));
      console.log(pc.yellow("⚠  Context file contains secrets — keep chmod 600 and do not commit to git."));
      if (membershipWarning) {
        console.log(pc.yellow(`⚠  Warning: ${membershipWarning}`));
      }
    } catch (e) { handleCommandError(e); }
  });

  // whoami
  addCommonClientOptions(
    auth.command("whoami").description("Show current authenticated identity")
  ).action(async (opts: BaseClientOptions) => {
    try {
      const ctx = resolveCommandContext(opts);
      const me = await ctx.api.get<any>("/api/users/me");
      if (!me) throw new Error("Not authenticated. Run `paperclipai auth login` first.");
      if (ctx.json) { printOutput(me, { json: true }); return; }
      console.log(`User: ${me.name} (${me.email})`);
      if (me.companies?.length) console.log(`Companies: ${me.companies.map((c: any) => `${c.name}${c.role ? ` (${c.role})` : ""}`).join(", ")}`);
      const prefix = ctx.profile.apiKey?.slice(0, 14);
      console.log(`Auth: ${me.authSource ?? "unknown"}${prefix ? ` (${prefix}...)` : ""}`);
    } catch (e) { handleCommandError(e); }
  });

  // list-keys
  addCommonClientOptions(
    auth.command("list-keys").description("List your Personal Access Tokens")
  ).action(async (opts: BaseClientOptions) => {
    try {
      const ctx = resolveCommandContext(opts);
      const keys = await ctx.api.get<any[]>("/api/users/me/api-keys");
      if (!keys?.length) { ctx.json ? printOutput([], { json: true }) : console.log(pc.dim("No API keys. Create one with `paperclipai auth create-key --name <name>`.")); return; }
      if (ctx.json) { printOutput(keys, { json: true }); return; }
      const p = (s: string, w: number) => s.padEnd(w);
      const hdr = [p("ID", 10), p("Name", 16), p("Prefix", 16), p("Created", 12), p("Last Used", 12), p("Status", 10)].join("  ");
      console.log(pc.bold(hdr)); console.log("-".repeat(hdr.length));
      for (const k of keys) {
        const d = (s: string | null) => s ? new Date(s).toISOString().slice(0, 10) : "";
        console.log([p(k.id.slice(0, 8), 10), p(k.name, 16), p(k.keyPrefix, 16), p(d(k.createdAt), 12), p(d(k.lastUsedAt) || pc.dim("never"), 12), k.revokedAt ? pc.red("revoked") : pc.green("active")].join("  "));
      }
    } catch (e) { handleCommandError(e); }
  });

  // revoke-key
  addCommonClientOptions(
    auth.command("revoke-key").description("Revoke a Personal Access Token").argument("<keyId>", "API key ID")
  ).action(async (keyId: string, opts: BaseClientOptions) => {
    try {
      const ctx = resolveCommandContext(opts);
      await ctx.api.delete(`/api/users/me/api-keys/${keyId}`);
      ctx.json ? printOutput({ revoked: true, keyId }, { json: true }) : console.log(pc.green(`API key ${keyId} revoked.`));
    } catch (e) { handleCommandError(e); }
  });
}
