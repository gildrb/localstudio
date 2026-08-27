#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterPack } from "./project/standalone.mjs";

const commands = {
  "assert-release-main": "release assertReleaseMain",
  "assert-standalone": "standalone assertStandalone",
  "browser-perf": "browser-perf",
  "bundle-agent-runtime": "agent-runtime bundleAgentRuntime",
  "check-commits": "commits checkCommits",
  "complete-standalone": "standalone completeStandalone",
  "controller-standards": "validate controllerStandards",
  doctor: "toolchain doctor",
  perf: "perf",
  "postbuild-agent-runtime": "agent-runtime postbuildAgentRuntime",
  "prepare-agent-runtime": "agent-runtime prepareAgentRuntime",
  "prepare-next": "standalone prepareNext",
  "release-notes": "release-notes",
  "sign-release": "release signDesktopRelease",
  "stage-release": "release stageDesktopRelease",
  start: "start start",
  "validate-contracts": "validate validateContracts",
  "validate-package": "validate validatePackage",
  "validate-structure": "validate validateStructure",
  "validate-ui": "validate validateUi",
  "audit-layout": "validate auditLayout",
};

async function invoke(spec) {
  const [module, exported] = spec.split(" ");
  const loaded = await import(`./project/${module}.mjs`);
  if (exported) await loaded[exported]();
}

const invoked = path.basename(process.argv[1] ?? "");
const hooks = {
  "commit-msg": "commits checkCommits",
  "pre-commit": "hooks preCommit",
  "pre-push": "hooks prePush",
};
if (Object.hasOwn(hooks, invoked)) {
  if (invoked === "commit-msg") process.argv.splice(2, 0, "--message-file");
  await invoke(hooks[invoked]);
} else if (
  invoked === "project.mjs" ||
  path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)
) {
  const command = process.argv[2];
  process.argv.splice(2, 1);
  if (command === "setup-hooks") await invoke("toolchain setupHooks");
  else if (!command || !Object.hasOwn(commands, command)) {
    console.error(`Usage: node scripts/project.mjs <${Object.keys(commands).join("|")}>`);
    process.exit(1);
  } else await invoke(commands[command]);
}

export default afterPack;
