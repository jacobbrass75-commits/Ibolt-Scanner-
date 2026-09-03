#!/bin/sh
set -eu
# A separate runtime leaves other hosted apps on their existing Node version.
test "$(id -u)" = 0
test "$(uname -m)" = x86_64
version=v22.23.2
checksum=d60acfe00a2932254bb0ad20e01b0d74397a0875595de719654b214f4b03f307
base=/opt/iboltscan
if ! id iboltscan >/dev/null 2>&1; then useradd --system --home-dir /var/lib/iboltscan --shell /usr/sbin/nologin iboltscan; fi
install -d -m 755 "$base" "$base/releases"
install -d -m 700 -o iboltscan -g iboltscan /var/lib/iboltscan /var/backups/iboltscan
install -d -m 750 -o root -g iboltscan /etc/iboltscan
if ! test -x "$base/node-$version/bin/node"; then
  archive="$base/node-$version.tar.xz"
  curl --fail --silent --show-error --location "https://nodejs.org/dist/$version/node-$version-linux-x64.tar.xz" --output "$archive"
  printf '%s  %s\n' "$checksum" "$archive" | sha256sum --check -
  install -d -m 755 "$base/node-$version"
  tar -xJf "$archive" --strip-components=1 -C "$base/node-$version"
fi
if ! test -e "$base/node"; then ln -s "$base/node-$version" "$base/node"; fi
"$base/node/bin/node" --version
