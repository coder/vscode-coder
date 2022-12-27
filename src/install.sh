# This script installs Microsoft's code-server on a remote machine.
# It supports macOS and Linux.
#!/bin/sh

set -eux

INSTALL_ARCH=x86_64
INSTALL_TARGET=unknown-linux-gnu

MIN_GLIBC_VERSION=2.18
LDD=$(ldd --version 2>&1 || true)

if [ "$(uname)" = "Darwin" ]; then
  INSTALL_TARGET=apple-darwin-signed
elif echo "$LDD" | grep -q "musl"; then
  INSTALL_TARGET=unknown-linux-musl
  echo "is musl"
else
  GLIBC_VERSION=$(echo "$LDD" | grep -o 'GLIBC [0-9]\+\.[0-9]\+' | head -n 1 | tr -d 'GLIBC ')
  echo "glibc version is $GLIBC_VERSION"
  IS_MIN_GLIBC_VERSION=$(awk 'BEGIN{ print "'$MIN_GLIBC_VERSION'"<="'$GLIBC_VERSION'" }')
  echo "is min? $IS_MIN_GLIBC_VERSION"
  if [ "$IS_MIN_GLIBC_VERSION" = "0" ]; then
    INSTALL_TARGET=unknown-linux-musl
  fi
fi

ARCH=$(uname -m)
if [ $ARCH = "aarch64" ] || [ $ARCH = "arm64" ]; then
  INSTALL_ARCH=aarch64
fi

INSTALL_URL=https://aka.ms/vscode-server-launcher/$INSTALL_ARCH-$INSTALL_TARGET
echo "Installing from $INSTALL_URL"

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

INSTALL_DIR=$HOME/.vscode-remote/bin

mkdir -p $INSTALL_DIR

if test -f "$INSTALL_DIR/code-server"; then
  echo "code-server already installed"
  exit 0
fi

if command_exists curl; then
  curl -sSL "$INSTALL_URL" -o $INSTALL_DIR/code-server
elif command_exists wget; then
  wget -qO $INSTALL_DIR/code-server "$INSTALL_URL"
else
  echo "Please install curl or wget"
  exit 1
fi

chmod +x $INSTALL_DIR/code-server
