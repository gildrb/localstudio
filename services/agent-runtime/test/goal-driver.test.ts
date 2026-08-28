import { afterEach, beforeEach, expect, jest, test } from "bun:test";
import { cleanTemps, isolatedDataDir } from "./test-fixtures";
import { attachGoalDriver, markGoalTurnAborted } from "../src/goal-driver";
import { readGoal, writeGoal } from "../src/goals-store";
import type { LoggedPiEvent, PiAgentSession, PiAgentStatus } from "../src/pi-runtime-types";

const id = "goal-driver-test-session";
const original = process.env.LOCAL_STUDIO_DATA_DIR;
const disposers = new Set<() => void>();
beforeEach(() => {
  const directory = isolatedDataDir("goal-driver-");
  process.env.LOCAL_STUDIO_DATA_DIR = directory;
  jest.useFakeTimers();
});
afterEach(() => {
  for (const dispose of disposers) dispose();
  disposers.clear();
  if (original === undefined) delete process.env.LOCAL_STUDIO_DATA_DIR;
  else process.env.LOCAL_STUDIO_DATA_DIR = original;
  jest.useRealTimers();
  cleanTemps();
});

type GoalEvent = LoggedPiEvent["event"];
type Harness = {
  session: PiAgentSession;
  status: PiAgentStatus;
  emit: (event: GoalEvent) => void;
  waitForIdle: () => Promise<void>;
  prompts: string[];
};
function harness(): Harness {
  const listeners: Array<(event: LoggedPiEvent) => void> = [],
    prompts: string[] = [];
  let seq = 0;
  const status: PiAgentStatus = {
    running: false,
    active: false,
    modelId: "test",
    cwd: "/tmp",
    piSessionId: id,
    agentDir: "/tmp",
    eventSeq: 0,
    lastError: null,
    contextUsage: null,
  };
  const session: PiAgentSession = {
    status,
    async ensureStarted() {},
    async prompt(message) {
      prompts.push(message);
    },
    async steer() {},
    async mutateQueuedFollowUp() {},
    async followUp() {},
    async abort() {
      return { steering: [], followUp: [] };
    },
    async compact() {
      throw new Error("compact is not available in the goal-driver harness");
    },
    async stop() {},
    getEventsAfter() {
      return [];
    },
    onLoggedEvent(listener) {
      listeners.push(listener);
      return () => undefined;
    },
    adoptPiSessionId(piSessionId) {
      status.piSessionId = piSessionId ?? null;
    },
    respondExtensionUi() {
      return false;
    },
  };
  const control = attachGoalDriver(session);
  disposers.add(() => control.dispose());
  return {
    session,
    status,
    prompts,
    waitForIdle: () => control.waitForIdle(),
    emit(event) {
      for (const listener of listeners) listener({ seq: ++seq, event, timestamp: "" });
    },
  };
}
const says = (text: string) => ({
  type: "message",
  message: { role: "assistant", content: [{ type: "text", text }] },
});
const goal = (patch: Parameters<typeof writeGoal>[1] = {}) =>
  writeGoal(id, {
    objective: "ship the release",
    status: "active",
    resetProgress: true,
    ...patch,
  });
async function turn(harness: Harness, text?: string): Promise<void> {
  harness.emit({ type: "agent_start" });
  if (text) harness.emit(says(text));
  harness.emit({ type: "agent_settled" });
  await harness.waitForIdle();
}

test("ordinary turns count and remain active", async () => {
  const h = harness();
  await goal();
  await turn(h, "Rebuilt the bundle.");
  const result = await readGoal(id);
  expect(result?.status).toBe("active");
  expect(result?.turnsUsed).toBe(1);
});

test("this turn's completion sentinel settles the goal", async () => {
  const h = harness();
  await goal();
  await turn(h, "All green.\nGOAL_COMPLETE");
  expect((await readGoal(id))?.status).toBe("complete");
});

test("textless turns do not inherit old sentinels", async () => {
  const h = harness();
  await goal();
  await turn(h, "All green.\nGOAL_COMPLETE");
  await goal({ objective: "now do the next thing" });
  h.emit({ type: "agent_start" });
  h.emit({ type: "tool_execution_start" });
  h.emit({ type: "agent_settled" });
  await h.waitForIdle();
  const result = await readGoal(id);
  expect(result?.status).toBe("active");
  expect(result?.turnsUsed).toBe(1);
});

test("spent turn budgets stop pursuit", async () => {
  const h = harness();
  await goal({ turnBudget: 1 });
  await turn(h, "Working.");
  const result = await readGoal(id);
  expect(result?.status).toBe("budget_limited");
  expect(result?.turnsUsed).toBe(1);
});

test("pursuit time is banked per run", async () => {
  const h = harness();
  await goal();
  h.emit({ type: "agent_start" });
  await h.waitForIdle();
  expect((await readGoal(id))?.activeRunStartedAt).not.toBeNull();
  jest.advanceTimersByTime(1_500);
  h.emit({ type: "agent_settled" });
  await h.waitForIdle();
  const result = await readGoal(id);
  expect(result?.activeRunStartedAt).toBeNull();
  expect(result?.timeUsedSeconds).toBe(1.5);
});

test("Stop pauses without reprompting", async () => {
  const h = harness();
  await goal();
  h.emit({ type: "agent_start" });
  markGoalTurnAborted(h.session);
  h.emit({ type: "agent_settled" });
  await h.waitForIdle();
  expect((await readGoal(id))?.status).toBe("paused");
  jest.advanceTimersByTime(2_000);
  await h.waitForIdle();
  expect(h.prompts).toHaveLength(0);
});

test("runtime errors pause pursuit", async () => {
  const h = harness();
  await goal();
  h.emit({ type: "agent_start" });
  h.status.lastError = "model unreachable";
  h.emit({ type: "agent_settled" });
  await h.waitForIdle();
  expect((await readGoal(id))?.status).toBe("paused");
});

test("tool-free continuations park the goal", async () => {
  const h = harness();
  await goal();
  await turn(h, "Working.");
  jest.advanceTimersByTime(2_000);
  await h.waitForIdle();
  expect(h.prompts).toHaveLength(1);
  expect(h.prompts[0]).toContain("ship the release");
  h.emit(says("I think we are nearly there."));
  h.emit({ type: "agent_settled" });
  await h.waitForIdle();
  expect((await readGoal(id))?.status).toBe("paused");
});
