import { afterEach, expect, test } from "bun:test";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { Effect } from "effect";
import { piRuntimeManager } from "../src/pi-runtime";
import { refreshPiModels } from "../src/pi-runtime-models";
import { readSessionListMetadata, setSessionArchived } from "../src/session-metadata-store";
import {
  rolloutCache,
  rolloutCacheFilePath,
  scanCompleteRolloutLines,
  statRollout,
} from "../src/rollout-cache";
import { cleanTemps, isolatedDataDir, jsonResponse } from "./test-fixtures";

const originalFetch = globalThis.fetch;

function workspace(): string {
  const directory = isolatedDataDir("local-studio-runtime-core-");
  process.env.LOCAL_STUDIO_DATA_DIR = directory;
  return directory;
}

function serialProbe() {
  let active = 0;
  let maximum = 0;
  return {
    run: async (operation: () => void) => {
      active += 1;
      maximum = Math.max(maximum, active);
      await Promise.resolve();
      operation();
      active -= 1;
    },
    maximum: () => maximum,
  };
}

afterEach(() => {
  delete process.env.LOCAL_STUDIO_DATA_DIR;
  delete process.env.PI_CODING_AGENT_DIR;
  globalThis.fetch = originalFetch;
  cleanTemps();
});

test("rollout cache rejects traversal components and invalid extensions", () => {
  const source = path.join(workspace(), "session.jsonl");
  const attacks = [
    ["../outside", ".json"],
    ["usage", "/outside"],
  ] as const;
  for (const [kind, extension] of attacks) {
    expect(() => rolloutCacheFilePath(kind, source, extension)).toThrow();
  }
});

test("rollout cache identity rejects replaced files with matching size and mtime", () => {
  const directory = workspace();
  const source = path.join(directory, "session.jsonl");
  writeFileSync(source, "old\n");
  const first = statRollout(source);
  if (!first) throw new Error("missing source stat");
  const cache = rolloutCache<number, number>("identity-test", {
    serialize: (value) => value,
    deserialize: (value) => value,
  });
  cache.write(source, first, 7);
  const replacement = path.join(directory, "replacement.jsonl");
  writeFileSync(replacement, "new\n");
  utimesSync(replacement, first.mtimeMs / 1000, first.mtimeMs / 1000);
  renameSync(replacement, source);
  const second = statRollout(source);
  if (!second) throw new Error("missing replacement stat");
  expect(second.size).toBe(first.size);
  expect(second.mtimeMs).toBe(first.mtimeMs);
  expect(second.ino).not.toBe(first.ino);
  expect(cache.read(source, second)).toBeUndefined();
});

test("bounded rollout scans ignore bytes appended beyond the snapshot", async () => {
  const source = path.join(workspace(), "session.jsonl");
  writeFileSync(source, "first\nsecond\n");
  const lines: string[] = [];
  const consumed = await scanCompleteRolloutLines(source, 0, (line) => lines.push(line), 6);
  expect(lines).toEqual(["first"]);
  expect(consumed).toBe(6);
});

test("user Pi models accept partial bounded thinking-level maps", async () => {
  const directory = workspace();
  const piDirectory = path.join(directory, "user-pi");
  process.env.LOCAL_STUDIO_DATA_DIR = directory;
  process.env.PI_CODING_AGENT_DIR = piDirectory;
  mkdirSync(piDirectory, { recursive: true });
  writeFileSync(
    path.join(directory, "api-settings.json"),
    JSON.stringify({ backendUrl: "http://controller" }),
  );
  writeFileSync(
    path.join(piDirectory, "models.json"),
    JSON.stringify({
      providers: {
        custom: {
          baseUrl: "http://provider/v1",
          models: [{ id: "partial-map", reasoning: true, thinkingLevelMap: { high: "high" } }],
        },
      },
    }),
  );
  globalThis.fetch = async () => jsonResponse({ object: "list", data: [] });
  const { models } = await refreshPiModels();
  expect(models.some((model) => model.id === "user-pi-custom/partial-map")).toBe(true);
});

test("metadata readers do not quarantine corrupt state outside the writer lock", async () => {
  const directory = workspace();
  const store = path.join(directory, "agent-session-metadata.json");
  writeFileSync(store, "{broken", { mode: 0o600 });
  expect(readSessionListMetadata()("session").archived).toBe(false);
  expect(readdirSync(directory).filter((name) => name.includes(".corrupt-"))).toEqual([]);
  await setSessionArchived("session", true, new Date("2025-01-01T00:00:00.000Z"));
  expect(readdirSync(directory).filter((name) => name.includes(".corrupt-"))).toHaveLength(1);
  expect(JSON.parse(readFileSync(store, "utf8")).sessions.session.archived).toBe(true);
});

test("metadata writers preserve stores on non-parse read failures", async () => {
  const directory = workspace();
  const store = path.join(directory, "agent-session-metadata.json");
  mkdirSync(store);
  await expect(setSessionArchived("session", true)).rejects.toBeDefined();
  expect(readdirSync(directory)).toContain("agent-session-metadata.json");
});

test("queue mutation preserves duplicate attachments before and after consumption", async () => {
  const imageA = { type: "image" as const, data: "AAAA", mimeType: "image/png" };
  const cases = [
    { consume: false, expected: imageA },
    { consume: true, expected: { ...imageA, data: "BBBB" } },
  ] as const;
  for (const { consume, expected } of cases) {
    const wrapper = piRuntimeManager.getSession(`queue-${crypto.randomUUID()}`);
    const queues = { steering: Array<string>(), followUp: Array<string>() };
    const delivered: unknown[][] = [];
    const probe = serialProbe();
    const deliver = (mode: keyof typeof queues, text: string, images: unknown[] = []) =>
      probe.run(() => {
        queues[mode].push(text);
        delivered.push(images);
      });
    let consumeBeforeClear = consume;
    Reflect.set(wrapper, "runtime", {
      session: {
        isStreaming: true,
        steer: (text: string, images?: unknown[]) => deliver("steering", text, images),
        followUp: (text: string, images?: unknown[]) => deliver("followUp", text, images),
        clearQueue() {
          if (consumeBeforeClear) {
            queues.followUp.shift();
            consumeBeforeClear = false;
          }
          const cleared = { steering: [...queues.steering], followUp: [...queues.followUp] };
          queues.steering.length = queues.followUp.length = 0;
          return cleared;
        },
        getSteeringMessages: () => queues.steering,
        getFollowUpMessages: () => queues.followUp,
      },
    });
    const imageB = { ...imageA, data: "BBBB" };
    await Promise.all([wrapper.followUp("same", [imageA]), wrapper.followUp("same", [imageB])]);
    await wrapper.mutateQueuedFollowUp("same", "promote");
    expect(probe.maximum()).toBe(1);
    expect(queues).toEqual({ steering: ["same"], followUp: consume ? [] : ["same"] });
    expect(delivered.at(consume ? -1 : -2)).toEqual([expected]);
  }
});

test("ensureStarted operations are serialized", async () => {
  const wrapper = piRuntimeManager.getSession(`start-${crypto.randomUUID()}`);
  const probe = serialProbe();
  Reflect.set(wrapper, "ensureStartedEffect", () =>
    Effect.tryPromise({ try: () => probe.run(() => undefined), catch: (error) => error }),
  );
  await Promise.all([wrapper.ensureStarted("one"), wrapper.ensureStarted("two")]);
  expect(probe.maximum()).toBe(1);
});
