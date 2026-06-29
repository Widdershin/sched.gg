{
  routes =
    { loader, get, process }:
    let
      pkgs = loader.pkgs;

      # Offline node_modules (helper + per-project hashes) live in one shared file.
      nodeModules = import ./nix/node-modules.nix { inherit pkgs; };

      # --- Frontend (React, esbuild → bundle.js + bundle.css) -----------------
      frontendNodeModules = nodeModules.frontend;

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
          cp ${./fonts}/Inter-Regular.ttf $out/
          cp ${./fonts}/Inter-Medium.ttf $out/
          cp ${./fonts}/Inter-Bold.ttf $out/
          cp ${./fonts}/Inter-ExtraBold.ttf $out/
        '';
      };

      # --- Backend (TypeScript, esbuild → single dist/server.js) --------------
      backendNodeModules = nodeModules.backend;

      backend = pkgs.stdenv.mkDerivation {
        name = "sched-gg-backend";
        src = ./backend;
        nativeBuildInputs = [ pkgs.nodejs_24 ];
        buildPhase = ''
          export HOME="$TMPDIR"
          ln -s ${backendNodeModules}/node_modules node_modules
          mkdir -p ../shared
          cp -r ${./shared}/* ../shared/
          cp ${./fonts}/Inter-Bold.ttf ../shared/
          cp ${./fonts}/Inter-ExtraBold.ttf ../shared/
          cp ${./fonts}/Inter-Medium.ttf ../shared/
          cp ${./fonts}/Inter-Regular.ttf ../shared/
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

      # The app shell as a directory so it can back a wildcard (SPA) route:
      # any path that isn't a real file falls through to this index.html, letting
      # the client router handle deep links like /lanyards/<id>.
      appShell = pkgs.runCommand "sched-gg-app-shell" { } ''
        mkdir -p $out
        cp ${./frontend/index.html} $out/index.html
      '';

      # Static builds (`nix build .#fantailProject`) throw on process routes, so
      # the backend is gated out there via `args.backend = "false"` (see flake.nix)
      # and included by default under `nix run .#fantail`.
      enableBackend = (loader.args.backend or "true") != "false";
    in
    # Routes match bottom-to-top: /api (process) and /js (bundle/fonts) resolve
    # before the catch-all, which serves the app shell for every other path.
    [
      # SPA shell. References /js/bundle.js and /js/bundle.css.
      (get "/*" appShell)

      # Compiled JS + CSS bundle (+ preloaded fonts).
      (get "/js" frontend)
    ]
    ++ pkgs.lib.optional enableBackend (process "/api" backendServer);

  fantailSchemaVersion = 1;
}
