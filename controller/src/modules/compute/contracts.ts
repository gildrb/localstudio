export type EngineId = "vllm" | "sglang" | "exllamav3";

export const ENGINE_IDS: readonly EngineId[] = ["vllm", "sglang", "exllamav3"] as const;

export type Accelerator = "cuda" | "rocm" | "metal" | "xpu" | "cpu";
export type EngineRuntimeKind = "docker";
export type HostPlatform = "linux" | "darwin" | "win32";
export type HostArch = "x64" | "arm64";

export type NodeId = string;

export type DeviceId = string;

export interface HostProfile {
  readonly nodeId: NodeId;
  readonly platform: HostPlatform;
  readonly arch: HostArch;
  readonly accelerator: Accelerator;
  readonly unifiedMemory: boolean;
  readonly wsl: boolean;
  readonly docker: boolean;
  readonly dockerGpu: boolean;
  readonly deviceCount: number;
}

export type EngineSupport =
  | { readonly ok: true; readonly runtimes: readonly EngineRuntimeKind[] }
  | { readonly ok: false; readonly reason: string };

export interface HealthCheck {
  readonly path: string;
  readonly readyDeadlineMs: number;
  readonly intervalMs: number;
}

export type MetricMap = Readonly<Record<CanonicalMetric, readonly string[]>>;

export type CanonicalMetric =
  | "requestsRunning"
  | "requestsWaiting"
  | "kvCacheUtilization"
  | "promptTokensTotal"
  | "generationTokensTotal";

export interface PortBinding {
  readonly container: number;
  readonly host: number;
}

export interface Mount {
  readonly from: string;
  readonly to: string;
  readonly readOnly: boolean;
}

export interface LaunchPlan {
  readonly kind: EngineRuntimeKind;
  readonly argv: readonly string[];
  readonly image?: string;
  readonly env: Readonly<Record<string, string>>;
  readonly ports: readonly PortBinding[];
  readonly mounts: readonly Mount[];
  readonly devices: readonly DeviceId[];
  readonly health: HealthCheck;
}

export interface ServingOptions {
  readonly tensorParallel: number;
  readonly pipelineParallel: number;
  readonly maxContextLength: number;
  readonly memoryFraction: number;
  readonly maxConcurrentRequests: number;
  readonly kvCacheDtype: string | null;
  readonly dtype: string | null;
  readonly quantization: string | null;
  readonly trustRemoteCode: boolean;
  readonly toolCallParser: string | null;
  readonly reasoningParser: string | null;
}

export interface LaunchRequest {
  readonly engine: EngineId;
  readonly host: HostProfile;
  readonly runtime: EngineRuntimeKind;
  readonly devices: readonly DeviceId[];
  readonly port: number;
  readonly modelPath: string;
  readonly servedModelName: string;
  readonly options: ServingOptions;
  readonly extraArgs: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly dockerImage: string | null;
}

export interface ComputeEngineSpec {
  readonly id: EngineId;
  readonly supports: (host: HostProfile) => EngineSupport;
  readonly plan: (request: LaunchRequest) => LaunchPlan;
  readonly health: HealthCheck;
  readonly metrics: MetricMap;
  readonly image: (host: HostProfile) => string | null;
  readonly defaultPort: number;
}

export type HandleReference =
  | {
      readonly kind: "docker";
      readonly containerId: string;
      readonly daemonId: string;
      readonly executablePath: string;
      readonly executableToken: string;
    }
  | {
      readonly kind: "docker-pending";
      readonly containerName: string;
      readonly nonce: string;
      readonly daemonId: string;
      readonly executablePath: string;
      readonly executableToken: string;
    }
  | { readonly kind: "pinned"; readonly holder: string };

export interface InstanceRecord {
  readonly name: string;
  readonly nodeId: NodeId;
  readonly engine: EngineId;
  readonly recipeId: string;
  readonly runtime: EngineRuntimeKind;
  readonly ref: HandleReference | null;
  readonly port: number;
  readonly devices: readonly DeviceId[];
  readonly nonce: string;
  readonly startedAt: string;
  readonly readyDeadlineAt: string;
}

export type InstanceState = "reserving" | "starting" | "ready" | "unhealthy" | "exited";

export type TelemetryField =
  | "memory"
  | "utilization"
  | "temperature"
  | "power"
  | "storage"
  | "hostMemory";

export type DeviceVendor = "nvidia" | "amd" | "apple" | "intel" | "unknown";

export interface AcceleratorInfo {
  readonly id: DeviceId;
  readonly index: number;
  readonly vendor: DeviceVendor;
  readonly name: string;
  readonly accelerator: Accelerator;
  readonly memoryTotalBytes: number;
  readonly memoryUsedBytes: number;
  readonly unifiedMemory: boolean;
  readonly utilizationPct: number | null;
  readonly temperatureC: number | null;
  readonly powerWatts: number | null;
  readonly powerLimitWatts: number | null;
  readonly driver: string | null;
}

export interface HostInfo {
  readonly cpuModel: string;
  readonly cpuCount: number;
  readonly memoryTotalBytes: number;
  readonly memoryAvailableBytes: number;
  readonly swapTotalBytes: number | null;
  readonly platform: HostPlatform;
  readonly arch: HostArch;
  readonly release: string;
  readonly uptimeSeconds: number;
}

export interface VolumeInfo {
  readonly mount: string;
  readonly totalBytes: number;
  readonly freeBytes: number;
  readonly filesystem: string | null;
  readonly model: string | null;
  readonly rotational: boolean | null;
}

export interface ThermalInfo {
  readonly label: string;
  readonly celsius: number;
  readonly source: "gpu" | "cpu" | "chassis";
}

export interface DeviceSnapshot {
  readonly sampledAt: string;
  readonly accelerators: readonly AcceleratorInfo[];
  readonly host: HostInfo;
  readonly storage: readonly VolumeInfo[];
  readonly thermals: readonly ThermalInfo[];
  readonly capabilities: readonly TelemetryField[];
}

export type LaunchFailure =
  | { readonly kind: "unsupported"; readonly engine: EngineId; readonly reason: string }
  | { readonly kind: "already-running"; readonly name: string }
  | { readonly kind: "no-capacity"; readonly need: number; readonly free: number }
  | { readonly kind: "install-failed"; readonly engine: EngineId; readonly detail: string }
  | {
      readonly kind: "spawn-failed";
      readonly detail: string;
      readonly startedReference?: HandleReference;
    }
  | {
      readonly kind: "exited-early";
      readonly exitCode: number | null;
      readonly signal: string | null;
      readonly logTail: string;
    }
  | { readonly kind: "unhealthy-timeout"; readonly waitedMs: number; readonly logTail: string }
  | { readonly kind: "cancelled" };
