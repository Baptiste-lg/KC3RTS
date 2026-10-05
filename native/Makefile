# KC3's configuration controls the public Tag/Struct ABI (including F80).
include .toolchain/kc3/libkc3/config.mk

.PHONY: bridge
bridge: .toolchain/kc3/lib/kc3/0.1/kc3rts.so

.toolchain/kc3/lib/kc3/0.1/kc3rts.so: native/data.c native/Makefile .toolchain/kc3/libkc3/config.mk
	# KC3's SHARED_FLAGS target ld directly (Linux includes raw -soname).
	# Keep its ABI compilation flags, but link this module through the C driver.
	$(CC) $(CPPFLAGS) $(CFLAGS) -I.toolchain/kc3 -shared native/data.c -L.toolchain/kc3/libkc3 -lkc3 -o $@.new
	mv $@.new $@
