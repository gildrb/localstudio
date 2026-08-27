"use client";

import { Schema } from "effect";
import { useState } from "react";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { JsonRecordSchema, JsonSchema, type Json, type RecordJson } from "@/lib/json";

export { JsonRecordSchema, JsonSchema };
export type { Json, RecordJson };
const decodeJson = Schema.decodeUnknownSync(JsonSchema);
export const isRecordJson = Schema.is(JsonRecordSchema);
const isString = Schema.is(Schema.String);

export function jsonRequest(body: Json, method = "POST"): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}
export async function request(path: `/api/${string}`, init?: RequestInit): Promise<Json> {
  const response = await fetch(path, { cache: "no-store", ...init });
  const body = decodeJson(await response.json().catch(() => null));
  if (!response.ok) {
    const record = isRecordJson(body) ? body : null;
    throw new Error(
      record && isString(record.error) ? record.error : `${response.status} ${response.statusText}`,
    );
  }
  return body;
}
export async function requestRecord(
  path: `/api/${string}`,
  init?: RequestInit,
): Promise<RecordJson> {
  const body = await request(path, init);
  if (!isRecordJson(body)) throw new Error("Expected an object response");
  return body;
}
export function records(value: Json | null, key: string): RecordJson[] {
  const list = Array.isArray(value) ? value : isRecordJson(value) ? value[key] : null;
  return Array.isArray(list) ? list.filter(isRecordJson) : [];
}
export function jsonText(value: Json | undefined, fallback = ""): string {
  return isString(value) ? value : fallback;
}
export function useJson(path: `/api/${string}`) {
  const [data, setData] = useState<Json | null>(null);
  const [error, setError] = useState("");
  const reload = () =>
    request(path)
      .then(setData)
      .catch((value) => setError(value instanceof Error ? value.message : String(value)));
  useMountSubscription(() => {
    void reload();
  }, [path]);
  return { data, error, reload };
}
