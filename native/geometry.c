/* Bounded integer geometry only. KC3 owns terrain, reservations and movement
 * policy. Unsupported inputs return Void for the KC3 fallback. */
#include <stdint.h>
#include "libkc3/kc3.h"

static bool grid_scalar(const s_tag *tag, s64 *out)
{
  switch (tag->type) {
  case TAG_S8:  *out = tag->data.td_s8; break;
  case TAG_S16: *out = tag->data.td_s16; break;
  case TAG_S32: *out = tag->data.td_s32; break;
  case TAG_S64: *out = tag->data.td_s64; break;
  case TAG_SW:  *out = tag->data.td_sw; break;
  case TAG_U8:  *out = tag->data.td_u8; break;
  case TAG_U16: *out = tag->data.td_u16; break;
  case TAG_U32: *out = tag->data.td_u32; break;
  case TAG_U64:
    if (tag->data.td_u64 > INT32_MAX) return false;
    *out = tag->data.td_u64;
    break;
  case TAG_UW:
    if (tag->data.td_uw > INT32_MAX) return false;
    *out = tag->data.td_uw;
    break;
  default: return false;
  }
  return *out >= INT32_MIN && *out <= INT32_MAX;
}

/* Enumerate one caller-selected, axis-aligned two-segment corridor. This is
 * not a planner: KC3 chooses axis priority, retries, clearance and A* budgets.
 * Only destination bytes are tested (the starting cell may be blocked).
 * Void declines unsupported input; [] means this exact corridor is blocked.
 * Build an owned list in linear time, with no shared mutable path storage. */
s_tag *kc3rts_grid_corridor(const s_tag *width_tag, const s_tag *mask,
                           s_tag *start_tag, const s_tag *goal_tag,
                           const s_tag *horizontal, s_tag *result)
{
  s64 width, start, goal;
  if (!grid_scalar(width_tag, &width) || width < 1 || width > 65535 ||
      mask->type != TAG_STR || !mask->data.td_str.size ||
      mask->data.td_str.size > 1048576 ||
      mask->data.td_str.size % (uw) width ||
      !grid_scalar(start_tag, &start) || !grid_scalar(goal_tag, &goal) ||
      start < 0 || goal < 0 || (uw) start >= mask->data.td_str.size ||
      (uw) goal >= mask->data.td_str.size || horizontal->type != TAG_BOOL)
    return tag_init(result);
  s64 dx = goal % width - start % width;
  s64 dz = goal / width - start / width;
  s64 count[2] = {dx < 0 ? -dx : dx, dz < 0 ? -dz : dz};
  s64 step[2] = {dx < 0 ? -1 : 1, dz < 0 ? -width : width};
  if (count[0] + count[1] >= 4096) return tag_init(result);
  s_list *path = list_new(NULL);
  if (!path) return NULL;
  if (!tag_init_copy(&path->tag, start_tag)) {
    list_delete_all(path);
    return NULL;
  }
  s_list **tail = &path->next.data.td_plist;
  s64 cell = start;
  for (int segment = 0; segment < 2; ++segment) {
    int axis = horizontal->data.td_bool_ ? segment : 1 - segment;
    for (s64 i = 0; i < count[axis]; ++i) {
      cell += step[axis];
      if (mask->data.td_str.ptr.p_pchar[cell] == '#') {
        list_delete_all(path);
        return tag_init_plist(result, NULL);
      }
      if (!(*tail = list_new_uw_reduce((uw) cell, NULL))) {
        list_delete_all(path);
        return NULL;
      }
      tail = &(*tail)->next.data.td_plist;
    }
  }
  return tag_init_plist(result, path);
}

/* Read one worker-local Facts bucket of {id, x, z, size} bounding boxes.
 * The range cursor borrows objects without materializing a variable/callback
 * for every neighbor. No mutation, retained pointer or gameplay decision:
 * strict overlap and integer half-sizes match the KC3 reference exactly.
 * KC3 owns the index and must not mutate it concurrently with this query. */
s_tag *kc3rts_cell_clear(const s_tag *index, s_tag *cell,
                        const s_tag *body, s_tag *result)
{
  s64 cell_id, x, z, size;
  if (index->type != TAG_PFACTS || !index->data.td_pfacts ||
      !grid_scalar(cell, &cell_id) ||
      body->type != TAG_PTUPLE || body->data.td_ptuple->count != 4)
    return tag_init(result);
  const s_tag *query = body->data.td_ptuple->tag;
  if (!grid_scalar(query + 1, &x) || !grid_scalar(query + 2, &z) ||
      !grid_scalar(query + 3, &size) || size < 0)
    return tag_init(result);

  s_tag predicate = {0};
  tag_init_psym(&predicate, sym_1("body"));
  s_fact start = {.subject = cell, .predicate = &predicate,
                  .object = TAG_FIRST};
  s_fact end = {.subject = cell, .predicate = &predicate,
                .object = TAG_LAST};
  s_facts *facts = index->data.td_pfacts;
  s_facts_cursor cursor;
  s_fact *fact;
  if (!facts_cursor_init(facts, &cursor, facts->index_spo, &start, &end))
    return NULL;
  tag_init_bool(result, true);
  for (;;) {
    if (!facts_cursor_next(&cursor, &fact)) {
      facts_cursor_clean(&cursor);
      return NULL;
    }
    if (!fact) break;
    const s_tag *neighbor = fact->object;
    if (neighbor->type != TAG_PTUPLE || neighbor->data.td_ptuple->count != 4) {
      tag_init(result);
      break;
    }
    const s_tag *other = neighbor->data.td_ptuple->tag;
    if (!compare_tag(query, other)) continue;
    s64 other_x, other_z, other_size;
    if (!grid_scalar(other + 1, &other_x) ||
        !grid_scalar(other + 2, &other_z) ||
        !grid_scalar(other + 3, &other_size) || other_size < 0) {
      tag_init(result);
      break;
    }
    s64 distance = (size + other_size) / 2;
    s64 dx = x - other_x, dz = z - other_z;
    if (dx < distance && dx > -distance &&
        dz < distance && dz > -distance) {
      tag_init_bool(result, false);
      break;
    }
  }
  facts_cursor_clean(&cursor);
  return result;
}

/* Pure axis-aligned integer interpolation to a cell center. The caller picks
 * the axis priority; KC3 still decides routes, speed, collision and acceptance.
 * Bounds keep target products, differences and clamping safe in signed 64 bits.
 * IDs/footprints are opaque owned copies, never narrowed or used as indices. */
s_tag *kc3rts_grid_step(const s_tag *layout, const s_tag *body,
                       const s_tag *speed_tag, const s_tag *cell_tag,
                       const s_tag *horizontal_tag, s_tag *result)
{
  s64 w, h, ox, oz, size, x, z, speed, cell;
  if (layout->type != TAG_PTUPLE || layout->data.td_ptuple->count != 5 ||
      body->type != TAG_PTUPLE || body->data.td_ptuple->count != 4 ||
      horizontal_tag->type != TAG_BOOL)
    return tag_init(result);
  const s_tag *grid = layout->data.td_ptuple->tag;
  s_tag *unit = body->data.td_ptuple->tag;
  if (!grid_scalar(grid, &w) || !grid_scalar(grid + 1, &h) ||
      !grid_scalar(grid + 2, &ox) || !grid_scalar(grid + 3, &oz) ||
      !grid_scalar(grid + 4, &size) || !grid_scalar(unit + 1, &x) ||
      !grid_scalar(unit + 2, &z) || !grid_scalar(speed_tag, &speed) ||
      !grid_scalar(cell_tag, &cell) || w < 1 || w > 65535 || h < 1 ||
      h > 65535 || size < 1 || speed < 0 || cell < 0 || cell >= w * h)
    return tag_init(result);

  s64 tx = ox + (cell % w) * size + size / 2;
  s64 tz = oz + (cell / w) * size + size / 2;
  if (x != tx && (horizontal_tag->data.td_bool_ || z == tz)) {
    s64 delta = tx - x;
    x = delta > speed ? x + speed : delta < -speed ? x - speed : tx;
  } else {
    s64 delta = tz - z;
    z = delta > speed ? z + speed : delta < -speed ? z - speed : tz;
  }

  s_tag output = {0}, coordinate = {0};
  if (!tag_init_ptuple(&output, 2)) return NULL;
  s_tag *pair = output.data.td_ptuple->tag;
  if (!tag_init_ptuple(pair, 4)) goto failed;
  s_tag *next = pair->data.td_ptuple->tag;
  if (!tag_init_copy(next, unit) || !tag_init_copy(next + 3, unit + 3))
    goto failed;
  tag_init_s64(&coordinate, x);
  if (!tag_integer_reduce(&coordinate, next + 1)) goto failed;
  tag_init_s64(&coordinate, z);
  if (!tag_integer_reduce(&coordinate, next + 2)) goto failed;
  tag_init_bool(pair + 1, x == tx && z == tz);
  *result = output;
  return result;
 failed:
  tag_clean(&output);
  return NULL;
}

s_tag *kc3rts_grid_cover(const s_tag *layout, const s_tag *x_tag,
                        const s_tag *z_tag, const s_tag *footprint_tag,
                        s_tag *result)
{
  s64 w, h, ox, oz, size, x, z, footprint;
  if (layout->type != TAG_PTUPLE || layout->data.td_ptuple->count != 5)
    return tag_init(result);
  const s_tag *parts = layout->data.td_ptuple->tag;
  if (!grid_scalar(parts, &w) || !grid_scalar(parts + 1, &h) ||
      !grid_scalar(parts + 2, &ox) || !grid_scalar(parts + 3, &oz) ||
      !grid_scalar(parts + 4, &size) || !grid_scalar(x_tag, &x) ||
      !grid_scalar(z_tag, &z) || !grid_scalar(footprint_tag, &footprint) ||
      w < 1 || w > 65535 || h < 1 || h > 65535 || size < 1 || footprint < 2)
    return tag_init(result);

  /* Signed-32-bit inputs make all intermediate arithmetic safe in s64.
   * Dimensions also keep cell IDs representable by uw on 32-bit hosts.
   * Preserve KC3's integer half-size rule, including odd footprints. */
  s64 half = footprint / 2;
  s64 left = x - half - ox, right = x + half - 1 - ox;
  s64 top = z - half - oz, bottom = z + half - 1 - oz;
  if (left < 0 || top < 0 || right >= w * size || bottom >= h * size)
    return tag_init_plist(result, NULL);
  left /= size;
  right /= size;
  top /= size;
  bottom /= size;
  /* Limit native allocation; unusually large queries retain the reference. */
  if ((right - left + 1) * (bottom - top + 1) > 4096)
    return tag_init(result);

  s_list *cells = NULL, **tail = &cells;
  for (s64 row = top; row <= bottom; ++row)
    for (s64 col = left; col <= right; ++col) {
      *tail = list_new_uw_reduce((uw) (row * w + col), NULL);
      if (!*tail) {
        list_delete_all(cells);
        return NULL;
      }
      tail = &(*tail)->next.data.td_plist;
    }
  return tag_init_plist(result, cells);
}

/* Fuse existing bounded geometry/read-only queries, avoiding intermediate
 * interpreter crossings. The returned proposal exists even when blocked;
 * KC3 still chooses axis priority, alternatives and movement acceptance.
 * No reservation changes here. Unsupported inputs fall back as one unit. */
s_tag *kc3rts_grid_probe(const s_tag *layout, const s_tag *mask,
                        const s_tag *index, const s_tag *body,
                        const s_tag *speed, const s_tag *cell,
                        const s_tag *horizontal, s_tag *result)
{
  s_tag proposal = {0}, cells = {0}, clear = {0}, output = {0};
  if (!kc3rts_grid_step(layout, body, speed, cell, horizontal, &proposal))
    return NULL;
  if (proposal.type == TAG_VOID) return tag_init(result);
  s64 width, height;
  const s_tag *grid = layout->data.td_ptuple->tag;
  /* grid_step already validated these bounded dimensions. */
  if (!grid_scalar(grid, &width) || !grid_scalar(grid + 1, &height) ||
      mask->type != TAG_STR || mask->data.td_str.size != (uw) (width * height))
    goto fallback;
  s_tag *pair = proposal.data.td_ptuple->tag;
  s_tag *next = pair->data.td_ptuple->tag;
  if (!kc3rts_grid_cover(layout, next + 1, next + 2, next + 3, &cells))
    goto failed;
  if (cells.type == TAG_VOID) goto fallback;
  for (s_list *item = cells.data.td_plist; item; item = list_next(item)) {
    s64 offset;
    if (!grid_scalar(&item->tag, &offset) || offset < 0 ||
        (uw) offset >= mask->data.td_str.size) goto fallback;
    bool blocked = mask->data.td_str.ptr.p_pchar[offset] == '#';
    if (!blocked) {
      if (!kc3rts_cell_clear(index, &item->tag, pair, &clear)) goto failed;
      if (clear.type != TAG_BOOL) goto fallback;
      blocked = !clear.data.td_bool_;
    }
    if (blocked) {
      tag_clean(&cells);
      tag_init_plist(&cells, NULL);
      break;
    }
  }
  if (!tag_init_ptuple(&output, 3)) goto failed;
  /* Move owned values, not borrowed Facts objects, into the result. */
  output.data.td_ptuple->tag[0] = pair[0];
  output.data.td_ptuple->tag[1] = pair[1];
  output.data.td_ptuple->tag[2] = cells;
  tag_init(pair);
  tag_init(pair + 1);
  tag_clean(&proposal);
  *result = output;
  return result;
 fallback:
  tag_clean(&proposal);
  tag_clean(&cells);
  return tag_init(result);
 failed:
  tag_clean(&proposal);
  tag_clean(&cells);
  tag_clean(&output);
  return NULL;
}

/* The caller explicitly requests reservation of this one candidate, only if
 * clear. Reuse the read-only probe and ordered Facts exchange; all read cursors
 * are closed before writes. KC3 still chooses the axis, retries, priorities and
 * entity/order updates. Preflight every removable subject before ANY write.
 * Unsupported inputs decline without mutation. Runtime write errors are fatal,
 * never a request to retry a partially applied exchange through the fallback. */
s_tag *kc3rts_facts_exchange(s_tag *, s_tag *, s_tag *, s_tag *,
                            s_tag *, s_tag *, s_tag *);

s_tag *kc3rts_grid_probe_reserve(s_tag *layout, s_tag *mask, s_tag *index,
                                s_tag *old_cells, s_tag *body, s_tag *speed,
                                s_tag *cell, s_tag *horizontal, s_tag *result)
{
  if (index->type != TAG_PFACTS || !index->data.td_pfacts ||
      old_cells->type != TAG_PLIST) return tag_init(result);
  for (s_list *item = old_cells->data.td_plist; item; item = list_next(item))
    if (item->next.type != TAG_PLIST || !tag_is_integer(&item->tag))
      return tag_init(result);
  s_tag output = {0};
  if (!kc3rts_grid_probe(layout, mask, index, body, speed, cell, horizontal,
                         &output)) return NULL;
  if (output.type == TAG_VOID) return tag_init(result);
  s_tag *parts = output.data.td_ptuple->tag;
  if (parts[2].data.td_plist) {
    /* Typed tag initializers do not initialize hash/refcount metadata. */
    s_tag predicate = {0}, exchanged = {0};
    tag_init_psym(&predicate, sym_1("body"));
    if (!kc3rts_facts_exchange(index, &predicate, old_cells, body,
                               parts + 2, parts, &exchanged) ||
        exchanged.type != TAG_BOOL || !exchanged.data.td_bool_) {
      tag_clean(&exchanged);
      tag_clean(&output);
      return NULL;
    }
    tag_clean(&exchanged);
  }
  *result = output;
  return result;
}
