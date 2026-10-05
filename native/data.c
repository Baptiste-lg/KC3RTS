/* Read a field without copying an entire RTS.Shared payload first.
 * This is a storage primitive; game rules remain in KC3. */
#include "libkc3/kc3.h"

static const s_map *payload(const s_tag *value)
{
  if (value->type == TAG_MAP) return &value->data.td_map;
  if (value->type == TAG_PSTRUCT &&
      value->data.td_pstruct->pstruct_type->module == sym_1("RTS.Shared"))
    return struct_get(value->data.td_pstruct, sym_1("value"));
  return NULL;
}

s_tag *kc3rts_get(s_tag *value, const s_tag *key, s_tag *result)
{
  const s_map *map = payload(value);
  if (map && map_get(map, key, result)) return result;
  return tag_init(result);
}

static s_tag *wrap_map(const s_tag *source, s_map *map, s_tag *result)
{
  if (source->type == TAG_MAP) {
    result->type = TAG_MAP;
    result->data.td_map = *map;
    return result;
  }
  /* RTS.Shared has exactly one Map field. Fail if that storage contract changes. */
  if (source->data.td_pstruct->pstruct_type->size != sizeof(s_map)) {
    map_clean(map);
    return NULL;
  }
  s_map *owned = alloc(sizeof *owned);
  if (owned) {
    *owned = *map;
    if (tag_init_pstruct_with_data(result, sym_1("RTS.Shared"), owned, true)) return result;
    alloc_free(owned);
  }
  map_clean(map);
  return NULL;
}

s_tag *kc3rts_put(s_tag *source, s_tag *key, s_tag *value, s_tag *result)
{
  const s_map *map = payload(source);
  s_map updated = {0};
  if (!map) return tag_init(result);
  if (!map_put((s_map *)map, key, value, &updated)) return NULL;
  return wrap_map(source, &updated, result);
}

s_tag *kc3rts_merge(s_tag *source, s_tag *fields, s_tag *result)
{
  const s_map *map = payload(source), *other = payload(fields);
  s_map updated = {0};
  if (!map || !other) return tag_init(result);
  if (!map_merge(map, other, &updated)) return NULL;
  return wrap_map(source, &updated, result);
}

/* The pinned JSON writer lacks List support. Keep this bounded codec separate
 * from gameplay; every value accepted here has the same canonical KC3 encoding. */
#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define JSON_LIMIT 4194304
#define JSON_SAFE INT64_C(9007199254740991)
struct writer { char *bytes; size_t used; };

static bool write_bytes(struct writer *w, const char *bytes, size_t size)
{
  if (size > JSON_LIMIT - w->used) return false;
  memcpy(w->bytes + w->used, bytes, size);
  w->used += size;
  return true;
}

static bool write_string(struct writer *w, const s_str *s)
{
  static const char hex[] = "0123456789abcdef";
  if (str_length_utf8(s) < 0) return false;
  if (!write_bytes(w, "\"", 1)) return false;
  for (uw i = 0; i < s->size; ++i) {
    unsigned char c = (unsigned char)s->ptr.p_pchar[i];
    if (c < 32) {
      char escaped[] = {'\\', 'u', '0', '0', hex[c >> 4], hex[c & 15]};
      if (!write_bytes(w, escaped, sizeof escaped)) return false;
    } else {
      if ((c == '"' || c == '\\') && !write_bytes(w, "\\", 1)) return false;
      if (!write_bytes(w, s->ptr.p_pchar + i, 1)) return false;
    }
  }
  return write_bytes(w, "\"", 1);
}

static bool write_tag(struct writer *w, s_tag *tag, unsigned depth)
{
  if (depth > 64) return false;
  switch (tag->type) {
  case TAG_VOID: return write_bytes(w, "null", 4);
  case TAG_BOOL: return tag->data.td_bool_ ? write_bytes(w, "true", 4) : write_bytes(w, "false", 5);
  case TAG_STR: return write_string(w, &tag->data.td_str);
  case TAG_MAP: {
    s_map *map = &tag->data.td_map;
    if (!write_bytes(w, "{", 1)) return false;
    for (uw i = 0; i < map->count; ++i) {
      if (map->key[i].type != TAG_STR ||
          (i && !write_bytes(w, ",", 1)) ||
          !write_string(w, &map->key[i].data.td_str) ||
          !write_bytes(w, ":", 1) || !write_tag(w, map->value + i, depth + 1)) return false;
    }
    return write_bytes(w, "}", 1);
  }
  case TAG_PSTRUCT: {
    const s_map *map = payload(tag);
    if (!map) return false;
    /* Sharing is an internal storage detail, never part of the wire schema. */
    s_tag borrowed = {.type = TAG_MAP};
    borrowed.data.td_map = *map;
    return write_tag(w, &borrowed, depth);
  }
  case TAG_PLIST: {
    bool first = true;
    if (!write_bytes(w, "[", 1)) return false;
    for (s_list *item = tag->data.td_plist; item; item = list_next(item)) {
      if ((!first && !write_bytes(w, ",", 1)) || !write_tag(w, &item->tag, depth + 1)) return false;
      if (item->next.type != TAG_PLIST) return false;
      first = false;
    }
    return write_bytes(w, "]", 1);
  }
  case TAG_S8: case TAG_S16: case TAG_S32: case TAG_S64: case TAG_SW:
  case TAG_U8: case TAG_U16: case TAG_U32: case TAG_U64: case TAG_UW: {
    int64_t value;
    char number[24];
    s64 converted;
    const s_sym *type = &g_sym_S64;
    if ((tag->type == TAG_U64 && tag->data.td_u64 > JSON_SAFE) ||
        (tag->type == TAG_UW && tag->data.td_uw > JSON_SAFE) ||
        !s64_init_cast(&converted, &type, tag)) return false;
    value = converted;
    if (value < -JSON_SAFE || value > JSON_SAFE) return false;
    int length = snprintf(number, sizeof number, "%" PRId64, value);
    return length > 0 && (size_t)length < sizeof number && write_bytes(w, number, (size_t)length);
  }
  case TAG_INTEGER: {
    s_tag reduced = {0};
    bool valid = tag_integer_reduce(tag, &reduced) && reduced.type != TAG_INTEGER;
    if (valid) valid = write_tag(w, &reduced, depth + 1);
    tag_clean(&reduced);
    return valid;
  }
  default: return false;
  }
}

s_tag *kc3rts_encode(s_tag *value, s_tag *result)
{
  struct writer w = {malloc(JSON_LIMIT), 0};
  if (!w.bytes) return NULL;
  bool valid = write_tag(&w, value, 0);
  s_tag *encoded = valid ? tag_init_str_alloc_copy(result, w.used, w.bytes) : tag_init(result);
  free(w.bytes);
  return encoded;
}
