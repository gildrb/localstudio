import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export function writeJsonAtomic<Payload>(filePath: string, payload: Payload, space?: number): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(payload, null, space)}\n`, "utf8");
  renameSync(tempPath, filePath);
}
