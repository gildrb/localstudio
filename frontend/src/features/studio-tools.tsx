"use client";
import { Schema } from "effect";
import { useRef, useState } from "react";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { jsonRequest, request, requestRecord, type Json, type RecordJson } from "./studio-api";
import { ErrorText } from "./studio-ui";

const GitStateSchema = Schema.Struct({
  isRepo: Schema.Boolean,
  branch: Schema.NullOr(Schema.String),
  status: Schema.Array(Schema.String),
  diff: Schema.String,
  additions: Schema.Number,
  deletions: Schema.Number,
});
const PullRequestResponseSchema = Schema.Struct({
  pr: Schema.optional(
    Schema.Struct({
      number: Schema.Number,
      title: Schema.String,
      state: Schema.String,
      url: Schema.String,
      mergeable: Schema.String,
    }),
  ),
});
const BranchListResponseSchema = Schema.Struct({
  branches: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      current: Schema.Boolean,
      remote: Schema.Boolean,
    }),
  ),
});
const WorktreeListResponseSchema = Schema.Struct({
  worktrees: Schema.Array(
    Schema.Struct({
      path: Schema.String,
      branch: Schema.NullOr(Schema.String),
      current: Schema.Boolean,
    }),
  ),
});
type GitState = typeof GitStateSchema.Type;
type PullRequest = NonNullable<(typeof PullRequestResponseSchema.Type)["pr"]>;
const decodeGitState = Schema.decodeUnknownSync(GitStateSchema);
const decodePullRequest = Schema.decodeUnknownSync(PullRequestResponseSchema);
const decodeBranchList = Schema.decodeUnknownSync(BranchListResponseSchema);
const decodeWorktreeList = Schema.decodeUnknownSync(WorktreeListResponseSchema);
const FileResponseSchema = Schema.Struct({ content: Schema.String });
const PtyOpenResponseSchema = Schema.Struct({
  id: Schema.String,
  replay: Schema.optional(Schema.String),
});
const FileSearchResponseSchema = Schema.Struct({
  entries: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      path: Schema.String,
      rel: Schema.String,
      kind: Schema.Literals(["file", "directory"]),
    }),
  ),
});
const CommentListResponseSchema = Schema.Struct({
  comments: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      line: Schema.Number,
      body: Schema.String,
      createdAt: Schema.String,
    }),
  ),
});
const BrowserFrameResponseSchema = Schema.Struct({
  data: Schema.Struct({
    frame: Schema.NullOr(Schema.String),
    url: Schema.String,
    title: Schema.String,
    canGoBack: Schema.Boolean,
    canGoForward: Schema.Boolean,
  }),
});
const decodeFileResponse = Schema.decodeUnknownSync(FileResponseSchema);
const decodePtyOpenResponse = Schema.decodeUnknownSync(PtyOpenResponseSchema);
const decodeFileSearchResponse = Schema.decodeUnknownSync(FileSearchResponseSchema);
const decodeCommentListResponse = Schema.decodeUnknownSync(CommentListResponseSchema);
const decodeBrowserFrameResponse = Schema.decodeUnknownSync(BrowserFrameResponseSchema);

function FileTools({ cwd }: { cwd: string }) {
  const [path, setPath] = useState("");
  const [content, setContent] = useState("");
  const [line, setLine] = useState("1");
  const [comment, setComment] = useState("");
  const [feedback, setFeedback] = useState("");
  const [entries, setEntries] = useState<(typeof FileSearchResponseSchema.Type)["entries"]>([]);
  const [comments, setComments] = useState<(typeof CommentListResponseSchema.Type)["comments"]>([]);
  const [error, setError] = useState("");
  const query = `cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(path)}`;
  const run = async (operation: () => Promise<Json | void>) => {
    try {
      await operation();
      setFeedback("File operation completed.");
      setError("");
    } catch (value) {
      setFeedback("");
      setError(value instanceof Error ? value.message : String(value));
    }
  };
  const open = () =>
    run(async () => {
      const value = await requestRecord(`/api/agent/fs/file?${query}`);
      setContent(decodeFileResponse(value).content);
    });
  const browse = (directory = path) =>
    run(async () => {
      const value = await requestRecord(
        `/api/agent/fs?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(directory)}`,
      );
      setPath(directory);
      setEntries(decodeFileSearchResponse(value).entries);
    });
  const removeComment = (id: string) =>
    run(async () => {
      await request(`/api/agent/comments?${query}&id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      setComments((items) => items.filter((entry) => entry.id !== id));
    });
  return (
    <article>
      <h3>Files, preview & comments</h3>
      <div className="row">
        <input
          value={path}
          onChange={(event) => setPath(event.target.value)}
          placeholder="Relative path"
        />
        <button onClick={open}>Open file</button>
        <button onClick={() => browse()}>Browse directory</button>
        <button
          onClick={() =>
            run(async () => {
              const value = await requestRecord(
                `/api/agent/fs/search?cwd=${encodeURIComponent(cwd)}&q=${encodeURIComponent(path)}`,
              );
              setEntries(decodeFileSearchResponse(value).entries);
            })
          }
        >
          Search
        </button>
        <a href={`/api/agent/fs/raw?${query}`} target="_blank" rel="noreferrer">
          Raw preview
        </a>
      </div>
      <textarea
        value={content}
        onChange={(event) => setContent(event.target.value)}
        placeholder="File content"
      />
      <button
        onClick={() =>
          run(() =>
            request(`/api/agent/fs/file?${query}`, { ...jsonRequest({ content }), method: "PUT" }),
          )
        }
      >
        Save file
      </button>
      <div className="row">
        <input
          value={line}
          onChange={(event) => setLine(event.target.value)}
          aria-label="Comment line"
        />
        <input
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          placeholder="Review comment"
        />
        <button
          onClick={() =>
            run(() =>
              request(
                "/api/agent/comments",
                jsonRequest({ cwd, path, line: Number(line), body: comment }),
              ),
            )
          }
        >
          Comment
        </button>
        <button
          onClick={() =>
            run(async () => {
              const value = await requestRecord(`/api/agent/comments?${query}`);
              setComments(decodeCommentListResponse(value).comments);
            })
          }
        >
          List comments
        </button>
      </div>
      {entries.map((entry) => (
        <button
          key={entry.path}
          onClick={() => (entry.kind === "directory" ? browse(entry.rel) : setPath(entry.rel))}
        >
          {entry.kind}: {entry.rel}
        </button>
      ))}
      {comments.map((entry) => (
        <p key={entry.id}>
          Line {entry.line}: {entry.body}{" "}
          <button onClick={() => removeComment(entry.id)}>Delete</button>
        </p>
      ))}
      <ErrorText value={error} />
      {feedback ? <p aria-live="polite">{feedback}</p> : null}
    </article>
  );
}

function shellPath(path: string): string | null {
  if (!path || path.includes("\n") || path.includes("\r") || path.includes("\0")) return null;
  return `'${path.replaceAll("'", "'\"'\"'")}'`;
}
function GitTools({ cwd }: { cwd: string }) {
  const [path, setPath] = useState("");
  const [branch, setBranch] = useState("");
  const [worktree, setWorktree] = useState("");
  const [commit, setCommit] = useState("");
  const [prNumber, setPrNumber] = useState("");
  const [gitState, setGitState] = useState<GitState | null>(null);
  const [branches, setBranches] = useState<(typeof BranchListResponseSchema.Type)["branches"]>([]);
  const [worktrees, setWorktrees] = useState<(typeof WorktreeListResponseSchema.Type)["worktrees"]>(
    [],
  );
  const [pullRequest, setPullRequest] = useState<PullRequest | null>(null);
  const [feedback, setFeedback] = useState("Loading repository status…");
  const [error, setError] = useState("");
  const query = `cwd=${encodeURIComponent(cwd)}`;
  const run = async (
    url: `/api/${string}`,
    init: RequestInit | undefined,
    accept: (value: Json) => void,
    success: string,
  ) => {
    try {
      const value = await request(url, init);
      accept(value);
      setFeedback(success);
      setError("");
    } catch (value) {
      setFeedback("");
      setError(value instanceof Error ? value.message : String(value));
    }
  };
  const refreshGit = () =>
    run(
      `/api/agent/git?${query}`,
      undefined,
      (value) => setGitState(decodeGitState(value)),
      "Repository status refreshed.",
    );
  const refreshPullRequest = () =>
    run(
      `/api/agent/pr?${query}`,
      undefined,
      (value) => setPullRequest(decodePullRequest(value).pr ?? null),
      "Pull request refreshed.",
    );
  const gitAction = (value: RecordJson, success: string) =>
    run(
      `/api/agent/git?${query}`,
      jsonRequest(value),
      (response) => setGitState(decodeGitState(response)),
      success,
    );
  const indexAction = (verb: "add" | "restore" | "revert") => {
    const quoted = shellPath(path);
    if (!quoted) {
      setError("Choose a safe relative path");
      return;
    }
    if (verb === "revert" && !window.confirm(`Discard all working-tree changes to ${path}?`))
      return;
    const command =
      verb === "add"
        ? `git add -- ${quoted}`
        : verb === "restore"
          ? `git restore --staged -- ${quoted}`
          : `git restore -- ${quoted}`;
    void run(
      `/api/agent/terminal?${query}`,
      jsonRequest({ command }),
      () => void refreshGit(),
      verb === "add" ? "Path staged." : verb === "restore" ? "Path unstaged." : "Path reverted.",
    );
  };
  useMountSubscription(() => {
    setGitState(null);
    setFeedback("Loading repository status…");
    void refreshGit();
  }, [cwd]);
  return (
    <article>
      <h3>Git review</h3>
      <div className="row">
        <button onClick={refreshGit}>Refresh status</button>
        {gitState?.isRepo ? (
          <>
            <button
              onClick={() =>
                run(
                  `/api/agent/git/branches?${query}`,
                  undefined,
                  (value) => setBranches(decodeBranchList(value).branches),
                  "Branches refreshed.",
                )
              }
            >
              Branches
            </button>
            <button
              onClick={() =>
                run(
                  `/api/agent/git/worktrees?${query}`,
                  undefined,
                  (value) => setWorktrees(decodeWorktreeList(value).worktrees),
                  "Worktrees refreshed.",
                )
              }
            >
              Worktrees
            </button>
            <button onClick={refreshPullRequest}>Pull request</button>
          </>
        ) : null}
      </div>
      {gitState === null ? <p>Checking whether this folder is a Git repository…</p> : null}
      {gitState && !gitState.isRepo ? (
        <section>
          <p>This folder is not a Git repository.</p>
          <button onClick={() => gitAction({ action: "init" }, "Git repository initialized.")}>
            Initialize Git
          </button>
        </section>
      ) : null}
      {gitState?.isRepo ? (
        <>
          <div className="row">
            <input
              value={prNumber}
              onChange={(event) => setPrNumber(event.target.value)}
              placeholder="Pull request number"
            />
            <button
              onClick={() => {
                if (!prNumber || !window.confirm(`Merge pull request #${prNumber} with squash?`))
                  return;
                void run(
                  "/api/agent/pr/merge",
                  jsonRequest({ cwd, number: Number(prNumber), method: "squash" }),
                  () => void refreshPullRequest(),
                  `Pull request #${prNumber} merged with squash.`,
                );
              }}
            >
              Squash and merge
            </button>
          </div>
          <div className="row">
            <input
              value={path}
              onChange={(event) => setPath(event.target.value)}
              placeholder="Changed path"
            />
            <button onClick={() => indexAction("add")}>Stage</button>
            <button onClick={() => indexAction("restore")}>Unstage</button>
            <button onClick={() => indexAction("revert")}>Revert</button>
          </div>
          <div className="row">
            <input
              value={commit}
              onChange={(event) => setCommit(event.target.value)}
              placeholder="Commit message"
            />
            <button
              onClick={() =>
                gitAction(
                  { action: "commit", message: commit, paths: path ? [path] : [] },
                  "Changes committed.",
                )
              }
            >
              Commit
            </button>
            <button onClick={() => gitAction({ action: "push" }, "Branch pushed.")}>Push</button>
          </div>
          <div className="row">
            <input
              value={branch}
              onChange={(event) => setBranch(event.target.value)}
              placeholder="Branch"
            />
            <button
              onClick={() =>
                gitAction({ action: "switch_branch", branch }, `Switched to ${branch}.`)
              }
            >
              Switch
            </button>
            <button
              onClick={() =>
                gitAction({ action: "create_branch", branch }, `Created and switched to ${branch}.`)
              }
            >
              Create
            </button>
            <input
              value={worktree}
              onChange={(event) => setWorktree(event.target.value)}
              placeholder="Worktree path"
            />
            <button
              onClick={() =>
                gitAction(
                  { action: "add_worktree", branch, path: worktree },
                  `Worktree added at ${worktree}.`,
                )
              }
            >
              Add worktree
            </button>
            <button
              onClick={() =>
                gitAction(
                  { action: "remove_worktree", path: worktree },
                  `Worktree removed from ${worktree}.`,
                )
              }
            >
              Remove
            </button>
          </div>
          <section>
            <p>
              Repository · Branch {gitState.branch ?? "detached"} · +{gitState.additions} -
              {gitState.deletions}
            </p>
            <p>Status: {gitState.status.join(", ") || "Working tree clean"}</p>
            {gitState.diff ? <pre>{gitState.diff}</pre> : null}
          </section>
          {branches.length ? (
            <p>
              Branches:{" "}
              {branches.map((entry) => `${entry.current ? "• " : ""}${entry.name}`).join(", ")}
            </p>
          ) : null}
          {worktrees.length ? (
            <p>
              Worktrees:{" "}
              {worktrees
                .map(
                  (entry) =>
                    `${entry.current ? "• " : ""}${entry.path} (${entry.branch ?? "detached"})`,
                )
                .join(", ")}
            </p>
          ) : null}
          {pullRequest ? (
            <p>
              PR #{pullRequest.number}: {pullRequest.title} · {pullRequest.state} ·{" "}
              {pullRequest.mergeable}
            </p>
          ) : null}
        </>
      ) : null}
      <p aria-live="polite">{feedback}</p>
      <ErrorText value={error} />
    </article>
  );
}

function BrowserTools() {
  const [url, setUrl] = useState("http://localhost:3000");
  const [history, setHistory] = useState<string[]>([]);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [frameUrl, setFrameUrl] = useState("");
  const refreshFrame = async () => {
    const response = decodeBrowserFrameResponse(await requestRecord("/api/agent/browser/frame"));
    setFrameUrl(response.data.frame ? `data:image/jpeg;base64,${response.data.frame}` : "");
    setUrl(response.data.url);
    setHistory((items) =>
      items.at(-1) === response.data.url ? items : [...items, response.data.url].slice(-24),
    );
  };
  const run = async (endpoint: `/api/${string}`, init?: RequestInit) => {
    try {
      await request(endpoint, init);
      setFeedback("Browser operation completed.");
      setError("");
      await refreshFrame();
    } catch (value) {
      setFeedback("");
      setError(value instanceof Error ? value.message : String(value));
    }
  };
  const navigate = () => void run("/api/agent/browser/navigate", jsonRequest({ url }));
  const sendEnter = async () => {
    try {
      const key = { kind: "key", key: "Enter", code: "Enter" };
      await request("/api/agent/browser/input", jsonRequest({ ...key, type: "down" }));
      await request("/api/agent/browser/input", jsonRequest({ ...key, type: "up" }));
      await refreshFrame();
    } catch (value) {
      setFeedback("");
      setError(value instanceof Error ? value.message : String(value));
    }
  };
  useMountSubscription(() => {
    void refreshFrame().catch((value) =>
      setError(value instanceof Error ? value.message : String(value)),
    );
  }, []);
  return (
    <article>
      <h3>Local browser</h3>
      <div className="row">
        <input value={url} onChange={(event) => setUrl(event.target.value)} />
        <button onClick={navigate}>Navigate</button>
        <button onClick={() => run("/api/agent/browser/back", jsonRequest({}))}>Back</button>
        <button onClick={() => run("/api/agent/browser/forward", jsonRequest({}))}>Forward</button>
        <button onClick={() => run("/api/agent/browser/reload", jsonRequest({}))}>Reload</button>
      </div>
      <div className="row">
        <button onClick={() => run(`/api/agent/browser/fetch?url=${encodeURIComponent(url)}`)}>
          Fetch text
        </button>
        <button onClick={() => run("/api/agent/browser/localhosts")}>Discover local apps</button>
        <button
          onClick={() =>
            run("/api/agent/browser/viewport", jsonRequest({ width: 1280, height: 800 }))
          }
        >
          1280 × 800
        </button>
        <button onClick={sendEnter}>Send Enter</button>
      </div>
      <p>
        History:{" "}
        {history.length
          ? history.map((entry) => (
              <button
                key={entry}
                onClick={() => run("/api/agent/browser/navigate", jsonRequest({ url: entry }))}
              >
                {entry}
              </button>
            ))
          : "None"}
      </p>
      {frameUrl ? <img src={frameUrl} alt="Current browser screencast frame" /> : null}
      <ErrorText value={error} />
      {feedback ? <p aria-live="polite">{feedback}</p> : null}
    </article>
  );
}

function TerminalTools({ cwd }: { cwd: string }) {
  const [id, setId] = useState("");
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");
  const stream = useRef<EventSource | null>(null);
  const reconnectTimer = useRef<number | null>(null);
  const disconnect = () => {
    stream.current?.close();
    stream.current = null;
    if (reconnectTimer.current !== null) window.clearTimeout(reconnectTimer.current);
    reconnectTimer.current = null;
  };
  useMountSubscription(() => disconnect, []);
  const connect = (ptyId: string) => {
    disconnect();
    const source = new EventSource(
      `/api/agent/terminal/pty/stream?id=${encodeURIComponent(ptyId)}`,
    );
    source.addEventListener("snapshot", (event) => setOutput(atob(event.data)));
    source.onmessage = (event) => setOutput((value) => value + atob(event.data));
    source.onerror = () => {
      source.close();
      reconnectTimer.current = window.setTimeout(() => connect(ptyId), 1500);
    };
    stream.current = source;
  };
  const open = async () => {
    try {
      const raw = await requestRecord(
        "/api/agent/terminal/pty/open",
        jsonRequest({ cwd, cols: 100, rows: 28, ownerKey: `workspace:${cwd}` }),
      );
      const result = decodePtyOpenResponse(raw);
      const ptyId = result.id;
      setId(ptyId);
      if (result.replay !== undefined) setOutput(result.replay);
      connect(ptyId);
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    }
  };
  const action = async (name: "input" | "resize" | "close", value: RecordJson) => {
    try {
      await request(`/api/agent/terminal/pty/${name}`, jsonRequest({ id, ...value }));
      if (name === "close") {
        disconnect();
        setId("");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };
  return (
    <article>
      <h3>Persistent terminal</h3>
      <div className="row">
        <button onClick={open}>{id ? "Reconnect" : "Open"}</button>
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Terminal input"
        />
        <button
          onClick={() => {
            void action("input", { data: `${input}\n` });
            setInput("");
          }}
        >
          Write
        </button>
        <button onClick={() => action("resize", { cols: 120, rows: 36 })}>Resize</button>
        <button onClick={() => action("close", {})}>Close</button>
      </div>
      <pre>{output || "Terminal output appears here."}</pre>
      <ErrorText value={error} />
    </article>
  );
}

export function WorkspaceTools({ cwd }: { cwd: string }) {
  return (
    <section className="tools">
      <h2>Explicit local tools</h2>
      <p>
        Reads stay local. Save, terminal, browser input, Git changes, and remote PR actions run only
        when you press their controls.
      </p>
      <div className="grid">
        <FileTools cwd={cwd} />
        <GitTools cwd={cwd} />
        <BrowserTools />
        <TerminalTools cwd={cwd} />
      </div>
    </section>
  );
}
