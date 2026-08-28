import { execFile } from "node:child_process";
import assert from "node:assert/strict";
import { link, mkdir, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test, { afterEach } from "node:test";
import { promisify } from "node:util";
import { blockedReason } from "../../../frontend/desktop/resources/pi-extensions/github.ts";
import { cleanTemps, tempDir } from "./test-fixtures.ts";
import {
  appendNoteText,
  createNoteFile,
  listNotes,
  readNoteText,
  relativeNote,
} from "../../../frontend/desktop/resources/pi-extensions/obsidian.ts";

const execFileAsync = promisify(execFile);
afterEach(cleanTemps);

const DELETE_REFUSAL =
  "github_cli refuses `delete` subcommands — they are irreversible. Ask the user to run it themselves if that is really what they want.";

const destructiveApiCases: ReadonlyArray<readonly string[]> = [
  ["api", "repos/o/r", "--method", "DELETE"],
  ["api", "repos/o/r", "--method=delete"],
  ["api", "repos/o/r", "-X", "Delete"],
  ["api", "repos/o/r", "-XDELETE"],
  ["api", "repos/o/r", "-X=DELETE"],
  ["api", "repos/o/r", "--method", "GET", "-XDELETE"],
  ["api", "repos/o/r", "-XPOST", "-XDELETE"],
];

for (const args of destructiveApiCases) {
  void test(`refuses gh ${args.join(" ")}`, () => {
    assert.equal(blockedReason(args), DELETE_REFUSAL);
  });
}

void test("allows non-destructive gh api argv unchanged", () => {
  assert.equal(blockedReason(["api", "repos/o/r", "--method", "POST"]), null);
  assert.equal(blockedReason(["api", "repos/o/r"]), null);
  assert.equal(blockedReason(["api", "repos/o/r", "-f", "-XDELETE"]), null);
  assert.equal(blockedReason(["api", "repos/o/r", "--", "-XDELETE"]), null);
});

void test("rejects protected Obsidian directory case-insensitively", () => {
  for (const note of [".obsidian/config", ".OBSIDIAN/config", ".Obsidian/config"])
    assert.throws(() => relativeNote(note), /outside \.obsidian/);
});

void test("uses no-follow descriptors for note create, read, and append", async () => {
  const temporary = tempDir("localstudio-obsidian-");
  const rootPath = path.join(temporary, "vault"),
    outsidePath = path.join(temporary, "outside");
  await mkdir(rootPath);
  await mkdir(outsidePath);
  const root = await realpath(rootPath);
  const outside = await realpath(outsidePath);

  assert.equal(await createNoteFile(root, "safe", "first"), "safe.md");
  assert.equal(await appendNoteText(root, "safe", " second"), "safe.md");
  assert.equal(await readNoteText(root, path.join(root, "safe.md")), "first second");

  const tooLarge = "x".repeat(512 * 1024 + 1);
  await assert.rejects(createNoteFile(root, "large", tooLarge));
  await assert.rejects(appendNoteText(root, "safe", tooLarge));
  assert.equal(await readNoteText(root, path.join(root, "safe.md")), "first second");
  await writeFile(path.join(root, "oversize.md"), tooLarge);
  await assert.rejects(readNoteText(root, path.join(root, "oversize.md")));

  const hidden = path.join(root, ".OBSIDIAN");
  await mkdir(hidden);
  await writeFile(path.join(hidden, "private.md"), "private");
  assert.equal(
    (await listNotes(root)).notes.some((note) => note.name === "private"),
    false,
  );

  const outsideNote = path.join(outside, "secret.md");
  await writeFile(outsideNote, "secret");
  await link(outsideNote, path.join(root, "hardlinked.md"));
  await assert.rejects(readNoteText(root, path.join(root, "hardlinked.md")));
  await assert.rejects(appendNoteText(root, "hardlinked", " leaked"));
  assert.equal(await readFile(outsideNote, "utf8"), "secret");

  await symlink(outsideNote, path.join(root, "linked.md"));
  await assert.rejects(readNoteText(root, path.join(root, "linked.md")));
  await assert.rejects(appendNoteText(root, "linked", " leaked"));
  assert.equal(await readFile(outsideNote, "utf8"), "secret");

  await symlink(outside, path.join(root, "jump"), "dir");
  await assert.rejects(createNoteFile(root, "jump/escaped", "leaked"));
  await assert.rejects(readFile(path.join(outside, "escaped.md"), "utf8"));
});

void test(
  "rejects a FIFO note without blocking",
  { skip: process.platform === "win32", timeout: 1_000 },
  async () => {
    const root = await realpath(tempDir("localstudio-obsidian-fifo-"));
    await execFileAsync("mkfifo", [path.join(root, "pipe.md")]);
    await assert.rejects(appendNoteText(root, "pipe", "blocked"));
  },
);
