#!/bin/sh
# Compile against the pinned runtime; never edit the sibling KC3 checkout.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"
make -f native/Makefile bridge
