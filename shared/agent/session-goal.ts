import { Schema } from "effect";

export const GOAL_STATUSES = ["active", "paused", "blocked", "complete", "budget_limited"] as const;

export type GoalStatus = (typeof GOAL_STATUSES)[number];

export const GoalStatusSchema = Schema.Literals(GOAL_STATUSES);

export const SessionGoalSchema = Schema.Struct({
  version: Schema.Literal(1),
  objective: Schema.String,
  status: GoalStatusSchema,
  turnBudget: Schema.NullOr(Schema.Number),
  turnsUsed: Schema.Number,
  // Pursuit time, not wall time. `createdAt` keeps running while the goal is
  // paused, while the user is asleep, and while the session is detached, so it
  // cannot answer "how long has this goal been worked on". The driver banks a
  // finished run's duration into `timeUsedSeconds` and parks the current run's
  // start in `activeRunStartedAt`; elapsed is the sum of the two, and only
  // while a run is actually open. Both survive reload because they are stored,
  // which is what makes the clock monotonic across remounts.
  timeUsedSeconds: Schema.Number,
  activeRunStartedAt: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});

export type SessionGoal = Schema.Schema.Type<typeof SessionGoalSchema>;
