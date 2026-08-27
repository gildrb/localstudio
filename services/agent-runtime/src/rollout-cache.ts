import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  createReadStream,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { resolveDataDir } from "./data-dir";

const CACHE_SCHEMA = 1;

export type RolloutStat = {
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  dev: number;
  ino: number;
};

type Envelope<T> = { schema: number; value: T } & RolloutStat;

function cacheRoot(): string {
  return path.join(resolveDataDir(), "rollout-cache");
}

const SAFE_CACHE_COMPONENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function cacheFileFor(kind: string, filepath: string, extension = ".json"): string {
  if (!SAFE_CACHE_COMPONENT.test(kind) || !/^\.[A-Za-z0-9]+$/.test(extension)) {
    throw new Error("Invalid rollout cache path component.");
  }
  const digest = createHash("sha256").update(path.resolve(filepath)).digest("hex").slice(0, 32);
  const readable = (path.basename(filepath).match(/^[\w.-]{0,40}/)?.[0] ?? "rollout").replace(
    /\.jsonl$/,
    "",
  );
  return path.join(cacheRoot(), kind, `${readable}.${digest}${extension}`);
}

export function rolloutCacheFilePath(kind: string, filepath: string, extension: string): string {
  return cacheFileFor(kind, filepath, extension);
}

function readEnvelope<T>(file: string, stat?: RolloutStat, exact = true): T | undefined {
  let parsed: Envelope<T>;
  try {
    parsed = JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    return undefined;
  }
  if (parsed?.schema !== CACHE_SCHEMA) return undefined;
  if (stat) {
    const fields = exact
      ? (["size", "mtimeMs", "ctimeMs", "dev", "ino"] as const)
      : (["dev", "ino"] as const);
    if (fields.some((field) => parsed[field] !== stat[field])) return undefined;
  }
  return parsed.value;
}

const MAX_ENTRIES_PER_KIND = 512;

export function evictIfCrowded(directory: string, extension = ".json"): void {
  let names: string[];
  try {
    names = readdirSync(directory).filter((name) => name.endsWith(extension));
  } catch {
    return;
  }
  if (names.length <= MAX_ENTRIES_PER_KIND) return;

  const byAge = names
    .map((name) => {
      const file = path.join(directory, name);
      try {
        return { file, atimeMs: statSync(file).atimeMs };
      } catch {
        return { file, atimeMs: 0 };
      }
    })
    .sort((a, b) => a.atimeMs - b.atimeMs);

  for (const { file } of byAge.slice(0, byAge.length - MAX_ENTRIES_PER_KIND)) {
    try {
      unlinkSync(file);
    } catch {}
  }
}

function writeEnvelope<T>(file: string, envelope: Envelope<T>): void {
  try {
    const directory = path.dirname(file);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(envelope), { encoding: "utf-8", mode: 0o600 });
    renameSync(temporary, file);
    evictIfCrowded(directory);
  } catch {}
}

export type RolloutCache<T> = {
  read(filepath: string, stat: RolloutStat): T | undefined;
  readStale(filepath: string): T | undefined;
  write(filepath: string, stat: RolloutStat, value: T): void;
  forget(filepath: string): void;
};

export function rolloutCache<T, S>(
  kind: string,
  codec: { serialize: (value: T) => S; deserialize: (raw: S) => T },
): RolloutCache<T> {
  const decode = (raw: S): T | undefined => {
    try {
      return codec.deserialize(raw);
    } catch {
      return undefined;
    }
  };
  const read = (filepath: string, stat?: RolloutStat, exact = true) => {
    const raw = readEnvelope<S>(cacheFileFor(kind, filepath), stat, exact);
    return raw === undefined ? undefined : decode(raw);
  };
  return {
    read: (filepath, stat) => read(filepath, stat),
    readStale: (filepath) => {
      const stat = statRollout(filepath);
      return stat ? read(filepath, stat, false) : undefined;
    },
    write(filepath, stat, value) {
      writeEnvelope(cacheFileFor(kind, filepath), {
        schema: CACHE_SCHEMA,
        ...stat,
        value: codec.serialize(value),
      });
    },
    forget(filepath) {
      try {
        unlinkSync(cacheFileFor(kind, filepath));
      } catch {}
    },
  };
}

export async function readRolloutHead(filepath: string, bytes = 512): Promise<string> {
  const chunks: Buffer[] = [];
  const stream = createReadStream(filepath, { start: 0, end: bytes - 1 });
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf-8");
}

export async function scanCompleteRolloutLines(
  filepath: string,
  start: number,
  consume: (line: string) => void,
  endExclusive?: number,
): Promise<number> {
  let consumedBytes = start;
  if (endExclusive !== undefined && start >= endExclusive) return consumedBytes;
  let pending = "";
  const stream = createReadStream(filepath, {
    start,
    end: endExclusive === undefined ? undefined : endExclusive - 1,
    encoding: "utf-8",
  });
  for await (const chunk of stream) {
    pending += chunk;
    let lineStart = 0;
    let newline = pending.indexOf("\n", lineStart);
    while (newline !== -1) {
      const line = pending.slice(lineStart, newline);
      consume(line);
      consumedBytes += Buffer.byteLength(line, "utf-8") + 1;
      lineStart = newline + 1;
      newline = pending.indexOf("\n", lineStart);
    }
    pending = pending.slice(lineStart);
  }
  return consumedBytes;
}

export function statRollout(filepath: string): RolloutStat | undefined {
  try {
    const { size, mtimeMs, ctimeMs, dev, ino } = statSync(filepath);
    return { size, mtimeMs, ctimeMs, dev, ino };
  } catch {
    return undefined;
  }
}
