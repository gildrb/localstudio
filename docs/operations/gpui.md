# GPUI client: build and CI

Crate: `native/local-studio-gpui`. Flake: repo root `flake.nix` (the only flake). Workflow: `.github/workflows/gpui.yml`.

## Local commands

```
nix develop path:.                                              # toolchain, system libraries, LD_LIBRARY_PATH, CARGO_BUILD_BUILD_DIR=target
cargo run --manifest-path native/local-studio-gpui/Cargo.toml   # dev run on the host GPU
cargo clippy --locked --manifest-path native/local-studio-gpui/Cargo.toml --all-targets -- --deny warnings
nix build -L .#default                                          # store build, runtime libraries on RPATH
nix flake check -L                                              # package, clippy, fmt; Linux adds smoke-x11 and smoke-wayland
nix flake check --all-systems --no-build                        # evaluate all three systems
```

A binary built by Cargo inside `nix develop` finds `libxcb.so.1` and the other libraries only through the shell `LD_LIBRARY_PATH`. Run it inside the shell, or use `nix build`.

## Flake outputs

Systems: `x86_64-linux`, `aarch64-linux`, `aarch64-darwin`. nixpkgs 26.11 dropped `x86_64-darwin`.

| Output | Content |
|---|---|
| `packages.default`, `packages.local-studio-gpui` | crane build, `--locked`; Linux: RPATH patched, `.desktop` file; macOS: `runtime-shaders`, `Applications/Local Studio.app` |
| `apps.default` | `nix run` |
| `devShells.default` | build inputs, Rust toolchain, rust-analyzer, nixfmt; does not build the package |
| `checks.{package,clippy,fmt}` | build, `clippy -D warnings`, `cargo fmt --check` |
| `checks.smoke-x11`, `checks.smoke-wayland` (Linux) | `--smoke` under Xvfb and headless weston, Lavapipe Vulkan |
| `formatter` | `nixfmt` |

## Traps

- Flakes in a git repository see tracked files only. Use `path:.` for untracked work.
- crane fetches each git dependency at its locked rev. The first build fetches zed with full history and builds about 600 crates: 20 to 40 minutes cold.
- The Nix sandbox has no `xcrun metal`, so macOS Nix builds enable `runtime-shaders`. The Cargo job on macOS installs the Metal toolchain when `xcrun metal` is missing, then precompiles shaders.
- `--smoke` fails on an APCA token failure, an invalid built-in key binding, a font load error, or no first frame.

## CI

| Job | Runners | Steps |
|---|---|---|
| `nix-eval` | `ubuntu-latest` | `nix flake check --all-systems --no-build` |
| `nix` | `ubuntu-latest`, `ubuntu-24.04-arm`, `macos-latest` | `nix flake check -L`, `nix build` |
| `cargo-linux` | `ubuntu-latest` | fmt, clippy, release build, `--smoke` on X11 (Xvfb) and Wayland (weston), Lavapipe |
| `cargo-macos` | `macos-latest` | Metal toolchain, clippy, release build, `--smoke` |

The workflow runs only when `native/local-studio-gpui/**`, `flake.nix`, `flake.lock` or the workflow change. No binary cache is set up.
