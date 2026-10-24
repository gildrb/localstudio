# local-studio-gpui

Native desktop client for Local Studio. It shows one controller at a time: its engines, GPUs, throughput, load, memory and request log. It reads the controller `/api/*` management routes only. Built on [GPUI](https://github.com/zed-industries/zed/tree/main/crates/gpui). One codebase for Linux (Wayland and X11) and macOS.

## Install

Nix (`x86_64-linux`, `aarch64-linux`, `aarch64-darwin`):

```
nix run github:sybil-solutions/local-studio            # run without install
nix profile install github:sybil-solutions/local-studio # install
nix build .#default                                     # build from a checkout, output in ./result
```

Cargo (install the system dependencies below first):

```
cargo build --release --locked --manifest-path native/local-studio-gpui/Cargo.toml  # binary in native/local-studio-gpui/target/release/local-studio-gpui
```

macOS without full Xcode: add `--features runtime-shaders` (Metal shaders compile at first launch).

## Use

```
local-studio-gpui          # open the window
local-studio-gpui --smoke  # check APCA contrast and key bindings, draw one frame, print "smoke: ok", exit
```

Configuration: `~/.local-studio-t3/config.json`, read only. `LOCAL_STUDIO_T3_HOME` sets another directory. Keys: `url`, `fleetKey`, `peers`. The fleet key is sent as `Authorization: Bearer` and never shown.

Point the client at a test controller on port 18091 with its own data root. The client never starts or stops a controller, engine or GPU job without an explicit confirm. Loading a model while one runs, Stop and Cancel each ask first, inline.

## Keys

`Mod` is Cmd on macOS and Ctrl on Linux.

| Keys | Action |
|---|---|
| `Mod Q` | Quit |
| `Mod R` | Refresh |
| `Mod F` | Filter the log |
| `Mod L` | Load model |
| `Mod Shift C` | Copy controller URL |
| `Up`, `Down` | Next controller in the rail, next recipe in Load model |
| `Mod C` | Copy log row |
| `Mod S` | Save log |
| `Mod 1` to `Mod 9` | Select controller |
| `F6`, `Shift F6` | Next, previous region |
| `Esc` | Dismiss |
| `F11` (Linux), `Cmd Ctrl F` (macOS) | Fullscreen |
| `Ctrl W` (Linux), `Cmd W` (macOS) | Close window |

Key hints read `Ctrl+Shift+C` on Linux and `⇧⌘C` on macOS.

## System dependencies

Build: needed to compile and link. Run: needed at runtime. The Nix package puts all runtime libraries on the binary RPATH; only the GPU driver comes from the host.

| Dependency | nixpkgs | Debian/Ubuntu | Fedora | Arch | Build | Run |
|---|---|---|---|---|---|---|
| C toolchain, pkg-config | `stdenv`, `pkg-config` | `build-essential pkg-config` | `gcc pkgconf-pkg-config` | `base-devel` | yes | no |
| fontconfig | `fontconfig` | `libfontconfig-dev` | `fontconfig-devel` | `fontconfig` | yes | yes |
| freetype | `freetype` | `libfreetype-dev` | `freetype-devel` | `freetype2` | yes | yes |
| libxkbcommon, xkbcommon-x11 | `libxkbcommon` | `libxkbcommon-dev libxkbcommon-x11-dev` | `libxkbcommon-x11-devel` | `libxkbcommon-x11` | yes | yes |
| X11: libxcb, libX11 | `libxcb`, `libx11` | `libxcb1-dev libx11-xcb-dev` | `libxcb-devel` | `libxcb` | yes | X11 |
| Wayland client (loaded at runtime) | `wayland` | `libwayland-dev` | `wayland-devel` | `wayland` | no | Wayland |
| Vulkan loader | `vulkan-loader` | `libvulkan1` | `vulkan-loader` | `vulkan-icd-loader` | no | yes |
| Vulkan driver (ICD) | NixOS `hardware.graphics.enable = true` | `mesa-vulkan-drivers` or NVIDIA driver | `mesa-vulkan-drivers` | `vulkan-radeon`, `vulkan-intel` or `nvidia-utils` | no | yes |
| EGL (GL fallback) | `libglvnd` | `libegl1` | `libglvnd-egl` | `libglvnd` | no | fallback |
| xdg-desktop-portal and a backend | NixOS `xdg.portal.enable = true` | `xdg-desktop-portal-gtk` | `xdg-desktop-portal-gtk` | `xdg-desktop-portal-gtk` | no | save dialog |
| AT-SPI (screen readers) | NixOS `services.gnome.at-spi2-core.enable = true` | `at-spi2-core` | `at-spi2-core` | `at-spi2-core` | no | accessibility |
| Xcode Command Line Tools | n/a | n/a | n/a | n/a | macOS | no |
| Full Xcode (`xcrun metal`) | n/a | n/a | n/a | n/a | macOS release without `runtime-shaders` | no |
| Apple SDK | `apple-sdk_15` | n/a | n/a | n/a | macOS Nix | no |

Install line for Debian/Ubuntu:

```
sudo apt-get install pkg-config libfontconfig-dev libfreetype-dev libxkbcommon-dev libxkbcommon-x11-dev libxcb1-dev libx11-xcb-dev libwayland-dev libvulkan1 mesa-vulkan-drivers libegl1
```

## Platform notes

| Variable | Effect |
|---|---|
| `WAYLAND_DISPLAY=` (empty) | Force X11 |
| `GPUI_X11_SCALE_FACTOR=2` | Override X11 HiDPI scale (default from `Xft.dpi`) |
| `ZED_DEVICE_ID=0x1234` | Pick the GPU adapter |

- GNOME Wayland gives client-side decorations: the app draws its own title bar, window controls, shadow and 8 px resize edges. KDE, Sway, X11 and macOS use native decorations. The app reads the mode on every frame, so a switch after the first configure is picked up.
- macOS: native menu bar; the 40 px title bar drags the window and double-click follows the system setting. Linux: the same menus open from the menu button at the top of the controller list.
- Copy writes the clipboard only, not the X11/Wayland primary selection.

## Limitations

- No `x86_64-darwin` output: nixpkgs 26.11 dropped it. Intel Macs use the Cargo build.
- A Nix-built binary on a non-NixOS distribution needs the host Vulkan driver: run it with nixGL or set `VK_DRIVER_FILES` to the host ICD file. Use the Cargo build there instead.
- Linux file dialogs need xdg-desktop-portal. Without it the save dialog shows an inline error.
- Windows compiles but is not tested.
- Live throughput, the request log, TTFT, KV cache and GPU utilisation need `GET /api/live`, which the controller does not serve yet. Without it the Throughput and Request log cards are hidden and the Now card says so inline. `LOCAL_STUDIO_GPUI_DEMO=1` shows them with fixture data.
- Controller URLs must be `http://`. The fleet key travels in clear text; use it on a trusted network or over Tailscale.
- No app icon yet.

## Development

Build, CI and flake checks: [docs/operations/gpui.md](../../docs/operations/gpui.md).

## Attribution

Inter (SIL OFL 1.1) and Lucide icons (ISC). See `THIRD_PARTY_NOTICES.md`.

## License

MIT.
