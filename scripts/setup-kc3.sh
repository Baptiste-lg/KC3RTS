#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
runtime_dir="$repo_root/.toolchain/kc3"
source_url=${KC3_SOURCE_URL:-https://github.com/kc3-lang/kc3.git}
revision=4bdffa88b35a496ca0a856a9eb58486cf6e2029c

mkdir -p "$repo_root/.toolchain"
if [ ! -d "$runtime_dir/.git" ]; then
  git clone --filter=blob:none --no-checkout "$source_url" "$runtime_dir"
fi

actual=$(git -C "$runtime_dir" rev-parse HEAD)
if [ "$actual" != "$revision" ]; then
  git -C "$runtime_dir" fetch origin "$revision"
fi
git -C "$runtime_dir" checkout --detach "$revision"
git -C "$runtime_dir" submodule update --init

if [ "$(git -C "$runtime_dir" rev-parse HEAD)" != "$revision" ]; then
  echo "KC3 revision mismatch" >&2
  exit 1
fi

cd "$runtime_dir"
./configure
make kc3s json lib_links
test -x kc3s/kc3s
test -e lib/kc3/0.1/json.so
printf 'KC3RTS_KC3S=%s/kc3s/kc3s\n' "$runtime_dir"
