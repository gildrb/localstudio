import { arch, platform } from "node:os";
import { Effect } from "effect";
import type { AcceleratorInfo, DeviceVendor, TelemetryField } from "../contracts";
import { detectGpuMonitoringTool, getGpuInfo } from "../../system/platform/gpu";
import type { GpuInfo, RuntimeGpuMonitoringTool } from "../../models/types";
import { neverFails, type DeviceProbe } from "./probe";

const MB = 1024 * 1024;

const TOOL_VENDORS = {
  "nvidia-smi": "nvidia",
  "amd-smi": "amd",
  "rocm-smi": "amd",
  "intel-sysfs": "intel",
  "apple-metal": "apple",
} satisfies Readonly<Record<RuntimeGpuMonitoringTool, DeviceVendor>>;

const ACCELERATOR_BY_VENDOR = {
  nvidia: "cuda",
  amd: "rocm",
  intel: "xpu",
  apple: "metal",
  unknown: "cpu",
} satisfies Readonly<Record<DeviceVendor, AcceleratorInfo["accelerator"]>>;

const deviceIdFor = (gpu: GpuInfo, vendor: DeviceVendor): string =>
  gpu.uuid ?? gpu.pci_bus_id ?? `${vendor}:${gpu.index}`;

const vendorFor = (tool: RuntimeGpuMonitoringTool | null): DeviceVendor => {
  if (tool) return TOOL_VENDORS[tool];
  if (platform() === "darwin" && arch() === "arm64") return "apple";
  return "unknown";
};

const available = (flag: boolean | undefined): boolean => flag !== false;

const reading = (flag: boolean | undefined, value: number | undefined): number | null =>
  available(flag) && value !== undefined && Number.isFinite(value) ? value : null;

const toAccelerator = (gpu: GpuInfo, vendor: DeviceVendor): AcceleratorInfo => ({
  id: deviceIdFor(gpu, vendor),
  index: gpu.index,
  vendor,
  name: gpu.name,
  accelerator: ACCELERATOR_BY_VENDOR[vendor],
  memoryTotalBytes: Math.max(0, gpu.memory_total_mb) * MB,
  memoryUsedBytes: available(gpu.memory_usage_available) ? Math.max(0, gpu.memory_used_mb) * MB : 0,
  // Apple Silicon and the Grace/GB10 parts share one pool with the CPU; never budget
  // their VRAM separately from host RAM.
  unifiedMemory: gpu.memory_shared === true,
  utilizationPct: reading(gpu.utilization_available, gpu.utilization_pct),
  temperatureC: reading(gpu.temperature_available, gpu.temp_c),
  powerWatts: reading(gpu.power_available, gpu.power_draw),
  powerLimitWatts: reading(gpu.power_available, gpu.power_limit),
  driver: null,
});

const capabilitiesOf = (accelerators: readonly AcceleratorInfo[]): readonly TelemetryField[] => {
  if (accelerators.length === 0) return [];
  const capabilities: TelemetryField[] = ["memory"];
  if (accelerators.some((entry) => entry.utilizationPct !== null)) capabilities.push("utilization");
  if (accelerators.some((entry) => entry.temperatureC !== null)) capabilities.push("temperature");
  if (accelerators.some((entry) => entry.powerWatts !== null)) capabilities.push("power");
  return capabilities;
};

export const acceleratorProbe: DeviceProbe = {
  id: "accelerators",
  detect: () => true,
  run: () =>
    neverFails(
      Effect.gen(function* () {
        const tool = yield* detectGpuMonitoringTool();
        const gpus = yield* getGpuInfo();
        const vendor = vendorFor(tool);
        const accelerators = gpus.map((gpu) => toAccelerator(gpu, vendor));
        return { fragment: { accelerators }, capabilities: capabilitiesOf(accelerators) };
      }),
    ),
};
