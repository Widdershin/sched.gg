{
  routes =
    { loader, get, process }:
    let
      pkgs = loader.pkgs;

      # Shared helper: build an offline npm cache + node_modules from a project's
      # package.json + package-lock.json only, so app-code edits never trigger a
      # dependency reinstall. Returns { nodeModules, node }.
      # Regenerate a hash when deps change with:
      #   nix run nixpkgs#prefetch-npm-deps -- <project>/package-lock.json
      mkNodeModules =
        { name, packageJson, packageLock, hash, node }:
        let
          manifest = pkgs.runCommand "${name}-manifest" { } ''
            mkdir -p $out
            cp ${packageJson} $out/package.json
            cp ${packageLock} $out/package-lock.json
          '';
          npmDeps = pkgs.fetchNpmDeps {
            name = "${name}-npm-deps";
            src = manifest;
            inherit hash;
          };
        in
        pkgs.stdenv.mkDerivation {
          name = "${name}-node-modules";
          src = manifest;
          nativeBuildInputs = [ node pkgs.npmHooks.npmConfigHook ];
          inherit npmDeps;
          dontBuild = true;
          installPhase = ''
            mkdir -p $out
            cp -r node_modules $out/node_modules
          '';
        };

      # --- Frontend (React, esbuild → bundle.js + bundle.css) -----------------
      frontendNodeModules = mkNodeModules {
        name = "sched-gg-frontend";
        packageJson = ./frontend/package.json;
        packageLock = ./frontend/package-lock.json;
        hash = "sha256-m7B6MgUePuy+5EgMz9lVbVI7KnvyDCCQtjOLH+HX7Fg=";
        node = pkgs.nodejs;
      };

      frontend = pkgs.stdenv.mkDerivation {
        name = "sched-gg-frontend";
        src = ./frontend;
        nativeBuildInputs = [ pkgs.nodejs ];
        buildPhase = ''
          export HOME="$TMPDIR"
          ln -s ${frontendNodeModules}/node_modules node_modules
          mkdir -p ../shared
          cp -r ${./shared}/* ../shared/
          npm run build
        '';
        installPhase = ''
          mkdir -p $out
          cp bundle.js bundle.css $out/
        '';
      };

      # --- Backend (TypeScript, esbuild → single dist/server.js) --------------
      backendNodeModules = mkNodeModules {
        name = "sched-gg-backend";
        packageJson = ./backend/package.json;
        packageLock = ./backend/package-lock.json;
        hash = "sha256-KIm/O+y7Rrhpi6FBzN2f9rqvgAvscmA0kjrKRwV2yog=";
        node = pkgs.nodejs_24;
      };

      backend = pkgs.stdenv.mkDerivation {
        name = "sched-gg-backend";
        src = ./backend;
        nativeBuildInputs = [ pkgs.nodejs_24 pkgs.inter ];
        buildPhase = ''
          export HOME="$TMPDIR"
          ln -s ${backendNodeModules}/node_modules node_modules
          mkdir -p ../shared
          cp -r ${./shared}/* ../shared/
          cp ${pkgs.inter}/share/fonts/truetype/InterVariable.ttf ../shared/Inter.ttf
          chmod -R +w ../shared
          npm run build
        '';
        installPhase = ''
          mkdir -p $out/node_modules
          cp dist/server.js $out/server.js
          cp -r ../shared $out/shared
          cp -r ${backendNodeModules}/node_modules/@napi-rs $out/node_modules/
        '';
      };

      # The process supervisor executes this file directly, so it must be a
      # single executable. DATA_DIR (and secrets) are inherited from the env that
      # launched `nix run .#fantail`.
      backendServer = pkgs.writeShellScript "sched-gg-backend-server" ''
        export DATA_DIR="''${DATA_DIR:-$HOME/.local/share/sched.gg}"
        export NODE_PATH="${backend}/node_modules"
        exec ${pkgs.nodejs_24}/bin/node --experimental-sqlite ${backend}/server.js
      '';

      # Static builds (`nix build .#fantailProject`) throw on process routes, so
      # the backend is gated out there via `args.backend = "false"` (see flake.nix)
      # and included by default under `nix run .#fantail`.
      enableBackend = (loader.args.backend or "true") != "false";
    in
    [
      # App shell. References /js/bundle.js and /js/bundle.css.
      (get "/" ./frontend/index.html)

      # Compiled JS + CSS bundle.
      (get "/js" frontend)
    ]
    ++ pkgs.lib.optional enableBackend (process "/api" backendServer);

  fantailSchemaVersion = 1;
}
