#!/usr/bin/env bash
# Idempotent single-machine installer. Environment overrides: LOCAL_STUDIO_DIR,
# LOCAL_STUDIO_DATA_DIR, LOCAL_STUDIO_MODELS_DIR, LOCAL_STUDIO_HOST,
# LOCAL_STUDIO_PORT, and LOCAL_STUDIO_REPO. The final line is machine-readable.
set -euo pipefail
umask 077

OS_NAME="$(uname -s)"
HOST_WAS_SET="${LOCAL_STUDIO_HOST+x}"
PORT_WAS_SET="${LOCAL_STUDIO_PORT+x}"
DATA_DIR_WAS_SET="${LOCAL_STUDIO_DATA_DIR+x}"
MODELS_DIR_WAS_SET="${LOCAL_STUDIO_MODELS_DIR+x}"
if [ "$OS_NAME" = "Darwin" ]; then
  DEFAULT_DIR="$HOME/Library/Application Support/Local Studio/controller-source"
  DEFAULT_DATA_DIR="$HOME/Library/Application Support/Local Studio/controller-data"
else
  DEFAULT_DIR="$HOME/local-studio"
  DEFAULT_DATA_DIR="$DEFAULT_DIR/data"
fi
DIR="${LOCAL_STUDIO_DIR:-$DEFAULT_DIR}"
DATA_DIR="${LOCAL_STUDIO_DATA_DIR:-$DEFAULT_DATA_DIR}"
MODELS_DIR="${LOCAL_STUDIO_MODELS_DIR:-$DATA_DIR/models}"
HOST="${LOCAL_STUDIO_HOST:-0.0.0.0}"
PORT="${LOCAL_STUDIO_PORT:-8080}"
REPO="${LOCAL_STUDIO_REPO:-https://github.com/sybil-solutions/local-studio.git}"
BUN="$HOME/.bun/bin/bun"
SYSTEMD_RUNTIME_DIR="${LOCAL_STUDIO_SYSTEMD_RUNTIME_DIR:-/run/systemd/system}"
case "$DIR$DATA_DIR$MODELS_DIR$HOST$PORT$REPO" in *$'\n'*|*$'\r'*) printf '%s\n' '[local-studio] configuration values must be single-line' >&2; exit 1 ;; esac

log() { printf '[local-studio] %s\n' "$*"; }
json_escape() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }

for dependency in git curl; do
  command -v "$dependency" >/dev/null 2>&1 || { log "$dependency is required — install it and rerun"; exit 1; }
done

if [ ! -x "$BUN" ] && ! command -v bun >/dev/null 2>&1; then
  command -v unzip >/dev/null 2>&1 || { log "unzip is required — install it and rerun"; exit 1; }
  machine="$(uname -m)"
  case "$OS_NAME:$machine" in
    Darwin:arm64) artifact=bun-darwin-aarch64.zip; digest=d8b96221828ad6f97ac7ac0ab7e95872341af763001e8803e8267652c2652620 ;;
    Darwin:x86_64) artifact=bun-darwin-x64-baseline.zip; digest=3e35ad6f53971a9834bf9e6786e2adf72b5f1921cc9a9c5fde073d2972944076 ;;
    Linux:aarch64|Linux:arm64) artifact=bun-linux-aarch64.zip; digest=a27ffb63a8310375836e0d6f668ae17fa8d8d18b88c37c821c65331973a19a3b ;;
    Linux:x86_64) artifact=bun-linux-x64-baseline.zip; digest=a063908ae08b7852ca10939bbdc6ceed3ddabce8fb9402dce83d65d73b36e6c7 ;;
    *) log "unsupported Bun platform: $OS_NAME $machine"; exit 1 ;;
  esac
  case "$(ldd --version 2>&1 || true)" in
    *musl*) case "$machine" in
      x86_64) artifact=bun-linux-x64-musl-baseline.zip; digest=56a7d6806cf155536c0178f0ea5fbd098e684fa509ebdb4fc0a7e19fb65382dc ;;
      *) artifact=bun-linux-aarch64-musl.zip; digest=b98e0ad3625c5c00d1d5b5ff55605c7adddbfae151861e68ade57b2d3b8703bb ;;
    esac ;;
  esac
  temp="$(mktemp -d "${TMPDIR:-/tmp}/local-studio-bun.XXXXXX")"
  trap 'rm -rf "$temp"' EXIT
  archive="$temp/$artifact"
  log "installing Bun 1.3.14…"
  curl -fsSL "https://github.com/oven-sh/bun/releases/download/bun-v1.3.14/$artifact" -o "$archive"
  if command -v sha256sum >/dev/null 2>&1; then actual="$(sha256sum "$archive" | awk '{print $1}')";
  else actual="$(shasum -a 256 "$archive" | awk '{print $1}')"; fi
  [ "$actual" = "$digest" ] || { log "Bun archive checksum mismatch"; exit 1; }
  unzip -q "$archive" -d "$temp"
  mkdir -p "$(dirname "$BUN")"
  install -m 755 "$temp/${artifact%.zip}/bun" "$BUN.tmp.$$"
  mv "$BUN.tmp.$$" "$BUN"
  rm -rf "$temp"; trap - EXIT
fi
[ -x "$BUN" ] || BUN="$(command -v bun)"
[ "$("$BUN" --version)" = 1.3.14 ] || { log "Bun 1.3.14 is required"; exit 1; }
log "bun: 1.3.14"

if [ -d "$DIR/.git" ]; then
  log "updating existing checkout at $DIR"
  git -C "$DIR" pull --ff-only || log "pull failed (local changes?) — keeping current checkout"
elif [ -d "$DIR/controller" ]; then
  log "using existing non-git install at $DIR (left untouched)"
else
  log "cloning into $DIR"
  git clone --depth 1 "$REPO" "$DIR"
fi

log "installing controller dependencies…"
(cd "$DIR/controller" && "$BUN" install >/dev/null 2>&1) || (cd "$DIR/controller" && "$BUN" install)

ENV_FILE="$DIR/.env"
read_env_value() {
  awk -v key="$1" 'index($0, key "=") == 1 { sub("^[^=]*=", ""); print; found=1; exit } END { exit !found }' "$ENV_FILE" 2>/dev/null
}
write_env_value() {
  key="$1" value="$2"
  if grep -q "^$key=" "$ENV_FILE" 2>/dev/null; then
    LOCAL_STUDIO_ENV_VALUE="$value" awk -v key="$key" 'index($0, key "=") == 1 { if (!written) print key "=" ENVIRON["LOCAL_STUDIO_ENV_VALUE"]; written=1; next } { print }' "$ENV_FILE" > "$ENV_FILE.tmp"
    mv "$ENV_FILE.tmp" "$ENV_FILE"
  else printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"; fi
}
if [ -f "$ENV_FILE" ] && API_KEY="$(read_env_value LOCAL_STUDIO_API_KEY)" && [ -n "$API_KEY" ]; then
  log "reusing existing API key from .env"
else
  if command -v openssl >/dev/null 2>&1; then
    API_KEY="$(openssl rand -hex 32)"
  else
    API_KEY="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  fi
  printf 'LOCAL_STUDIO_API_KEY=%s\n' "$API_KEY" >> "$ENV_FILE"
  log "wrote $ENV_FILE"
fi
if [ -z "$HOST_WAS_SET" ] && value="$(read_env_value LOCAL_STUDIO_HOST)"; then HOST="$value"; fi
if [ -z "$PORT_WAS_SET" ] && value="$(read_env_value LOCAL_STUDIO_PORT)"; then PORT="$value"; fi
if [ -z "$DATA_DIR_WAS_SET" ]; then
  if value="$(read_env_value LOCAL_STUDIO_DATA_DIR)"; then DATA_DIR="$value";
  elif [ -d "$DIR/data" ]; then DATA_DIR="$DIR/data"; fi
fi
if [ -z "$MODELS_DIR_WAS_SET" ]; then
  if value="$(read_env_value LOCAL_STUDIO_MODELS_DIR)"; then MODELS_DIR="$value";
  else MODELS_DIR="$DATA_DIR/models"; fi
fi
case "$DIR$DATA_DIR$MODELS_DIR$HOST$PORT$API_KEY" in *$'\n'*|*$'\r'*) log "configuration values must be single-line"; exit 1 ;; esac
if [[ ! "$PORT" =~ ^[0-9]{1,5}$ ]] || (( 10#$PORT < 1 || 10#$PORT > 65535 )); then log "port must be between 1 and 65535"; exit 1; fi
for key in API_KEY HOST PORT DATA_DIR MODELS_DIR; do
  write_env_value "LOCAL_STUDIO_$key" "${!key}"
done
chmod 600 "$ENV_FILE"
mkdir -p "$DATA_DIR" "$MODELS_DIR"

if [ "$OS_NAME" = "Darwin" ]; then
  LABEL="org.local.studio.controller"
  PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
  LOG_FILE="$DATA_DIR/controller.log"
  xml_escape() {
    printf '%s' "$1" | sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g; s/"/\&quot;/g'
  }
  mkdir -p "$HOME/Library/LaunchAgents"
  cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>$(xml_escape "$BUN")</string><string>$(xml_escape "$DIR/controller/src/main.ts")</string></array>
  <key>WorkingDirectory</key><string>$(xml_escape "$DIR")</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>LOCAL_STUDIO_HOST</key><string>$(xml_escape "$HOST")</string>
    <key>LOCAL_STUDIO_PORT</key><string>$(xml_escape "$PORT")</string>
    <key>LOCAL_STUDIO_API_KEY</key><string>$(xml_escape "$API_KEY")</string>
    <key>LOCAL_STUDIO_DATA_DIR</key><string>$(xml_escape "$DATA_DIR")</string>
    <key>LOCAL_STUDIO_MODELS_DIR</key><string>$(xml_escape "$MODELS_DIR")</string>
    <key>PATH</key><string>$(xml_escape "$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin")</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>5</integer>
  <key>StandardOutPath</key><string>$(xml_escape "$LOG_FILE")</string>
  <key>StandardErrorPath</key><string>$(xml_escape "$LOG_FILE")</string>
</dict>
</plist>
PLIST
  chmod 600 "$PLIST"
  plutil -lint "$PLIST" >/dev/null
  SERVICE="gui/$(id -u)/$LABEL"
  launchctl bootout "$SERVICE" >/dev/null 2>&1 || true
  # bootout is asynchronous; wait until bootstrap cannot race it.
  for _ in {1..50}; do
    launchctl print "$SERVICE" >/dev/null 2>&1 || break
    sleep 0.2
  done
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
  launchctl enable "$SERVICE"
  launchctl kickstart -k "$SERVICE"
  started="launchd"
elif command -v systemctl >/dev/null 2>&1 && [ -d "$SYSTEMD_RUNTIME_DIR" ]; then
  UNIT_DIR="$HOME/.config/systemd/user"
  UNIT_NAME="local-studio-controller-$PORT.service"
  systemd_escape() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/%/%%/g'; }
  systemd_exec_escape() { systemd_escape "$1" | sed 's/\$/$$/g'; }
  mkdir -p "$UNIT_DIR"
  cat > "$UNIT_DIR/$UNIT_NAME" <<UNIT
[Unit]
Description=Local Studio Controller
After=network-online.target

[Service]
Type=simple
WorkingDirectory="$(systemd_escape "$DIR")"
Environment="LOCAL_STUDIO_HOST=$(systemd_escape "$HOST")"
Environment="LOCAL_STUDIO_PORT=$(systemd_escape "$PORT")"
Environment="LOCAL_STUDIO_API_KEY=$(systemd_escape "$API_KEY")"
Environment="LOCAL_STUDIO_DATA_DIR=$(systemd_escape "$DATA_DIR")"
Environment="LOCAL_STUDIO_MODELS_DIR=$(systemd_escape "$MODELS_DIR")"
ExecStart="$(systemd_exec_escape "$BUN")" "$(systemd_exec_escape "$DIR/controller/src/main.ts")"
Restart=on-failure
RestartSec=3
KillMode=mixed
TimeoutStopSec=15
StandardOutput="append:$(systemd_escape "$DATA_DIR/controller.log")"
StandardError="append:$(systemd_escape "$DATA_DIR/controller.log")"

[Install]
WantedBy=default.target
UNIT
  chmod 600 "$UNIT_DIR/$UNIT_NAME"
  systemctl --user daemon-reload
  systemctl --user enable "$UNIT_NAME" >/dev/null 2>&1 || true
  systemctl --user restart "$UNIT_NAME"
  loginctl enable-linger "$USER" >/dev/null 2>&1 || true
  started="systemd"
else
  log "no systemd — starting with nohup"
  command -v setsid >/dev/null 2>&1 || { log "setsid is required without systemd"; exit 1; }
  PID_FILE="$DATA_DIR/controller.pid"
  if read -r pid < "$PID_FILE" 2>/dev/null && [[ "$pid" =~ ^[0-9]+$ ]]; then
    command="$(ps -p "$pid" -o command= 2>/dev/null || true)"
    case "$command" in *"$DIR/controller/src/main.ts"*) kill "$pid" 2>/dev/null || true ;; esac
  fi
  (cd "$DIR" && setsid nohup env LOCAL_STUDIO_HOST="$HOST" LOCAL_STUDIO_PORT="$PORT" LOCAL_STUDIO_API_KEY="$API_KEY" LOCAL_STUDIO_DATA_DIR="$DATA_DIR" LOCAL_STUDIO_MODELS_DIR="$MODELS_DIR" "$BUN" controller/src/main.ts >> "$DATA_DIR/controller.log" 2>&1 < /dev/null & echo $! > "$PID_FILE")
  started="nohup"
fi

log "waiting for controller on :${PORT}…"
HEALTH_HOST="$HOST"
case "$HEALTH_HOST" in
  ""|"0.0.0.0"|"::") HEALTH_HOST="127.0.0.1" ;;
esac
HEALTH_URL_HOST="$HEALTH_HOST"
case "$HEALTH_URL_HOST" in
  *:*) HEALTH_URL_HOST="[$HEALTH_URL_HOST]" ;;
esac
for _ in {1..30}; do
  if curl -fsS --max-time 2 "http://$HEALTH_URL_HOST:$PORT/health" >/dev/null 2>&1; then
    HOST_ADDR="$HOST"
    case "$HOST_ADDR" in
      ""|"0.0.0.0"|"::")
        HOST_ADDR=""
        if command -v tailscale >/dev/null 2>&1; then
          HOST_ADDR="$(tailscale ip -4 2>/dev/null | head -1 || true)"
        fi
        if [ -z "$HOST_ADDR" ]; then
          HOST_ADDR="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
        fi
        ;;
    esac
    [ -n "$HOST_ADDR" ] || HOST_ADDR="$(hostname)"
    HOST_URL_ADDR="$HOST_ADDR"
    case "$HOST_URL_ADDR" in
      *:*) HOST_URL_ADDR="[$HOST_URL_ADDR]" ;;
    esac
    log "controller healthy ($started)"
    printf 'LOCAL_STUDIO_CONTROLLER {"url":"http://%s:%s","api_key":"%s"}\n' "$(json_escape "$HOST_URL_ADDR")" "$PORT" "$(json_escape "$API_KEY")"
    exit 0
  fi
  sleep 2
done

log "controller did not become healthy in 60s — check $DATA_DIR/controller.log"
exit 1
