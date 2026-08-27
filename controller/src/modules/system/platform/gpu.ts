import { existsSync } from "node:fs";
import { arch, cpus, freemem, platform, totalmem } from "node:os";
import { Effect } from "effect";
import type { GpuInfo, RuntimeGpuMonitoringTool } from "../../models/types";
import { runCommandAsyncEffect } from "../../../core/command";
import { getGpuInfoFromAmdSmi, getGpuInfoFromRocmSmi } from "./amd-gpu";
import { getGpuInfoFromIntelSysfs } from "./intel-gpu";
import { resolveRocmSmiTool } from "./rocm-info";
import {
  resolveAmdSmiBinary,
  resolveForcedGpuMonitoringTool,
  resolveNvidiaSmiBinary,
  resolveRocmSmiBinary,
} from "./smi-tools";

const NVIDIA_SMI_GPU_FIELDS = [
  "uuid",
  "pci.bus_id",
  "name",
  "memory.total",
  "memory.used",
  "memory.free",
  "utilization.gpu",
  "temperature.gpu",
  "power.draw",
  "power.limit",
] as const;

const NVIDIA_SMI_SNAPSHOT_QUERY = [...NVIDIA_SMI_GPU_FIELDS, "driver_version"].join(",");
const NVIDIA_SMI_ARGS = [
  `--query-gpu=${NVIDIA_SMI_SNAPSHOT_QUERY}`,
  "--format=csv,noheader,nounits",
];
const NVIDIA_SMI_TIMEOUT_MS = 5_000;

const parseNvidiaSmiGpuLine = (line: string, index: number): GpuInfo => {
  const fields = line.split(",").map((value) => value.trim());
  const name = fields[2] ?? "Unknown";
  const identity = (field: number): string | undefined => {
    const value = fields[field];
    return !value || /^(?:N\/A|\[Not Supported\])$/i.test(value) ? undefined : value;
  };
  const number = (field: number): number => {
    const value = Number(fields[field] ?? 0);
    return Number.isFinite(value) ? value : 0;
  };
  const megabytes = (field: number): number => Math.max(0, Math.round(number(field)));
  const reportedTotalMb = megabytes(3);
  const unified = reportedTotalMb === 0 && /(?:GB10|Grace)/i.test(name);
  const fallbackTotalMb = unified ? Math.round(totalmem() / 1024 / 1024) : 0;
  const fallbackFreeMb = unified ? Math.round(freemem() / 1024 / 1024) : 0;
  const gpu: GpuInfo = {
    index,
    name,
    memory_total_mb: reportedTotalMb || fallbackTotalMb,
    memory_used_mb: megabytes(4) || Math.max(0, fallbackTotalMb - fallbackFreeMb),
    memory_free_mb: megabytes(5) || fallbackFreeMb,
    utilization_pct: number(6),
    temp_c: number(7),
    power_draw: number(8),
    power_limit: number(9),
  };
  const uuid = identity(0);
  const pciBusId = identity(1);
  if (uuid) gpu.uuid = uuid;
  if (pciBusId) gpu.pci_bus_id = pciBusId;
  return gpu;
};

const splitSmiLines = (stdout: string): string[] =>
  stdout
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

const parseNvidiaSmiGpuOutput = (stdout: string): GpuInfo[] =>
  splitSmiLines(stdout).map(parseNvidiaSmiGpuLine);

const parseNvidiaSmiDriverVersion = (stdout: string): string | null => {
  const firstLine = splitSmiLines(stdout)[0];
  if (!firstLine) return null;
  const driver = firstLine.split(",")[NVIDIA_SMI_GPU_FIELDS.length]?.trim();
  return driver || null;
};

export type NvidiaSmiSnapshot = {
  available: boolean;
  gpus: GpuInfo[];
  driverVersion: string | null;
};

export const queryNvidiaSmiSnapshot = (): Effect.Effect<NvidiaSmiSnapshot | null> => {
  const nvidiaSmi = resolveNvidiaSmiBinary();
  if (!nvidiaSmi) return Effect.succeed(null);
  return runCommandAsyncEffect(nvidiaSmi, NVIDIA_SMI_ARGS, {
    timeoutMs: NVIDIA_SMI_TIMEOUT_MS,
  }).pipe(
    Effect.map((result) => {
      if (result.status !== 0 || !result.stdout) {
        return { available: result.status === 0, gpus: [], driverVersion: null };
      }
      return {
        available: true,
        gpus: parseNvidiaSmiGpuOutput(result.stdout),
        driverVersion: parseNvidiaSmiDriverVersion(result.stdout),
      };
    }),
    Effect.catch(() => Effect.succeed({ available: false, gpus: [], driverVersion: null })),
  );
};

export const getGpuInfoFromNvidiaSmi = (): Effect.Effect<GpuInfo[]> =>
  queryNvidiaSmiSnapshot().pipe(Effect.map((snapshot) => snapshot?.gpus ?? []));

export const detectGpuMonitoringTool = (): Effect.Effect<RuntimeGpuMonitoringTool | null> =>
  Effect.gen(function* () {
    const forced = resolveForcedGpuMonitoringTool();
    if (forced) return forced;
    if (resolveNvidiaSmiBinary()) return "nvidia-smi";
    const rocmTool = resolveRocmSmiTool();
    if (rocmTool) return rocmTool;
    if ((yield* getGpuInfoFromIntelSysfs()).length > 0) return "intel-sysfs";
    return null;
  });

let warnedNoGpuTooling = false;

const warnNoGpuToolingOnce = (): void => {
  if (warnedNoGpuTooling) return;
  warnedNoGpuTooling = true;
  const attempted = [
    `nvidia-smi=${resolveNvidiaSmiBinary() ? "found" : "not found"}`,
    `amd-smi=${resolveAmdSmiBinary() ? "found" : "not found"}`,
    `rocm-smi=${resolveRocmSmiBinary() ? "found" : "not found"}`,
    `intel-sysfs=${existsSync("/sys/bus/pci/devices") ? "no compute GPUs" : "unavailable"}`,
  ].join(" ");
  console.warn(`No GPUs reported by any monitoring tool; attempted: ${attempted}`);
};

const collectForcedGpuInfo = (forced: RuntimeGpuMonitoringTool): Effect.Effect<GpuInfo[]> => {
  if (forced === "nvidia-smi") return getGpuInfoFromNvidiaSmi();
  if (forced === "amd-smi") return getGpuInfoFromAmdSmi();
  if (forced === "rocm-smi") return getGpuInfoFromRocmSmi();
  return getGpuInfoFromIntelSysfs();
};

const collectGpuInfo = (): Effect.Effect<GpuInfo[]> =>
  Effect.gen(function* () {
    const forced = resolveForcedGpuMonitoringTool();
    if (forced) return yield* collectForcedGpuInfo(forced);

    const nvidia = yield* getGpuInfoFromNvidiaSmi();
    if (nvidia.length > 0) {
      return nvidia;
    }

    const rocmTool = resolveRocmSmiTool();
    if (rocmTool) {
      const collectors =
        rocmTool === "amd-smi"
          ? [getGpuInfoFromAmdSmi, getGpuInfoFromRocmSmi]
          : [getGpuInfoFromRocmSmi, getGpuInfoFromAmdSmi];
      for (const collect of collectors) {
        const gpus = yield* collect();
        if (gpus.length > 0) return gpus;
      }
      return [];
    }

    const intel = yield* getGpuInfoFromIntelSysfs();
    if (intel.length > 0) {
      return intel;
    }

    if (platform() === "darwin" && arch() === "arm64") {
      const cpuName = cpus()[0]?.model?.trim() || "Apple Silicon";
      const memoryTotalMb = Math.round(totalmem() / 1024 / 1024);
      return [
        {
          id: "apple-metal-0",
          index: 0,
          name: `${cpuName} GPU`,
          memory_total_mb: memoryTotalMb,
          memory_used_mb: 0,
          memory_free_mb: memoryTotalMb,
          utilization_pct: 0,
          temp_c: 0,
          power_draw: 0,
          power_limit: 0,
          memory_shared: true,
          memory_usage_available: false,
          utilization_available: false,
          temperature_available: false,
          power_available: false,
        },
      ];
    }

    return [];
  });

export const getGpuInfo = (): Effect.Effect<GpuInfo[]> =>
  Effect.gen(function* () {
    const gpus = yield* collectGpuInfo();
    if (gpus.length === 0) {
      yield* Effect.sync(warnNoGpuToolingOnce);
    }
    return gpus;
  });
