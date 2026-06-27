{
  routes =
    { loader, get }:
    let
      pkgs = loader.pkgs;

      # Build the React app with esbuild via buildNpmPackage.
      # `npm run build` produces bundle.js + bundle.css; we keep just those.
      # When dependencies change, regenerate npmDepsHash with:
      #   nix run nixpkgs#prefetch-npm-deps -- frontend/package-lock.json
      frontend = pkgs.buildNpmPackage {
        name = "sched-gg-frontend";
        src = ./frontend;
        npmDepsHash = "sha256-yhRclkAQMVzznYb5aeAu9/0Hm7EEjFqczk3wGte6Yxg=";

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
