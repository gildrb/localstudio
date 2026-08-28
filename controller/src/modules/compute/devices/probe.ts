import { Effect } from "effect";
import type { DeviceSnapshot, HostProfile, TelemetryField } from "../contracts";

export type SnapshotFragment = Partial<Omit<DeviceSnapshot, "sampledAt" | "capabilities">>;

export interface ProbeResult {
  readonly fragment: SnapshotFragment;
  readonly capabilities: readonly TelemetryField[];
}

export interface DeviceProbe {
  readonly id: string;
  readonly detect: (host: HostProfile) => boolean;
  readonly run: (host: HostProfile) => Effect.Effect<ProbeResult>;
}

export const emptyResult: ProbeResult = { fragment: {}, capabilities: [] };

export const neverFails = (effect: Effect.Effect<ProbeResult>): Effect.Effect<ProbeResult> =>
  effect.pipe(Effect.catchCause(() => Effect.succeed(emptyResult)));
