import { listBuiltinPlugins } from "../builtin-plugins";
import { PluginUpsertInputSchema } from "../plugin-contract";
import { decodeJsonBody, errorMessage, jsonError } from "./helpers";
import {
  listUserPlugins,
  readUserPlugin,
  removeUserPlugin,
  resolveUserPluginsDir,
  setUserPluginEnabled,
  writeUserPlugin,
} from "../user-plugins";

async function listing(): Promise<Response> {
  const [builtin, user] = await Promise.all([listBuiltinPlugins(), listUserPlugins()]);
  return Response.json({
    directory: resolveUserPluginsDir(),
    plugins: [...builtin, ...user],
  });
}

export async function list(): Promise<Response> {
  return listing();
}

export async function upsert(request: Request): Promise<Response> {
  const body = await decodeJsonBody(request, PluginUpsertInputSchema);
  if (!body) return jsonError("invalid plugin payload");
  try {
    if (body.source !== undefined) await writeUserPlugin(body.id, body.source);
    if (body.enabled !== undefined) await setUserPluginEnabled(body.id, body.enabled);
    return listing();
  } catch (error) {
    return jsonError(errorMessage(error, "Plugin could not be saved"), 409);
  }
}

export async function remove(request: Request): Promise<Response> {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!id) return jsonError("id is required");
  try {
    await removeUserPlugin(id);
    return listing();
  } catch (error) {
    return jsonError(errorMessage(error, "Plugin could not be removed"), 409);
  }
}

export async function source(request: Request): Promise<Response> {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!id) return jsonError("id is required");
  try {
    return Response.json(await readUserPlugin(id));
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Plugin could not be read" },
      { status: 404 },
    );
  }
}
