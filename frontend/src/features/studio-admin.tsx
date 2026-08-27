"use client";
import { Schema } from "effect";
import { useState } from "react";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { ErrorText, JsonView } from "./studio-ui";
import {
  jsonText,
  records,
  requestRecord,
  useJson,
  type Json,
  type RecordJson,
} from "./studio-api";

const isNumber = Schema.is(Schema.Number);
function numberText(value: Json | undefined, fallback = ""): string {
  return isNumber(value) ? String(value) : fallback;
}
function jsonBody(value: RecordJson, method = "POST"): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(value) };
}

function useFields<T extends Record<string, string>>(initial: T) {
  const [fields, setFields] = useState(initial);
  const input = (key: keyof T) => ({
    value: fields[key],
    onChange: (event: { target: { value: string } }) =>
      setFields((current) => ({ ...current, [key]: event.target.value })),
  });
  return { fields, setFields, input };
}
function useMutationActions(success: string, reloads: Array<() => Promise<void>>) {
  const [message, setMessage] = useState("");
  const run = async (path: `/api/${string}`, init?: RequestInit) => {
    try {
      await requestRecord(path, init);
      setMessage(success);
      await Promise.all(reloads.map((reload) => reload()));
    } catch (value) {
      setMessage(value instanceof Error ? value.message : String(value));
    }
  };
  return { message, setMessage, run };
}

export function RecipeManager() {
  const state = useJson("/api/proxy/recipes");
  const status = useJson("/api/proxy/status");
  const { fields, setFields, input } = useFields({
    id: "",
    name: "",
    model: "",
    backend: "llamacpp",
  });
  const { id, name, model, backend } = fields;
  const { message, setMessage, run } = useMutationActions(
    "Recipe state reconciled with the controller",
    [state.reload, status.reload],
  );
  const [pinnedRecipes, setPinnedRecipes] = useState<Set<string>>(new Set());
  useMountSubscription(() => {
    const saved = localStorage.getItem("local-studio-pinned-recipes");
    if (!saved) return;
    try {
      const decoded = Schema.decodeUnknownOption(Schema.Array(Schema.String))(JSON.parse(saved));
      if (decoded._tag === "Some") setPinnedRecipes(new Set(decoded.value));
    } catch {
      setMessage("Saved recipe pins are invalid");
    }
  }, []);
  const togglePin = (recipeId: string) => {
    setPinnedRecipes((current) => {
      const next = new Set(current);
      if (next.has(recipeId)) next.delete(recipeId);
      else next.add(recipeId);
      localStorage.setItem("local-studio-pinned-recipes", JSON.stringify([...next]));
      return next;
    });
  };
  const draft: RecordJson = {
    id: id || name.toLowerCase().replaceAll(" ", "-"),
    name,
    model_path: model,
    backend,
  };
  return (
    <article>
      <h2>Recipe editor</h2>
      <div className="row">
        <input {...input("id")} placeholder="Recipe id" />
        <input {...input("name")} placeholder="Name" />
        <input {...input("model")} placeholder="Local model path" />
        <select {...input("backend")}>
          <option value="vllm">vLLM</option>
          <option value="sglang">SGLang</option>
          <option value="llamacpp">llama.cpp</option>
          <option value="mlx">MLX</option>
        </select>
        <button
          onClick={() =>
            run(
              id ? `/api/proxy/recipes/${encodeURIComponent(id)}` : "/api/proxy/recipes",
              jsonBody(draft, id ? "PUT" : "POST"),
            )
          }
        >
          {id ? "Save recipe" : "Create recipe"}
        </button>
      </div>
      <ErrorText value={message || state.error || status.error} />
      {records(state.data, "recipes")
        .sort(
          (left, right) =>
            Number(pinnedRecipes.has(jsonText(right.id))) -
            Number(pinnedRecipes.has(jsonText(left.id))),
        )
        .map((recipe) => {
          const recipeId = jsonText(recipe.id);
          const label = jsonText(recipe.name) || recipeId;
          return (
            <div className="item" key={recipeId}>
              <span>
                {label} · {jsonText(recipe.status)}
              </span>
              <button
                onClick={() => {
                  setFields({
                    id: recipeId,
                    name: label,
                    model: jsonText(recipe.model_path),
                    backend: jsonText(recipe.backend) || "llamacpp",
                  });
                }}
              >
                Edit
              </button>
              <button onClick={() => togglePin(recipeId)}>
                {pinnedRecipes.has(recipeId) ? "Unpin" : "Pin"}
              </button>
              <button
                onClick={() =>
                  run(`/api/proxy/launch/${encodeURIComponent(recipeId)}`, { method: "POST" })
                }
              >
                Launch
              </button>
              <button
                onClick={() =>
                  run(`/api/proxy/recipes/${encodeURIComponent(recipeId)}`, { method: "DELETE" })
                }
              >
                Delete
              </button>
            </div>
          );
        })}
      <button onClick={() => run("/api/proxy/evict", { method: "POST" })}>Stop active model</button>
      <JsonView value={status.data} />
    </article>
  );
}

export function MachineManager() {
  const rigs = useJson("/api/proxy/studio/rigs");
  const targets = useJson("/api/proxy/runtime/targets");
  const providers = useJson("/api/agent/providers");
  const { fields, setFields, input } = useFields({
    rigId: "",
    nodeId: "",
    name: "",
    description: "",
    hardwareType: "custom",
    role: "standalone",
    hostname: "",
    address: "",
    osName: "",
    cpuModel: "",
    memoryGb: "",
    notes: "",
    acceleratorName: "",
    acceleratorCount: "1",
    acceleratorMemory: "",
    acceleratorType: "",
    acceleratorBandwidth: "",
  });
  const {
    rigId,
    nodeId,
    name,
    description,
    hardwareType,
    role,
    hostname,
    address,
    osName,
    cpuModel,
    memoryGb,
    notes,
    acceleratorName,
    acceleratorCount,
    acceleratorMemory,
    acceleratorType,
    acceleratorBandwidth,
  } = fields;
  const [unifiedMemory, setUnifiedMemory] = useState(false);
  const { message, run } = useMutationActions("Machine configuration saved locally", [
    rigs.reload,
    targets.reload,
    providers.reload,
  ]);
  const editRig = (rig: RecordJson) =>
    setFields((current) => ({
      ...current,
      rigId: jsonText(rig.id),
      name: jsonText(rig.name),
      description: jsonText(rig.description),
    }));
  const editNode = (rig: RecordJson, node: RecordJson) => {
    const accelerator = records({ items: node.accelerators ?? [] }, "items")[0];
    setFields({
      rigId: jsonText(rig.id),
      nodeId: jsonText(node.id),
      name: jsonText(node.name),
      description: jsonText(rig.description),
      hardwareType: jsonText(node.hardware_type) || "custom",
      role: jsonText(node.role) || "standalone",
      hostname: jsonText(node.hostname),
      address: jsonText(node.address),
      osName: jsonText(node.os),
      cpuModel: jsonText(node.cpu_model),
      memoryGb: numberText(node.memory_gb),
      notes: jsonText(node.notes),
      acceleratorName: jsonText(accelerator?.name),
      acceleratorCount: numberText(accelerator?.count, "1"),
      acceleratorMemory: numberText(accelerator?.memory_gb),
      acceleratorType: jsonText(accelerator?.memory_type),
      acceleratorBandwidth: numberText(accelerator?.memory_bandwidth_gbs),
    });
    setUnifiedMemory(accelerator?.unified_memory === true);
  };
  const nodeBody = (): RecordJson => ({
    name,
    hardware_type: hardwareType,
    role,
    hostname: hostname || null,
    address: address || null,
    os: osName || null,
    cpu_model: cpuModel || null,
    memory_gb: Number(memoryGb) || null,
    notes: notes || null,
    accelerators: acceleratorName
      ? [
          {
            name: acceleratorName,
            count: Number(acceleratorCount) || 1,
            memory_gb: Number(acceleratorMemory) || null,
            memory_type: acceleratorType || null,
            memory_bandwidth_gbs: Number(acceleratorBandwidth) || null,
            unified_memory: unifiedMemory,
          },
        ]
      : [],
  });
  return (
    <article>
      <h2>Rigs, nodes, runtimes & providers</h2>
      <div className="row">
        <input {...input("rigId")} placeholder="Rig id" />
        <input {...input("name")} placeholder="Name" />
        <input {...input("description")} placeholder="Description" />
        <button
          onClick={() =>
            run(
              rigId
                ? `/api/proxy/studio/rigs/${encodeURIComponent(rigId)}`
                : "/api/proxy/studio/rigs",
              jsonBody({ name, description: description || null }, rigId ? "PUT" : "POST"),
            )
          }
        >
          Save rig
        </button>
        <button
          disabled={!rigId}
          onClick={() =>
            run(`/api/proxy/studio/rigs/${encodeURIComponent(rigId)}`, { method: "DELETE" })
          }
        >
          Delete rig
        </button>
      </div>
      <div className="row">
        <input {...input("nodeId")} placeholder="Node id" />
        <select {...input("hardwareType")}>
          {(
            [
              "dgx-spark",
              "gpu-desktop",
              "gpu-server",
              "mac",
              "laptop",
              "mini-pc",
              "custom",
            ] as const
          ).map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
        <select {...input("role")}>
          {(["head", "worker", "standalone"] as const).map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
        {(
          [
            ["hostname", "Hostname"],
            ["address", "Address"],
            ["osName", "OS"],
            ["cpuModel", "CPU model"],
            ["memoryGb", "Memory GB"],
            ["notes", "Notes"],
            ["acceleratorName", "Accelerator"],
            ["acceleratorCount", "Accelerator count"],
            ["acceleratorMemory", "Accelerator memory GB"],
            ["acceleratorType", "Memory type"],
            ["acceleratorBandwidth", "Bandwidth GB/s"],
          ] as const
        ).map(([key, label]) => (
          <input key={key} {...input(key)} placeholder={label} />
        ))}
        <label>
          <input
            type="checkbox"
            checked={unifiedMemory}
            onChange={(event) => setUnifiedMemory(event.target.checked)}
          />{" "}
          Unified memory
        </label>
        <button
          disabled={!rigId}
          onClick={() =>
            run(
              nodeId
                ? `/api/proxy/studio/rigs/${encodeURIComponent(rigId)}/nodes/${encodeURIComponent(nodeId)}`
                : `/api/proxy/studio/rigs/${encodeURIComponent(rigId)}/nodes`,
              jsonBody(nodeBody(), nodeId ? "PUT" : "POST"),
            )
          }
        >
          Save node
        </button>
        <button
          disabled={!rigId || !nodeId}
          onClick={() =>
            run(
              `/api/proxy/studio/rigs/${encodeURIComponent(rigId)}/nodes/${encodeURIComponent(nodeId)}`,
              { method: "DELETE" },
            )
          }
        >
          Delete node
        </button>
      </div>
      {records(rigs.data, "rigs").map((rig) => (
        <div className="item" key={jsonText(rig.id)}>
          <button onClick={() => editRig(rig)}>Edit {jsonText(rig.name)}</button>
          {records({ items: rig.nodes ?? [] }, "items").map((node) => (
            <button key={jsonText(node.id)} onClick={() => editNode(rig, node)}>
              Edit {jsonText(node.name)}
            </button>
          ))}
        </div>
      ))}
      {records(targets.data, "targets").map((target) => {
        const targetId = jsonText(target.id);
        return (
          <div className="item" key={targetId}>
            <span>{jsonText(target.name) || targetId}</span>
            <button
              onClick={() =>
                run(`/api/proxy/runtime/targets/${encodeURIComponent(targetId)}/select`, {
                  method: "POST",
                })
              }
            >
              Select runtime
            </button>
          </div>
        );
      })}
      <p>
        Provider accounts use explicit sign-in and sign-out in Integrations. Secrets stay local.
      </p>
      <ErrorText value={message || rigs.error || targets.error || providers.error} />
      <JsonView value={providers.data} />
    </article>
  );
}

function redactDeployLine(line: string): string {
  return line
    .replace(
      /((?:api[_ -]?key|token|secret|password|authorization)["']?\s*[:=]\s*(?:bearer\s+)?["']?)[^"'\s]+/gi,
      "$1[stored]",
    )
    .replace(/(https?:\/\/)[^@\s]+@/gi, "$1[credentials-stored]@");
}

export function DesktopManager() {
  const bridge = globalThis.window?.localStudioDesktop;
  const { fields, input } = useFields({ path: "", projectId: "", deployHost: "", hotkey: "" });
  const { path, projectId, deployHost, hotkey } = fields;
  const [deployMode, setDeployMode] = useState<"ssh" | "local">("ssh");
  const [output, setOutput] = useState<Json | null>(null);
  const [deployLog, setDeployLog] = useState<string[]>([]);
  const [error, setError] = useState("");
  useMountSubscription(
    () =>
      bridge?.controllerDeploy.onLog((line) =>
        setDeployLog((lines) => [...lines, redactDeployLine(line)]),
      ),
    [bridge],
  );
  const call = async (operation: () => Promise<object | string | number | boolean | null>) => {
    try {
      setOutput(JSON.stringify(await operation()));
      setError("");
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    }
  };
  const copyPairingCredential = async () => {
    if (!bridge) return;
    await call(async () => {
      const result = await bridge.getKittylitterPairingJson();
      if (!result.ok || !result.pairingJson)
        return { ok: false, error: result.error ?? "Pairing credential unavailable" };
      const copied = await bridge.copyKittylitterPairingJson(result.pairingJson);
      return { ok: copied.ok, credentialCopied: copied.ok, error: copied.error ?? null };
    });
  };
  const deploy = async () => {
    if (!bridge || (deployMode === "ssh" && !deployHost.trim())) return;
    setDeployLog([]);
    await call(async () => {
      const result = await bridge.controllerDeploy.start({ mode: deployMode, host: deployHost });
      if (!result.ok) return { ok: false, error: result.error ?? "Deployment failed" };
      if (!result.url || !result.apiKey)
        return { ok: false, error: "Deployment omitted credentials" };
      await requestRecord(
        "/api/settings",
        jsonBody({ backendUrl: result.url, apiKey: result.apiKey }),
      );
      return { ok: true, url: result.url, credentialStored: true };
    });
  };
  if (!bridge)
    return (
      <article>
        <h2>Desktop bridge</h2>
        <p>
          Desktop-only project, preference, update, quick panel, open, and reveal controls appear in
          the packaged app.
        </p>
      </article>
    );
  return (
    <article>
      <h2>Desktop bridge</h2>
      <div className="row">
        <button onClick={() => call(() => bridge.openDirectory())}>Add project folder</button>
        <button onClick={() => call(() => bridge.listProjects())}>List projects</button>
        <input {...input("projectId")} placeholder="Project id" />
        <button onClick={() => call(() => bridge.removeProject(projectId))}>Remove project</button>
        <input {...input("path")} placeholder="Local path" />
        <button onClick={() => call(() => bridge.openPath(path))}>Open</button>
        <button onClick={() => call(() => bridge.revealPath(path))}>Reveal</button>
      </div>
      <div className="row">
        <button onClick={() => call(() => bridge.getRuntime())}>Desktop runtime</button>
        <button onClick={() => call(() => bridge.loadUiPreferences())}>Load preferences</button>
        <button
          onClick={() =>
            call(() =>
              bridge
                .saveUiPreferences({ theme: document.documentElement.dataset.theme ?? "dark" })
                .then(() => true),
            )
          }
        >
          Save preferences
        </button>
        <button onClick={() => call(() => bridge.getUpdateStatus())}>Check updates</button>
        <button onClick={() => call(() => bridge.startUpdate())}>Install update</button>
      </div>
      <div className="row">
        <input {...input("hotkey")} placeholder="Quick panel hotkey" />
        <button onClick={() => call(() => bridge.quickPanel.getHotkey())}>Get hotkey</button>
        <button onClick={() => call(() => bridge.quickPanel.setHotkey(hotkey))}>Set hotkey</button>
        <button onClick={() => call(() => bridge.quickPanel.expand().then(() => true))}>
          Open quick panel
        </button>
        <button onClick={() => call(() => bridge.quickPanel.dismiss().then(() => true))}>
          Dismiss quick panel
        </button>
        <button onClick={copyPairingCredential}>Copy KittyLitter pairing credential</button>
        <button
          onClick={() =>
            call(() => bridge.quickPanel.focusMainAndNavigate(projectId).then(() => true))
          }
        >
          Open project in main window
        </button>
      </div>
      <div className="row">
        <select
          value={deployMode}
          onChange={(event) => setDeployMode(event.target.value === "local" ? "local" : "ssh")}
          aria-label="Controller deployment destination"
        >
          <option value="ssh">Remote SSH host</option>
          <option value="local">This machine</option>
        </select>
        {deployMode === "ssh" ? (
          <input {...input("deployHost")} placeholder="SSH host for controller" />
        ) : null}
        <button onClick={deploy}>Deploy controller and store credential</button>
      </div>
      {deployLog.length ? (
        <pre aria-label="Controller deployment log">{deployLog.join("\n")}</pre>
      ) : null}
      <ErrorText value={error} />
      {output === null ? null : <JsonView value={output} />}
    </article>
  );
}

export function NormalizedUsage({ value }: { value: Json | null }) {
  const [view, setView] = useState<"models" | "activity" | "controller" | "errors">("models");
  const root = records([value], "value")[0] ?? {};
  const controller = records([root.controller ?? null], "value")[0] ?? {};
  const rows =
    view === "models"
      ? records(root, "by_model")
      : view === "activity"
        ? records(root, "daily")
        : view === "controller"
          ? records(controller, "by_path")
          : records(controller, "recent_errors");
  return (
    <article>
      <div className="tabs">
        {(["models", "activity", "controller", "errors"] as const).map((name) => (
          <button key={name} onClick={() => setView(name)}>
            {name}
          </button>
        ))}
      </div>
      <p>
        Normalized {view} view · {rows.length} rows · controller metrics included
      </p>
      <JsonView
        value={view === "controller" ? (controller.totals ?? null) : (root.totals ?? null)}
      />
      <JsonView value={rows} />
    </article>
  );
}
