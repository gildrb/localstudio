import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  rmdirSync,
  statSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  copyPackageTree,
  frontendDir,
  packageDirectoryFor,
  readPackageManifest,
  repoRoot,
  walkUnder,
} from "./lib.mjs";

const standaloneBase = path.resolve(frontendDir, ".next", "standalone");

const RUNTIME_PREFIXES = [
  "server.js",
  "package.json",
  ".next/",
  "public/",
  "node_modules/",
  "frontend/server.js",
  "frontend/package.json",
  "frontend/.next/",
  "frontend/public/",
  "frontend/node_modules/",
];

function isRuntimeFile(file) {
  const rel = path.relative(standaloneBase, file).replaceAll("\\", "/");
  return RUNTIME_PREFIXES.some((prefix) => rel === prefix || rel.startsWith(prefix));
}

const filesUnder = (directory) => walkUnder(readdirSync, directory, (entry) => entry.isFile());
const symlinksUnder = (directory) =>
  walkUnder(readdirSync, directory, (entry) => entry.isSymbolicLink());

export function prepareNext() {
  rmSync(path.join(frontendDir, ".next"), { recursive: true, force: true });
}

export function completeStandalone() {
  const standaloneRoots = [path.resolve(standaloneBase, "frontend"), standaloneBase];
  const standaloneRoot = standaloneRoots.find((root) =>
    existsSync(path.resolve(root, "server.js")),
  );
  if (!standaloneRoot) throw Error(`Missing standalone server under: ${standaloneBase}`);

  const runtimeDependencyPaths = [
    ["typebox", "node_modules/typebox"],
    ["@earendil-works/pi-coding-agent", "node_modules/@earendil-works/pi-coding-agent"],
  ];
  const projectRequire = createRequire(path.resolve(frontendDir, "package.json"));
  const copiedPackages = new Map();
  for (const [packageName, destinationPath] of runtimeDependencyPaths) {
    if (!resolvablePackageDirectory(projectRequire, packageName)) {
      throw Error(`Missing runtime dependency source: ${destinationPath}`);
    }
    copyPackageTree(
      projectRequire,
      packageName,
      path.resolve(standaloneRoot, destinationPath),
      copiedPackages,
    );
  }

  const tracedPiPackageDirectory = path.resolve(
    standaloneRoot,
    ".next/node_modules/@earendil-works",
  );
  if (existsSync(tracedPiPackageDirectory)) {
    const packageTargets = new Map([
      [
        "pi-ai-",
        path.resolve(
          standaloneRoot,
          "node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai",
        ),
      ],
      [
        "pi-coding-agent-",
        path.resolve(standaloneRoot, "node_modules/@earendil-works/pi-coding-agent"),
      ],
    ]);
    for (const entry of readdirSync(tracedPiPackageDirectory)) {
      const target = [...packageTargets].find(([prefix]) => entry.startsWith(prefix))?.[1];
      if (!target) continue;
      const link = path.resolve(tracedPiPackageDirectory, entry);
      if (!lstatSync(link).isSymbolicLink()) {
        throw Error(`Expected traced Pi package alias to be a symlink: ${link}`);
      }
      unlinkSync(link);
      symlinkSync(path.relative(path.dirname(link), target), link, "dir");
    }
  }

  const externalLinks = symlinksUnder(standaloneRoot).filter((link) => {
    const target = path.relative(standaloneRoot, realpathSync(link));
    return target === ".." || target.startsWith(`..${path.sep}`) || path.isAbsolute(target);
  });
  for (const link of externalLinks) {
    const target = realpathSync(link);
    unlinkSync(link);
    cpSync(target, link, { recursive: true, dereference: true });
  }

  const isVerifiedCopy = (file, repoRelativePath) => {
    const source = path.resolve(repoRoot, repoRelativePath);
    if (!existsSync(source)) return false;
    const sourceStat = statSync(source);
    const copyStat = statSync(file);
    if (!sourceStat.isFile() || sourceStat.size !== copyStat.size) return false;
    if (!(repoRelativePath === "data" || /(^|\/)data\//.test(repoRelativePath))) return true;
    return readFileSync(source).equals(readFileSync(file));
  };

  const unverified = [];
  let pruned = 0;
  for (const file of filesUnder(standaloneBase)) {
    if (isRuntimeFile(file)) continue;
    const repoRelativePath = path.relative(standaloneBase, file).replaceAll("\\", "/");
    if (!isVerifiedCopy(file, repoRelativePath)) {
      unverified.push(repoRelativePath);
      continue;
    }
    unlinkSync(file);
    pruned += 1;
  }
  if (unverified.length > 0) {
    throw Error(
      `Standalone output contains non-runtime files with no matching repo source; refusing to prune them (move them aside manually if expected):\n${unverified.join("\n")}`,
    );
  }

  const removeEmptyDirectories = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) removeEmptyDirectories(path.resolve(directory, entry.name));
    }
    if (directory !== standaloneBase && readdirSync(directory).length === 0) rmdirSync(directory);
  };
  removeEmptyDirectories(standaloneBase);
  console.log(
    `  standalone repaired: +${runtimeDependencyPaths.length} runtime dependency trees, -${pruned} traced non-runtime files`,
  );
}

function requireRuntimeRoot() {
  const runtimeRoots = [path.resolve(standaloneBase, "frontend"), standaloneBase];
  const servers = runtimeRoots.map((root) => path.resolve(root, "server.js"));
  if (!servers.some((server) => existsSync(server)))
    throw Error(`Missing standalone server: ${servers.join(", ")}`);
  const required = [
    "node_modules/@earendil-works/pi-coding-agent/package.json",
    "node_modules/@earendil-works/pi-coding-agent/dist/index.js",
    "node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/package.json",
    "node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/providers/data/amazon-bedrock.json",
    "node_modules/@earendil-works/pi-coding-agent/node_modules/typebox/build/value/shared/union_priority_sort.mjs",
  ];
  for (const file of required) {
    if (!runtimeRoots.some((root) => existsSync(path.resolve(root, file))))
      throw Error(`Missing standalone runtime dependency: ${file}`);
  }
  return runtimeRoots.find((root) => existsSync(path.resolve(root, "server.js")));
}

function resolvablePackageDirectory(resolver, packageName) {
  try {
    return packageDirectoryFor(resolver, packageName);
  } catch {
    return undefined;
  }
}

function assertContainedPackage(runtimeRoot, packageName, packageDirectory) {
  if (!isContained(runtimeRoot, realpathSync(packageDirectory))) {
    throw Error(`Pi dependency escaped standalone runtime: ${packageName}`);
  }
}

function assertPackageClosure(sourceResolver, runtimeResolver, packageName, runtimeRoot, visited) {
  const sourceDirectory = packageDirectoryFor(sourceResolver, packageName);
  const runtimeDirectory = packageDirectoryFor(runtimeResolver, packageName);
  assertContainedPackage(runtimeRoot, packageName, runtimeDirectory);
  const sourceManifestPath = path.resolve(sourceDirectory, "package.json");
  const runtimeManifestPath = path.resolve(runtimeDirectory, "package.json");
  if (!readFileSync(sourceManifestPath).equals(readFileSync(runtimeManifestPath))) {
    throw Error(`Standalone package provenance mismatch: ${packageName}`);
  }
  const canonicalRuntimeDirectory = realpathSync(runtimeDirectory);
  if (visited.has(canonicalRuntimeDirectory)) return;
  visited.add(canonicalRuntimeDirectory);
  const manifest = readPackageManifest(sourceManifestPath);
  const sourceChildResolver = createRequire(sourceManifestPath);
  const runtimeChildResolver = createRequire(runtimeManifestPath);
  for (const dependency of Object.keys(manifest.dependencies)) {
    assertPackageClosure(
      sourceChildResolver,
      runtimeChildResolver,
      dependency,
      runtimeRoot,
      visited,
    );
  }
  const optional = { ...manifest.optionalDependencies, ...manifest.peerDependencies };
  for (const dependency of Object.keys(optional)) {
    if (!resolvablePackageDirectory(sourceChildResolver, dependency)) continue;
    assertPackageClosure(
      sourceChildResolver,
      runtimeChildResolver,
      dependency,
      runtimeRoot,
      visited,
    );
  }
}

function assertPiRuntime(runtimeRoot) {
  const codingAgent = path.resolve(runtimeRoot, "node_modules/@earendil-works/pi-coding-agent");
  const piAi = path.resolve(codingAgent, "node_modules/@earendil-works/pi-ai");
  const entries = [path.resolve(codingAgent, "dist/index.js"), path.resolve(piAi, "dist/index.js")];
  if (entries.some((entry) => !existsSync(entry)))
    throw Error("Missing packaged Pi runtime entrypoints");
  for (const entry of entries) {
    assertImportable(entry, runtimeRoot, "Standalone Pi runtime entrypoint");
  }
  const sourceResolver = createRequire(path.resolve(frontendDir, "package.json"));
  const runtimeResolver = createRequire(path.resolve(runtimeRoot, "package.json"));
  const visited = new Set();
  assertPackageClosure(sourceResolver, runtimeResolver, "typebox", runtimeRoot, visited);
  assertPackageClosure(
    sourceResolver,
    runtimeResolver,
    "@earendil-works/pi-coding-agent",
    runtimeRoot,
    visited,
  );
}

export function assertStandalone() {
  const runtimeRoot = requireRuntimeRoot();
  assertContainedLinks(standaloneBase, "standalone runtime");
  assertPiRuntime(runtimeRoot);
  const unexpected = filesUnder(standaloneBase).filter((file) => !isRuntimeFile(file));
  if (unexpected.length > 0)
    throw Error(`Standalone build contains non-runtime files:
${unexpected.map((file) => path.relative(standaloneBase, file)).join("\n")}`);
  console.log("  standalone server build is minimal");
}

function resolveResourcesDir(appOutDir, productFilename, electronPlatformName) {
  if (electronPlatformName === "darwin" || electronPlatformName === "mas") {
    return path.join(appOutDir, `${productFilename}.app`, "Contents", "Resources");
  }
  return path.join(appOutDir, "resources");
}

function isContained(root, target) {
  const relative = path.relative(root, target);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function assertContainedLinks(directory, label) {
  const canonicalDirectory = realpathSync(directory);
  const unsafe = symlinksUnder(directory).filter((link) => {
    if (path.isAbsolute(readlinkSync(link)) || !existsSync(link)) return true;
    return !isContained(canonicalDirectory, realpathSync(link));
  });
  if (unsafe.length > 0) throw Error(`Unsafe ${label} links: ${unsafe.join(", ")}`);
}

function assertImportable(entry, cwd, label, timeout) {
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", `import(${JSON.stringify(pathToFileURL(entry).href)})`],
    { cwd, encoding: "utf8", timeout },
  );
  if (result.status !== 0) {
    throw Error(`${label} is not importable: ${result.stderr || result.stdout || result.error}`);
  }
}

const isRuntimeArtifact = (source) =>
  !lstatSync(source).isFile() || !/\.(?:map|[cm]?ts)$/.test(path.basename(source));

function assertMatchingTree(sourceRoot, copyRoot, label, filter = isRuntimeArtifact) {
  assertContainedLinks(sourceRoot, `${label} source`);
  assertContainedLinks(copyRoot, label);
  const entries = (root, filter) =>
    [
      ...filesUnder(root)
        .filter(filter)
        .map((file) => ["file", path.relative(root, file)]),
      ...symlinksUnder(root)
        .filter(filter)
        .map((link) => ["link", path.relative(root, link)]),
    ].sort((a, b) => a[1].localeCompare(b[1]));
  const source = entries(sourceRoot, filter);
  const copy = entries(copyRoot, () => true);
  if (
    source.length !== copy.length ||
    source.some((entry, index) => entry[0] !== copy[index][0] || entry[1] !== copy[index][1])
  ) {
    throw Error(`${label} inventory differs from its source`);
  }
  for (const [kind, relative] of source) {
    const original = path.join(sourceRoot, relative);
    const copied = path.join(copyRoot, relative);
    const matches =
      kind === "link"
        ? readlinkSync(original) === readlinkSync(copied)
        : (statSync(original).mode & 0o777) === (statSync(copied).mode & 0o777) &&
          readFileSync(original).equals(readFileSync(copied));
    if (!matches) throw Error(`${label} provenance mismatch: ${relative}`);
  }
}

function assertFiles(root, label, files) {
  const missing = files.map((file) => path.join(root, file)).find((file) => !existsSync(file));
  if (missing) throw Error(`${label}: ${missing}`);
}

function materializeStandaloneRootDependencies(packagedStandaloneBase, standaloneServer) {
  const sourceRoot = path.join(standaloneBase, "node_modules");
  const packagedRoot = path.join(packagedStandaloneBase, "node_modules");
  if (!existsSync(path.join(sourceRoot, "next", "package.json"))) {
    throw Error(`Standalone root dependency closure is missing next: ${sourceRoot}`);
  }
  assertContainedLinks(sourceRoot, "standalone root dependency");

  rmSync(packagedRoot, { recursive: true, force: true });
  cpSync(sourceRoot, packagedRoot, {
    recursive: true,
    dereference: false,
    filter: isRuntimeArtifact,
  });
  assertMatchingTree(sourceRoot, packagedRoot, "Next dependency");

  const packagedResolver = createRequire(standaloneServer);
  const nextEntry = realpathSync(packagedResolver.resolve("next"));
  if (!isContained(packagedRoot, nextEntry)) {
    throw Error(`Packaged Next resolved outside its standalone dependency closure: ${nextEntry}`);
  }
  assertImportable(nextEntry, path.dirname(standaloneServer), "Packaged Next", 30_000);
}

function materializeAgentRuntime(resourcesDir) {
  const sourceRoot = path.join(repoRoot, "services", "agent-runtime", "dist");
  const packagedRoot = path.join(resourcesDir, "app", "agent-runtime");
  rmSync(packagedRoot, { recursive: true, force: true });
  cpSync(sourceRoot, packagedRoot, {
    recursive: true,
    dereference: false,
    verbatimSymlinks: true,
    filter: isRuntimeArtifact,
  });
  assertMatchingTree(sourceRoot, packagedRoot, "Agent runtime");
  return packagedRoot;
}

function packageArch(arch) {
  const names = ["ia32", "x64", "armv7l", "arm64", "universal"];
  const name = names[arch];
  if (!name) throw Error(`Unsupported Electron package architecture: ${arch}`);
  return name;
}

function materializeDesktopRuntime(resourcesDir, electronPlatformName, arch) {
  const platform = electronPlatformName === "mas" ? "darwin" : electronPlatformName;
  const arches = packageArch(arch) === "universal" ? ["x64", "arm64"] : [packageArch(arch)];
  const packageNames = [
    "@lydell/node-pty",
    ...arches.map((targetArch) => `@lydell/node-pty-${platform}-${targetArch}`),
  ];
  const resolver = createRequire(path.resolve(frontendDir, "package.json"));
  const runtimeRoot = path.join(resourcesDir, "desktop-runtime", "node_modules");
  rmSync(runtimeRoot, { recursive: true, force: true });
  for (const packageName of packageNames) {
    const source = packageDirectoryFor(resolver, packageName);
    const destination = path.join(runtimeRoot, ...packageName.split("/"));
    const packageArtifact = (file) =>
      isRuntimeArtifact(file) && !isContained(path.join(source, "node_modules"), file);
    cpSync(source, destination, { recursive: true, dereference: false, filter: packageArtifact });
    assertMatchingTree(source, destination, `Desktop runtime ${packageName}`, packageArtifact);
  }
  assertContainedLinks(runtimeRoot, "desktop runtime");
  return { runtimeRoot, platform, arches };
}

export async function afterPack(context) {
  const { appOutDir, arch, packager, electronPlatformName } = context;
  const productFilename = packager.appInfo.productFilename;
  const resourcesDir = resolveResourcesDir(appOutDir, productFilename, electronPlatformName);
  const packagedStandaloneBase = path.join(resourcesDir, "app", "frontend", ".next", "standalone");
  const candidates = [
    path.join(packagedStandaloneBase, "frontend", "server.js"),
    path.join(packagedStandaloneBase, "server.js"),
  ];
  const standaloneServer = candidates.find((candidate) => existsSync(candidate));

  const appArchive = path.join(resourcesDir, "app.asar");
  const appArchiveBytes = statSync(appArchive).size;
  if (appArchiveBytes > 5 * 1024 * 1024) {
    throw Error(`Packaged app.asar is unexpectedly large: ${appArchiveBytes} bytes`);
  }
  if (!standaloneServer) {
    throw Error(
      [
        "Packaged app is missing the embedded Next standalone server — refusing to sign/ship a broken bundle.",
        `Looked for: ${candidates.join(" or ")}`,
        `electron-builder failed to copy extraResources from .next/standalone (it can log "file source doesn't exist" yet still exit 0).`,
        "Re-run the build (run `npm run build` first if .next/standalone is absent).",
      ].join("\n  "),
    );
  }

  materializeStandaloneRootDependencies(packagedStandaloneBase, standaloneServer);

  const packagedRoot = path.dirname(standaloneServer);
  assertFiles(packagedRoot, "Missing Pi runtime dependency", [
    "node_modules/@earendil-works/pi-coding-agent/dist/index.js",
    "node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/package.json",
    "node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/providers/data/amazon-bedrock.json",
  ]);

  const agentRuntimeRoot = materializeAgentRuntime(resourcesDir);
  const agentRuntime = path.join(agentRuntimeRoot, "standalone.mjs");

  const {
    runtimeRoot: desktopRuntimeRoot,
    platform,
    arches,
  } = materializeDesktopRuntime(resourcesDir, electronPlatformName, arch);
  assertFiles(desktopRuntimeRoot, "Missing desktop runtime dependency", [
    "@lydell/node-pty/package.json",
    "@lydell/node-pty/index.js",
    ...arches.flatMap((targetArch) => {
      const packageRoot = `@lydell/node-pty-${platform}-${targetArch}`;
      const nativeRoot = `${packageRoot}/prebuilds/${platform}-${targetArch}`;
      return [
        `${packageRoot}/package.json`,
        `${packageRoot}/lib/index.js`,
        `${nativeRoot}/pty.node`,
        ...(platform === "win32" ? [] : [`${nativeRoot}/spawn-helper`]),
      ];
    }),
  ]);
  if (platform === process.platform && arches.includes(process.arch)) {
    const ptyEntry = createRequire(path.join(desktopRuntimeRoot, "package.json")).resolve(
      "@lydell/node-pty",
    );
    if (!isContained(desktopRuntimeRoot, realpathSync(ptyEntry))) {
      throw Error(`Packaged node-pty resolved outside its runtime closure: ${ptyEntry}`);
    }
    assertImportable(ptyEntry, desktopRuntimeRoot, "Packaged node-pty", 30_000);
  }

  const unwantedRuntimeFile = [
    packagedStandaloneBase,
    agentRuntimeRoot,
    desktopRuntimeRoot,
  ].flatMap((directory) =>
    readdirSync(directory, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.(?:map|[cm]?ts)$/.test(entry.name))
      .map((entry) => path.join(entry.parentPath, entry.name)),
  )[0];
  if (unwantedRuntimeFile) {
    throw Error(`Packaged app contains a non-runtime source artifact: ${unwantedRuntimeFile}`);
  }

  const agentRuntimeCode = readFileSync(agentRuntime, "utf8");
  if (
    /["'](?:[A-Za-z]:\\|\/(?:Users|home|root)\/)[^"'\n]*node_modules[\\/]/.test(agentRuntimeCode)
  ) {
    throw Error("Packaged agent runtime contains a build-machine dependency path");
  }

  if (electronPlatformName === "darwin") {
    const helperExecutable = path.join(
      path.dirname(resourcesDir),
      "Frameworks",
      `${productFilename} Helper.app`,
      "Contents",
      "MacOS",
      `${productFilename} Helper`,
    );
    if (!existsSync(helperExecutable)) {
      throw Error(`Packaged app is missing its Pi helper executable: ${helperExecutable}`);
    }
  }

  const packagedPiCli = path.join(
    packagedRoot,
    "node_modules",
    "@earendil-works",
    "pi-coding-agent",
    "dist",
    "cli.js",
  );
  if (!existsSync(packagedPiCli)) {
    throw Error(`Packaged app is missing its Pi CLI: ${packagedPiCli}`);
  }
  console.log(
    `  afterPack: embedded frontend and agent runtime present, app.asar ${appArchiveBytes} bytes (${electronPlatformName})`,
  );
}
