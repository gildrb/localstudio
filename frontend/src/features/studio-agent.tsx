"use client";
import { Schema } from "effect";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import {
  ErrorText,
  JsonView,
  Page,
  jsonText,
  Tabs,
  records,
  requestRecord,
  useJson,
  type Json,
  type RecordJson,
} from "./studio-core";
import { WorkspaceTools } from "./studio-tools";
import { jsonRequest } from "./studio-request";
import {
  acceptRuntimePayload,
  decodeCanonicalSession,
  decodeRuntimePayload,
  decodeRuntimeSnapshot,
  foldSessionEvent,
  foldSessionEvents,
  exportTranscript,
  reconcileQueueEvent,
  mergeCanonicalRuntimeEvents,
  type FoldedMessage,
  type QueuedTurn,
  type RuntimeCursor,
} from "./studio-domain";

const isString = Schema.is(Schema.String);
const SessionPreferenceSchema = Schema.Struct({
  title: Schema.optional(Schema.String),
  pinned: Schema.optional(Schema.Boolean),
  hidden: Schema.optional(Schema.Boolean),
});
const SessionPreferencesSchema = Schema.Record(Schema.String, SessionPreferenceSchema);
type SessionPreference = typeof SessionPreferenceSchema.Type;
type SessionPreferences = typeof SessionPreferencesSchema.Type;
const decodeSessionPreferences = Schema.decodeUnknownOption(SessionPreferencesSchema);
const TurnResponseSchema = Schema.Struct({
  outcome: Schema.Literals(["accepted", "queued", "rejected"]),
  piSessionId: Schema.optional(Schema.NullOr(Schema.String)),
});
const decodeTurnResponse = Schema.decodeUnknownSync(TurnResponseSchema);
const ProjectSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  path: Schema.String,
});
const ProjectAddResponseSchema = Schema.Struct({ project: ProjectSchema });
const DirectoryBrowserSchema = Schema.Struct({
  path: Schema.String,
  parent: Schema.NullOr(Schema.String),
  roots: Schema.Array(Schema.String),
  entries: Schema.Array(Schema.Struct({ name: Schema.String, path: Schema.String })),
});
const decodeProjectAddResponse = Schema.decodeUnknownSync(ProjectAddResponseSchema);
const decodeDirectoryBrowser = Schema.decodeUnknownSync(DirectoryBrowserSchema);
type DirectoryBrowser = typeof DirectoryBrowserSchema.Type;

type ProjectOption = { id: string; name: string; path: string };
type SessionFilter = "active" | "archived" | "all";
function selectedWorkspace(projects: ProjectOption[], selectedPath: string, requestedId: string) {
  const requested = projects.find((project) => project.id === requestedId);
  const cwd = selectedPath || requested?.path || projects[0]?.path || "";
  return { cwd, projectId: projects.find((project) => project.path === cwd)?.id ?? requestedId };
}
function sessionListPath(filter: SessionFilter): `/api/${string}` {
  if (filter === "archived") return "/api/agent/sessions/all?archived=only";
  if (filter === "all") return "/api/agent/sessions/all?includeArchived=true";
  return "/api/agent/sessions/all?since=30d";
}
function modelThinkingLevels(model: RecordJson | undefined): string[] {
  return Array.isArray(model?.thinkingLevels) ? model.thinkingLevels.filter(isString) : ["auto"];
}
function modelDestinationId(model: RecordJson | undefined): string {
  const controllerUrl = jsonText(model?.controllerUrl);
  if (controllerUrl) return `controller:${controllerUrl}`;
  return `provider:${jsonText(model?.providerId, jsonText(model?.provider, "unknown"))}`;
}
function isAbsolutePath(value: string): boolean {
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\");
}
function selectedCatalogue(catalogue: RecordJson[], selected: string[]): RecordJson[] {
  return catalogue
    .filter((item) => selected.includes(jsonText(item.id)))
    .map((item) => ({
      id: jsonText(item.id),
      name: jsonText(item.name),
      path: jsonText(item.path),
      source: jsonText(item.source),
    }));
}
function WorkbenchActions({
  quick,
  sessionId,
  projectId,
}: {
  quick: boolean;
  sessionId: string;
  projectId: string;
}) {
  if (!quick)
    return (
      <Tabs
        items={[
          ["/agent/automations", "Goals & automations"],
          ["/configure#integrations", "Connectors"],
        ]}
      />
    );
  if (!sessionId || !globalThis.window?.localStudioDesktop) return null;
  return (
    <button
      onClick={() =>
        window.localStudioDesktop?.quickPanel.focusMainAndNavigate(projectId, sessionId)
      }
    >
      Continue in main window
    </button>
  );
}

function SubagentStatus({ piSessionId }: { piSessionId: string | null }) {
  const state = useJson(
    `/api/agent/subagents?piSessionId=${encodeURIComponent(piSessionId ?? "")}`,
  );
  useMountSubscription(() => {
    if (!piSessionId) return;
    const timer = window.setInterval(() => void state.reload(), 4_000);
    return () => window.clearInterval(timer);
  }, [piSessionId]);
  const runs = records(state.data, "subagents");
  if (!piSessionId || runs.length === 0) return null;
  return (
    <section className="card">
      <h2>Subagents</h2>
      {runs.map((run) => (
        <div className="item" key={jsonText(run.id)}>
          <strong>{jsonText(run.name, "Subagent")}</strong>
          <span>{jsonText(run.status, "unknown")}</span>
          {run.active === false && run.status === "running" ? <span>idle</span> : null}
        </div>
      ))}
    </section>
  );
}

export function Workbench({ quick = false }: { quick?: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedProjectId = searchParams.get("project") ?? "";
  const requestedSessionId = searchParams.get("session") ?? "";
  const requestedNewTask = searchParams.get("new") === "1";
  const handedOffSession = useRef(false);
  const projectsState = useJson("/api/agent/projects");
  const modelsState = useJson("/api/agent/models");
  const providers = useJson("/api/agent/providers");
  const skillsState = useJson("/api/agent/skills");
  const templatesState = useJson("/api/agent/prompt-templates");
  const projects = records(projectsState.data, "projects").map((item) => ({
    id: jsonText(item.id),
    name: jsonText(item.name, jsonText(item.path, "Project")),
    path: jsonText(item.path),
  }));
  const [cwd, setCwd] = useState("");
  const [projectPath, setProjectPath] = useState("");
  const [directoryBrowser, setDirectoryBrowser] = useState<DirectoryBrowser | null>(null);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const workspace = selectedWorkspace(projects, cwd, requestedProjectId);
  const activeCwd = workspace.cwd;
  const activeProjectId = workspace.projectId;
  const [sessionFilter, setSessionFilter] = useState<SessionFilter>(() =>
    searchParams.has("archived") ? "archived" : "active",
  );
  const sessionsState = useJson(sessionListPath(sessionFilter));
  const [sessionId, setSessionId] = useState("");
  const [piSessionId, setPiSessionId] = useState<string | null>(null);
  const cursor = useRef<RuntimeCursor>({ received: 0, committed: 0, unsequenced: 0 });
  const sessionLoadGeneration = useRef(0);
  const [streamVersion, setStreamVersion] = useState(0);
  const [messages, setMessages] = useState<FoldedMessage[]>([]);
  const [queued, setQueued] = useState<QueuedTurn[]>([]);
  const [attachments, setAttachments] = useState<
    Array<{ id: string; name: string; dataUrl: string }>
  >([]);
  const [skills, setSkills] = useState<string[]>([]);
  const [templates, setTemplates] = useState<string[]>([]);
  const [thinking, setThinking] = useState("auto");
  const [prompt, setPrompt] = useState("");
  const [destinationId, setDestinationId] = useState("");
  const [modelId, setModelId] = useState("");
  const [taskStatus, setTaskStatus] = useState("Ready");
  const [sending, setSending] = useState(false);
  const [mode, setMode] = useState<"prompt" | "steer" | "follow_up">("prompt");
  const [fullTools, setFullTools] = useState(false);
  const [browserEnabled, setBrowserEnabled] = useState(false);
  const [remoteConsent, setRemoteConsent] = useState(false);
  const [error, setError] = useState("");
  const [sessionTitle, setSessionTitle] = useState("");
  const [pinned, setPinned] = useState(false);
  const [sessionPreferences, setSessionPreferences] = useState<SessionPreferences>({});
  const sessions = records(sessionsState.data, "sessions").sort((left, right) => {
    const leftPinned = sessionPreferences[jsonText(left.id)]?.pinned === true;
    const rightPinned = sessionPreferences[jsonText(right.id)]?.pinned === true;
    return Number(rightPinned) - Number(leftPinned);
  });
  useMountSubscription(() => {
    const apply = (value: Json) => {
      const decoded = decodeSessionPreferences(value);
      if (decoded._tag === "Some") setSessionPreferences(decoded.value);
    };
    if (window.localStudioDesktop) {
      void window.localStudioDesktop.loadSessionPrefs().then(apply);
      return;
    }
    const saved = localStorage.getItem("local-studio-session-preferences");
    if (!saved) return;
    try {
      apply(JSON.parse(saved));
    } catch {
      setError("Saved session preferences are invalid");
    }
  }, []);
  const models = records(modelsState.data, "models");
  const providerCatalogue = records(providers.data, "providers");
  const skillCatalogue = records(skillsState.data, "skills");
  const templateCatalogue = records(templatesState.data, "templates");
  const destinations = Array.from(
    new Map(
      models.map((model) => {
        const id = modelDestinationId(model);
        const providerId = jsonText(model.providerId, jsonText(model.provider));
        const provider = providerCatalogue.find((item) => jsonText(item.id) === providerId);
        const controllerName = jsonText(model.controllerName);
        const controllerUrl = jsonText(model.controllerUrl);
        const label = controllerName || jsonText(provider?.name, providerId || "Unknown provider");
        const status = controllerUrl
          ? `Remote controller · ${controllerUrl}`
          : provider?.configured === true
            ? "Signed in"
            : provider?.configured === false
              ? "Sign-in required"
              : "Available";
        return [id, { id, label, status }] as const;
      }),
    ).values(),
  );
  const activeDestinationId = destinationId || destinations[0]?.id || "";
  const destinationModels = models.filter(
    (model) => modelDestinationId(model) === activeDestinationId,
  );
  const activeModel = destinationModels.some((model) => jsonText(model.id) === modelId)
    ? modelId
    : jsonText(destinationModels[0]?.id, jsonText(destinationModels[0]?.name));
  const selectedModel = destinationModels.find((model) => jsonText(model.id) === activeModel);
  const activeDestination = destinations.find((item) => item.id === activeDestinationId);
  const modelDestination = `${activeDestinationId}:${activeModel}`;
  const thinkingLevels = modelThinkingLevels(selectedModel);
  useMountSubscription(() => {
    if (thinking !== "auto" && !thinkingLevels.includes(thinking)) setThinking("auto");
  }, [activeModel, thinking]);
  const composerSkills = selectedCatalogue(skillCatalogue, skills);
  const composerTemplates = selectedCatalogue(templateCatalogue, templates);
  const runtimeOptions = {
    cwd: activeCwd,
    modelId: activeModel,
    toolAccess: fullTools ? "full" : "read_only",
    browserToolEnabled: browserEnabled,
    skills: composerSkills,
    promptTemplates: composerTemplates,
  } as const;
  useMountSubscription(() => {
    setRemoteConsent(
      localStorage.getItem(`local-studio.remote-consent.${modelDestination}`) === "1",
    );
  }, [modelDestination]);
  const resetTask = (nextSessionId: string) => {
    sessionLoadGeneration.current += 1;
    setSessionId(nextSessionId);
    setPiSessionId(null);
    cursor.current = { received: 0, committed: 0, unsequenced: 0 };
    setMessages([]);
    setQueued([]);
    setPrompt("");
    setAttachments([]);
    setMode("prompt");
    setSessionTitle("");
    setPinned(false);
    setTaskStatus("Ready for a new task");
    setError("");
    return sessionLoadGeneration.current;
  };
  const createSession = () => resetTask(crypto.randomUUID());
  const selectWorkspacePath = (path: string) => {
    resetTask("");
    setCwd(path);
  };
  useMountSubscription(() => {
    if (!requestedNewTask) return;
    createSession();
    router.replace("/agent");
  }, [requestedNewTask]);
  const registerProject = async (path: string) => {
    try {
      const { project } = decodeProjectAddResponse(
        await requestRecord("/api/agent/projects", jsonRequest({ path })),
      );
      selectWorkspacePath(project.path);
      setProjectPath("");
      setDirectoryBrowser(null);
      setError("");
      void projectsState.reload();
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    }
  };
  const addProjectPath = () => {
    const path = projectPath.trim();
    if (isAbsolutePath(path)) void registerProject(path);
    else setError("Enter an absolute directory path");
  };
  const browseProject = async () => {
    try {
      const project = await window.localStudioDesktop?.openDirectory();
      if (project) void registerProject(project.path);
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    }
  };
  const browseServerDirectory = async (path?: string) => {
    setDirectoryLoading(true);
    setError("");
    try {
      const suffix = path ? `?path=${encodeURIComponent(path)}` : "";
      setDirectoryBrowser(
        decodeDirectoryBrowser(await requestRecord(`/api/agent/directories${suffix}`)),
      );
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setDirectoryLoading(false);
    }
  };
  const selectBrowsedProject = () => {
    if (directoryBrowser) void registerProject(directoryBrowser.path);
  };
  const loadSession = async (id: string, projectPath = activeCwd) => {
    if (!projects.some((project) => project.path === projectPath)) {
      setTaskStatus("Session unavailable");
      setError("This session's project is no longer registered. Add the project again to open it.");
      return;
    }
    const generation = resetTask(id);
    setCwd(projectPath);
    setTaskStatus("Loading session…");
    const preference = sessionPreferences[id];
    setSessionTitle(preference?.title ?? "");
    setPinned(preference?.pinned === true);
    try {
      const data = await requestRecord(
        `/api/agent/sessions/${encodeURIComponent(id)}?cwd=${encodeURIComponent(projectPath)}`,
      );
      const canonical = decodeCanonicalSession(data);
      const canonicalPiSessionId = canonical.meta?.piSessionId ?? null;
      const runtimeData = await requestRecord(
        `/api/agent/runtime/status?sessionId=${encodeURIComponent(id)}${canonicalPiSessionId ? `&piSessionId=${encodeURIComponent(canonicalPiSessionId)}` : ""}`,
      );
      const runtime = decodeRuntimeSnapshot(runtimeData);
      if (sessionLoadGeneration.current !== generation) return;
      setPiSessionId(canonicalPiSessionId);
      cursor.current = { received: runtime.cursor, committed: runtime.cursor, unsequenced: 0 };
      setMessages(foldSessionEvents(mergeCanonicalRuntimeEvents(canonical.events, runtime.events)));
      setQueued([]);
      setTaskStatus("Session ready");
      setStreamVersion((value) => value + 1);
    } catch (value) {
      if (sessionLoadGeneration.current !== generation) return;
      setTaskStatus("Session failed to load");
      setError(value instanceof Error ? value.message : String(value));
    }
  };
  useMountSubscription(() => {
    if (handedOffSession.current || !requestedSessionId || !activeCwd) return;
    handedOffSession.current = true;
    void loadSession(requestedSessionId, activeCwd);
  }, [requestedSessionId, activeCwd]);
  const setArchived = async (archived: boolean) => {
    if (!sessionId) return;
    try {
      await requestRecord(
        `/api/agent/sessions/${encodeURIComponent(sessionId)}`,
        jsonRequest({ cwd: activeCwd, archived }, "PATCH"),
      );
      if (archived) resetTask("");
      void sessionsState.reload();
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    }
  };
  const sessionPreference = (patch: SessionPreference) => {
    if (!sessionId) return;
    setSessionPreferences((current) => {
      const next = { ...current, [sessionId]: { ...current[sessionId], ...patch } };
      if (window.localStudioDesktop) void window.localStudioDesktop.saveSessionPrefs(next);
      else localStorage.setItem("local-studio-session-preferences", JSON.stringify(next));
      return next;
    });
  };
  const exportSession = () => {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(
      new Blob([exportTranscript(messages)], {
        type: "text/markdown",
      }),
    );
    link.download = `${sessionTitle || sessionId || "session"}.md`;
    link.click();
    URL.revokeObjectURL(link.href);
  };
  const control = async (endpoint: "abort" | "compact") => {
    if (!sessionId) return;
    try {
      await requestRecord(
        `/api/agent/${endpoint}`,
        jsonRequest(
          endpoint === "compact"
            ? {
                sessionId,
                piSessionId,
                ...runtimeOptions,
                thinkingLevel: thinking,
              }
            : { sessionId },
        ),
      );
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    }
  };
  const send = async (event: FormEvent) => {
    event.preventDefault();
    const content = prompt.trim();
    if (sending || !content || !activeModel || !activeCwd) return;
    if (!remoteConsent) {
      setError("Confirm the selected destination custody disclosure before sending");
      return;
    }
    const id = sessionId || crypto.randomUUID();
    setSending(true);
    setTaskStatus("Sending…");
    setError("");
    setSessionId(id);
    setPrompt("");
    setMessages((items) => [
      ...items,
      {
        id: `optimistic-${id}-${Date.now()}`,
        role: "user",
        content,
        blocks: [{ type: "text", text: content, value: content }],
      },
    ]);
    try {
      const result = await requestRecord(
        "/api/agent/turn",
        jsonRequest(
          (() => {
            const body: RecordJson = {
              sessionId: id,
              ...runtimeOptions,
              message: content,
              images: attachments.flatMap((attachment) => {
                const separator = attachment.dataUrl.indexOf(",");
                const mime = attachment.dataUrl.slice(5, attachment.dataUrl.indexOf(";"));
                return separator > 0
                  ? [
                      {
                        type: "image",
                        data: attachment.dataUrl.slice(separator + 1),
                        mimeType: mime,
                      },
                    ]
                  : [];
              }),
              piSessionId,
              thinkingLevel: thinking,
            };
            if (mode === "steer") {
              body.mode = "steer";
              body.streamingBehavior = "steer";
            }
            if (mode === "follow_up") {
              body.mode = "follow_up";
              body.streamingBehavior = "followUp";
            }
            return body;
          })(),
        ),
      );
      const command = decodeTurnResponse(result);
      const outcome = command.outcome;
      if (outcome === "queued") {
        setQueued((items) => [...items, { id: crypto.randomUUID(), text: content }]);
        setTaskStatus("Follow-up queued");
      }
      if (outcome === "accepted") {
        setTaskStatus("Agent is working");
        cursor.current = { received: 0, committed: 0, unsequenced: 0 };
        setQueued([]);
        setStreamVersion((value) => value + 1);
      }
      const canonical = command.piSessionId;
      if (canonical) setPiSessionId(canonical);
      setAttachments([]);
      setMessages((items) => [
        ...items,
        {
          id: `command-${id}-${Date.now()}`,
          role: "event",
          content: `Command ${outcome}`,
          blocks: [{ type: "event", text: `Command ${outcome}`, value: outcome }],
        },
      ]);
      if (outcome === "rejected") setTaskStatus("Request rejected");
      void sessionsState.reload();
    } catch (value) {
      setTaskStatus("Send failed");
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setSending(false);
    }
  };
  const attach = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    for (const file of files.slice(0, 4)) {
      if (!file.type.startsWith("image/") || file.size > 10 * 1024 * 1024) {
        setError(`${file.name} must be an image smaller than 10 MiB`);
        continue;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result;
        if (isString(dataUrl))
          setAttachments((items) =>
            [...items, { id: crypto.randomUUID(), name: file.name, dataUrl }].slice(-4),
          );
      };
      reader.readAsDataURL(file);
    }
    event.target.value = "";
  };
  const mutateQueue = async (action: "promote" | "remove" | "replace", queuedTurn: QueuedTurn) => {
    const message = queuedTurn.text;
    try {
      const queueBody: RecordJson = {
        sessionId,
        piSessionId,
        ...runtimeOptions,
        message,
        mode: "follow_up",
        queueAction: action,
      };
      if (action === "replace") queueBody.queueReplacement = prompt.trim() || message;
      await requestRecord("/api/agent/turn", jsonRequest(queueBody));
      setQueued((items) =>
        action === "remove"
          ? items.filter((item) => item.id !== queuedTurn.id)
          : action === "replace"
            ? items.map((item) =>
                item.id === queuedTurn.id ? { ...item, text: prompt.trim() || message } : item,
              )
            : [queuedTurn, ...items.filter((item) => item.id !== queuedTurn.id)],
      );
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    }
  };
  useMountSubscription(() => {
    if (!sessionId) return;
    const events = new EventSource(
      `/api/agent/runtime/events?sessionId=${encodeURIComponent(sessionId)}&after=${cursor.current.received}${piSessionId ? `&piSessionId=${encodeURIComponent(piSessionId)}` : ""}`,
    );
    events.onmessage = (event) => {
      try {
        const raw: Json = JSON.parse(event.data);
        const payload = decodeRuntimePayload(raw);
        if (!payload) return;
        const accepted = acceptRuntimePayload(cursor.current, payload);
        cursor.current = accepted.cursor;
        const acceptedEvent = accepted.event;
        if (acceptedEvent)
          setMessages((items) => foldSessionEvent(items, acceptedEvent, accepted.identity));
        if (acceptedEvent?.type === "queue_update")
          setQueued((items) => reconcileQueueEvent(items, acceptedEvent));
        if (payload.type === "status") {
          setTaskStatus(payload.phase === "idle" ? "Ready" : `Runtime: ${payload.phase}`);
          if (payload.phase === "idle") setQueued([]);
        }
      } catch (value) {
        setError(value instanceof Error ? value.message : "Invalid runtime event");
      }
    };
    events.onerror = () => {
      events.close();
      window.setTimeout(() => setStreamVersion((value) => value + 1), 1200);
    };
    return () => events.close();
  }, [sessionId, piSessionId, streamVersion]);
  const renderProjectSelection = () => (
    <>
      <article aria-labelledby="project-heading">
        <h2 id="project-heading">Project directory</h2>
        <label>
          Working directory
          <select
            value={activeCwd}
            onChange={(event) => selectWorkspacePath(event.target.value)}
            disabled={projectsState.data === null || projects.length === 0}
          >
            {projects.length === 0 ? (
              <option value="">
                {projectsState.data === null ? "Loading projects…" : "No project added"}
              </option>
            ) : null}
            {projects.map((project) => (
              <option key={project.id} value={project.path}>
                {project.name} — {project.path}
              </option>
            ))}
          </select>
        </label>
        <div className="row">
          {globalThis.window?.localStudioDesktop ? (
            <button type="button" onClick={browseProject}>
              Browse native folders…
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => browseServerDirectory(directoryBrowser?.path)}
            disabled={directoryLoading}
          >
            {directoryLoading ? "Loading folders…" : "Browse server folders…"}
          </button>
          <input
            value={projectPath}
            onChange={(event) => setProjectPath(event.target.value)}
            placeholder="Absolute directory path"
            aria-label="Absolute directory path"
          />
          <button type="button" onClick={addProjectPath} disabled={!projectPath.trim()}>
            Add path
          </button>
        </div>
        {directoryBrowser ? (
          <section aria-label="Server folder browser">
            <p>{directoryBrowser.path}</p>
            <div className="row">
              {directoryBrowser.roots.map((rootPath) => (
                <button
                  type="button"
                  key={rootPath}
                  onClick={() => browseServerDirectory(rootPath)}
                >
                  Root: {rootPath}
                </button>
              ))}
              {directoryBrowser.parent ? (
                <button
                  type="button"
                  onClick={() => browseServerDirectory(directoryBrowser.parent ?? undefined)}
                >
                  Parent folder
                </button>
              ) : null}
              <button type="button" onClick={selectBrowsedProject}>
                Add this folder
              </button>
              <button type="button" onClick={() => setDirectoryBrowser(null)}>
                Close browser
              </button>
            </div>
            {directoryBrowser.entries.length === 0 ? (
              <p>No child folders.</p>
            ) : (
              directoryBrowser.entries.map((entry) => (
                <button
                  className="session"
                  type="button"
                  key={entry.path}
                  onClick={() => browseServerDirectory(entry.path)}
                >
                  {entry.name}
                </button>
              ))
            )}
          </section>
        ) : null}
        <p>
          {activeCwd
            ? `Tasks can access ${activeCwd} within the enabled tool limits.`
            : "Add a directory before starting a task."}
        </p>
      </article>
    </>
  );
  const renderDestinationSelection = () => (
    <>
      <article aria-labelledby="destination-heading">
        <h2 id="destination-heading">Model destination</h2>
        <div className="row">
          <label>
            Provider or controller
            <select
              value={activeDestinationId}
              onChange={(event) => {
                setDestinationId(event.target.value);
                setModelId("");
              }}
              disabled={modelsState.data === null || destinations.length === 0}
            >
              {destinations.length === 0 ? (
                <option value="">
                  {modelsState.data === null ? "Loading destinations…" : "No destination found"}
                </option>
              ) : null}
              {destinations.map((destination) => (
                <option key={destination.id} value={destination.id}>
                  {destination.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Model
            <select
              value={activeModel}
              onChange={(event) => setModelId(event.target.value)}
              disabled={destinationModels.length === 0}
            >
              {destinationModels.length === 0 ? (
                <option value="">No models available</option>
              ) : null}
              {destinationModels.map((model) => (
                <option key={jsonText(model.id)} value={jsonText(model.id)}>
                  {jsonText(model.name, jsonText(model.id))}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p role="status">
          <strong>{activeDestination?.label ?? "No destination"}</strong>
          {activeDestination ? ` — ${activeDestination.status}` : " — Configure a provider first"}
          {selectedModel?.active === true ? " · model active" : ""}
        </p>
      </article>
    </>
  );
  const renderProjectAndDestination = () => (
    <div className="grid">
      {renderProjectSelection()}
      {renderDestinationSelection()}
    </div>
  );
  const renderTaskSettings = () => (
    <>
      <div className="row" aria-label="Task controls">
        <label>
          Turn behavior
          <select
            value={mode}
            onChange={(event) => {
              const value = event.target.value;
              if (value === "prompt" || value === "steer" || value === "follow_up") setMode(value);
            }}
          >
            <option value="prompt">Prompt or queue</option>
            <option value="steer">Steer active turn</option>
            <option value="follow_up">Follow up</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={fullTools}
            onChange={(event) => setFullTools(event.target.checked)}
          />
          Allow writes
        </label>
        <label>
          <input
            type="checkbox"
            checked={browserEnabled}
            onChange={(event) => setBrowserEnabled(event.target.checked)}
          />
          Browser
        </label>
        <label>
          Thinking level
          <select value={thinking} onChange={(event) => setThinking(event.target.value)}>
            {["auto", ...thinkingLevels.filter((level) => level !== "auto")].map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </label>
        <label>
          Attach images
          <input type="file" accept="image/*" multiple onChange={attach} />
        </label>
      </div>
      <div className="row">
        {skillCatalogue.map((skill) => {
          const id = jsonText(skill.id);
          const name = jsonText(skill.name, id);
          return (
            <label key={id}>
              <input
                type="checkbox"
                checked={skills.includes(id)}
                onChange={() =>
                  setSkills((items) =>
                    items.includes(id) ? items.filter((item) => item !== id) : [...items, id],
                  )
                }
              />
              Skill: {name}
            </label>
          );
        })}
        {templateCatalogue.map((template) => {
          const id = jsonText(template.id);
          const name = jsonText(template.name, id);
          return (
            <button
              key={id}
              onClick={() =>
                setTemplates((items) =>
                  items.includes(id) ? items.filter((item) => item !== id) : [...items, id],
                )
              }
            >
              Template: {name}
            </button>
          );
        })}
        {attachments.map((attachment) => (
          <span key={attachment.id}>
            {attachment.name}
            <button
              type="button"
              aria-label={`Remove ${attachment.name}`}
              onClick={() =>
                setAttachments((items) => items.filter((item) => item.id !== attachment.id))
              }
            >
              Remove
            </button>
          </span>
        ))}
      </div>
      <label>
        <input
          type="checkbox"
          checked={remoteConsent}
          onChange={(event) => {
            const allowed = event.target.checked;
            setRemoteConsent(allowed);
            localStorage.setItem(
              `local-studio.remote-consent.${modelDestination}`,
              allowed ? "1" : "0",
            );
          }}
        />
        On Send, {activeDestination?.label ?? "the selected destination"}
        {selectedModel ? ` (${jsonText(selectedModel.name, activeModel)})` : ""} receives this
        prompt, attachments, loaded skill/template paths, and enabled tool context. It controls that
        copy under its own retention policy.
      </label>
    </>
  );
  const renderSessionPanel = () => (
    <>
      <aside className="panel">
        <div className="row">
          <select
            aria-label="Session filter"
            value={sessionFilter}
            onChange={(event) => {
              const value = event.target.value;
              if (value === "active" || value === "archived" || value === "all")
                setSessionFilter(value);
            }}
          >
            <option value="active">Active sessions</option>
            <option value="archived">Archived sessions</option>
            <option value="all">All sessions</option>
          </select>
          <button onClick={createSession}>New task</button>
          <button onClick={() => setArchived(true)} disabled={!sessionId}>
            Archive
          </button>
          <button onClick={() => setArchived(false)} disabled={!sessionId}>
            Restore
          </button>
          <button
            onClick={() => {
              const title = window.prompt("Session name", sessionTitle);
              if (title !== null) {
                setSessionTitle(title);
                sessionPreference({ title });
              }
            }}
            disabled={!sessionId}
          >
            Rename
          </button>
          <button
            onClick={() => {
              setPinned((value) => {
                sessionPreference({ pinned: !value });
                return !value;
              });
            }}
            disabled={!sessionId}
          >
            {pinned ? "Unpin" : "Pin"}
          </button>
          <button onClick={exportSession} disabled={!sessionId}>
            Export
          </button>
        </div>
        <h2>Sessions</h2>
        {sessionsState.data === null && !sessionsState.error ? (
          <p role="status">Loading sessions…</p>
        ) : sessions.length === 0 ? (
          <p>No {sessionFilter === "all" ? "saved" : sessionFilter} sessions yet.</p>
        ) : (
          sessions.map((session) => {
            const id = jsonText(session.id);
            return (
              <button
                className="session"
                key={id}
                aria-current={sessionId === id ? "true" : undefined}
                onClick={() => loadSession(id, jsonText(session.cwd, activeCwd))}
              >
                {sessionPreferences[id]?.pinned === true ? "Pinned · " : ""}
                {sessionPreferences[id]?.title ??
                  jsonText(session.firstUserMessage, jsonText(session.title, id))}
              </button>
            );
          })
        )}
        <h2>Provider status</h2>
        {providers.data === null && !providers.error ? (
          <p role="status">Loading providers…</p>
        ) : providerCatalogue.length === 0 ? (
          <p>No sign-in providers found.</p>
        ) : (
          providerCatalogue.map((provider) => (
            <div className="item" key={jsonText(provider.id)}>
              <span>{jsonText(provider.name, jsonText(provider.id))}</span>
              <span>{provider.configured === true ? "Signed in" : "Not signed in"}</span>
            </div>
          ))
        )}
      </aside>
    </>
  );
  const renderTranscript = () => (
    <>
      {messages.length ? (
        messages.map((message) => (
          <div key={message.id} className={message.role}>
            <b>{message.role}</b>
            <p>{message.content}</p>
            {message.blocks
              .filter((block) => block.type !== "text" && !block.text)
              .map((block, index) => (
                <pre key={`${message.id}-${index}`}>{JSON.stringify(block.value, null, 2)}</pre>
              ))}
          </div>
        ))
      ) : (
        <section aria-labelledby="empty-task-heading">
          <h2 id="empty-task-heading">
            {taskStatus === "Loading session…" ? "Loading conversation…" : "Start a new task"}
          </h2>
          <p>
            {taskStatus === "Loading session…"
              ? "The saved transcript and live runtime events are being merged."
              : activeCwd && activeModel
                ? "Describe the result you want. Nothing is sent until you consent and press Send."
                : "Choose a project directory and model destination to begin."}
          </p>
        </section>
      )}
    </>
  );
  const renderQueue = () => (
    <>
      {queued.length ? (
        <section>
          <h3>Queued follow-ups</h3>
          {queued.map((item) => (
            <div className="item" key={item.id}>
              <span>{item.text}</span>
              <button onClick={() => mutateQueue("promote", item)}>Promote</button>
              <button onClick={() => mutateQueue("replace", item)}>Replace with draft</button>
              <button onClick={() => mutateQueue("remove", item)}>Remove</button>
            </div>
          ))}
        </section>
      ) : null}
    </>
  );
  const renderComposer = () => (
    <>
      <form onSubmit={send} aria-labelledby="composer-heading">
        <h2 id="composer-heading">Task composer</h2>
        <label htmlFor="agent-prompt">
          What should the agent do?
          <textarea
            id="agent-prompt"
            rows={5}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Describe the task, constraints, and expected result…"
          />
        </label>
        <div className="row">
          <span>
            {activeDestination?.label ?? "No destination"} · {activeCwd || "No project"}
          </span>
          <button
            type="submit"
            disabled={sending || !prompt.trim() || !remoteConsent || !activeModel || !activeCwd}
          >
            {sending ? "Sending…" : mode === "prompt" ? "Send task" : "Send turn"}
          </button>
        </div>
        {!remoteConsent ? <p>Confirm the destination disclosure above to enable Send.</p> : null}
      </form>
    </>
  );
  const renderChat = () => (
    <article className="chat">
      {renderTranscript()}
      <div className="row">
        <span role="status" aria-live="polite">
          {taskStatus}
        </span>
        <button onClick={() => control("abort")} disabled={!sessionId}>
          Abort
        </button>
        <button
          onClick={() => control("compact")}
          disabled={!sessionId || !activeModel || !activeCwd}
        >
          Compact
        </button>
      </div>
      {renderQueue()}
      {renderComposer()}
    </article>
  );
  return (
    <Page
      title={quick ? "Quick panel" : "Workbench"}
      actions={<WorkbenchActions quick={quick} sessionId={sessionId} projectId={activeProjectId} />}
    >
      <p>
        Sessions and transcripts stay on this workstation. A selected remote provider or controller
        receives the prompt, attachments, selected skill/template text, and tool context. Browser,
        connector, write, or remote access starts only after the matching control is enabled and
        Send is pressed.
      </p>
      <ErrorText
        value={[error, projectsState.error, modelsState.error, providers.error, sessionsState.error]
          .filter(Boolean)
          .slice(0, 1)
          .join("")}
      />
      <SubagentStatus piSessionId={piSessionId} />
      {renderProjectAndDestination()}
      {renderTaskSettings()}
      <div className="workbench">
        {renderSessionPanel()}
        {renderChat()}
      </div>
      {activeCwd ? <WorkspaceTools key={activeCwd} cwd={activeCwd} /> : null}
    </Page>
  );
}

export function Automations() {
  const [piSessionId, setPiSessionId] = useState("");
  const automations = useJson("/api/agent/automations");
  const goal = useJson(`/api/agent/goal?piSessionId=${encodeURIComponent(piSessionId)}`);
  const [text, setText] = useState("");
  const [message, setMessage] = useState("");
  const [automationId, setAutomationId] = useState("");
  const [name, setName] = useState("");
  const [automationPrompt, setAutomationPrompt] = useState("");
  const [model, setModel] = useState("");
  const [cwd, setCwd] = useState("");
  const [scheduleKind, setScheduleKind] = useState<"interval" | "daily" | "weekly">("daily");
  const [minutes, setMinutes] = useState("60");
  const [time, setTime] = useState("08:00");
  const [day, setDay] = useState("1");
  const run = async (path: `/api/${string}`, init?: RequestInit) => {
    try {
      await requestRecord(path, init);
      setMessage("Saved locally");
      void automations.reload();
      void goal.reload();
    } catch (value) {
      setMessage(value instanceof Error ? value.message : String(value));
    }
  };
  const schedule: RecordJson =
    scheduleKind === "interval"
      ? { kind: "interval", minutes: Number(minutes) }
      : scheduleKind === "weekly"
        ? { kind: "weekly", day: Number(day), time }
        : { kind: "daily", time };
  const draft: RecordJson = { name, prompt: automationPrompt, modelId: model, cwd, schedule };
  const saveAutomation = () =>
    run(
      automationId
        ? `/api/agent/automations/${encodeURIComponent(automationId)}`
        : "/api/agent/automations",
      jsonRequest(draft, automationId ? "PATCH" : "POST"),
    );
  return (
    <Page title="Goals & automations" actions={<Link href="/agent">Workbench</Link>}>
      <p>
        Review and explicitly run scheduled local work. Automations use the same provider,
        connector, consent, and filesystem boundaries as Workbench.
      </p>
      <ErrorText value={message || automations.error || goal.error} />
      <div className="grid">
        <article>
          <h2>Goal</h2>
          <div className="row">
            <input
              value={piSessionId}
              onChange={(event) => setPiSessionId(event.target.value)}
              placeholder="Runtime session id"
            />
            <input
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Goal"
            />
            <button
              onClick={() =>
                run(
                  `/api/agent/goal?piSessionId=${encodeURIComponent(piSessionId)}`,
                  jsonRequest({ objective: text }, "PUT"),
                )
              }
            >
              Set
            </button>
            <button
              onClick={() =>
                run(`/api/agent/goal?piSessionId=${encodeURIComponent(piSessionId)}`, {
                  method: "DELETE",
                })
              }
            >
              Clear
            </button>
          </div>
          <JsonView value={goal.data} />
        </article>
        <article>
          <h2>Automations</h2>
          <div className="row">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Name"
            />
            <input
              value={automationPrompt}
              onChange={(event) => setAutomationPrompt(event.target.value)}
              placeholder="Prompt"
            />
            <input
              value={model}
              onChange={(event) => setModel(event.target.value)}
              placeholder="Model id"
            />
            <input
              value={cwd}
              onChange={(event) => setCwd(event.target.value)}
              placeholder="Working directory"
            />
          </div>
          <div className="row">
            <select
              value={scheduleKind}
              onChange={(event) => {
                const value = event.target.value;
                if (value === "interval" || value === "daily" || value === "weekly")
                  setScheduleKind(value);
              }}
            >
              <option value="interval">Interval</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </select>
            {scheduleKind === "interval" ? (
              <input
                value={minutes}
                onChange={(event) => setMinutes(event.target.value)}
                aria-label="Interval minutes"
              />
            ) : (
              <input type="time" value={time} onChange={(event) => setTime(event.target.value)} />
            )}
            {scheduleKind === "weekly" ? (
              <input
                min="0"
                max="6"
                type="number"
                value={day}
                onChange={(event) => setDay(event.target.value)}
                aria-label="Weekday 0 through 6"
              />
            ) : null}
            <button onClick={saveAutomation}>
              {automationId ? "Save automation" : "Create automation"}
            </button>
            <button
              onClick={() => {
                setAutomationId("");
                setName("");
                setAutomationPrompt("");
              }}
            >
              New
            </button>
          </div>
          {records(automations.data, "automations").map((item) => {
            const id = jsonText(item.id);
            return (
              <div className="item" key={id}>
                <span>{jsonText(item.name, id)}</span>
                <button
                  onClick={() => {
                    setAutomationId(id);
                    setName(jsonText(item.name));
                    setAutomationPrompt(jsonText(item.prompt));
                    setModel(jsonText(item.modelId));
                    setCwd(jsonText(item.cwd));
                  }}
                >
                  Edit
                </button>
                <button
                  onClick={() =>
                    run(
                      `/api/agent/automations/${encodeURIComponent(id)}`,
                      jsonRequest(
                        { status: item.status === "paused" ? "active" : "paused" },
                        "PATCH",
                      ),
                    )
                  }
                >
                  {item.status === "paused" ? "Resume" : "Pause"}
                </button>
                <button
                  onClick={() =>
                    run(`/api/agent/automations/${encodeURIComponent(id)}/run`, { method: "POST" })
                  }
                >
                  Run now
                </button>
                <button
                  onClick={() =>
                    run(`/api/agent/automations/${encodeURIComponent(id)}`, { method: "DELETE" })
                  }
                >
                  Delete
                </button>
              </div>
            );
          })}
        </article>
      </div>
    </Page>
  );
}
