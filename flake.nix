{
  description = "rv - effortless GPU computing on UVA's Rivanna cluster";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
  };

  outputs =
    { self, nixpkgs }:
    let
      version = "0.3.0";

      sources = {
        x86_64-linux = {
          url = "https://github.com/charliemeyer2000/rivanna.dev/releases/download/cli-v${version}/rv-linux";
          hash = "sha256-InicZlH8nxL9YJhUu8mljTBjfh9NM6NjS//Pq2ZFoOE="; # linux-hash
        };
        aarch64-darwin = {
          url = "https://github.com/charliemeyer2000/rivanna.dev/releases/download/cli-v${version}/rv-macos";
          hash = "sha256-tBdVvhjiAPdbludYhk01jFEXAXB94z9tIWDMTOQO71U="; # macos-hash
        };
      };

      supportedSystems = builtins.attrNames sources;

      forAllSystems = f: nixpkgs.lib.genAttrs supportedSystems f;
    in
    {
      packages = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          src = sources.${system};
          isLinux = pkgs.lib.hasSuffix "linux" system;
        in
        {
          rv = pkgs.stdenvNoCC.mkDerivation {
            pname = "rv";
            inherit version;

            src = pkgs.fetchurl {
              inherit (src) url hash;
            };

            dontUnpack = true;

            nativeBuildInputs = pkgs.lib.optionals isLinux [ pkgs.autoPatchelfHook ];
            buildInputs = pkgs.lib.optionals isLinux [ pkgs.stdenv.cc.cc.lib ];

            installPhase = ''
              runHook preInstall
              install -Dm755 $src $out/bin/rv
              runHook postInstall
            '';

            meta = {
              description = "Effortless GPU computing on UVA's Rivanna cluster";
              homepage = "https://www.rivanna.dev";
              platforms = supportedSystems;
              mainProgram = "rv";
            };
          };

          default = self.packages.${system}.rv;
        }
      );

      overlays.default = final: _prev: {
        rv = self.packages.${final.system}.rv;
      };
    };
}
