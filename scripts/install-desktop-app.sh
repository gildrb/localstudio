#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_ROOT="${LOCAL_STUDIO_INSTALL_ROOT:-/Applications}"
ROLLBACK_ROOT="${LOCAL_STUDIO_ROLLBACK_ROOT:-$HOME/Library/Application Support/Local Studio Installer/Rollbacks}"
LSREGISTER="${LOCAL_STUDIO_LSREGISTER:-/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister}"
PLIST_BUDDY="${LOCAL_STUDIO_PLIST_BUDDY:-/usr/libexec/PlistBuddy}"
SKIP_RUNTIME_CLEANUP="${LOCAL_STUDIO_SKIP_RUNTIME_CLEANUP:-0}"
RELEASE_DMG_URL="${LOCAL_STUDIO_RELEASE_DMG_URL:-https://github.com/sybil-solutions/local-studio/releases/download/v2.15.2/Local-Studio-2.15.2-arm64.dmg}"
RELEASE_DMG_SHA256="${LOCAL_STUDIO_RELEASE_DMG_SHA256:-3d44944da62d471f81283a9c8fbb3f4f9f6ce1f4d158014a20ab901d27972bab}"
EXPECTED_TEAM_ID="TZ447KHNZL"
RELEASE_TEMP=""
RELEASE_MOUNT=""
RELEASE_ATTACHED=0

channel="stable"
keep_backup=1
mode="install"

for arg in "$@"; do
  case "$arg" in
    stable|dev) channel="$arg" ;;
    --no-backup) keep_backup=0 ;;
    --migrate-rollbacks) mode="migrate" ;;
    *) echo "error: unknown argument $arg" >&2; exit 2 ;;
  esac
done

if [[ "$INSTALL_ROOT" != /* || "$INSTALL_ROOT" == "/" ]]; then
  echo "error: install root must be an absolute directory below /" >&2
  exit 2
fi

if [[ "$ROLLBACK_ROOT" != /* || "$ROLLBACK_ROOT" == "/" || "$ROLLBACK_ROOT" == "$INSTALL_ROOT" || "$ROLLBACK_ROOT/" == "$INSTALL_ROOT/"* ]]; then
  echo "error: rollback root must be an absolute directory outside the install root" >&2
  exit 2
fi

mkdir -p "$INSTALL_ROOT" "$ROLLBACK_ROOT"
INSTALL_ROOT="$(cd "$INSTALL_ROOT" && pwd -P)"
ROLLBACK_ROOT="$(cd "$ROLLBACK_ROOT" && pwd -P)"
if [[ "$INSTALL_ROOT" == "/" || "$ROLLBACK_ROOT" == "/" || "$ROLLBACK_ROOT" == "$INSTALL_ROOT" || "$ROLLBACK_ROOT/" == "$INSTALL_ROOT/"* || "$INSTALL_ROOT/" == "$ROLLBACK_ROOT/"* ]]; then
  echo "error: canonical install and rollback roots overlap" >&2
  exit 2
fi

if [[ "$channel" == "dev" ]]; then
  APP_NAME="Local Studio Dev"
  APP_ID="org.local.studio.desktop.dev"
  BUILT="${LOCAL_STUDIO_BUILT_APP:-$REPO_ROOT/frontend/dist-desktop-dev/mac-arm64/$APP_NAME.app}"
else
  APP_NAME="Local Studio"
  APP_ID="org.local.studio.desktop"
  BUILT="${LOCAL_STUDIO_BUILT_APP:-}"
fi

TARGET="$INSTALL_ROOT/$APP_NAME.app"
ROLLBACK="$ROLLBACK_ROOT/$APP_NAME.zip"
TRANSACTION=""
STAGED=""
REPLACED=""

bundle_id() {
  "$PLIST_BUDDY" -c 'Print :CFBundleIdentifier' "$1/Contents/Info.plist" 2>/dev/null
}

archive_bundle() {
  local source="$1"
  local destination="$2"
  local temporary="$destination.tmp.$$"
  mkdir -p "$(dirname "$destination")"
  rm -f "$temporary"
  if ! ditto -c -k --sequesterRsrc --keepParent "$source/Contents" "$temporary"; then
    rm -f "$temporary"
    return 1
  fi
  if ! archive_is_valid "$temporary"; then
    rm -f "$temporary"
    echo "error: rollback archive is incomplete" >&2
    return 1
  fi
  mv -f "$temporary" "$destination"
}

archive_is_valid() {
  local archive="$1"
  [[ -f "$archive" ]] || return 1
  unzip -tqq "$archive" || return 1
  unzip -Z1 "$archive" | awk '$0 == "Contents/Info.plist" || ($0 ~ /^Local Studio( Dev)?\.app/ && $0 ~ /\/Contents\/Info\.plist$/) { found = 1 } END { exit found ? 0 : 1 }'
}

archive_matches_bundle() {
  local archive="$1" id="$2" name="$3" temporary info root
  temporary="$(mktemp -d "${TMPDIR:-/tmp}/local-studio-archive.XXXXXX")"
  if ditto -x -k "$archive" "$temporary"; then
    info="$temporary/Contents/Info.plist"
    [[ -f "$info" ]] || info="$temporary/$name.app/Contents/Info.plist"
  fi
  if [[ -n "$info" && -f "$info" ]]; then
    root="${info%/Contents/Info.plist}"
    if [[ "$(bundle_id "$root" || true)" == "$id" && -x "$root/Contents/MacOS/$name" ]] && codesign --verify --deep --strict "$root"; then
      rm -rf "$temporary"
      return 0
    fi
  fi
  rm -rf "$temporary"
  return 1
}

unregister_bundle_tree() {
  local root="$1"
  local nested
  [[ -x "$LSREGISTER" ]] || return 0
  while IFS= read -r -d '' nested; do
    "$LSREGISTER" -u "$nested" >/dev/null 2>&1 || true
  done < <(find "$root" -type d -name '*.app' -print0 2>/dev/null)
  "$LSREGISTER" -u "$root" >/dev/null 2>&1 || true
}

prune_stale_launch_services() {
  local registered
  [[ -x "$LSREGISTER" ]] || return 0
  while IFS= read -r registered; do
    case "$registered" in
      "$INSTALL_ROOT/Local Studio.app"|"$INSTALL_ROOT/Local Studio.app/"*|"$INSTALL_ROOT/Local Studio Dev.app"|"$INSTALL_ROOT/Local Studio Dev.app/"*) continue ;;
      "$INSTALL_ROOT/Local Studio"*) ;;
      *) continue ;;
    esac
    [[ ! -e "$registered" ]] || continue
    "$LSREGISTER" -u "$registered" >/dev/null 2>&1 || true
  done < <("$LSREGISTER" -dump 2>/dev/null | sed -nE 's/^[[:space:]]*path:[[:space:]]*(.*) \(0x[[:xdigit:]]+\)$/\1/p')
  "$LSREGISTER" -gc >/dev/null 2>&1 || true
}

migrate_legacy_bundles() {
  local skip_id="${1:-}"
  local candidate id name canonical archive

  while IFS= read -r -d '' candidate; do
    id="$(bundle_id "$candidate" || true)"
    case "$id" in
      org.local.studio.desktop) name="Local Studio" ;;
      org.local.studio.desktop.dev) name="Local Studio Dev" ;;
      *) continue ;;
    esac
    canonical="$INSTALL_ROOT/$name.app"
    archive="$ROLLBACK_ROOT/$name.zip"
    [[ "$candidate" != "$canonical" ]] || continue

    if [[ "$id" != "$skip_id" ]]; then
      if archive_is_valid "$archive"; then
        echo "==> keeping legacy bundle; rollback slot already contains other data: $candidate"
        continue
      fi
      echo "==> archiving legacy rollback $candidate -> $archive"
      archive_bundle "$candidate" "$archive"
      if ! archive_matches_bundle "$archive" "$id" "$name"; then
        echo "error: refusing to remove legacy bundle; rollback validation failed" >&2
        rm -f "$archive"
        continue
      fi
    fi

    echo "==> removing legacy bundle $candidate"
    unregister_bundle_tree "$candidate"
    rm -rf "$candidate"
  done < <([[ ! -d "$INSTALL_ROOT" ]] || find "$INSTALL_ROOT" -mindepth 1 -maxdepth 1 -type d -iname '*Local Studio*' -print0)

  prune_stale_launch_services
}

cleanup_temporary_paths() {
  local failed=0
  if [[ "${SWAP_VERIFIED:-0}" == "0" && -n "$REPLACED" && -d "$REPLACED" ]]; then
    if rm -rf "$TARGET" && mv "$REPLACED" "$TARGET"; then :; else
      echo "error: failed to restore $TARGET; replacement remains at $REPLACED" >&2
      failed=1
    fi
  elif [[ "${SWAP_VERIFIED:-0}" == "0" && "${TARGET_INSTALLED:-0}" == "1" ]]; then
    rm -rf "$TARGET" || { echo "error: failed to remove unverified $TARGET" >&2; failed=1; }
  fi
  [[ -z "$STAGED" ]] || rm -rf "$STAGED" || { echo "error: failed to remove $STAGED" >&2; failed=1; }
  cleanup_release_source || failed=1
  [[ -z "$TRANSACTION" ]] || rmdir "$TRANSACTION" 2>/dev/null || true
  return "$failed"
}

cleanup_release_source() {
  local failed=0
  if [[ "$RELEASE_ATTACHED" == "1" ]]; then
    if hdiutil detach "$RELEASE_MOUNT" -quiet || hdiutil detach "$RELEASE_MOUNT" -force -quiet; then RELEASE_ATTACHED=0; else failed=1; fi
  fi
  if [[ "$RELEASE_ATTACHED" == "0" && -n "$RELEASE_TEMP" ]]; then
    if rm -rf "$RELEASE_TEMP"; then RELEASE_TEMP=""; RELEASE_MOUNT=""; else failed=1; fi
  fi
  (( failed == 0 ))
}

if [[ "$mode" == "migrate" ]]; then
  migrate_legacy_bundles
  echo "==> done. rollback archives: $ROLLBACK_ROOT"
  exit 0
fi

SWAP_VERIFIED=0
TARGET_INSTALLED=0
TRANSACTION="$(mktemp -d "$INSTALL_ROOT/.local-studio-install-$APP_ID.XXXXXX")"
STAGED="$TRANSACTION/staged.app"
REPLACED="$TRANSACTION/replaced.app"
trap cleanup_temporary_paths EXIT

if [[ "$channel" == "stable" && -z "$BUILT" ]]; then
  RELEASE_TEMP="$(mktemp -d "${TMPDIR:-/tmp}/local-studio-release.XXXXXX")"
  RELEASE_MOUNT="$RELEASE_TEMP/mount"
  release_dmg="$RELEASE_TEMP/Local-Studio-arm64.dmg"
  mkdir -p "$RELEASE_MOUNT"
  echo "==> downloading latest stable release"
  curl --fail --location --silent --show-error "$RELEASE_DMG_URL" --output "$release_dmg"
  [[ "$(shasum -a 256 "$release_dmg" | awk '{print $1}')" == "$RELEASE_DMG_SHA256" ]] || { echo "error: release checksum mismatch" >&2; exit 1; }
  xcrun stapler validate "$release_dmg"
  spctl --assess --type open --context context:primary-signature "$release_dmg"
  hdiutil attach -readonly -nobrowse -mountpoint "$RELEASE_MOUNT" "$release_dmg" >/dev/null
  RELEASE_ATTACHED=1
  BUILT="$RELEASE_MOUNT/$APP_NAME.app"
fi

if [[ ! -d "$BUILT" ]]; then
  echo "error: no built bundle at $BUILT" >&2
  hint="desktop:dist"
  [[ "$channel" == "dev" ]] && hint="desktop:dist:dev"
  echo "       run: npm --prefix frontend run $hint" >&2
  exit 1
fi

if [[ "$(bundle_id "$BUILT" || true)" != "$APP_ID" ]]; then
  echo "error: built bundle identifier does not match $APP_ID" >&2
  exit 1
fi

if [[ ! -x "$BUILT/Contents/MacOS/$APP_NAME" ]]; then
  echo "error: built bundle has no executable" >&2
  exit 1
fi

if [[ "$BUILT" != /* ]]; then
  echo "error: built bundle path must be absolute" >&2
  exit 2
fi

codesign --verify --deep --strict "$BUILT"
if [[ "$channel" == "stable" ]]; then
  spctl --assess --type execute "$BUILT"
  [[ "$(codesign -dv --verbose=4 "$BUILT" 2>&1 | sed -n 's/^TeamIdentifier=//p')" == "$EXPECTED_TEAM_ID" ]] || { echo "error: release publisher does not match $EXPECTED_TEAM_ID" >&2; exit 1; }
fi
ditto "$BUILT" "$STAGED"
codesign --verify --deep --strict "$STAGED"
cleanup_release_source

if [[ -d "$TARGET" && "$keep_backup" == "1" ]]; then
  echo "==> archiving current install -> $ROLLBACK"
  archive_bundle "$TARGET" "$ROLLBACK"
  archive_matches_bundle "$ROLLBACK" "$APP_ID" "$APP_NAME" || { rm -f "$ROLLBACK"; echo "error: current install rollback failed strong validation" >&2; exit 1; }
elif [[ "$keep_backup" == "0" ]]; then
  rm -f "$ROLLBACK"
fi

if [[ "$SKIP_RUNTIME_CLEANUP" != "1" ]]; then
  echo "==> quitting $APP_NAME"
  osascript -e "tell application \"$APP_NAME\" to quit" >/dev/null 2>&1 || true
  executable="$TARGET/Contents/MacOS/$APP_NAME"
  for _ in {1..10}; do
    if [[ ! -e "$executable" ]] || ! lsof -t "$executable" >/dev/null 2>&1; then break; fi
    sleep 0.5
  done
  if [[ -e "$executable" ]]; then
    while IFS= read -r pid; do [[ -z "$pid" ]] || kill "$pid" 2>/dev/null || true; done < <(lsof -t "$executable" 2>/dev/null | sort -u)
  fi

  for port in 3000 8081; do
    while IFS= read -r pid; do
      [[ -n "$pid" ]] || continue
      command="$(ps -p "$pid" -o command= 2>/dev/null || true)"
      case "$command" in *"$TARGET/"*) ;; *) continue ;; esac
      echo "==> stopping stale $APP_NAME server on :$port (pid $pid)"
      kill "$pid" 2>/dev/null || true
    done < <(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | sort -u)
  done
fi

if [[ -d "$TARGET" ]]; then
  mv "$TARGET" "$REPLACED"
fi

mv "$STAGED" "$TARGET"
TARGET_INSTALLED=1
codesign --verify --deep --strict "$TARGET"
if [[ "$channel" == "stable" ]]; then
  spctl --assess --type execute "$TARGET"
  [[ "$(codesign -dv --verbose=4 "$TARGET" 2>&1 | sed -n 's/^TeamIdentifier=//p')" == "$EXPECTED_TEAM_ID" ]] || { echo "error: installed publisher does not match $EXPECTED_TEAM_ID" >&2; exit 1; }
fi
SWAP_VERIFIED=1
rm -rf "$REPLACED"
rmdir "$TRANSACTION"
TRANSACTION=""

if [[ "$keep_backup" == "1" ]]; then
  migrate_legacy_bundles
else
  migrate_legacy_bundles "$APP_ID"
fi

if [[ -x "$LSREGISTER" ]]; then
  "$LSREGISTER" -f "$TARGET" >/dev/null 2>&1 || true
  "$LSREGISTER" -gc >/dev/null 2>&1 || true
fi

trap - EXIT
echo "==> installed $TARGET"
if [[ -f "$ROLLBACK" ]]; then
  echo "==> rollback archive: $ROLLBACK"
fi
echo "    launch with: open \"$TARGET\""
