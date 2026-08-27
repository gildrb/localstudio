import type { Json } from "./studio-core";

export function jsonRequest(body: Json, method = "POST"): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}
