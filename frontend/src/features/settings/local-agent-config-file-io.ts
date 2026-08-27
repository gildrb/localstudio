import { chmod, copyFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import YAML from "yaml";
import { Schema } from "effect";
import {
  JsonRecordSchema,
  type Json as JsonValue,
  type RecordJson as JsonRecord,
} from "@/lib/json";

export { JsonRecordSchema };
export type { JsonValue, JsonRecord };
const decodeJsonRecord = Schema.decodeUnknownOption(JsonRecordSchema);
const isString = Schema.is(Schema.String);

const normalizeBaseUrl = (url: string): string => url.trim().replace(/\/+$/, "");

export const sameBaseUrl = (a: JsonValue, b: string): boolean =>
  isString(a) && normalizeBaseUrl(a) === normalizeBaseUrl(b);

export async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

export async function readJsonFile(
  file: string,
): Promise<{ exists: boolean; config?: JsonRecord; error?: string }> {
  let raw: string;
  try {
    raw = await readFile(file, "utf-8");
  } catch {
    return { exists: false };
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    const config = decodeJsonRecord(parsed);
    if (config._tag === "None") {
      return { exists: true, error: `${file} does not contain a JSON object` };
    }
    return { exists: true, config: { ...config.value } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { exists: true, error: `${file} is not valid JSON (${message}); refusing to modify it` };
  }
}

export async function readYamlFile(
  file: string,
): Promise<{ exists: boolean; document?: YAML.Document; error?: string }> {
  let raw: string;
  try {
    raw = await readFile(file, "utf-8");
  } catch {
    return { exists: false };
  }
  try {
    const document = YAML.parseDocument(raw);
    return { exists: true, document };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { exists: true, error: `${file} is not valid YAML (${message}); refusing to modify it` };
  }
}

function backupTimestamp(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
}

export async function backupExistingFile(file: string): Promise<string> {
  const base = `${file}.bak-local-studio-${backupTimestamp(new Date())}`;
  let backupPath = base;
  let suffix = 2;
  while (await pathExists(backupPath)) {
    backupPath = `${base}-${suffix}`;
    suffix += 1;
  }
  await copyFile(file, backupPath);
  return backupPath;
}

export async function writeJsonAtomic(
  file: string,
  config: JsonRecord,
  mode: number,
): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${randomBytes(6).toString("hex")}`;
  await writeFile(tmp, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf-8", mode });
  // writeFile's mode is subject to the process umask; chmod makes it exact.
  await chmod(tmp, mode);
  await rename(tmp, file);
}

export async function writeYamlAtomic(
  file: string,
  config: JsonRecord,
  mode: number,
): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${randomBytes(6).toString("hex")}`;
  const yamlText = YAML.stringify(config, { indent: 2, lineWidth: 0 });
  await writeFile(tmp, yamlText, { encoding: "utf-8", mode });
  await chmod(tmp, mode);
  await rename(tmp, file);
}

export async function existingFileMode(file: string): Promise<number | null> {
  try {
    return (await stat(file)).mode & 0o777;
  } catch {
    return null;
  }
}
