import { Command } from "commander";
import type { Agent } from "@paperclipai/shared";
import {
  removeMaintainerOnlySkillSymlinks,
  resolvePaperclipSkillsDir,
} from "@paperclipai/adapter-utils/server-utils";
import * as p from "@clack/prompts";
import pc from "picocolors";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  addCommonClientOptions,
  formatInlineRecord,
  handleCommandError,
  printOutput,
  resolveCommandContext,
  type BaseClientOptions,
} from "./common.js";
import { ApiRequestError } from "../../client/http.js";

interface AgentListOptions extends BaseClientOptions {
  companyId?: string;
}

interface AgentCreateOptions extends BaseClientOptions {
  companyId?: string;
  name: string;
  role?: string;
  title?: string;
  reportsTo?: string;
  adapterType?: string;
  adapterConfig?: string;
  runtimeConfig?: string;
  budget?: string;
  cwd?: string;
  model?: string;
  instructionsFile?: string;
}

interface AgentHireResponse {
  agent: Agent;
  approval: { id: string; type: string; status: string } | null;
}

interface AgentImportOptions extends BaseClientOptions {
  companyId?: string;
  dryRun?: boolean;
  setupKeys?: boolean;
  role?: string;
  adapterType?: string;
  name?: string;
  reportsTo?: string;
  budget?: string;
}

interface AgentLocalCliOptions extends BaseClientOptions {
  companyId?: string;
  keyName?: string;
  installSkills?: boolean;
  create?: boolean;
  role?: string;
  model?: string;
  cwd?: string;
}

interface CreatedAgentKey {
  id: string;
  name: string;
  token: string;
  createdAt: string;
}

interface SkillsInstallSummary {
  tool: "codex" | "claude";
  target: string;
  linked: string[];
  removed: string[];
  skipped: string[];
  failed: Array<{ name: string; error: string }>;
}

const __moduleDir = path.dirname(fileURLToPath(import.meta.url));

function codexSkillsHome(): string {
  const fromEnv = process.env.CODEX_HOME?.trim();
  const base = fromEnv && fromEnv.length > 0 ? fromEnv : path.join(os.homedir(), ".codex");
  return path.join(base, "skills");
}

function claudeSkillsHome(): string {
  const fromEnv = process.env.CLAUDE_HOME?.trim();
  const base = fromEnv && fromEnv.length > 0 ? fromEnv : path.join(os.homedir(), ".claude");
  return path.join(base, "skills");
}

async function installSkillsForTarget(
  sourceSkillsDir: string,
  targetSkillsDir: string,
  tool: "codex" | "claude",
): Promise<SkillsInstallSummary> {
  const summary: SkillsInstallSummary = {
    tool,
    target: targetSkillsDir,
    linked: [],
    removed: [],
    skipped: [],
    failed: [],
  };

  await fs.mkdir(targetSkillsDir, { recursive: true });
  const entries = await fs.readdir(sourceSkillsDir, { withFileTypes: true });
  summary.removed = await removeMaintainerOnlySkillSymlinks(
    targetSkillsDir,
    entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name),
  );
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const source = path.join(sourceSkillsDir, entry.name);
    const target = path.join(targetSkillsDir, entry.name);
    const existing = await fs.lstat(target).catch(() => null);
    if (existing) {
      if (existing.isSymbolicLink()) {
        let linkedPath: string | null = null;
        try {
          linkedPath = await fs.readlink(target);
        } catch (err) {
          await fs.unlink(target);
          try {
            await fs.symlink(source, target);
            summary.linked.push(entry.name);
            continue;
          } catch (linkErr) {
            summary.failed.push({
              name: entry.name,
              error:
                err instanceof Error && linkErr instanceof Error
                  ? `${err.message}; then ${linkErr.message}`
                  : err instanceof Error
                    ? err.message
                    : `Failed to recover broken symlink: ${String(err)}`,
            });
            continue;
          }
        }

        const resolvedLinkedPath = path.isAbsolute(linkedPath)
          ? linkedPath
          : path.resolve(path.dirname(target), linkedPath);
        const linkedTargetExists = await fs
          .stat(resolvedLinkedPath)
          .then(() => true)
          .catch(() => false);

        if (!linkedTargetExists) {
          await fs.unlink(target);
        } else {
          summary.skipped.push(entry.name);
          continue;
        }
      } else {
        summary.skipped.push(entry.name);
        continue;
      }
    }

    try {
      await fs.symlink(source, target);
      summary.linked.push(entry.name);
    } catch (err) {
      summary.failed.push({
        name: entry.name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return summary;
}

function buildAgentEnvExports(input: {
  apiBase: string;
  companyId: string;
  agentId: string;
  apiKey: string;
}): string {
  const escaped = (value: string) => value.replace(/'/g, "'\"'\"'");
  return [
    `export PAPERCLIP_API_URL='${escaped(input.apiBase)}'`,
    `export PAPERCLIP_COMPANY_ID='${escaped(input.companyId)}'`,
    `export PAPERCLIP_AGENT_ID='${escaped(input.agentId)}'`,
    `export PAPERCLIP_API_KEY='${escaped(input.apiKey)}'`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Frontmatter parser — handles simple YAML key-value frontmatter in AGENTS.md
// ---------------------------------------------------------------------------

interface ParsedAgentFolder {
  name: string;
  role?: string;
  title?: string;
  adapterType?: string;
  adapterConfig?: Record<string, unknown>;
  runtimeConfig?: Record<string, unknown>;
  capabilities?: string;
  reportsTo?: string;
  budgetMonthlyCents?: number;
  model?: string;
  permissionMode?: string;
  cwd: string;
  instructionsFilePath?: string;
  source: "frontmatter" | "folder-defaults";
}

function parseFrontmatter(content: string): Record<string, string> | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;

  const result: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx < 1) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    let value = trimmed.slice(colonIdx + 1).trim();
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return Object.keys(result).length > 0 ? result : null;
}

function tryParseJson(value: string): Record<string, unknown> | null {
  if (!value.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch { /* not JSON */ }
  return null;
}

async function parseAgentFolder(folderPath: string, overrides: {
  name?: string;
  role?: string;
  adapterType?: string;
  reportsTo?: string;
  budget?: string;
}): Promise<ParsedAgentFolder> {
  const resolvedPath = path.resolve(folderPath);
  const folderName = path.basename(resolvedPath);

  // Try AGENTS.md first
  const agentsMdPath = path.join(resolvedPath, "AGENTS.md");
  const soulMdPath = path.join(resolvedPath, "SOUL.md");

  let frontmatter: Record<string, string> | null = null;
  let soulContent: string | null = null;
  let hasAgentsMd = false;

  try {
    const agentsMdContent = await fs.readFile(agentsMdPath, "utf-8");
    hasAgentsMd = true;
    frontmatter = parseFrontmatter(agentsMdContent);
  } catch { /* no AGENTS.md */ }

  try {
    soulContent = await fs.readFile(soulMdPath, "utf-8");
  } catch { /* no SOUL.md */ }

  const result: ParsedAgentFolder = {
    name: overrides.name ?? frontmatter?.name ?? folderName,
    cwd: resolvedPath,
    source: frontmatter ? "frontmatter" : "folder-defaults",
  };

  if (hasAgentsMd) {
    result.instructionsFilePath = "AGENTS.md";
  }

  if (frontmatter) {
    if (frontmatter.role) result.role = frontmatter.role;
    if (frontmatter.title) result.title = frontmatter.title;
    if (frontmatter.adapterType) result.adapterType = frontmatter.adapterType;
    if (frontmatter.capabilities) result.capabilities = frontmatter.capabilities;
    if (frontmatter.reportsTo) result.reportsTo = frontmatter.reportsTo;
    if (frontmatter.model) result.model = frontmatter.model;
    if (frontmatter.permissionMode) result.permissionMode = frontmatter.permissionMode;
    if (frontmatter.budgetMonthlyCents) {
      const n = Number(frontmatter.budgetMonthlyCents);
      if (Number.isFinite(n)) result.budgetMonthlyCents = n;
    }
    if (frontmatter.adapterConfig) {
      result.adapterConfig = tryParseJson(frontmatter.adapterConfig) ?? undefined;
    }
    if (frontmatter.runtimeConfig) {
      result.runtimeConfig = tryParseJson(frontmatter.runtimeConfig) ?? undefined;
    }
  }

  // Fall back to SOUL.md for capabilities if no frontmatter capabilities
  if (!result.capabilities && soulContent) {
    // Use the first non-empty paragraph after the heading as capabilities
    const lines = soulContent.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#") && !trimmed.startsWith(">")) {
        result.capabilities = trimmed.length > 200 ? trimmed.slice(0, 197) + "..." : trimmed;
        break;
      }
    }
  }

  // Apply CLI overrides (take precedence over frontmatter)
  if (overrides.role) result.role = overrides.role;
  if (overrides.adapterType) result.adapterType = overrides.adapterType;
  if (overrides.reportsTo) result.reportsTo = overrides.reportsTo;
  if (overrides.budget) {
    const n = Number(overrides.budget);
    if (Number.isFinite(n)) result.budgetMonthlyCents = n;
  }

  return result;
}

function buildHireBodyFromParsed(parsed: ParsedAgentFolder): Record<string, unknown> {
  const adapterConfig: Record<string, unknown> = { ...parsed.adapterConfig };
  adapterConfig.cwd = parsed.cwd;
  if (parsed.instructionsFilePath) {
    adapterConfig.instructionsFilePath = parsed.instructionsFilePath;
  }
  if (parsed.model) {
    adapterConfig.model = parsed.model;
  }
  if (parsed.permissionMode) {
    adapterConfig.permissionMode = parsed.permissionMode;
  }

  const body: Record<string, unknown> = {
    name: parsed.name,
    role: parsed.role ?? "general",
    adapterType: parsed.adapterType ?? "claude_local",
    adapterConfig,
    runtimeConfig: parsed.runtimeConfig ?? {},
  };
  if (parsed.title) body.title = parsed.title;
  if (parsed.capabilities) body.capabilities = parsed.capabilities;
  if (parsed.reportsTo) body.reportsTo = parsed.reportsTo;
  if (parsed.budgetMonthlyCents !== undefined) body.budgetMonthlyCents = parsed.budgetMonthlyCents;

  return body;
}

export function registerAgentCommands(program: Command): void {
  const agent = program.command("agent").description("Agent operations");

  addCommonClientOptions(
    agent
      .command("list")
      .description("List agents for a company")
      .requiredOption("-C, --company-id <id>", "Company ID")
      .action(async (opts: AgentListOptions) => {
        try {
          const ctx = resolveCommandContext(opts, { requireCompany: true });
          const rows = (await ctx.api.get<Agent[]>(`/api/companies/${ctx.companyId}/agents`)) ?? [];

          if (ctx.json) {
            printOutput(rows, { json: true });
            return;
          }

          if (rows.length === 0) {
            printOutput([], { json: false });
            return;
          }

          for (const row of rows) {
            console.log(
              formatInlineRecord({
                id: row.id,
                name: row.name,
                role: row.role,
                status: row.status,
                reportsTo: row.reportsTo,
                budgetMonthlyCents: row.budgetMonthlyCents,
                spentMonthlyCents: row.spentMonthlyCents,
              }),
            );
          }
        } catch (err) {
          handleCommandError(err);
        }
      }),
    { includeCompany: false },
  );

  addCommonClientOptions(
    agent
      .command("get")
      .description("Get one agent")
      .argument("<agentId>", "Agent ID")
      .action(async (agentId: string, opts: BaseClientOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          const row = await ctx.api.get<Agent>(`/api/agents/${agentId}`);
          printOutput(row, { json: ctx.json });
        } catch (err) {
          handleCommandError(err);
        }
      }),
  );

  addCommonClientOptions(
    agent
      .command("create")
      .description(
        "Create a new agent via the hire flow.\n" +
          "  Examples:\n" +
          "    paperclipai agent create --name bot --role engineer -C <companyId>\n" +
          "    paperclipai agent create --name bot --adapter-type claude_local --cwd /path --model opus -C <cid>\n" +
          "    paperclipai agent create --name bot --role pm --json -C <cid>  # JSON output",
      )
      .requiredOption("-C, --company-id <id>", "Company ID")
      .requiredOption("--name <name>", "Agent name")
      .option("--role <role>", "Agent role (ceo, cto, engineer, pm, qa, etc.)", "general")
      .option("--title <title>", "Agent title / job description")
      .option("--reports-to <agentId>", "UUID of the manager agent")
      .option("--adapter-type <type>", "Adapter type (claude_local, codex_local, process, etc.)", "process")
      .option("--adapter-config <json>", "Adapter config as JSON string")
      .option("--runtime-config <json>", "Runtime config as JSON string")
      .option("--budget <cents>", "Monthly budget in cents")
      .option("--cwd <path>", "Shortcut: sets adapterConfig.cwd")
      .option("--model <model>", "Shortcut: sets adapterConfig.model")
      .option("--instructions-file <path>", "Shortcut: sets adapterConfig.instructionsFilePath")
      .action(async (opts: AgentCreateOptions) => {
        try {
          const ctx = resolveCommandContext(opts, { requireCompany: true });

          const adapterConfig: Record<string, unknown> = opts.adapterConfig
            ? JSON.parse(opts.adapterConfig)
            : {};
          if (opts.cwd) adapterConfig.cwd = opts.cwd;
          if (opts.model) adapterConfig.model = opts.model;
          if (opts.instructionsFile) adapterConfig.instructionsFilePath = opts.instructionsFile;

          const runtimeConfig: Record<string, unknown> = opts.runtimeConfig
            ? JSON.parse(opts.runtimeConfig)
            : {};

          const body: Record<string, unknown> = {
            name: opts.name,
            role: opts.role ?? "general",
            adapterType: opts.adapterType ?? "process",
            adapterConfig,
            runtimeConfig,
          };
          if (opts.title) body.title = opts.title;
          if (opts.reportsTo) body.reportsTo = opts.reportsTo;
          if (opts.budget) body.budgetMonthlyCents = Number(opts.budget);

          const result = await ctx.api.post<AgentHireResponse>(
            `/api/companies/${ctx.companyId}/agent-hires`,
            body,
          );
          if (!result) {
            throw new Error("Failed to create agent");
          }

          if (ctx.json) {
            printOutput(result, { json: true });
            return;
          }

          const a = result.agent;
          console.log(
            formatInlineRecord({
              id: a.id,
              name: a.name,
              urlKey: a.urlKey,
              role: a.role,
              status: a.status,
              adapterType: a.adapterType,
            }),
          );
          if (result.approval) {
            console.log(
              `Approval required: id=${result.approval.id} status=${result.approval.status}`,
            );
          }
        } catch (err) {
          handleCommandError(err);
        }
      }),
    { includeCompany: false },
  );

  addCommonClientOptions(
    agent
      .command("import")
      .description(
        "Import an agent from a local folder by reading AGENTS.md frontmatter.\n" +
          "  Examples:\n" +
          "    paperclipai agent import ~/agents/my-agent -C <companyId>\n" +
          "    paperclipai agent import ./agent-folder -C <cid> --dry-run   # preview without creating\n" +
          "    paperclipai agent import ./agent-folder -C <cid> --setup-keys # create + generate keys",
      )
      .argument("<path>", "Path to agent folder containing AGENTS.md or SOUL.md")
      .requiredOption("-C, --company-id <id>", "Company ID")
      .option("--name <name>", "Override agent name (default: from frontmatter or folder name)")
      .option("--role <role>", "Override agent role")
      .option("--adapter-type <type>", "Override adapter type (default: claude_local)")
      .option("--reports-to <agentId>", "UUID of the manager agent")
      .option("--budget <cents>", "Monthly budget in cents")
      .option("--dry-run", "Preview what would be created without calling API")
      .option("--setup-keys", "After import, run local-cli flow (generate key + install skills)")
      .action(async (folderPath: string, opts: AgentImportOptions) => {
        try {
          const ctx = resolveCommandContext(opts, { requireCompany: true });
          const resolvedPath = path.resolve(folderPath);

          // Verify folder exists
          const stat = await fs.stat(resolvedPath).catch(() => null);
          if (!stat?.isDirectory()) {
            throw new Error(`Not a directory: ${resolvedPath}`);
          }

          const parsed = await parseAgentFolder(resolvedPath, {
            name: opts.name,
            role: opts.role,
            adapterType: opts.adapterType,
            reportsTo: opts.reportsTo,
            budget: opts.budget,
          });

          const body = buildHireBodyFromParsed(parsed);

          if (opts.dryRun) {
            if (ctx.json) {
              printOutput({ dryRun: true, source: parsed.source, hireBody: body }, { json: true });
            } else {
              console.log(pc.bold("Dry run — would create agent:"));
              console.log(`  source: ${parsed.source}`);
              console.log(`  name: ${body.name}`);
              console.log(`  role: ${body.role}`);
              console.log(`  adapterType: ${body.adapterType}`);
              console.log(`  adapterConfig: ${JSON.stringify(body.adapterConfig)}`);
              if (body.title) console.log(`  title: ${body.title}`);
              if (body.capabilities) console.log(`  capabilities: ${body.capabilities}`);
              if (body.reportsTo) console.log(`  reportsTo: ${body.reportsTo}`);
              if (body.budgetMonthlyCents !== undefined) console.log(`  budgetMonthlyCents: ${body.budgetMonthlyCents}`);
              if (body.runtimeConfig && Object.keys(body.runtimeConfig as Record<string, unknown>).length > 0) {
                console.log(`  runtimeConfig: ${JSON.stringify(body.runtimeConfig)}`);
              }
            }
            return;
          }

          const result = await ctx.api.post<AgentHireResponse>(
            `/api/companies/${ctx.companyId}/agent-hires`,
            body,
          );
          if (!result) {
            throw new Error("Failed to create agent");
          }

          // Optionally run local-cli setup (key + skills)
          let localCliResult: {
            key?: { id: string; name: string; token: string; createdAt: string };
            skills?: SkillsInstallSummary[];
            exports?: string;
          } | null = null;

          if (opts.setupKeys) {
            const agentRow = result.agent;
            const now = new Date().toISOString().replaceAll(":", "-");
            const keyName = `import-${now}`;
            const key = await ctx.api.post<CreatedAgentKey>(`/api/agents/${agentRow.id}/keys`, { name: keyName });
            if (!key) {
              throw new Error("Agent created but failed to create API key");
            }

            const installSummaries: SkillsInstallSummary[] = [];
            const skillsDir = await resolvePaperclipSkillsDir(__moduleDir, [path.resolve(process.cwd(), "skills")]);
            if (skillsDir) {
              installSummaries.push(
                await installSkillsForTarget(skillsDir, codexSkillsHome(), "codex"),
                await installSkillsForTarget(skillsDir, claudeSkillsHome(), "claude"),
              );
            }

            const exportsText = buildAgentEnvExports({
              apiBase: ctx.api.apiBase,
              companyId: agentRow.companyId,
              agentId: agentRow.id,
              apiKey: key.token,
            });

            localCliResult = { key, skills: installSummaries, exports: exportsText };
          }

          if (ctx.json) {
            const output: Record<string, unknown> = {
              source: parsed.source,
              agent: result.agent,
              approval: result.approval,
            };
            if (localCliResult) {
              output.key = localCliResult.key;
              output.skills = localCliResult.skills;
              output.exports = localCliResult.exports;
            }
            printOutput(output, { json: true });
            return;
          }

          const a = result.agent;
          console.log(`Imported from: ${resolvedPath} (${parsed.source})`);
          console.log(
            formatInlineRecord({
              id: a.id,
              name: a.name,
              urlKey: a.urlKey,
              role: a.role,
              status: a.status,
              adapterType: a.adapterType,
            }),
          );
          if (result.approval) {
            console.log(
              `Approval required: id=${result.approval.id} status=${result.approval.status}`,
            );
          }
          if (localCliResult) {
            console.log(`API key created: ${localCliResult.key!.name} (${localCliResult.key!.id})`);
            if (localCliResult.skills && localCliResult.skills.length > 0) {
              for (const summary of localCliResult.skills) {
                console.log(
                  `${summary.tool}: linked=${summary.linked.length} removed=${summary.removed.length} skipped=${summary.skipped.length} failed=${summary.failed.length} target=${summary.target}`,
                );
              }
            }
            console.log("");
            console.log("# Run this in your shell before launching codex/claude:");
            console.log(localCliResult.exports);
          }
        } catch (err) {
          handleCommandError(err);
        }
      }),
    { includeCompany: false },
  );

  addCommonClientOptions(
    agent
      .command("local-cli")
      .description(
        "Create an agent API key, install local Paperclip skills for Codex/Claude, and print shell exports.\n" +
          "  If the agent doesn't exist, use --create to create it first.\n" +
          "  Examples:\n" +
          "    paperclipai agent local-cli my-agent -C <companyId>                  # existing agent\n" +
          "    paperclipai agent local-cli new-agent -C <cid> --create --role pm    # create + setup\n" +
          "    paperclipai agent local-cli my-agent -C <cid> --json                 # JSON output",
      )
      .argument("<agentRef>", "Agent ID or shortname/url-key")
      .requiredOption("-C, --company-id <id>", "Company ID")
      .option("--key-name <name>", "API key label", "local-cli")
      .option(
        "--no-install-skills",
        "Skip installing Paperclip skills into ~/.codex/skills and ~/.claude/skills",
      )
      .option("--create", "Auto-create the agent if it does not exist")
      .option("--role <role>", "Agent role when creating (ceo, cto, engineer, pm, qa, etc.)", "general")
      .option("--model <model>", "Adapter model when creating (e.g. opus, sonnet)")
      .option("--cwd <path>", "Adapter working directory when creating")
      .action(async (agentRef: string, opts: AgentLocalCliOptions) => {
        try {
          const ctx = resolveCommandContext(opts, { requireCompany: true });
          const query = new URLSearchParams({ companyId: ctx.companyId ?? "" });

          let agentRow: Agent | null = null;
          try {
            agentRow = await ctx.api.get<Agent>(
              `/api/agents/${encodeURIComponent(agentRef)}?${query.toString()}`,
            );
          } catch (err) {
            if (err instanceof ApiRequestError && err.status === 404) {
              agentRow = null;
            } else {
              throw err;
            }
          }

          // Agent not found — create-if-missing flow
          if (!agentRow) {
            let shouldCreate = Boolean(opts.create);

            if (!shouldCreate && !ctx.json && process.stdin.isTTY) {
              // Interactive prompt
              console.log(pc.yellow(`Agent "${agentRef}" not found in company ${ctx.companyId}.`));
              const answer = await p.confirm({
                message: "Create this agent now?",
                initialValue: true,
              });
              if (p.isCancel(answer) || !answer) {
                console.log(pc.dim("Aborted."));
                process.exit(1);
              }
              shouldCreate = true;
            }

            if (!shouldCreate) {
              throw new Error(
                `Agent not found: ${agentRef}. Use --create to auto-create it.`,
              );
            }

            // Build create payload
            const adapterConfig: Record<string, unknown> = {};
            if (opts.cwd) adapterConfig.cwd = opts.cwd;
            if (opts.model) adapterConfig.model = opts.model;

            const createBody: Record<string, unknown> = {
              name: agentRef,
              role: opts.role ?? "general",
              adapterType: "process",
              adapterConfig,
              runtimeConfig: {},
            };

            if (!ctx.json) {
              console.log(pc.dim(`Creating agent "${agentRef}" (role=${createBody.role})...`));
            }

            const hireResult = await ctx.api.post<AgentHireResponse>(
              `/api/companies/${ctx.companyId}/agent-hires`,
              createBody,
            );
            if (!hireResult) {
              throw new Error("Failed to create agent");
            }
            agentRow = hireResult.agent;

            if (!ctx.json) {
              console.log(
                `Agent created: ${agentRow.name} (${agentRow.id})`,
              );
              if (hireResult.approval) {
                console.log(
                  pc.yellow(`Approval required: id=${hireResult.approval.id} status=${hireResult.approval.status}`),
                );
              }
            }
          }

          // --- Normal local-cli flow: generate key + install skills ---
          const now = new Date().toISOString().replaceAll(":", "-");
          const keyName = opts.keyName?.trim() ? opts.keyName.trim() : `local-cli-${now}`;
          const key = await ctx.api.post<CreatedAgentKey>(`/api/agents/${agentRow.id}/keys`, { name: keyName });
          if (!key) {
            throw new Error("Failed to create API key");
          }

          const installSummaries: SkillsInstallSummary[] = [];
          if (opts.installSkills !== false) {
            const skillsDir = await resolvePaperclipSkillsDir(__moduleDir, [path.resolve(process.cwd(), "skills")]);
            if (!skillsDir) {
              throw new Error(
                "Could not locate local Paperclip skills directory. Expected ./skills in the repo checkout.",
              );
            }

            installSummaries.push(
              await installSkillsForTarget(skillsDir, codexSkillsHome(), "codex"),
              await installSkillsForTarget(skillsDir, claudeSkillsHome(), "claude"),
            );
          }

          const exportsText = buildAgentEnvExports({
            apiBase: ctx.api.apiBase,
            companyId: agentRow.companyId,
            agentId: agentRow.id,
            apiKey: key.token,
          });

          if (ctx.json) {
            printOutput(
              {
                agent: {
                  id: agentRow.id,
                  name: agentRow.name,
                  urlKey: agentRow.urlKey,
                  companyId: agentRow.companyId,
                },
                key: {
                  id: key.id,
                  name: key.name,
                  createdAt: key.createdAt,
                  token: key.token,
                },
                skills: installSummaries,
                exports: exportsText,
              },
              { json: true },
            );
            return;
          }

          console.log(`Agent: ${agentRow.name} (${agentRow.id})`);
          console.log(`API key created: ${key.name} (${key.id})`);
          if (installSummaries.length > 0) {
            for (const summary of installSummaries) {
              console.log(
                `${summary.tool}: linked=${summary.linked.length} removed=${summary.removed.length} skipped=${summary.skipped.length} failed=${summary.failed.length} target=${summary.target}`,
              );
              for (const failed of summary.failed) {
                console.log(`  failed ${failed.name}: ${failed.error}`);
              }
            }
          }
          console.log("");
          console.log("# Run this in your shell before launching codex/claude:");
          console.log(exportsText);
        } catch (err) {
          handleCommandError(err);
        }
      }),
    { includeCompany: false },
  );
}
