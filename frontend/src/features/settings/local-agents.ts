/**
 * Server-only support for attaching a Local Studio model to locally installed
 * coding-agent CLIs. Detection inspects well-known config directories under a
 * given home dir; attachment merges a provider/model entry into each agent's
 * config file, preserving everything else and backing up existing files before
 * modification.
 */
import path from "node:path";
import { Option, Schema } from "effect";
import {
  backupExistingFile,
  existingFileMode,
  JsonRecordSchema,
  pathExists,
  readJsonFile,
  readYamlFile,
  writeJsonAtomic,
  writeYamlAtomic,
  type JsonRecord,
} from "./local-agent-config-file-io";
import {
  mergeDroidConfig,
  mergeHermesConfig,
  mergeOpencodeConfig,
  mergePiConfig,
  providerKeyForBaseUrl,
} from "./local-agent-config-merge";
import {
  detectLocalAgents,
  droidConfigPath,
  hermesConfigPath,
  ompSettingsPath,
  opencodeCandidatePaths,
  piConfigPath,
  resolveOmpConfigPath,
  resolveOpencodeConfigPath,
} from "./local-agent-detection";
import type {
  AttachAction,
  AttachExtraUpdate,
  AttachModelInput,
  AttachResult,
  LocalAgentId,
  LocalAgentModel,
} from "./local-agent-types";

export { LOCAL_AGENT_IDS, type LocalAgentId, type LocalAgentTarget } from "./local-agent-types";
export type { AttachAction, AttachModelInput, AttachResult, LocalAgentModel };
export { detectLocalAgents };

const decodeLocalAgentConfig = JsonRecordSchema.pipe(Schema.decodeUnknownOption);
const configWriters = { json: writeJsonAtomic, yaml: writeYamlAtomic };

interface AgentConfigFile {
  exists: boolean;
  config?: JsonRecord;
  error?: string;
}

interface AgentAttachPlan {
  configPath: string;
  detected: boolean;
  format: "json" | "yaml";
  /** Object to start from when the config file does not exist yet. */
  emptyConfig: () => JsonRecord;
  merge: (config: JsonRecord, model: LocalAgentModel) => AttachAction;
}

async function planFor(
  agent: LocalAgentId,
  home: string,
  model: LocalAgentModel,
): Promise<AgentAttachPlan> {
  if (agent === "pi") {
    return {
      configPath: piConfigPath(home),
      detected: await pathExists(path.join(home, ".pi")),
      format: "json",
      emptyConfig: () => ({ providers: {} }),
      merge: mergePiConfig,
    };
  }
  if (agent === "opencode") {
    const { xdg, dot } = opencodeCandidatePaths(home);
    const detected = (await pathExists(path.dirname(xdg))) || (await pathExists(path.dirname(dot)));
    return {
      configPath: await resolveOpencodeConfigPath(home, model.baseUrl),
      detected,
      format: "json",
      emptyConfig: () => ({ $schema: "https://opencode.ai/config.json" }),
      merge: mergeOpencodeConfig,
    };
  }
  if (agent === "hermes") {
    return {
      configPath: hermesConfigPath(home),
      detected: await pathExists(path.join(home, ".hermes")),
      format: "yaml",
      emptyConfig: () => ({ custom_models: [] }),
      merge: mergeHermesConfig,
    };
  }
  if (agent === "omp") {
    const configPath = await resolveOmpConfigPath(home);
    return {
      configPath,
      detected: await pathExists(path.join(home, ".omp")),
      format: configPath.endsWith(".json") ? "json" : "yaml",
      emptyConfig: () => ({ providers: {} }),
      merge: mergePiConfig,
    };
  }
  return {
    configPath: droidConfigPath(home),
    detected: await pathExists(path.join(home, ".factory")),
    format: "json",
    emptyConfig: () => ({ customModels: [] }),
    merge: mergeDroidConfig,
  };
}

async function readAgentConfig(
  configPath: string,
  format: AgentAttachPlan["format"],
): Promise<AgentConfigFile> {
  if (format === "json") return readJsonFile(configPath);
  const file = await readYamlFile(configPath);
  if (file.error) return { exists: file.exists, error: file.error };
  const decoded = Option.map(decodeLocalAgentConfig(file.document?.toJS()), (config) => ({
    ...config,
  }));
  if (file.exists && Option.isNone(decoded)) {
    return {
      exists: true,
      error: `${configPath} does not contain a YAML object`,
    };
  }
  return { exists: file.exists, config: Option.getOrUndefined(decoded) };
}

async function attachToAgent(
  agent: LocalAgentId,
  home: string,
  model: LocalAgentModel,
): Promise<AttachResult> {
  const plan = await planFor(agent, home, model);
  const { configPath, format } = plan;
  if (!plan.detected) {
    return {
      agent,
      ok: false,
      configPath,
      error: `${agent} is not installed (config directory not found)`,
    };
  }

  const file = await readAgentConfig(configPath, format);
  if (file.error) {
    return { agent, ok: false, configPath, error: file.error };
  }

  const { config = plan.emptyConfig() } = file;
  const mergeAction = plan.merge(config, model);

  let backupPath: string | undefined;
  if (file.exists) {
    backupPath = await backupExistingFile(configPath);
  }

  const mode = file.exists ? ((await existingFileMode(configPath)) ?? 0o600) : 0o600;
  await configWriters[format](configPath, config, mode);

  const action: AttachAction = file.exists ? mergeAction : "created-file";
  const extraUpdates =
    agent === "omp" ? await enableOmpModel(home, model, config).catch(() => undefined) : undefined;
  const result: AttachResult = {
    agent,
    ok: true,
    configPath,
    backupPath,
    action,
  };
  if (extraUpdates) result.extraUpdates = extraUpdates;
  return result;
}

async function enableOmpModel(
  home: string,
  model: LocalAgentModel,
  mergedConfig: JsonRecord,
): Promise<AttachExtraUpdate[] | undefined> {
  const providerKey = providerKeyForBaseUrl(mergedConfig, model.baseUrl);
  if (!providerKey) return undefined;
  const settingsPath = ompSettingsPath(home);
  const settings = await readYamlFile(settingsPath);
  if (settings.error || !settings.exists || !settings.document) return undefined;
  const doc = Option.getOrUndefined(
    Option.map(decodeLocalAgentConfig(settings.document.toJS()), (config) => ({ ...config })),
  );
  if (!doc) return undefined;
  const enabled = doc["enabledModels"];
  if (!Array.isArray(enabled) || enabled.length === 0) return undefined;
  const selector = `${providerKey}/${model.modelId}`;
  if (enabled.includes(selector)) return undefined;
  enabled.push(selector);
  const backupPath = await backupExistingFile(settingsPath);
  const mode = (await existingFileMode(settingsPath)) ?? 0o600;
  await writeYamlAtomic(settingsPath, doc, mode);
  return [{ configPath: settingsPath, backupPath }];
}

export async function attachModelToAgents(input: AttachModelInput): Promise<AttachResult[]> {
  const results: AttachResult[] = [];
  for (const agent of input.targets) {
    try {
      results.push(await attachToAgent(agent, input.home, input.model));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const plan = await planFor(agent, input.home, input.model).catch(() => null);
      results.push({
        agent,
        ok: false,
        configPath: plan?.configPath ?? "",
        error: message,
      });
    }
  }
  return results;
}
