import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const MIGRATION_MARKER_PREFIX = "legacy-user-data-migration-v1";
const MIGRATED_USER_DATA_PATHS = [
  "Local Storage",
  "Cookies",
  "Cookies-journal",
  "DIPS",
  "DIPS-shm",
  "DIPS-wal",
  "IndexedDB",
  "Network Persistent State",
  "Preferences",
  "Session Storage",
  "SharedStorage",
  "SharedStorage-shm",
  "SharedStorage-wal",
  "TransportSecurity",
  "Trust Tokens",
  "Trust Tokens-journal",
  "WebStorage",
  "agent-session-metadata.json",
  "api-settings.json",
  "computer-use",
  "controllers.json",
  "embedded-frontend.port",
  "logs",
  "mcp",
  "pi-agent",
  "projects.json",
  "session-prefs.json",
  "ui-preferences.json",
  "vekor",
] as const;

export function migrateLegacyUserData({
  legacyDir,
  targetDir,
}: {
  legacyDir: string;
  targetDir: string;
}): string[] {
  const sourceRoot = path.resolve(legacyDir);
  const targetRoot = path.resolve(targetDir);
  if (sourceRoot === targetRoot || !existsSync(sourceRoot)) return [];
  const markerPath = path.join(targetRoot, migrationMarkerName(sourceRoot));
  if (existsSync(markerPath)) return [];

  try {
    mkdirSync(targetRoot, { recursive: true });
  } catch (error) {
    console.warn(`[desktop] Failed to prepare user-data migration target: ${String(error)}`);
    return [];
  }

  const migrated: string[] = [];
  const skipped: string[] = [];
  const failed: string[] = [];
  for (const relativePath of MIGRATED_USER_DATA_PATHS) {
    const sourcePath = path.join(sourceRoot, relativePath);
    if (!existsSync(sourcePath)) continue;
    try {
      const targetPath = path.join(targetRoot, relativePath);
      const copied = copyMissingPath(sourcePath, targetPath);
      (copied ? migrated : skipped).push(relativePath);
    } catch (error) {
      failed.push(relativePath);
      console.warn(`[desktop] Failed to migrate ${relativePath}: ${String(error)}`);
    }
  }
  if (failed.length === 0) {
    writeMigrationMarker(markerPath, { legacyDir: sourceRoot, migrated, skipped });
  } else {
    console.warn(
      `[desktop] Legacy user-data migration left ${failed.length} paths pending; will retry next launch`,
    );
  }
  return migrated;
}

function migrationMarkerName(sourceRoot: string): string {
  const sourceKey = sourceRoot
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .slice(-80);
  return `${MIGRATION_MARKER_PREFIX}-${sourceKey || "source"}.json`;
}

function copyMissingPath(source: string, target: string): boolean {
  if (!existsSync(target)) {
    mkdirSync(path.dirname(target), { recursive: true });
    cpSync(source, target, { recursive: statSync(source).isDirectory(), force: false });
    return true;
  }
  if (!statSync(source).isDirectory() || !statSync(target).isDirectory()) return false;
  return readdirSync(source).reduce(
    (copied, entry) =>
      copyMissingPath(path.join(source, entry), path.join(target, entry)) || copied,
    false,
  );
}

function writeMigrationMarker(
  markerPath: string,
  details: { legacyDir: string; migrated: string[]; skipped: string[] },
): void {
  try {
    writeFileSync(
      markerPath,
      `${JSON.stringify({ ...details, migratedAt: new Date().toISOString() }, null, 2)}\n`,
      "utf8",
    );
  } catch (error) {
    console.warn(`[desktop] Failed to write user-data migration marker: ${String(error)}`);
  }
}
