# KC3's configuration controls the public Tag/Struct ABI (including F80).
include .toolchain/kc3/libkc3/config.mk

.PHONY: bridge
bridge: .toolchain/kc3/lib/kc3/0.1/kc3rts.so

.toolchain/kc3/lib/kc3/0.1/kc3rts.so: native/data.c native/Makefile .toolchain/kc3/libkc3/config.mk
	$(CC) $(CPPFLAGS) $(CFLAGS) -I.toolchain/kc3 $(SHARED_FLAGS) native/data.c -L.toolchain/kc3/libkc3 -lkc3 -o $@.new
	mv $@.new $@
