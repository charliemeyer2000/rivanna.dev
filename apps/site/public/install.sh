#!/usr/bin/env bash

set -euo pipefail

BASE_URL="https://rivanna.dev"
BINARY_NAME="rv"
TARGET_DIR="${HOME}/.local/bin"

die() {
    echo "Error: $*" >&2
    exit 1
}

detect_platform() {
    local os arch
    os="$(uname -s)"
    arch="$(uname -m)"

    case "$os" in
        Linux)
            case "$arch" in
                x86_64|amd64) echo "rv-linux" ;;
                aarch64|arm64) die "ARM64 Linux is not currently supported" ;;
                *) die "Unsupported Linux architecture: $arch" ;;
            esac
            ;;
        Darwin)
            case "$arch" in
                x86_64|arm64) echo "rv-macos" ;;
                *) die "Unsupported macOS architecture: $arch" ;;
            esac
            ;;
        *)
            die "Unsupported operating system: $os (supported: Linux x86_64, macOS x86_64/arm64)"
            ;;
    esac
}

show_success() {
    echo
    echo -e "\033[0;32m✓ Installation complete!\033[0m"
    echo -e "\033[0;32mTo get started: ${BINARY_NAME} init\033[0m"
    echo
}

show_path_instructions() {
    echo
    echo -e "\033[0;32mTo use the '${BINARY_NAME}' command, add '\${HOME}/.local/bin' to your PATH:\033[0m"
    echo

    case "${SHELL##*/}" in
        bash)
            echo -e "\033[1m  echo 'export PATH=\"\${HOME}/.local/bin:\$PATH\"' >> ~/.bashrc && source ~/.bashrc\033[0m"
            ;;
        zsh)
            echo -e "\033[1m  echo 'export PATH=\"\${HOME}/.local/bin:\$PATH\"' >> ~/.zshrc && source ~/.zshrc\033[0m"
            ;;
        *)
            echo -e "\033[1m  echo 'export PATH=\"\${HOME}/.local/bin:\$PATH\"' >> ~/.profile && source ~/.profile\033[0m"
            ;;
    esac

    echo
    echo -e "\033[0;32mTo get started: ${BINARY_NAME} init\033[0m"
    echo
}

main() {
    local binary_file tmpdir target_file

    binary_file="$(detect_platform)"
    tmpdir="$(mktemp -d)" || die "Failed to create temporary directory"
    trap 'rm -rf "${tmpdir:-}"' EXIT

    target_file="${TARGET_DIR}/${BINARY_NAME}"

    mkdir -p "$TARGET_DIR" || die "Failed to create $TARGET_DIR"

    echo "Downloading ${BINARY_NAME} CLI..."
    curl -fsSL -o "${tmpdir}/${binary_file}" \
        "${BASE_URL}/api/downloads/cli/latest/${binary_file}" \
        || die "Failed to download binary"

    mv "${tmpdir}/${binary_file}" "$target_file" || die "Failed to install binary"
    chmod +x "$target_file" || die "Failed to make binary executable"

    echo "Successfully installed ${BINARY_NAME} CLI"

    if "$target_file" --version >/dev/null 2>&1; then
        echo "Version: $("$target_file" --version)"
    fi

    if [[ ":$PATH:" == *":$TARGET_DIR:"* ]]; then
        show_success
    else
        show_path_instructions
    fi
}

main "$@"
