{
  description = "vscode-coder";

  inputs.flake-utils.url = "github:numtide/flake-utils";

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem
      (system:
        let pkgs = nixpkgs.legacyPackages.${system};
            nodejs = pkgs.nodejs-18_x;
            yarn' = pkgs.yarn.override { inherit nodejs; };
        in {
          devShells.default = pkgs.mkShell {
            nativeBuildInputs = with pkgs; [
              nodejs yarn'
            ];
          };
        }
      );
}
