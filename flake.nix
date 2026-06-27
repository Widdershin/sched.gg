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
          args = {
          };
        };
      });
    };
}
