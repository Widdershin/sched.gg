{
  description = "A very basic flake";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs?ref=nixos-unstable";
    fantail.url = "git+ssh://git@github.com/Widdershin/fantail";
    systems.url = "github:nix-systems/default";
  };

  outputs =
    {
      self,
      nixpkgs,
      fantail,
      systems,
    }:
    let
      forEachSystem = nixpkgs.lib.genAttrs (import systems);
    in
    {
      packages = forEachSystem (system: {
        # Run dev server with nix run .#fantail
        fantail = fantail.packages.${system}.fantail;

        # Build output with nix build .#fantailProject
        fantailProject = fantail.packages.${system}.buildFantailProject (import ./fantail.nix) {
          flake = self;

          flakeInputs = {
            nixpkgs = nixpkgs;
          };

          # Values here are available as loader.args.<name> in fantail.nix.
          # The static build cannot contain the `process` backend route (Fantail
          # throws on process routes in a static build), so exclude it here.
          # The backend runs only under `nix run .#fantail` (and `fantail docker`).
          args = {
            backend = "false";
          };
        };
      });

      # `nix flake check` (and `nix build .#checks.<system>.backend-tests`) runs
      # the backend unit tests (node:test, bundled with esbuild, in-memory sqlite).
      checks = forEachSystem (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          # Offline node_modules (helper + hashes) shared with fantail.nix.
          backendNodeModules = (import ./nix/node-modules.nix { inherit pkgs; }).backend;
        in
        {
          backend-tests =
            pkgs.runCommand "sched-gg-backend-tests"
              { nativeBuildInputs = [ pkgs.nodejs_24 ]; }
              ''
                # Reconstruct the backend/ + shared/ sibling layout the imports expect.
                cp -r ${./backend} backend
                cp -r ${./shared} shared
                chmod -R +w backend
                ln -s ${backendNodeModules}/node_modules backend/node_modules
                export HOME="$TMPDIR"
                cd backend
                node test.mjs
                touch $out
              '';
        }
      );
    };
}
