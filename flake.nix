{
  description = "vscode-coder";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { nixpkgs, flake-utils, ... }:
    flake-utils.lib.eachDefaultSystem
      (system:
        let pkgs = nixpkgs.legacyPackages.${system};
        in {
          devShells.default = pkgs.mkShell {
            # Node 24 matches the devcontainer; CI also covers the Node 22 minimum.
            nativeBuildInputs = with pkgs; [
              nodejs_24
              pnpm
            ];
            # pnpm would otherwise download the packageManager version from
            # package.json, a prebuilt binary that cannot run on NixOS.
            pnpm_config_manage_package_manager_versions = "false";
          };
        }
      );
}
