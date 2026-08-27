// Pure pi-event predicates shared by the agent runtime package
// (services/agent-runtime) and the frontend's client-side event pipeline.
// Keep this module dependency-free.

export function isAgentSettledEvent(event: { type?: unknown } | null | undefined): boolean {
  return event?.type === "agent_settled";
}
