#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONTROLLER="$ROOT/scripts/install-controller.sh"
DESKTOP="$ROOT/scripts/install-desktop-app.sh"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/local-studio-install-tests.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
expect_failure() { local message="$1"; shift; if "$@" >"$TMP/out" 2>&1; then fail "expected failure: $message"; fi; grep -F "$message" "$TMP/out" >/dev/null || { cat "$TMP/out" >&2; fail "missing error: $message"; }; }

bash -n "$CONTROLLER" "$DESKTOP"
if command -v shellcheck >/dev/null 2>&1; then shellcheck "$CONTROLLER" "$DESKTOP"; fi
while IFS='|' read -r artifact digest; do
  grep -F "artifact=$artifact; digest=$digest" "$CONTROLLER" >/dev/null || fail "Bun pin drifted: $artifact"
done <<'PINS'
bun-darwin-aarch64.zip|d8b96221828ad6f97ac7ac0ab7e95872341af763001e8803e8267652c2652620
bun-darwin-x64-baseline.zip|3e35ad6f53971a9834bf9e6786e2adf72b5f1921cc9a9c5fde073d2972944076
bun-linux-aarch64.zip|a27ffb63a8310375836e0d6f668ae17fa8d8d18b88c37c821c65331973a19a3b
bun-linux-x64-baseline.zip|a063908ae08b7852ca10939bbdc6ceed3ddabce8fb9402dce83d65d73b36e6c7
bun-linux-aarch64-musl.zip|b98e0ad3625c5c00d1d5b5ff55605c7adddbfae151861e68ade57b2d3b8703bb
bun-linux-x64-musl-baseline.zip|56a7d6806cf155536c0178f0ea5fbd098e684fa509ebdb4fc0a7e19fb65382dc
PINS
home="$TMP/controller home"
source_dir="$home/"$'source \\ " % $' 
data_dir="$home/"$'data \\ " % $' 
runtime="$TMP/systemd-runtime"
mkdir -p "$home/.bun/bin" "$source_dir/controller/src" "$data_dir/models" "$runtime" "$TMP/controller-bin"
cat > "$home/.bun/bin/bun" <<'MOCK'
#!/usr/bin/env bash
[[ "${1:-}" == --version ]] && printf '%s\n' 1.3.14
exit 0
MOCK
for command in systemctl loginctl git; do printf '#!/usr/bin/env bash\nexit 0\n' > "$TMP/controller-bin/$command"; done
cat > "$TMP/controller-bin/uname" <<'MOCK'
#!/usr/bin/env bash
printf '%s\n' Linux
MOCK
cat > "$TMP/controller-bin/curl" <<'MOCK'
#!/usr/bin/env bash
exit 0
MOCK
chmod +x "$home/.bun/bin/bun" "$TMP/controller-bin/"*
printf '%s\n' 'LOCAL_STUDIO_API_KEY=test-key' > "$source_dir/.env"
env PATH="$TMP/controller-bin:$PATH" HOME="$home" USER="${USER:-tester}" LOCAL_STUDIO_DIR="$source_dir" LOCAL_STUDIO_DATA_DIR="$data_dir" LOCAL_STUDIO_MODELS_DIR="$data_dir/models" LOCAL_STUDIO_PORT=18080 LOCAL_STUDIO_SYSTEMD_RUNTIME_DIR="$runtime" bash "$CONTROLLER" > "$TMP/controller.out"
unit="$home/.config/systemd/user/local-studio-controller-18080.service"
[[ -f "$unit" && "$(stat -f '%Lp' "$unit" 2>/dev/null || stat -c '%a' "$unit")" == 600 ]] || fail 'systemd unit missing or permissive'
dollar='$'
for expected in "\\" "\\\"" "%%" "$dollar$dollar"; do
  grep -F "$expected" "$unit" >/dev/null || fail "systemd value was not escaped: $expected"
done
if command -v systemd-analyze >/dev/null 2>&1; then systemd-analyze verify "$unit"; fi

install="$TMP/install"
mkdir -p "$install"; ln -s "$install" "$TMP/install-alias"
expect_failure 'canonical install and rollback roots overlap' env LOCAL_STUDIO_INSTALL_ROOT="$install" LOCAL_STUDIO_ROLLBACK_ROOT="$TMP/install-alias" bash "$DESKTOP" --migrate-rollbacks
mkdir -p "$TMP/rollback-parent/install-child"
expect_failure 'canonical install and rollback roots overlap' env LOCAL_STUDIO_INSTALL_ROOT="$TMP/rollback-parent/install-child" LOCAL_STUDIO_ROLLBACK_ROOT="$TMP/rollback-parent" bash "$DESKTOP" --migrate-rollbacks

mkdir -p "$TMP/bin" "$TMP/release-install" "$TMP/release-rollbacks" "$TMP/release-tmp"
printf bad > "$TMP/bad.dmg"
printf '#!/usr/bin/env bash\nexit 0\n' > "$TMP/bin/hdiutil"; chmod +x "$TMP/bin/hdiutil"
expect_failure 'release checksum mismatch' env PATH="$TMP/bin:$PATH" LOCAL_STUDIO_INSTALL_ROOT="$TMP/release-install" LOCAL_STUDIO_ROLLBACK_ROOT="$TMP/release-rollbacks" LOCAL_STUDIO_RELEASE_DMG_URL="file://$TMP/bad.dmg" LOCAL_STUDIO_RELEASE_DMG_SHA256="$(printf '0%.0s' {1..64})" TMPDIR="$TMP/release-tmp" bash "$DESKTOP" stable
[[ -z "$(find "$TMP/release-tmp" -mindepth 1 -print -quit)" ]] || fail 'release temp survived pre-attach failure'

mkdir -p "$TMP/migrate-install/Old Local Studio.app/Contents" "$TMP/migrate-rollbacks"
printf occupied > "$TMP/migrate-rollbacks/Local Studio.zip"
cat > "$TMP/bin/PlistBuddy" <<'MOCK'
#!/usr/bin/env bash
printf '%s\n' org.local.studio.desktop
MOCK
cat > "$TMP/bin/unzip" <<'MOCK'
#!/usr/bin/env bash
[[ "$1" == -Z1 ]] && printf '%s\n' Contents/Info.plist
exit 0
MOCK
chmod +x "$TMP/bin/PlistBuddy" "$TMP/bin/unzip"
env PATH="$TMP/bin:$PATH" LOCAL_STUDIO_INSTALL_ROOT="$TMP/migrate-install" LOCAL_STUDIO_ROLLBACK_ROOT="$TMP/migrate-rollbacks" LOCAL_STUDIO_PLIST_BUDDY="$TMP/bin/PlistBuddy" LOCAL_STUDIO_LSREGISTER="$TMP/missing-lsregister" bash "$DESKTOP" --migrate-rollbacks > "$TMP/migrate.out"
[[ -d "$TMP/migrate-install/Old Local Studio.app" ]] || fail 'legacy bundle deleted without a matching archive'
grep -F 'rollback slot already contains other data' "$TMP/migrate.out" >/dev/null || fail 'occupied rollback slot was not reported'

mkdir -p "$TMP/strong-install/Old Local Studio.app/Contents" "$TMP/strong-rollbacks"
cat > "$TMP/bin/ditto" <<'MOCK'
#!/usr/bin/env bash
if [[ "$1" == -c ]]; then printf archive > "${@: -1}"; exit 0; fi
if [[ "$1" != -x ]]; then cp -R "$1" "$2"; exit 0; fi
archive="${@: -2:1}"; temporary="${@: -1}"; name='Local Studio'
[[ "$archive" == *Dev* ]] && name='Local Studio Dev'
mkdir -p "$temporary/Contents/MacOS" "$temporary/Contents/Frameworks/Local Studio Helper.app/Contents"
printf '%s\n' "$name" > "$temporary/Contents/Info.plist"
printf helper > "$temporary/Contents/Frameworks/Local Studio Helper.app/Contents/Info.plist"
printf '#!/bin/sh\n' > "$temporary/Contents/MacOS/$name"
chmod +x "$temporary/Contents/MacOS/$name"
MOCK
cat > "$TMP/bin/codesign" <<'MOCK'
#!/usr/bin/env bash
exit 0
MOCK
cat > "$TMP/bin/PlistBuddy" <<'MOCK'
#!/usr/bin/env bash
path="${@: -1}"
case "$path" in *Helper*) printf '%s\n' helper.id ;; *Dev*) printf '%s\n' org.local.studio.desktop.dev ;; *) if grep -q Dev "$path" 2>/dev/null; then printf '%s\n' org.local.studio.desktop.dev; else printf '%s\n' org.local.studio.desktop; fi ;; esac
MOCK
chmod +x "$TMP/bin/ditto" "$TMP/bin/codesign" "$TMP/bin/PlistBuddy"
env PATH="$TMP/bin:$PATH" LOCAL_STUDIO_INSTALL_ROOT="$TMP/strong-install" LOCAL_STUDIO_ROLLBACK_ROOT="$TMP/strong-rollbacks" LOCAL_STUDIO_PLIST_BUDDY="$TMP/bin/PlistBuddy" LOCAL_STUDIO_LSREGISTER="$TMP/missing-lsregister" bash "$DESKTOP" --migrate-rollbacks > "$TMP/strong.out"
[[ ! -e "$TMP/strong-install/Old Local Studio.app" ]] || fail 'strong archive validation selected a nested helper bundle'

mkdir -p "$TMP/upgrade-install/Local Studio Dev.app/Contents/MacOS" "$TMP/upgrade-built/Local Studio Dev.app/Contents/MacOS" "$TMP/upgrade-rollbacks"
printf '#!/bin/sh\n' > "$TMP/upgrade-install/Local Studio Dev.app/Contents/MacOS/Local Studio Dev"
printf '#!/bin/sh\n' > "$TMP/upgrade-built/Local Studio Dev.app/Contents/MacOS/Local Studio Dev"
chmod +x "$TMP/upgrade-install/Local Studio Dev.app/Contents/MacOS/Local Studio Dev" "$TMP/upgrade-built/Local Studio Dev.app/Contents/MacOS/Local Studio Dev"
env PATH="$TMP/bin:$PATH" LOCAL_STUDIO_INSTALL_ROOT="$TMP/upgrade-install" LOCAL_STUDIO_ROLLBACK_ROOT="$TMP/upgrade-rollbacks" LOCAL_STUDIO_BUILT_APP="$TMP/upgrade-built/Local Studio Dev.app" LOCAL_STUDIO_PLIST_BUDDY="$TMP/bin/PlistBuddy" LOCAL_STUDIO_LSREGISTER="$TMP/missing-lsregister" LOCAL_STUDIO_SKIP_RUNTIME_CLEANUP=1 bash "$DESKTOP" dev > "$TMP/upgrade.out"
[[ -f "$TMP/upgrade-rollbacks/Local Studio Dev.zip" ]] || fail 'strong normal backup was not retained'
printf '%s\n' 'Installer contracts passed'
