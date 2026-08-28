import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const roots: string[] = [];

export function tempDir(prefix: string): string {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

export function isolatedDataDir(prefix: string): string {
  const root = tempDir(prefix);
  writeFileSync(path.join(root, "api-settings.json"), "{}", { mode: 0o600 });
  return root;
}

export function cleanTemps(): void {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
}

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export function jsonResponse(body: JsonValue): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
