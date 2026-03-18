import { Command } from "commander";
import { ROLE_PRESETS, MEMBERSHIP_ROLES, type MembershipRole } from "@paperclipai/shared";
import pc from "picocolors";
import {
  addCommonClientOptions,
  formatInlineRecord,
  handleCommandError,
  printOutput,
  resolveCommandContext,
  type BaseClientOptions,
} from "./common.js";

const VALID_ROLES: readonly string[] = MEMBERSHIP_ROLES;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MemberListOptions extends BaseClientOptions {
  companyId?: string;
}

interface MemberSetRoleOptions extends BaseClientOptions {
  companyId?: string;
}

interface CompanyMember {
  id: string;
  companyId: string;
  principalType: string;
  principalId: string;
  status: string;
  membershipRole: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerMemberCommands(program: Command): void {
  const member = program
    .command("member")
    .description("Company member and permission management");

  // ---- member list --------------------------------------------------------

  addCommonClientOptions(
    member
      .command("list")
      .description(
        "List company members with their roles and status.\n" +
          "  Examples:\n" +
          "    paperclipai member list -C <companyId>\n" +
          "    paperclipai member list -C <companyId> --json\n" +
          "    paperclipai member list -C <companyId> --json | jq '.[].membershipRole'",
      )
      .requiredOption("-C, --company-id <id>", "Company ID")
      .action(async (opts: MemberListOptions) => {
        try {
          const ctx = resolveCommandContext(opts, { requireCompany: true });
          const members =
            (await ctx.api.get<CompanyMember[]>(
              `/api/companies/${ctx.companyId}/members`,
            )) ?? [];

          if (ctx.json) {
            printOutput(members, { json: true });
            return;
          }

          if (members.length === 0) {
            console.log(pc.dim("No members found."));
            return;
          }

          for (const m of members) {
            console.log(
              formatInlineRecord({
                id: m.id,
                principalType: m.principalType,
                principalId: m.principalId,
                role: m.membershipRole ?? "-",
                status: m.status,
              }),
            );
          }
        } catch (err) {
          handleCommandError(err);
        }
      }),
    { includeCompany: false },
  );

  // ---- member set-role ----------------------------------------------------

  addCommonClientOptions(
    member
      .command("set-role")
      .description(
        "Set a member's role and grant the corresponding permission preset.\n" +
          "  Roles: owner, admin, contributor, viewer\n" +
          "  Examples:\n" +
          "    paperclipai member set-role <memberId> owner -C <companyId>\n" +
          "    paperclipai member set-role <principalId> admin -C <companyId> --json",
      )
      .argument(
        "<identifier>",
        "Member ID or principal ID (user/agent UUID)",
      )
      .argument(
        "<role>",
        `Role to assign (${VALID_ROLES.join(", ")})`,
      )
      .requiredOption("-C, --company-id <id>", "Company ID")
      .action(
        async (
          identifier: string,
          role: string,
          opts: MemberSetRoleOptions,
        ) => {
          try {
            const ctx = resolveCommandContext(opts, {
              requireCompany: true,
            });

            if (!VALID_ROLES.includes(role)) {
              throw new Error(
                `Invalid role: ${role}. Valid roles: ${VALID_ROLES.join(", ")}`,
              );
            }

            // Resolve identifier → memberId
            // The PATCH endpoint requires memberId, but users may pass a principalId.
            // Fetch the member list and try to match by id or principalId.
            const members =
              (await ctx.api.get<CompanyMember[]>(
                `/api/companies/${ctx.companyId}/members`,
              )) ?? [];

            const match =
              members.find((m) => m.id === identifier) ??
              members.find((m) => m.principalId === identifier);

            const memberId = match?.id ?? identifier;

            const grants = (ROLE_PRESETS[role as MembershipRole] ?? []).map((k) => ({
              permissionKey: k,
            }));

            const result = await ctx.api.patch<CompanyMember>(
              `/api/companies/${ctx.companyId}/members/${memberId}/permissions`,
              { grants, membershipRole: role },
            );

            if (ctx.json) {
              printOutput(result, { json: true });
              return;
            }

            if (result) {
              console.log(
                formatInlineRecord({
                  id: result.id,
                  principalType: result.principalType,
                  principalId: result.principalId,
                  role: result.membershipRole ?? "-",
                  status: result.status,
                }),
              );
              console.log(
                pc.green(
                  `Role set to ${role} with ${grants.length} permission grant(s).`,
                ),
              );
            }
          } catch (err) {
            handleCommandError(err);
          }
        },
      ),
    { includeCompany: false },
  );
}
