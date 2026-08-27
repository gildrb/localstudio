import type { GpuInfo } from "../models/types";
import type { EventData } from "./event-manager";

export type MetricValue = number | string | null | undefined;

export const positiveOrUndefined = (value: MetricValue): number | undefined => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

export const roundTenth = (value: number): number => Math.round(value * 10) / 10;
export interface SessionPeaks {
  prompt_throughput: number;
  generation_throughput: number;
  ttft_ms: number;
  kv_cache_usage: number;
  running_requests: number;
  power_watts: number;
  vram_used_gb: number;
}

export const emptyPeaks = (): SessionPeaks => ({
  prompt_throughput: 0,
  generation_throughput: 0,
  ttft_ms: 0,
  kv_cache_usage: 0,
  running_requests: 0,
  power_watts: 0,
  vram_used_gb: 0,
});

export const bumpPeak = (peaks: SessionPeaks, key: keyof SessionPeaks, value: number): void => {
  if (Number.isFinite(value) && value > peaks[key]) peaks[key] = value;
};

export const bumpBestLower = (
  peaks: SessionPeaks,
  key: keyof SessionPeaks,
  value: number,
): void => {
  if (!Number.isFinite(value) || value <= 0) return;
  if (peaks[key] === 0 || value < peaks[key]) peaks[key] = value;
};

export const firstMetric = (metrics: Record<string, number>, names: string[]): number => {
  for (const name of names) {
    const value = metrics[name];
    if (value !== undefined && Number.isFinite(value)) return value;
  }
  return 0;
};

export const lifetimeMetrics = (data: Record<string, number>, powerWatts: number): EventData => ({
  lifetime_prompt_tokens: data["prompt_tokens_total"] ?? 0,
  lifetime_completion_tokens: data["completion_tokens_total"] ?? 0,
  lifetime_requests: data["requests_total"] ?? 0,
  lifetime_energy_kwh: (data["energy_wh"] ?? 0) / 1000,
  lifetime_uptime_hours: (data["uptime_seconds"] ?? 0) / 3600,
  current_power_watts: powerWatts,
});

export const summarizeGpus = (
  gpus: GpuInfo[],
): { powerWatts: number; powerLimitWatts: number; vramUsedGb: number; vramCapacityGb: number } =>
  gpus.reduce(
    (totals, gpu) => ({
      powerWatts: totals.powerWatts + gpu.power_draw,
      powerLimitWatts: totals.powerLimitWatts + gpu.power_limit,
      vramUsedGb: totals.vramUsedGb + gpu.memory_used_mb / 1024,
      vramCapacityGb: totals.vramCapacityGb + gpu.memory_total_mb / 1024,
    }),
    { powerWatts: 0, powerLimitWatts: 0, vramUsedGb: 0, vramCapacityGb: 0 },
  );
