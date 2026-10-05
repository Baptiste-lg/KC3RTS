#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
runtime_dir="$repo_root/.toolchain/kc3"
source_url=${KC3_SOURCE_URL:-https://github.com/kc3-lang/kc3.git}
revision=4bdffa88b35a496ca0a856a9eb58486cf6e2029c

mkdir -p "$repo_root/.toolchain"

setup_build_tool() {
  name=$1
  url=$2
  tool_revision=$3
  tool_dir="$repo_root/.toolchain/$name"

  if [ ! -d "$tool_dir/.git" ]; then
    git clone --filter=blob:none --no-checkout "$url" "$tool_dir"
  fi
  if [ "$(git -C "$tool_dir" rev-parse HEAD)" != "$tool_revision" ]; then
    git -C "$tool_dir" fetch origin "$tool_revision"
  fi
  git -C "$tool_dir" checkout --detach "$tool_revision"

  (
    cd "$tool_dir"
    ./configure --prefix "$repo_root/.toolchain"
    make build
    make install
  )
}

setup_build_tool kmx_sort https://github.com/kmx-io/kmx_sort.git e54ead595ee4cf6e0f2a7c1c2bbb85c4e0858efd
setup_build_tool runj https://github.com/kmx-io/runj.git 83386841f4f5a464eafc7e30a46d277fb3e863ff
PATH="$repo_root/.toolchain/bin:$PATH"
export PATH

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
sh "$repo_root/scripts/build-native.sh"
LD_LIBRARY_PATH="$runtime_dir/libkc3:$runtime_dir/lib/kc3/0.1${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
  "$runtime_dir/kc3s/kc3s" --load "$repo_root/kc3/preload.kc3" --quit
printf 'KC3RTS_KC3S=%s/kc3s/kc3s\n' "$runtime_dir"
