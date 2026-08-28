import { constants, readFileSync } from "node:fs";
import { mkdir, open, readdir, realpath, stat, type FileHandle } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Schema } from "effect";
import { Type } from "typebox";
import { decodeJson, present, type Json } from "./first-party-tool.ts";

const VaultSchema = Schema.Struct({
  path: Schema.String,
  name: Schema.String,
  open: Schema.Boolean,
  lastOpened: Schema.NullOr(Schema.String),
});
const VaultListSchema = Schema.Array(VaultSchema);
const ConfigVaultSchema = Schema.Struct({
  path: Schema.String,
  ts: Schema.optional(Schema.Number),
  open: Schema.optional(Schema.Boolean),
});
const ConfigSchema = Schema.Struct({ vaults: Schema.Record(Schema.String, ConfigVaultSchema) });
const FsErrorSchema = Schema.Struct({ code: Schema.String });
type Vault = typeof VaultSchema.Type;
type NoteFile = { rel: string; abs: string; name: string; modified: string; bytes: number };
type OpenVault = { vault: Vault; root: string };
const MAX_NOTES = 5_000;
const MAX_NOTE_BYTES = 512 * 1024;
const MAX_BODY_CHARS = 100_000;

function configPath(): string {
  const override = process.env.LOCAL_STUDIO_OBSIDIAN_CONFIG?.trim();
  if (override) return override;
  const home = homedir();
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "obsidian", "obsidian.json");
  }
  if (process.platform === "win32") {
    return path.join(
      process.env.APPDATA ?? path.join(home, "AppData", "Roaming"),
      "obsidian",
      "obsidian.json",
    );
  }
  return path.join(
    process.env.XDG_CONFIG_HOME ?? path.join(home, ".config"),
    "obsidian",
    "obsidian.json",
  );
}

function configVaults(): Vault[] {
  try {
    const raw = JSON.parse(readFileSync(configPath(), "utf8"));
    const config = Schema.decodeUnknownSync(ConfigSchema)(raw);
    return Object.values(config.vaults).map((entry) => ({
      path: entry.path,
      name: path.basename(entry.path),
      open: entry.open === true,
      lastOpened: entry.ts === undefined ? null : new Date(entry.ts).toISOString(),
    }));
  } catch {
    return [];
  }
}

function readVaults(): Vault[] {
  const injected = process.env.LOCAL_STUDIO_OBSIDIAN_VAULTS?.trim();
  if (injected) {
    try {
      const vaults = Schema.decodeUnknownSync(VaultListSchema)(JSON.parse(injected));
      if (vaults.length > 0) return [...vaults];
    } catch {}
  }
  return configVaults().sort((left, right) => {
    if (left.open !== right.open) return left.open ? -1 : 1;
    return (right.lastOpened ?? "").localeCompare(left.lastOpened ?? "");
  });
}

function selectVault(vaults: Vault[], requested: string | undefined): Vault {
  if (vaults.length === 0) throw new Error(`No Obsidian vault found in ${configPath()}.`);
  const wanted = requested?.trim();
  if (!wanted) return vaults[0];
  const exact = vaults.find((vault) => path.resolve(vault.path) === path.resolve(wanted));
  if (exact) return exact;
  const named = vaults.filter((vault) => vault.name.toLowerCase() === wanted.toLowerCase());
  if (named.length === 1) return named[0];
  throw new Error(`Vault "${wanted}" is missing or ambiguous. Use obsidian_vaults for full paths.`);
}

async function openVault(vaults: Vault[], requested: string | undefined): Promise<OpenVault> {
  const vault = selectVault(vaults, requested);
  return { vault, root: await realpath(vault.path) };
}

export function relativeNote(input: string): string {
  const trimmed = input.trim().replaceAll("\\", "/").replace(/^\/+/, "");
  const withExtension = trimmed.toLowerCase().endsWith(".md") ? trimmed : `${trimmed}.md`;
  const normalized = path.normalize(withExtension);
  const segments = normalized.split(path.sep);
  if (
    !trimmed ||
    path.isAbsolute(normalized) ||
    segments.includes("..") ||
    segments[0]?.toLowerCase() === ".obsidian"
  ) {
    throw new Error("Note path must stay inside the vault and outside .obsidian.");
  }
  return normalized;
}

function ensureInside(root: string, target: string): void {
  const relative = path.relative(root, target);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Note path escapes the vault.");
  }
}

type OpenNote = { handle: FileHandle; target: string; bytes: number };

async function canonicalParent(root: string, target: string): Promise<string> {
  ensureInside(root, target);
  const parent = await realpath(path.dirname(target));
  ensureInside(root, parent);
  return parent;
}

async function openNoteFile(root: string, target: string, flags: number): Promise<OpenNote> {
  const parent = await canonicalParent(root, target);
  const handle = await open(target, flags | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
  try {
    if ((await canonicalParent(root, target)) !== parent)
      throw new Error("Note parent changed while opening it.");
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1 || info.size > MAX_NOTE_BYTES)
      throw new Error("Note is missing or too large.");
    const canonical = await realpath(target);
    ensureInside(root, canonical);
    if (canonical !== target) throw new Error("Note is a symlink.");
    const current = await stat(target);
    if (current.dev !== info.dev || current.ino !== info.ino)
      throw new Error("Note changed while opening it.");
    return { handle, target, bytes: info.size };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

async function withNoteFile<T>(
  root: string,
  target: string,
  flags: number,
  operation: (opened: OpenNote) => Promise<T>,
): Promise<T> {
  const opened = await openNoteFile(root, target, flags);
  try {
    return await operation(opened);
  } finally {
    await opened.handle.close();
  }
}

function existingTarget(root: string, input: string): string {
  const target = path.resolve(root, relativeNote(input));
  ensureInside(root, target);
  return target;
}

export async function readNoteText(root: string, target: string): Promise<string> {
  return withNoteFile(root, target, constants.O_RDONLY, async ({ handle }) => {
    const buffer = Buffer.alloc(MAX_NOTE_BYTES + 1);
    let total = 0;
    while (total < buffer.length) {
      const { bytesRead } = await handle.read(buffer, total, buffer.length - total, total);
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    if (total > MAX_NOTE_BYTES) throw new Error("Note is missing or too large.");
    return buffer.subarray(0, total).toString("utf8");
  });
}

async function stableEntries(root: string, directory: string) {
  const before = await realpath(directory);
  ensureInside(root, before);
  if (before !== directory) throw new Error("Vault directory changed or is a symlink.");
  const entries = await readdir(before, { withFileTypes: true });
  if ((await realpath(directory)) !== before)
    throw new Error("Vault directory changed while listing it.");
  return entries;
}

export async function listNotes(root: string): Promise<{ notes: NoteFile[]; truncated: boolean }> {
  const notes: NoteFile[] = [];
  const queue = [root];
  while (queue.length > 0 && notes.length < MAX_NOTES) {
    const directory = queue.shift();
    if (!directory) break;
    const entries = await stableEntries(root, directory).catch(() => []);
    for (const entry of entries) {
      if (entry.name.toLowerCase() === ".obsidian" || entry.isSymbolicLink()) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) queue.push(absolute);
      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".md") continue;
      const info = await withNoteFile(root, absolute, constants.O_RDONLY, ({ handle }) =>
        handle.stat(),
      ).catch(() => null);
      if (!info) continue;
      notes.push({
        rel: path.relative(root, absolute),
        abs: absolute,
        name: path.basename(entry.name, ".md"),
        modified: info.mtime.toISOString(),
        bytes: info.size,
      });
      if (notes.length >= MAX_NOTES) break;
    }
  }
  return { notes, truncated: queue.length > 0 };
}

async function resolveNote(root: string, input: string): Promise<NoteFile> {
  const notes = (await listNotes(root)).notes;
  const requested = input.trim().replaceAll("\\", "/").replace(/\.md$/i, "").toLowerCase();
  const matches = notes.filter((note) => {
    const relative = note.rel.replaceAll("\\", "/").replace(/\.md$/i, "").toLowerCase();
    return relative === requested || note.name.toLowerCase() === requested;
  });
  if (matches.length !== 1) throw new Error(`Note "${input}" is missing or ambiguous.`);
  return matches[0];
}

type ParsedNote = { metadata: string | null; body: string };
function frontmatter(text: string): ParsedNote {
  if (!text.startsWith("---\n")) return { metadata: null, body: text };
  const end = text.indexOf("\n---\n", 4);
  return end < 0
    ? { metadata: null, body: text }
    : { metadata: text.slice(4, end), body: text.slice(end + 5) };
}

function links(text: string): string[] {
  return [...text.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)]
    .map((match) => match[1]?.trim() ?? "")
    .filter(Boolean);
}

function excerpt(text: string, query: string): string {
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  if (index < 0) return "";
  return text.slice(Math.max(0, index - 80), Math.min(text.length, index + query.length + 80));
}

async function vaultList(vaults: Vault[]): Promise<Json> {
  const values = await Promise.all(
    vaults.map(async (vault) => {
      const root = await realpath(vault.path);
      const listed = await listNotes(root);
      return { ...vault, notes: listed.notes.length, truncated: listed.truncated };
    }),
  );
  return decodeJson({ vaults: values, config: configPath() });
}

async function searchVault(
  vaults: Vault[],
  query: string,
  requested: string | undefined,
  folder: string | undefined,
  limit: number | undefined,
): Promise<Json> {
  const opened = await openVault(vaults, requested);
  const listed = await listNotes(opened.root);
  const normalizedFolder = folder?.trim().toLowerCase();
  const matches = [];
  for (const note of listed.notes) {
    if (normalizedFolder && !note.rel.toLowerCase().startsWith(normalizedFolder)) continue;
    const text = await readNoteText(opened.root, note.abs);
    const passage = excerpt(text, query);
    if (!note.name.toLowerCase().includes(query.toLowerCase()) && !passage) continue;
    matches.push({ path: note.rel, title: note.name, modified: note.modified, excerpt: passage });
  }
  const maximum = Number.isFinite(limit)
    ? Math.min(100, Math.max(1, Math.trunc(Number(limit))))
    : 20;
  return decodeJson({
    vault: opened.vault.name,
    query,
    scanned: listed.notes.length,
    truncated: listed.truncated,
    matches: matches.slice(0, maximum),
  });
}

async function readNote(
  vaults: Vault[],
  requestedVault: string | undefined,
  requestedNote: string,
): Promise<Json> {
  const opened = await openVault(vaults, requestedVault);
  const note = await resolveNote(opened.root, requestedNote);
  const target = existingTarget(opened.root, note.rel);
  const parsed = frontmatter(await readNoteText(opened.root, target));
  return decodeJson({
    vault: opened.vault.name,
    path: note.rel,
    title: note.name,
    modified: note.modified,
    frontmatter: parsed.metadata,
    links: links(parsed.body),
    body: parsed.body.slice(0, MAX_BODY_CHARS),
    truncated: parsed.body.length > MAX_BODY_CHARS,
  });
}

async function recentNotes(
  vaults: Vault[],
  requested: string | undefined,
  limit: number | undefined,
): Promise<Json> {
  const opened = await openVault(vaults, requested);
  const listed = await listNotes(opened.root);
  const maximum = Number.isFinite(limit)
    ? Math.min(100, Math.max(1, Math.trunc(Number(limit))))
    : 20;
  const notes = [...listed.notes]
    .sort((left, right) => right.modified.localeCompare(left.modified))
    .slice(0, maximum);
  return decodeJson({ vault: opened.vault.name, notes, truncated: listed.truncated });
}

async function backlinks(
  vaults: Vault[],
  requestedVault: string | undefined,
  requestedNote: string,
): Promise<Json> {
  const opened = await openVault(vaults, requestedVault);
  const target = await resolveNote(opened.root, requestedNote);
  const listed = await listNotes(opened.root);
  const matches = [];
  for (const note of listed.notes) {
    const body = await readNoteText(opened.root, note.abs);
    if (links(body).some((link) => link.toLowerCase() === target.name.toLowerCase())) {
      matches.push({
        path: note.rel,
        title: note.name,
        excerpt: excerpt(body, `[[${target.name}`),
      });
    }
  }
  return decodeJson({
    vault: opened.vault.name,
    note: target.rel,
    backlinks: matches,
    truncated: listed.truncated,
  });
}

async function ensureDirectory(root: string, directory: string): Promise<void> {
  ensureInside(root, directory);
  if (directory === root) return;
  await ensureDirectory(root, path.dirname(directory));
  try {
    await mkdir(directory);
  } catch (error) {
    const parsed = Schema.decodeUnknownOption(FsErrorSchema)(error);
    if (parsed._tag === "None" || parsed.value.code !== "EEXIST") throw error;
  }
  const canonical = await realpath(directory);
  ensureInside(root, canonical);
  if (canonical !== directory) throw new Error("Note directory is a symlink.");
}

export async function createNoteFile(root: string, note: string, content: string): Promise<string> {
  if (Buffer.byteLength(content) > MAX_NOTE_BYTES) throw new Error("Note is missing or too large.");
  const relative = relativeNote(note);
  const target = path.resolve(root, relative);
  ensureInside(root, target);
  await ensureDirectory(root, path.dirname(target));
  await withNoteFile(
    root,
    target,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
    ({ handle }) => handle.writeFile(content, "utf8"),
  );
  return relative;
}

export async function appendNoteText(root: string, note: string, content: string): Promise<string> {
  const target = existingTarget(root, note);
  await withNoteFile(root, target, constants.O_WRONLY | constants.O_APPEND, ({ handle, bytes }) => {
    if (bytes + Buffer.byteLength(content) > MAX_NOTE_BYTES)
      throw new Error("Note is missing or too large.");
    return handle.appendFile(content, "utf8");
  });
  return path.relative(root, target);
}

async function createNote(
  vaults: Vault[],
  requestedVault: string | undefined,
  note: string,
  content: string,
): Promise<Json> {
  const opened = await openVault(vaults, requestedVault);
  const relative = await createNoteFile(opened.root, note, content);
  return decodeJson({ vault: opened.vault.name, path: relative, created: true });
}

async function appendNote(
  vaults: Vault[],
  requestedVault: string | undefined,
  note: string,
  content: string,
): Promise<Json> {
  const opened = await openVault(vaults, requestedVault);
  const relative = await appendNoteText(opened.root, note, content);
  return decodeJson({ vault: opened.vault.name, path: relative, appended: true });
}

export default function registerObsidianExtension(pi: ExtensionAPI): void {
  const vaults = readVaults();
  const vault = Type.Optional(Type.String({ description: "Vault name or full path" }));
  const note = Type.String({ description: "Vault-relative path or unique note name" });
  pi.registerTool({
    name: "obsidian_vaults",
    label: "Obsidian: Vaults",
    description: "List configured vaults and note counts.",
    parameters: Type.Object({}),
    execute: () => present("obsidian", "obsidian_vaults", vaultList(vaults)),
  });
  pi.registerTool({
    name: "obsidian_search",
    label: "Obsidian: Search",
    description: "Search note titles and content without reading .obsidian configuration.",
    parameters: Type.Object({
      query: Type.String(),
      vault,
      scope: Type.Optional(Type.String()),
      folder: Type.Optional(Type.String()),
      limit: Type.Optional(Type.Number()),
    }),
    execute: (_id, params) =>
      present(
        "obsidian",
        "obsidian_search",
        searchVault(vaults, params.query.trim(), params.vault, params.folder, params.limit),
      ),
  });
  pi.registerTool({
    name: "obsidian_read",
    label: "Obsidian: Read Note",
    description: "Read one note with frontmatter and wikilinks separated from its body.",
    parameters: Type.Object({ note, vault }),
    execute: (_id, params) =>
      present("obsidian", "obsidian_read", readNote(vaults, params.vault, params.note)),
  });
  pi.registerTool({
    name: "obsidian_recent",
    label: "Obsidian: Recent Notes",
    description: "List recently modified notes.",
    parameters: Type.Object({
      vault,
      limit: Type.Optional(Type.Number()),
      folder: Type.Optional(Type.String()),
    }),
    execute: (_id, params) =>
      present("obsidian", "obsidian_recent", recentNotes(vaults, params.vault, params.limit)),
  });
  pi.registerTool({
    name: "obsidian_backlinks",
    label: "Obsidian: Backlinks",
    description: "Find notes whose wikilinks resolve to one note.",
    parameters: Type.Object({ note, vault }),
    execute: (_id, params) =>
      present("obsidian", "obsidian_backlinks", backlinks(vaults, params.vault, params.note)),
  });
  pi.registerTool({
    name: "obsidian_create",
    label: "Obsidian: Create Note",
    description: "Create a new note without overwriting any existing file.",
    parameters: Type.Object({ note, vault, content: Type.String() }),
    execute: (_id, params) =>
      present(
        "obsidian",
        "obsidian_create",
        createNote(vaults, params.vault, params.note, params.content),
      ),
  });
  pi.registerTool({
    name: "obsidian_append",
    label: "Obsidian: Append Note",
    description: "Append to an existing note. This never creates or overwrites a note.",
    parameters: Type.Object({ note, vault, content: Type.String() }),
    execute: (_id, params) =>
      present(
        "obsidian",
        "obsidian_append",
        appendNote(vaults, params.vault, params.note, params.content),
      ),
  });
}
