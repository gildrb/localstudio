import {
  readRolloutHead,
  rolloutCache,
  scanCompleteRolloutLines,
  statRollout,
  type RolloutStat,
} from "./rollout-cache";
import { isRecord, type UnknownRecord, type UnparsedValue } from "../../../shared/agent/guards";
import { Schema } from "effect";

const isNumber = Schema.is(Schema.Number);

export type SessionUsageTotals = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  total: number;
  cost: number;
  calls: number;
  compactions: number;
};

export function emptyUsageTotals(): SessionUsageTotals {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: 0,
    total: 0,
    cost: 0,
    calls: 0,
    compactions: 0,
  };
}

type CacheEntry = {
  stat: RolloutStat;
  totals: SessionUsageTotals;
  scannedBytes: number;
  head: string;
};

const usageDisk = rolloutCache<CacheEntry, CacheEntry>("usage-totals", {
  serialize: (value) => value,
  deserialize: (value) => value,
});

type ScanResult = { totals: SessionUsageTotals; scannedBytes: number };

function canResume(
  entry: CacheEntry | undefined,
  stat: RolloutStat,
  head: string,
): entry is CacheEntry {
  return Boolean(
    entry?.stat &&
    entry.head === head &&
    entry.stat.dev === stat.dev &&
    entry.stat.ino === stat.ino &&
    stat.size >= entry.scannedBytes &&
    entry.scannedBytes > 0,
  );
}

function sameRollout(left: RolloutStat, right: RolloutStat | undefined): boolean {
  return Boolean(
    right &&
    right.size === left.size &&
    right.mtimeMs === left.mtimeMs &&
    right.ctimeMs === left.ctimeMs &&
    right.dev === left.dev &&
    right.ino === left.ino,
  );
}

async function scanFrom(
  filepath: string,
  start: number,
  seed: SessionUsageTotals,
  endExclusive: number,
): Promise<ScanResult> {
  let totals = seed;
  const scannedBytes = await scanCompleteRolloutLines(
    filepath,
    start,
    (line) => {
      if (line) totals = accumulateUsageLine(totals, line);
    },
    endExclusive,
  );
  return { totals, scannedBytes };
}

function numeric(source: UnknownRecord | null, keys: string[]): number {
  if (!source) return 0;
  for (const key of keys) {
    const value = source[key];
    if (isNumber(value) && Number.isFinite(value)) return value;
  }
  return 0;
}

function asRecord(value: UnparsedValue): UnknownRecord | null {
  return isRecord(value) ? value : null;
}

export function accumulateUsageLine(totals: SessionUsageTotals, line: string): SessionUsageTotals {
  const hasUsage = line.includes('"usage"');
  const hasCompaction = line.includes("compaction");
  if (!hasUsage && !hasCompaction) return totals;

  let entry: UnknownRecord | null = null;
  try {
    entry = asRecord(JSON.parse(line));
  } catch {
    return totals;
  }
  if (!entry) return totals;

  if (entry.type === "compaction" || entry.customType === "compaction") {
    return { ...totals, compactions: totals.compactions + 1 };
  }

  const message = asRecord(entry.message);
  if (!message || message.role !== "assistant") return totals;
  const usage = asRecord(message.usage);
  if (!usage) return totals;

  const input = numeric(usage, ["input", "input_tokens", "prompt_tokens"]);
  const output = numeric(usage, ["output", "output_tokens", "completion_tokens"]);
  const cacheRead = numeric(usage, ["cacheRead", "cache_read_input_tokens"]);
  const cacheWrite = numeric(usage, ["cacheWrite", "cache_creation_input_tokens"]);
  const reasoning = numeric(usage, ["reasoning", "reasoning_tokens"]);
  const reported = numeric(usage, ["totalTokens", "total_tokens", "total"]);
  const cost = numeric(asRecord(usage.cost), ["total"]);

  return {
    input: totals.input + input,
    output: totals.output + output,
    cacheRead: totals.cacheRead + cacheRead,
    cacheWrite: totals.cacheWrite + cacheWrite,
    reasoning: totals.reasoning + reasoning,
    total: totals.total + (reported || input + output),
    cost: totals.cost + cost,
    calls: totals.calls + 1,
    compactions: totals.compactions,
  };
}

export async function readSessionUsageTotals(filepath: string): Promise<SessionUsageTotals> {
  const stat = statRollout(filepath);
  if (!stat) return emptyUsageTotals();

  try {
    const head = await readRolloutHead(filepath);

    const previous = usageDisk.readStale(filepath);

    const resumable = canResume(previous, stat, head);
    if (resumable && previous.stat.ctimeMs === stat.ctimeMs) return previous.totals;

    const { totals, scannedBytes } = resumable
      ? await scanFrom(filepath, previous.scannedBytes, previous.totals, stat.size)
      : await scanFrom(filepath, 0, emptyUsageTotals(), stat.size);

    if (sameRollout(stat, statRollout(filepath))) {
      usageDisk.write(filepath, stat, { stat, totals, scannedBytes, head });
    }
    return totals;
  } catch {
    return emptyUsageTotals();
  }
}
