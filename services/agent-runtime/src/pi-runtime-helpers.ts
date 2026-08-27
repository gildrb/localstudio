import { existsSync, readFileSync } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { listProjectsFromStore, resolveAllowedWorkspace } from "./projects-store";
import { hasEnabledConnectorsSync } from "./connectors-service";
import { githubCliPathSync, hasGithubCliSync } from "./github-cli";
import { hasObsidianVaultSync, listObsidianVaultsSync } from "./obsidian-vault";
import { resolveBundledResource } from "./plugin-resources";
import type {
  AgentBrowserBackend as BrowserBackend,
  AgentThinkingLevel,
  AgentToolAccess,
} from "../../../shared/agent/agent-turn";

type RuntimeResourceRef = {
  id?: string;
  name?: string;
  path?: string;
};

export type RuntimeStartOptions = {
  thinkingLevel?: AgentThinkingLevel;
  toolAccess?: AgentToolAccess;
  browserToolEnabled?: boolean;
  browserSessionId?: string;
  browserBackend?: BrowserBackend;
  skills?: RuntimeResourceRef[];
  promptTemplates?: RuntimeResourceRef[];
};

type AgentSessionOptionsInput = {
  options: RuntimeStartOptions;
  cwd?: string;
  processEnv?: NodeJS.ProcessEnv;
};

type AgentSessionOptions = {
  extensionPaths: string[];
  skills: string[];
  promptTemplatePaths: string[];
  envInjections: Record<string, string>;
};

function resolveDefaultAgentCwd(): string {
  if (process.env.LOCAL_STUDIO_AGENT_CWD) return process.env.LOCAL_STUDIO_AGENT_CWD;

  try {
    const usable = listProjectsFromStore().find((entry) => entry.exists);
    if (usable) return usable.path;
  } catch {}

  const cwd = process.cwd();
  if (path.basename(cwd) === "frontend") return path.resolve(cwd, "..");
  if (cwd === "/" || cwd === "") return homedir();
  return cwd;
}

export function expandHome(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith(`~${path.sep}`)) return path.join(homedir(), value.slice(2));
  return value;
}

export function resolveAgentCwdEffect(input?: string): Effect.Effect<string, unknown> {
  const defaultCwd = resolveDefaultAgentCwd();
  const raw = input?.trim() || defaultCwd;
  const expanded = expandHome(raw);
  const candidate = path.isAbsolute(expanded) ? expanded : path.resolve(defaultCwd, expanded);
  return Effect.gen(function* () {
    const resolved = yield* Effect.tryPromise({
      try: () => realpath(candidate),
      catch: (error) => error,
    });
    const info = yield* Effect.tryPromise({
      try: () => stat(resolved),
      catch: (error) => error,
    });
    if (!info.isDirectory()) {
      return yield* Effect.fail(new Error(`Agent cwd is not a directory: ${resolved}`));
    }
    return resolveAllowedWorkspace(resolved);
  });
}

function resolveBundledResourcePath(kind: string, name: string, override?: string): string | null {
  if (override && existsSync(override)) return override;
  return resolveBundledResource(kind, name);
}

export function runtimeOptionsFingerprint(options: RuntimeStartOptions): string {
  const skills = (options.skills ?? [])
    .map((skill) => `${skill.name ?? ""}:${skill.path ?? ""}`)
    .sort();
  const promptTemplates = (options.promptTemplates ?? [])
    .map((template) => `${template.name ?? ""}:${template.path ?? ""}`)
    .sort();
  return JSON.stringify({
    thinkingLevel: options.thinkingLevel ?? "high",
    toolAccess: options.toolAccess ?? "full",
    browser: options.browserToolEnabled === true,
    browserBackend: browserBackend(options),
    browserSessionId: options.browserSessionId ?? "",
    skills,
    promptTemplates,
  });
}

function selectedPaths(resources: RuntimeResourceRef[]): string[] {
  return uniqueExistingPaths(resources.map((resource) => resource.path));
}

function uniqueExistingPaths(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  return values.filter((value): value is string => {
    if (!value || !existsSync(value)) return false;
    const resolved = path.resolve(value);
    if (seen.has(resolved)) return false;
    seen.add(resolved);
    return true;
  });
}

function shouldLoadBrowserTool(options: RuntimeStartOptions): boolean {
  return options.browserToolEnabled === true;
}

function browserBackend(options: RuntimeStartOptions): BrowserBackend {
  const backend = options.browserBackend ?? process.env.LOCAL_STUDIO_BROWSER_BACKEND;
  if (backend === "chrome") return "chrome";
  return "embedded";
}

function shouldLoadChromeTool(options: RuntimeStartOptions): boolean {
  return shouldLoadBrowserTool(options) && browserBackend(options) === "chrome";
}

type BundledResourceSpec = readonly [enabled: boolean, name: string, override?: string];

function selectedBundledResources(kind: string, specs: BundledResourceSpec[]): string[] {
  return uniqueExistingPaths(
    specs.flatMap(([enabled, name, override]) =>
      enabled ? [resolveBundledResourcePath(kind, name, override)] : [],
    ),
  );
}

function runtimeExtensionPaths(options: RuntimeStartOptions): string[] {
  const browser = shouldLoadBrowserTool(options);
  const chrome = shouldLoadChromeTool(options);
  return selectedBundledResources("pi-extensions", [
    [true, "local-studio-timeouts.ts", process.env.LOCAL_STUDIO_TIMEOUT_EXTENSION_PATH],
    [true, "local-studio-agent-policy.ts", process.env.LOCAL_STUDIO_AGENT_POLICY_EXTENSION_PATH],
    [browser, "cua.ts", process.env.LOCAL_STUDIO_CUA_EXTENSION_PATH],
    [chrome, "chrome.ts", process.env.LOCAL_STUDIO_CHROME_EXTENSION_PATH],
    [hasGithubCliSync(), "github.ts", process.env.LOCAL_STUDIO_GITHUB_EXTENSION_PATH],
    [hasObsidianVaultSync(), "obsidian.ts", process.env.LOCAL_STUDIO_OBSIDIAN_EXTENSION_PATH],
    [
      hasEnabledConnectorsSync(),
      "connectors.ts",
      process.env.LOCAL_STUDIO_CONNECTORS_EXTENSION_PATH,
    ],
    [true, "subagents.ts", process.env.LOCAL_STUDIO_SUBAGENTS_EXTENSION_PATH],
    [true, "automations.ts", process.env.LOCAL_STUDIO_AUTOMATIONS_EXTENSION_PATH],
  ]);
}

function runtimeSkillPaths(options: RuntimeStartOptions): string[] {
  return uniqueExistingPaths([
    ...selectedPaths(options.skills ?? []),
    ...selectedBundledResources("skills", [
      [shouldLoadBrowserTool(options), "cua", process.env.LOCAL_STUDIO_CUA_SKILL_PATH],
      [shouldLoadChromeTool(options), "chrome", process.env.LOCAL_STUDIO_CHROME_SKILL_PATH],
      [hasGithubCliSync(), "github", process.env.LOCAL_STUDIO_GITHUB_SKILL_PATH],
      [hasObsidianVaultSync(), "obsidian", process.env.LOCAL_STUDIO_OBSIDIAN_SKILL_PATH],
      [true, "automations", process.env.LOCAL_STUDIO_AUTOMATIONS_SKILL_PATH],
      [true, "subagents", process.env.LOCAL_STUDIO_SUBAGENTS_SKILL_PATH],
    ]),
  ]);
}

function runtimeEnvInjections(options: RuntimeStartOptions, env: NodeJS.ProcessEnv, cwd: string) {
  const frontendBase = env.LOCAL_STUDIO_FRONTEND_BASE ?? `http://127.0.0.1:${env.PORT || "3000"}`;
  const relay = readChromeRelayEnv(env);
  const githubCliPath = githubCliPathSync();
  const obsidianVaults = listObsidianVaultsSync();
  const injections: AgentSessionOptions["envInjections"] = {
    LOCAL_STUDIO_BROWSER_BACKEND: browserBackend(options),
    LOCAL_STUDIO_BROWSER_SESSION_ID: options.browserSessionId ?? "",
    LOCAL_STUDIO_CWD: cwd,
    LOCAL_STUDIO_FRONTEND_BASE: frontendBase,
    LOCAL_STUDIO_CHROME_RELAY_URL: env.SITEGEIST_RELAY_URL ?? relay.SITEGEIST_RELAY_URL ?? "",
    LOCAL_STUDIO_CHROME_RELAY_TOKEN: env.SITEGEIST_RELAY_TOKEN ?? relay.SITEGEIST_RELAY_TOKEN ?? "",
    LOCAL_STUDIO_CHROME_RELAY_SESSION: options.browserSessionId ?? "",
  };
  if (githubCliPath) injections.LOCAL_STUDIO_GH_PATH = githubCliPath;
  if (obsidianVaults.length > 0) {
    injections.LOCAL_STUDIO_OBSIDIAN_VAULTS = JSON.stringify(obsidianVaults);
  }
  return injections;
}

function readChromeRelayEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const filePath = expandHome(
    env.LOCAL_STUDIO_SITEGEIST_RELAY_ENV_PATH ?? "~/.config/sitegeist-relay/env",
  );
  if (!existsSync(filePath)) return {};
  try {
    return Object.fromEntries(
      readFileSync(filePath, "utf8")
        .split(/\r?\n/)
        .flatMap((line): Array<[string, string]> => {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) return [];
          const clean = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
          const index = clean.indexOf("=");
          if (index < 1) return [];
          const key = clean.slice(0, index).trim();
          const value = clean
            .slice(index + 1)
            .trim()
            .replace(/^['"]|['"]$/g, "");
          return key.startsWith("SITEGEIST_RELAY_") ? [[key, value]] : [];
        }),
    );
  } catch {
    return {};
  }
}

export function applyRuntimeEnvInjections(
  envInjections: Record<string, string>,
  env: NodeJS.ProcessEnv = process.env,
): void {
  for (const [key, value] of Object.entries(envInjections)) env[key] = value;
}

export function buildAgentSessionOptionsSync(input: AgentSessionOptionsInput): AgentSessionOptions {
  const options = input.options;
  return {
    extensionPaths: runtimeExtensionPaths(options),
    skills: runtimeSkillPaths(options),
    promptTemplatePaths: selectedPaths(options.promptTemplates ?? []),
    envInjections: runtimeEnvInjections(options, input.processEnv ?? process.env, input.cwd ?? ""),
  };
}
