import { Hono } from "hono";
import * as automation from "./automation-handlers";
import * as browser from "./browser-handlers";
import * as connector from "./connector-handlers";
import * as discovery from "./discovery-handlers";
import * as google from "./google-account-handlers";
import * as agent from "./handlers";
import { models } from "./model-handlers";
import * as oauth from "./oauth-handlers";
import * as plugin from "./plugin-handlers";
import * as project from "./project-handlers";
import * as provider from "./provider-handlers";
import * as pr from "./pr-handlers";
import * as pty from "./pty-handlers";
import * as session from "./session-handlers";
import * as subagent from "./subagent-handlers";

const API = "/api/agent";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const isLoopbackHost = (header?: string): boolean => {
  if (!header) return false;
  const host = header.trim().toLowerCase();
  return LOOPBACK_HOSTS.has(
    host.startsWith("[") ? host.replace(/\]:\d+$/, "]") : host.replace(/:\d+$/, ""),
  );
};
type Params = Record<string, string>;
type Route = [string, (request: Request, params: Params) => Response | Promise<Response>];

const getRoutes: Route[] = [
  ["/runtime/sessions", agent.runtimeSessions],
  ["/runtime/status", agent.runtimeStatus],
  ["/runtime/events", agent.runtimeEvents],
  ["/session-list-changed", agent.sessionListChanged],
  ["/setup-checks", agent.setupChecks],
  ["/models", models],
  ["/sessions", session.list],
  ["/sessions/all", session.listAll],
  ["/sessions/:id", (request, { id }) => session.get(request, id)],
  ["/automations", automation.list],
  ["/connectors", connector.list],
  ["/connectors/call", connector.inventory],
  ["/connectors/grants", connector.getGrants],
  ["/connectors/ssh-server-path", connector.sshServerPath],
  ["/oauth/status", oauth.handleOAuthStatus],
  ["/accounts/google", google.handleGoogleAccountGet],
  ["/projects", project.list],
  ["/plugins", plugin.list],
  ["/plugins/source", plugin.source],
  ["/skills", discovery.listSkills],
  ["/skills/load", discovery.loadSkill],
  ["/prompt-templates", discovery.listPromptTemplates],
  ["/prompt-templates/load", discovery.loadPromptTemplate],
  ["/pr", pr.get],
  ["/subagents", subagent.list],
  ["/subagents/:runId", (request, { runId }) => subagent.get(request, runId)],
  ["/goal", automation.getGoal],
  ["/providers", provider.handleProvidersList],
  [
    "/providers/login/:jobId",
    (request, { jobId }) => provider.handleProviderLoginJob(request, jobId),
  ],
  ["/terminal/pty/stream", pty.stream],
  ["/browser/fetch", browser.fetchPage],
  ["/browser/frame", browser.frame],
  ["/browser/localhosts", browser.localhosts],
  ["/browser/state", browser.state],
  ["/browser/history", browser.history],
  ["/browser/engines", browser.engines],
];
const postRoutes: Route[] = [
  ["/turn", agent.turn],
  ["/abort", agent.abort],
  ["/compact", agent.compact],
  ["/runtime/extension-ui", agent.extensionUiResponse],
  ["/models", models],
  ["/automations", automation.create],
  ["/automations/:id/run", (_, { id }) => automation.run(id)],
  ["/connectors", connector.upsert],
  ["/connectors/call", connector.call],
  ["/connectors/test", connector.test],
  ["/oauth/authorize", oauth.handleOAuthAuthorizeBegin],
  ["/accounts/google/authorize", google.handleGoogleAuthorizeBegin],
  ["/projects", project.add],
  ["/plugins", plugin.upsert],
  ["/pr/merge", pr.merge],
  ["/subagents", subagent.run],
  ["/subagents/:runId/stop", (request, { runId }) => subagent.stop(request, runId)],
  [
    "/providers/login/:jobId/respond",
    (request, { jobId }) => provider.handleProviderLoginRespond(request, jobId),
  ],
  ["/providers/login/:jobId/cancel", (_, { jobId }) => provider.handleProviderLoginCancel(jobId)],
  [
    "/providers/:providerId/login",
    (request, { providerId }) => provider.handleProviderLogin(request, providerId),
  ],
  [
    "/providers/:providerId/logout",
    (_, { providerId }) => provider.handleProviderLogout(providerId),
  ],
  ["/terminal/pty/open", pty.open],
  ["/terminal/pty/input", pty.input],
  ["/terminal/pty/resize", pty.resize],
  ["/terminal/pty/close", pty.close],
  ["/browser/input", browser.input],
  ["/browser/viewport", browser.viewport],
  ["/browser/engine", browser.selectEngine],
  ["/browser/:verb", (request, { verb }) => browser.verb(request, verb)],
];
const patchRoutes: Route[] = [
  ["/sessions/:id", (request, { id }) => session.patch(request, id)],
  ["/automations/:id", (request, { id }) => automation.patch(request, id)],
];
const putRoutes: Route[] = [
  ["/connectors/grants", connector.putGrant],
  ["/oauth/client", oauth.handleOAuthClientPut],
  ["/accounts/google", google.handleGoogleClientPut],
  ["/goal", automation.putGoal],
];
const deleteRoutes: Route[] = [
  ["/sessions", session.remove],
  ["/automations/:id", (_, { id }) => automation.remove(id)],
  ["/connectors", connector.remove],
  ["/connectors/grants", connector.deleteGrant],
  ["/oauth/authorize", oauth.handleOAuthAuthorizeCancel],
  ["/oauth", oauth.handleOAuthDisconnect],
  ["/accounts/google", google.handleGoogleAccountDisconnect],
  ["/accounts/google/authorize", google.handleGoogleAuthorizeCancel],
  ["/projects", project.remove],
  ["/plugins", plugin.remove],
  ["/goal", automation.deleteGoal],
];

export function createAgentRuntimeApp() {
  const app = new Hono();
  app.use("*", (c, next) =>
    isLoopbackHost(c.req.header("host"))
      ? next()
      : Promise.resolve(c.json({ error: "Forbidden host" }, 403)),
  );
  app.get("/health", (c) =>
    c.json({ ok: true, service: "local-studio-agent-runtime", pid: process.pid }),
  );
  for (const [path, handle] of getRoutes)
    app.get(`${API}${path}`, (c) => handle(c.req.raw, c.req.param()));
  for (const [path, handle] of postRoutes)
    app.post(`${API}${path}`, (c) => handle(c.req.raw, c.req.param()));
  for (const [path, handle] of patchRoutes)
    app.patch(`${API}${path}`, (c) => handle(c.req.raw, c.req.param()));
  for (const [path, handle] of putRoutes)
    app.put(`${API}${path}`, (c) => handle(c.req.raw, c.req.param()));
  for (const [path, handle] of deleteRoutes)
    app.delete(`${API}${path}`, (c) => handle(c.req.raw, c.req.param()));
  app.onError((error, c) =>
    c.json({ error: error instanceof Error ? error.message : "Internal Server Error" }, 500),
  );
  return { app };
}
