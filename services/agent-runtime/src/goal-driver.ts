import { isAgentSettledEvent } from "../../../shared/agent/pi-events";
import { goalContinuationPrompt, goalOutcomeFromText } from "../../../shared/agent/goal-protocol";
import { Schema } from "effect";
import type { LoggedPiEvent, PiAgentSession } from "./pi-runtime-types";
import { readGoal, writeGoal, type GoalWritePatch } from "./goals-store";
import { assistantMessageText } from "./session-text";

const CONTINUATION_GRACE_MS = 2000;
const AssistantEventSchema = Schema.Struct({
  type: Schema.Literals(["message", "message_end"]),
  message: Schema.Struct({ role: Schema.Literal("assistant"), content: Schema.Unknown }),
});

type GoalTurn = {
  startedAt: number | null;
  origin: "user" | "continuation";
  aborted: boolean;
  hadTools: boolean;
  text: string;
  generation: number;
};
type DriverControl = { waitForIdle(): Promise<void>; dispose(): void };
type DriverState = {
  turn: GoalTurn | null;
  nextOrigin: GoalTurn["origin"];
  generation: number;
  timer: ReturnType<typeof setTimeout> | null;
  tail: Promise<void>;
  failure: unknown;
  control?: DriverControl;
};

const driverStates = new WeakMap<PiAgentSession, DriverState>();
const newTurn = (state: DriverState, startedAt: number | null): GoalTurn => ({
  startedAt,
  origin: state.nextOrigin,
  aborted: false,
  hadTools: false,
  text: "",
  generation: state.generation,
});

export function markGoalTurnAborted(session: PiAgentSession): void {
  const state = driverStates.get(session);
  if (state?.turn) state.turn.aborted = true;
}

function eventTouchesTools(event: LoggedPiEvent["event"]): boolean {
  return (event.type ?? "").includes("tool");
}

function assistantTextFromEvent(event: LoggedPiEvent["event"]): string {
  const decoded = Schema.decodeUnknownOption(AssistantEventSchema)(event);
  return decoded._tag === "Some" ? assistantMessageText(decoded.value.message.content) : "";
}

async function openGoalRun(piSessionId: string | null): Promise<void> {
  if (!piSessionId) return;
  const goal = await readGoal(piSessionId);
  if (goal?.status === "active") {
    await writeGoal(piSessionId, { activeRunStartedAt: new Date().toISOString() });
  }
}

async function settleGoalAfterTurn(
  session: PiAgentSession,
  state: DriverState,
  piSessionId: string | null,
  lastError: string | null,
  turn: GoalTurn,
): Promise<void> {
  if (!piSessionId) return;
  const goal = await readGoal(piSessionId);
  if (!goal) return;
  const runSeconds = turn.startedAt === null ? 0 : (Date.now() - turn.startedAt) / 1000;
  const banked = {
    timeUsedSeconds: goal.timeUsedSeconds + runSeconds,
    activeRunStartedAt: null,
  } satisfies GoalWritePatch;
  const settle = async (patch: GoalWritePatch): Promise<void> => {
    await writeGoal(piSessionId, { ...banked, ...patch });
  };

  if (goal.status !== "active") {
    if (runSeconds > 0 || goal.activeRunStartedAt) await writeGoal(piSessionId, banked);
    return;
  }
  if (turn.aborted || lastError) return settle({ status: "paused" });
  const outcome = goalOutcomeFromText(turn.text);
  if (outcome) return settle({ status: outcome.kind === "complete" ? "complete" : "blocked" });

  const turnsUsed = goal.turnsUsed + 1;
  if (goal.turnBudget !== null && turnsUsed >= goal.turnBudget) {
    return settle({ turnsUsed, status: "budget_limited" });
  }
  if (turn.origin === "continuation" && !turn.hadTools) {
    return settle({ turnsUsed, status: "paused" });
  }
  await settle({ turnsUsed });
  scheduleContinuation(session, state, piSessionId, turn.generation);
}

function scheduleContinuation(
  session: PiAgentSession,
  state: DriverState,
  piSessionId: string,
  generation: number,
): void {
  if (state.generation !== generation) return;
  if (state.timer) clearTimeout(state.timer);
  state.timer = setTimeout(() => {
    state.timer = null;
    const run = async () => {
      if (state.generation !== generation || session.status.active) return;
      if (session.status.piSessionId !== piSessionId) return;
      const goal = await readGoal(piSessionId);
      if (!goal || goal.status !== "active") return;
      if (state.generation !== generation || session.status.active) return;
      state.nextOrigin = "continuation";
      try {
        await session.prompt(goalContinuationPrompt(goal.objective), () => {});
      } catch (error) {
        if (!state.turn) state.nextOrigin = "user";
        throw error;
      }
    };
    state.tail = state.tail.then(run).catch((error) => {
      console.error("[agent-runtime] goal continuation failed:", error);
      state.failure ??= error;
    });
  }, CONTINUATION_GRACE_MS);
}

export function attachGoalDriver(session: PiAgentSession): DriverControl {
  const attached = driverStates.get(session);
  if (attached?.control) return attached.control;
  const state: DriverState = {
    turn: null,
    nextOrigin: "user",
    generation: 0,
    timer: null,
    tail: Promise.resolve(),
    failure: null,
  } satisfies DriverState;
  const enqueue = (task: () => Promise<void>) => {
    state.tail = state.tail.then(task).catch((error) => {
      console.error("[agent-runtime] goal driver failed:", error);
      state.failure ??= error;
    });
  };
  const off = session.onLoggedEvent((logged) => {
    const type = logged.event.type ?? "";
    if (type === "agent_start") {
      state.generation += 1;
      if (state.timer) clearTimeout(state.timer);
      state.timer = null;
      state.turn = newTurn(state, Date.now());
      state.nextOrigin = "user";
      const piSessionId = session.status.piSessionId;
      enqueue(() => openGoalRun(piSessionId));
      return;
    }
    state.turn ??= newTurn(state, null);
    if (eventTouchesTools(logged.event)) state.turn.hadTools = true;
    else state.turn.text += assistantTextFromEvent(logged.event);
    if (!isAgentSettledEvent(logged.event)) return;
    const turn = state.turn;
    const { piSessionId, lastError } = session.status;
    state.turn = null;
    enqueue(() => settleGoalAfterTurn(session, state, piSessionId, lastError, turn));
  });
  state.control = {
    async waitForIdle() {
      let observed: Promise<void>;
      do {
        observed = state.tail;
        await observed;
      } while (observed !== state.tail);
      if (state.failure) throw state.failure;
    },
    dispose() {
      off();
      if (state.timer) clearTimeout(state.timer);
      driverStates.delete(session);
    },
  };
  driverStates.set(session, state);
  return state.control;
}
