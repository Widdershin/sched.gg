# Shared helper: build an offline npm cache + node_modules from a project's
# package.json + package-lock.json only, so app-code edits never trigger a
# dependency reinstall. Imported by both fantail.nix (builds) and flake.nix
# (the test check), so the per-project deps hashes live in one place.
#
# Regenerate a hash when deps change with:
#   nix run nixpkgs#prefetch-npm-deps -- <project>/package-lock.json
{ pkgs }:
let
  mkNodeModules =
    {
      name,
      packageJson,
      packageLock,
      hash,
      node ? pkgs.nodejs,
    }:
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
      nativeBuildInputs = [
        node
        pkgs.npmHooks.npmConfigHook
      ];
      inherit npmDeps;
      dontBuild = true;
      installPhase = ''
        mkdir -p $out
        cp -r node_modules $out/node_modules
      '';
    };
in
{
  inherit mkNodeModules;

  # Concrete per-project node_modules. Lazy, so importers only build what they use.
  frontend = mkNodeModules {
    name = "sched-gg-frontend";
    packageJson = ../frontend/package.json;
    packageLock = ../frontend/package-lock.json;
    hash = "sha256-zSev67+8RiGZYedDT+BJWuaPIhCXTrNHcxi0OkxCpGA=";
    node = pkgs.nodejs;
  };

  backend = mkNodeModules {
    name = "sched-gg-backend";
    packageJson = ../backend/package.json;
    packageLock = ../backend/package-lock.json;
    hash = "sha256-KIm/O+y7Rrhpi6FBzN2f9rqvgAvscmA0kjrKRwV2yog=";
    node = pkgs.nodejs_24;
  };
}
