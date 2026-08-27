import type {
  EngineId,
  ComputeEngineSpec,
  EngineSupport,
  HostProfile,
  LaunchPlan,
  LaunchRequest,
  EngineRuntimeKind,
} from "../contracts";
import { applyDevices } from "./devices";
import { exllamav3 } from "./exllamav3";
import { sglang } from "./sglang";
import { vllm } from "./vllm";

const SPECS = {
  vllm,
  sglang,
  exllamav3,
} satisfies Readonly<Record<EngineId, ComputeEngineSpec>>;

export const engineSpec = (id: EngineId): ComputeEngineSpec => SPECS[id];

export const allEngineSpecs: readonly ComputeEngineSpec[] = Object.values(SPECS);

export const availableEngines = (
  host: HostProfile,
): readonly { readonly id: EngineId; readonly support: EngineSupport }[] =>
  allEngineSpecs.map((spec) => ({ id: spec.id, support: spec.supports(host) }));

export const supportsRuntime = (
  id: EngineId,
  host: HostProfile,
  runtime: EngineRuntimeKind,
): boolean => {
  const support = SPECS[id].supports(host);
  return support.ok && support.runtimes.includes(runtime);
};

export const planLaunch = (request: LaunchRequest): LaunchPlan =>
  applyDevices(SPECS[request.engine].plan(request), request.host.accelerator);
