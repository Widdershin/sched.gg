{
  routes =
    { loader, get }:
    let
      pkgs = loader.pkgs;

      # Manifest-only source: just the files that determine the dependency tree.
      # Keeping this separate means editing app code under frontend/src does NOT
      # invalidate the node_modules derivation below.
      manifest = pkgs.runCommand "sched-gg-manifest" { } ''
        mkdir -p $out
        cp ${./frontend/package.json} $out/package.json
        cp ${./frontend/package-lock.json} $out/package-lock.json
      '';

      # Offline npm cache. Only re-derived when package-lock.json changes.
      # Regenerate the hash when dependencies change with:
      #   nix run nixpkgs#prefetch-npm-deps -- frontend/package-lock.json
      npmDeps = pkgs.fetchNpmDeps {
        name = "sched-gg-npm-deps";
        src = manifest;
        hash = "sha256-yhRclkAQMVzznYb5aeAu9/0Hm7EEjFqczk3wGte6Yxg=";
      };

      # Dependency-install derivation. The npmConfigHook runs `npm ci`, leaving a
      # node_modules tree we capture. Cached independently of the app source, so
      # code changes never trigger a reinstall.
      nodeModules = pkgs.stdenv.mkDerivation {
        name = "sched-gg-node-modules";
        src = manifest;
        nativeBuildInputs = [ pkgs.nodejs pkgs.npmHooks.npmConfigHook ];
        inherit npmDeps;
        dontBuild = true;
        installPhase = ''
          mkdir -p $out
          cp -r node_modules $out/node_modules
        '';
      };

      # Build derivation. Reuses the prebuilt node_modules and only runs esbuild,
      # so a code change is a fast bundle-only rebuild.
      # `npm run build` produces bundle.js + bundle.css; we keep just those.
      frontend = pkgs.stdenv.mkDerivation {
        name = "sched-gg-frontend";
        src = ./frontend;
        nativeBuildInputs = [ pkgs.nodejs ];
        buildPhase = ''
          export HOME="$TMPDIR"
          ln -s ${nodeModules}/node_modules node_modules
          npm run build
        '';
        installPhase = ''
          mkdir -p $out
          cp bundle.js bundle.css $out/
        '';
      };
    in
    [
      # App shell. References /js/bundle.js and /js/bundle.css.
      (get "/" ./frontend/index.html)

      # Compiled JS + CSS bundle.
      (get "/js" frontend)
    ];

  fantailSchemaVersion = 1;
}
