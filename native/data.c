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

static const s_tag *field(const s_tag *value, const s_tag *key)
{
  const s_map *map = payload(value);
  if (map)
    for (uw i = 0; i < map->count; ++i)
      if (!compare_tag(key, map->key + i)) return map->value + i;
  return NULL;
}

/* Generic ordered lookup over proper lists. [] means absent; [item] owns the
 * first matching non-Void item (including false/0/non-maps for a missing key).
 * Void declines unsupported list shapes so KC3 can retain its legacy path.
 * Validate the full shape before short-circuiting, never return borrowed tags. */
s_tag *kc3rts_find_field(s_tag *values, const s_tag *key,
                        const s_tag *expected, s_tag *result)
{
  const s_tag missing = {.type = TAG_VOID};
  if (values->type != TAG_PLIST) return tag_init(result);
  for (s_list *item = values->data.td_plist; item; item = list_next(item))
    if (item->next.type != TAG_PLIST) return tag_init(result);
  for (s_list *item = values->data.td_plist; item; item = list_next(item)) {
    if (item->tag.type == TAG_VOID) continue;
    const s_tag *value = field(&item->tag, key);
    if (!compare_tag(value ? value : &missing, expected)) {
      s_list *found = list_new_tag_copy(&item->tag, NULL);
      return found ? tag_init_plist(result, found) : NULL;
    }
  }
  return tag_init_plist(result, NULL);
}

/* Ordered map-field selection with KC3's own comparison semantics. The
 * caller supplies both field and predicate; no game schema or policy here.
 * Skip Void input rows just like List.map_filter, but retain false/0/[] rows
 * when their missing field matches. Every selected item is an owned copy.
 * Invalid list tails or operators decline the whole selection. */
s_tag *kc3rts_select_field(s_tag *values, const s_tag *key,
                          const s_tag *relation, const s_tag *expected,
                          s_tag *result)
{
  if (values->type != TAG_PLIST || relation->type != TAG_PSYM)
    return tag_init(result);
  const s_sym *op = relation->data.td_psym;
  bool equal = op == sym_1("eq"), unequal = op == sym_1("ne");
  if (!equal && !unequal && op != sym_1("gt")) return tag_init(result);
  const s_tag missing = {.type = TAG_VOID};
  s_list *selected = NULL, **tail = &selected;
  for (s_list *item = values->data.td_plist; item; item = list_next(item)) {
    if (item->next.type != TAG_PLIST) {
      list_delete_all(selected);
      return tag_init(result);
    }
    if (item->tag.type == TAG_VOID) continue;
    const s_tag *value = field(&item->tag, key);
    s8 comparison = compare_tag(value ? value : &missing, expected);
    bool keep = equal ? comparison == 0 : unequal ? comparison != 0 : comparison > 0;
    if (keep) {
      if (!(*tail = list_new_tag_copy(&item->tag, NULL))) {
        list_delete_all(selected);
        return NULL;
      }
      tail = &(*tail)->next.data.td_plist;
    }
  }
  return tag_init_plist(result, selected);
}

/* Project a tuple column in order, omitting Void just like List.map_filter.
 * Only selected values are copied; unrelated columns are never materialized.
 * Invalid rows/indices decline as a whole, cleaning any partial owned result. */
s_tag *kc3rts_tuple_column(s_tag *rows, s_tag *index, s_tag *result)
{
  s_tag zero = {0}, limit = {0};
  tag_init_u8(&zero, 0);
  tag_init_u32(&limit, 65535);
  const s_sym *type = &g_sym_Uw;
  uw column;
  if (rows->type != TAG_PLIST || !tag_is_integer(index) ||
      compare_tag(index, &zero) < 0 || compare_tag(index, &limit) > 0 ||
      !uw_init_cast(&column, &type, index)) return tag_init(result);
  s_list *values = NULL, **tail = &values;
  for (s_list *row = rows->data.td_plist; row; row = list_next(row)) {
    if (row->next.type != TAG_PLIST) goto invalid;
    if (row->tag.type == TAG_VOID) continue;
    if (row->tag.type != TAG_PTUPLE ||
        column >= row->tag.data.td_ptuple->count) goto invalid;
    s_tag *value = row->tag.data.td_ptuple->tag + column;
    if (value->type == TAG_VOID) continue;
    if (!(*tail = list_new_tag_copy(value, NULL))) {
      list_delete_all(values);
      return NULL;
    }
    tail = &(*tail)->next.data.td_plist;
  }
  return tag_init_plist(result, values);
 invalid:
  list_delete_all(values);
  return tag_init(result);
}

/* Same semantics as get(left, key) == get(right, key), without materializing
 * either field. Borrowed values stay inside this call; sources are immutable. */
s_tag *kc3rts_field_equal(s_tag *left, s_tag *right, const s_tag *key,
                         s_tag *result)
{
  const s_tag missing = {.type = TAG_VOID};
  const s_tag *a = field(left, key), *b = field(right, key);
  return tag_init_bool(result, !compare_tag(a ? a : &missing,
                                          b ? b : &missing));
}

/* One explicitly mutable, worker-local slot. Its struct owns a Tag, so KC3
 * cleans the retained value when the last alias is released. No global cache,
 * borrowed return value, or gameplay policy lives here. Never store the slot
 * itself (directly or indirectly) in its payload or in canonical state. */
static s_tag *slot_value(s_tag *slot)
{
  if (slot->type != TAG_PSTRUCT ||
      slot->data.td_pstruct->pstruct_type->module != sym_1("RTS.Slot") ||
      slot->data.td_pstruct->pstruct_type->size != sizeof(s_tag)) return NULL;
  return struct_get_w(slot->data.td_pstruct, sym_1("value"));
}

s_tag *kc3rts_slot_put(s_tag *slot, s_tag *value, s_tag *result)
{
  s_tag *stored = slot_value(slot), copy = {0};
  if (!stored) return tag_init(result);
  if (!tag_init_copy(&copy, value)) return NULL;
  tag_clean(stored);
  *stored = copy;
  return tag_init_bool(result, true);
}

s_tag *kc3rts_slot_take(s_tag *slot, s_tag *result)
{
  s_tag *stored = slot_value(slot);
  if (!stored) return tag_init(result);
  *result = *stored;
  tag_init(stored);
  return result;
}

/* Copy only the requested list part. No borrowed pointer escapes these calls;
 * missing/non-list fields return Void. An empty list has no head, but tail []. */
s_tag *kc3rts_first(s_tag *value, const s_tag *key, s_tag *result)
{
  const s_tag *list = field(value, key);
  if (list && list->type == TAG_PLIST && list->data.td_plist)
    return tag_init_copy(result, &list->data.td_plist->tag);
  return tag_init(result);
}

s_tag *kc3rts_rest(s_tag *value, const s_tag *key, s_tag *result)
{
  const s_tag *list = field(value, key);
  if (!list || list->type != TAG_PLIST) return tag_init(result);
  if (!list->data.td_plist) return tag_init_plist(result, NULL);
  return tag_init_copy(result, &list->data.td_plist->next);
}

/* Pair equal-length proper lists in one pass. Each result owns its values;
 * no cursor or borrowed pointer escapes. Void signals incompatible inputs,
 * distinct from successfully pairing two empty lists. */
s_tag *kc3rts_zip(s_tag *left, s_tag *right, s_tag *result)
{
  s_list *a, *b, *pairs = NULL, **tail = &pairs;
  if (left->type != TAG_PLIST || right->type != TAG_PLIST)
    return tag_init(result);
  a = left->data.td_plist;
  b = right->data.td_plist;
  while (a && b) {
    if (a->next.type != TAG_PLIST || b->next.type != TAG_PLIST)
      goto invalid;
    if (!(*tail = list_new(NULL))) goto failed;
    if (!tag_init_ptuple(&(*tail)->tag, 2)) goto failed;
    s_tuple *pair = (*tail)->tag.data.td_ptuple;
    if (!tag_init_copy(pair->tag, &a->tag) ||
        !tag_init_copy(pair->tag + 1, &b->tag)) goto failed;
    tail = &(*tail)->next.data.td_plist;
    a = list_next(a);
    b = list_next(b);
  }
  if (a || b) goto invalid;
  return tag_init_plist(result, pairs);
 invalid:
  list_delete_all(pairs);
  return tag_init(result);
 failed:
  list_delete_all(pairs);
  return NULL;
}

static s_tag *wrap_map(const s_tag *source, s_map *map, s_tag *result)
{
  if (source->type == TAG_MAP) {
    result->type = TAG_MAP;
    result->data.td_map = *map;
    return result;
  }
  /* RTS.Shared has exactly one Map field. Fail if that storage contract changes. */
  if (source->type != TAG_PSTRUCT || !source->data.td_pstruct ||
      source->data.td_pstruct->pstruct_type->module != sym_1("RTS.Shared") ||
      source->data.td_pstruct->pstruct_type->size != sizeof(s_map)) {
    map_clean(map);
    return NULL;
  }
  s_map *owned = alloc(sizeof *owned);
  if (owned) {
    *owned = *map;
    /* Retain the validated source schema directly; avoid resolving the same
     * immutable type through environment Facts on every map update. */
    s_struct *shared = struct_new_with_type(source->data.td_pstruct->pstruct_type);
    if (shared) {
      shared->data = owned;
      shared->free_data = true;
      result->type = TAG_PSTRUCT;
      result->data.td_pstruct = shared;
      return result;
    }
    alloc_free(owned);
  }
  map_clean(map);
  return NULL;
}

static bool integer_subjects(s_tag *subjects)
{
  if (subjects->type != TAG_PLIST) return false;
  for (s_list *item = subjects->data.td_plist; item; item = list_next(item))
    if (item->next.type != TAG_PLIST || !tag_is_integer(&item->tag))
      return false;
  return true;
}

/* Batch the same ordered Facts operations as KC3 List.do: remove the old
 * object at every old subject, then add the new object at every new subject.
 * Validate BOTH lists before the first write. No replacement/deduplication,
 * geometry, borrowed storage or game policy. Runtime errors remain errors;
 * never request fallback after a partially applied batch. */
s_tag *kc3rts_facts_exchange(s_tag *index, s_tag *predicate,
                            s_tag *old_subjects, s_tag *old_object,
                            s_tag *new_subjects, s_tag *new_object,
                            s_tag *result)
{
  if (index->type != TAG_PFACTS || !index->data.td_pfacts ||
      predicate->type != TAG_PSYM || old_object->type == TAG_PVAR ||
      new_object->type == TAG_PVAR || !integer_subjects(old_subjects) ||
      !integer_subjects(new_subjects)) return tag_init(result);
  s_facts *facts = index->data.td_pfacts;
  bool removed;
  for (s_list *item = old_subjects->data.td_plist; item; item = list_next(item))
    if (!facts_remove_fact_tags(facts, &item->tag, predicate, old_object, &removed))
      return NULL;
  for (s_list *item = new_subjects->data.td_plist; item; item = list_next(item))
    if (!facts_add_tags(facts, &item->tag, predicate, new_object)) return NULL;
  return tag_init_bool(result, true);
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
