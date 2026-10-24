{
  description = "Local Studio GPUI client";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    crane.url = "github:ipetkov/crane";
    rust-overlay = {
      url = "github:oxalica/rust-overlay";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    {
      self,
      nixpkgs,
      crane,
      rust-overlay,
    }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];
      forAll =
        f:
        nixpkgs.lib.genAttrs systems (
          system:
          f (
            import nixpkgs {
              inherit system;
              overlays = [ rust-overlay.overlays.default ];
            }
          )
        );
      crate = ./native/local-studio-gpui;
      setup =
        pkgs:
        let
          inherit (pkgs) lib stdenv;
          isLinux = stdenv.hostPlatform.isLinux;
          isDarwin = stdenv.hostPlatform.isDarwin;
          toolchain = pkgs.rust-bin.fromRustupToolchainFile (crate + "/rust-toolchain.toml");
          craneLib = (crane.mkLib pkgs).overrideToolchain toolchain;
          linuxRuntime = with pkgs; [
            vulkan-loader
            libglvnd
            wayland
            libxkbcommon
            libxcb
            libx11
            libxcursor
            libxi
            libxrandr
            fontconfig
            freetype
          ];
          linuxLink = with pkgs; [
            fontconfig
            freetype
            libxkbcommon
            libxcb
            libx11
          ];
          fonts = pkgs.makeFontsConf { fontDirectories = [ pkgs.dejavu_fonts ]; };
          lavapipe = "${pkgs.mesa}/share/vulkan/icd.d";
          src = lib.fileset.toSource {
              root = crate;
              fileset = lib.fileset.unions [
                (craneLib.fileset.commonCargoSources crate)
                (crate + "/assets")
                (crate + "/src/client/demo.json")
              ];
            };
          common = {
            pname = "local-studio-gpui";
            inherit src;
            strictDeps = true;
            nativeBuildInputs = [ pkgs.pkg-config ];
            buildInputs = lib.optionals isLinux linuxLink ++ lib.optionals isDarwin [ pkgs.apple-sdk_15 ];
            cargoExtraArgs = "--locked" + lib.optionalString isDarwin " --features runtime-shaders";
          };
          cargoArtifacts = craneLib.buildDepsOnly common;
          package = craneLib.buildPackage (
            common
            // {
              inherit cargoArtifacts;
              doCheck = false;
              nativeBuildInputs = common.nativeBuildInputs ++ lib.optionals isLinux [ pkgs.patchelf ];
              postFixup =
                lib.optionalString isLinux ''
                  patchelf --add-rpath ${lib.makeLibraryPath linuxRuntime} $out/bin/local-studio-gpui
                  install -Dm644 ${crate}/assets/local-studio.desktop $out/share/applications/dev.sybil.LocalStudio.desktop
                ''
                + lib.optionalString isDarwin ''
                  app="$out/Applications/Local Studio.app/Contents"
                  install -Dm644 ${crate}/assets/Info.plist "$app/Info.plist"
                  install -Dm755 $out/bin/local-studio-gpui "$app/MacOS/local-studio-gpui"
                '';
              meta = {
                description = "Local Studio controller dashboard";
                mainProgram = "local-studio-gpui";
                platforms = systems;
              };
            }
          );
          smoke =
            name: deps: run:
            pkgs.runCommand "local-studio-gpui-smoke-${name}"
              {
                nativeBuildInputs = deps ++ [ pkgs.coreutils ];
                FONTCONFIG_FILE = fonts;
              }
              ''
                export HOME=$TMPDIR XDG_RUNTIME_DIR=$TMPDIR
                export VK_DRIVER_FILES=$(echo ${lavapipe}/lvp_icd.*.json)
                ${run} | tee $out
                grep -q "smoke: ok" $out
              '';
        in
        {
          inherit
            craneLib
            common
            cargoArtifacts
            package
            linuxRuntime
            toolchain
            smoke
            ;
        };
    in
    {
      packages = forAll (pkgs: rec {
        local-studio-gpui = (setup pkgs).package;
        default = local-studio-gpui;
      });

      apps = forAll (pkgs: {
        default = {
          type = "app";
          program = pkgs.lib.getExe (setup pkgs).package;
        };
      });

      checks = forAll (
        pkgs:
        let
          s = setup pkgs;
          exe = pkgs.lib.getExe s.package;
        in
        {
          package = s.package;
          clippy = s.craneLib.cargoClippy (
            s.common
            // {
              inherit (s) cargoArtifacts;
              cargoClippyExtraArgs = "--all-targets -- --deny warnings";
            }
          );
          fmt = s.craneLib.cargoFmt { inherit (s.common) src; };
        }
        // pkgs.lib.optionalAttrs pkgs.stdenv.hostPlatform.isLinux {
          smoke-x11 = s.smoke "x11" [ pkgs.xvfb-run ] ''
            WAYLAND_DISPLAY= timeout 120 xvfb-run -a -s "-screen 0 1280x800x24" ${exe} --smoke
          '';
          smoke-wayland = s.smoke "wayland" [ pkgs.weston ] ''
            weston --backend=headless --renderer=pixman --socket=wl-smoke --idle-time=0 &
            timeout 30 sh -c 'until [ -S "$XDG_RUNTIME_DIR/wl-smoke" ]; do sleep 0.1; done'
            WAYLAND_DISPLAY=wl-smoke DISPLAY= timeout 120 ${exe} --smoke
          '';
        }
      );

      devShells = forAll (
        pkgs:
        let
          s = setup pkgs;
        in
        {
          default = pkgs.mkShell {
            packages = s.common.nativeBuildInputs ++ s.common.buildInputs ++ [
              s.toolchain
              pkgs.rust-analyzer
              pkgs.nixfmt
            ];
            CARGO_BUILD_BUILD_DIR = "target";
            LD_LIBRARY_PATH = pkgs.lib.optionalString pkgs.stdenv.hostPlatform.isLinux (
              pkgs.lib.makeLibraryPath s.linuxRuntime
            );
          };
        }
      );

      formatter = forAll (pkgs: pkgs.nixfmt);
    };
}
