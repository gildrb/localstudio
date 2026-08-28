import { Schema } from "effect";
import { ConnectorTestInputSchema, ConnectorUpsertInputSchema } from "../connector-contract";
import {
  connectorToolPrefix,
  enabledConnectors,
  isValidConnectorId,
  listConnectors,
  removeConnector,
  toConnectorView,
  upsertConnector,
  type ConnectorConfig,
} from "../connectors-service";
import {
  callConnectorTool,
  closePooledConnection,
  ConnectorToolDeniedError,
  listConnectorTools,
  probeConnector,
} from "../connector-pool";
import {
  isConnectorToolGranted,
  listConnectorGrants,
  removeConnectorGrant,
  resolveGrantedTools,
  setConnectorGrant,
} from "../connector-grants";
import {
  ConnectorGrantInputSchema,
  ConnectorGrantRemovalSchema,
  type ConnectorGrantTarget,
} from "../connector-grants-contract";
import { resolveBundledResource } from "../plugin-resources";
import { decodeJsonBody, errorMessage, jsonError } from "./helpers";

export async function list(): Promise<Response> {
  const connectors = await listConnectors();
  return Response.json({ connectors: connectors.map(toConnectorView) });
}

async function rejectionFor(
  body: typeof ConnectorUpsertInputSchema.Type,
): Promise<Response | null> {
  if (!isValidConnectorId(body.id)) return jsonError("invalid connector id");
  if (body.transport === "stdio" && !body.command) {
    return jsonError("command is required for stdio");
  }
  if (body.transport === "http") {
    if (!body.url) return jsonError("url is required for http");
    if (!/^https?:\/\//i.test(body.url)) {
      return jsonError("url must start with http:// or https://");
    }
  }
  const collision = (await listConnectors()).find(
    (entry) =>
      entry.id !== body.id && connectorToolPrefix(entry.id) === connectorToolPrefix(body.id),
  );
  return collision
    ? jsonError(`Tool names would collide with connector "${collision.id}"`, 409)
    : null;
}

function connectorFrom(body: typeof ConnectorUpsertInputSchema.Type): ConnectorConfig {
  const { allowTools, ...connector } = body;
  const result: ConnectorConfig = {
    ...connector,
    name: connector.name?.trim() || connector.id,
    enabled: connector.enabled ?? true,
  };
  return allowTools?.length ? { ...result, allowTools } : result;
}

export async function upsert(request: Request): Promise<Response> {
  const body = await decodeJsonBody(request, ConnectorUpsertInputSchema);
  if (!body) return jsonError("invalid connector payload");
  const rejection = await rejectionFor(body);
  if (rejection) return rejection;
  const connector = connectorFrom(body);
  try {
    const connectors = await upsertConnector(connector);
    closePooledConnection(connector.id);
    return Response.json({ connectors: connectors.map(toConnectorView) });
  } catch (error) {
    return jsonError(errorMessage(error, "Connector could not be saved"), 409);
  }
}

export async function remove(request: Request): Promise<Response> {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!id) return jsonError("id is required");
  try {
    const connectors = await removeConnector(id);
    closePooledConnection(id);
    return Response.json({ connectors: connectors.map(toConnectorView) });
  } catch (error) {
    return jsonError(errorMessage(error, "Connector could not be removed"), 409);
  }
}

const ConnectorToolCallSchema = Schema.Struct({
  connector_id: Schema.String,
  tool: Schema.String,
  args: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  model_id: Schema.optional(Schema.String),
});

const callerModelId = (value: string | null | undefined): string => value?.trim() ?? "";

export async function inventory(request: Request): Promise<Response> {
  const modelId = callerModelId(new URL(request.url).searchParams.get("model_id"));
  const grants = await listConnectorGrants();
  const granted = (await enabledConnectors()).flatMap((connector) => {
    const tools = resolveGrantedTools(grants, modelId, connector.id);
    return tools === "all" || tools.length ? [{ connector, tools }] : [];
  });
  const inventory = await Promise.all(
    granted.map(async ({ connector, tools }) => {
      try {
        const available = await listConnectorTools(connector.id);
        return {
          id: connector.id,
          name: connector.name,
          tools:
            tools === "all" ? available : available.filter((tool) => tools.includes(tool.name)),
        };
      } catch (error) {
        return {
          id: connector.id,
          name: connector.name,
          tools: [],
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );
  return Response.json({ connectors: inventory });
}

export async function call(request: Request): Promise<Response> {
  const body = await decodeJsonBody(request, ConnectorToolCallSchema);
  if (!body) return jsonError("connector_id and tool are required");
  if (!body.connector_id.trim() || !body.tool.trim()) {
    return jsonError("connector_id and tool are required");
  }
  try {
    const grants = await listConnectorGrants();
    if (
      !isConnectorToolGranted(grants, callerModelId(body.model_id), body.connector_id, body.tool)
    ) {
      throw new ConnectorToolDeniedError(
        `Model is not granted "${body.tool}" on connector "${body.connector_id}"`,
      );
    }
    const result = await callConnectorTool(body.connector_id, body.tool, body.args ?? {});
    return Response.json({ ok: true, result });
  } catch (error) {
    const status = error instanceof ConnectorToolDeniedError ? 403 : 500;
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status },
    );
  }
}

async function grantTargets(probeId: string | null): Promise<ConnectorGrantTarget[]> {
  return Promise.all(
    (await enabledConnectors()).map(async (connector) => {
      const tools =
        probeId === connector.id ? await listConnectorTools(connector.id).catch(() => []) : [];
      return {
        id: connector.id,
        name: connector.name,
        tools: tools.map((tool) => tool.name),
      };
    }),
  );
}

export async function getGrants(request: Request): Promise<Response> {
  try {
    const probeId = new URL(request.url).searchParams.get("connector")?.trim() || null;
    const [grants, connectors] = await Promise.all([listConnectorGrants(), grantTargets(probeId)]);
    return Response.json({ grants, connectors });
  } catch (error) {
    return jsonError(errorMessage(error, "Connector grants failed"), 500);
  }
}

export async function putGrant(request: Request): Promise<Response> {
  const input = await decodeJsonBody(request, ConnectorGrantInputSchema);
  if (!input) return jsonError("modelId, connectorId and tools are required");
  if (!input.modelId.trim() || !input.connectorId.trim()) {
    return jsonError("modelId and connectorId are required");
  }
  try {
    return Response.json({ grants: await setConnectorGrant(input) });
  } catch (error) {
    return jsonError(errorMessage(error, "Connector grant could not be saved"), 500);
  }
}

export async function deleteGrant(request: Request): Promise<Response> {
  const input = await decodeJsonBody(request, ConnectorGrantRemovalSchema);
  if (!input) return jsonError("modelId and connectorId are required");
  try {
    return Response.json({
      grants: await removeConnectorGrant(input.modelId, input.connectorId),
    });
  } catch (error) {
    return jsonError(errorMessage(error, "Connector grant could not be removed"), 500);
  }
}

type ConnectorTestResponse = {
  ok: boolean;
  tool_count: number;
  tool_names: string[];
  error?: string;
};

export async function test(request: Request): Promise<Response> {
  const body = await decodeJsonBody(request, ConnectorTestInputSchema);
  if (!body) return jsonError("id is required");
  const connector = (await listConnectors()).find((entry) => entry.id === body.id);
  if (!connector) return jsonError("unknown connector", 404);
  const result = await probeConnector(connector);
  const response: ConnectorTestResponse = {
    ok: result.ok,
    tool_count: result.tools.length,
    tool_names: result.tools.map((tool) => tool.name).slice(0, 40),
  };
  if (result.error) response.error = result.error;
  return Response.json(response);
}

export async function sshServerPath(): Promise<Response> {
  return Response.json({ path: resolveBundledResource("mcp", "ssh-remote.mjs") });
}
