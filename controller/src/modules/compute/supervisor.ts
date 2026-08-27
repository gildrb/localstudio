import { Effect, Schedule, type Cause } from "effect";
import type { ComputeService } from "./lifecycle";

const SUPERVISE_INTERVAL_MS = 2_000;

export type ComputeSupervisorError = Cause.Cause<never>;

export const startComputeSupervisor = (
  compute: ComputeService,
  onError: (error: ComputeSupervisorError) => void,
): Effect.Effect<never> =>
  compute.superviseOnce().pipe(
    Effect.asVoid,
    Effect.catchCause((cause) => Effect.sync(() => onError(cause))),
    Effect.repeat(Schedule.spaced(SUPERVISE_INTERVAL_MS)),
    Effect.andThen(Effect.never),
  );
