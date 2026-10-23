/* Bounded integer geometry only. KC3 owns terrain, reservations and movement
 * policy. Unsupported inputs return Void for the KC3 fallback. */
#include <stdint.h>
#include <string.h>
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

struct graph_span { s64 left, right, top, bottom; };
struct graph_body {
  s64 x, z, clearance;
  struct graph_span centers, east, south;
};

/* True signed floor/ceiling are needed for CENTER/EDGE ranges. The historical
 * Map.cells range below deliberately retains ordinary C/KC3 truncation. */
static s64 graph_floor(s64 value, s64 divisor)
{
  return value / divisor - (value % divisor < 0);
}

static s64 graph_ceil(s64 value, s64 divisor)
{
  return value / divisor + (value % divisor > 0);
}

static void graph_clip(struct graph_span *span, s64 width, s64 height)
{
  if (span->left < 0) span->left = 0;
  if (span->top < 0) span->top = 0;
  if (span->right >= width) span->right = width - 1;
  if (span->bottom >= height) span->bottom = height - 1;
}

static uw graph_area(const struct graph_span *span)
{
  if (span->right < span->left || span->bottom < span->top) return 0;
  return (uw) ((span->right - span->left + 1) *
               (span->bottom - span->top + 1));
}

/* Unit-only geometry: a closed center-to-center segment is blocked when it
 * intersects the STRICT integer-half collision box of a supplied body.
 * This does not change tiny/odd Map.cover reservations or movement sweeping.
 */
static bool graph_body_init(struct graph_body *body, const s_tag *parts,
                            s64 inflate, s64 width, s64 height,
                            s64 ox, s64 oz, s64 step)
{
  s64 size;
  if (!grid_scalar(parts + 1, &body->x) ||
      !grid_scalar(parts + 2, &body->z) ||
      !grid_scalar(parts + 3, &size) || size < 1)
    return false;
  body->clearance = inflate + size;
  s64 half = body->clearance / 2;
  /* Preserve Map.cells clipping, including slightly negative right/bottom
   * bounds whose division truncates to zero. Centers are filtered later by
   * the historical doubled-delta inequality, not the edge half-size rule. */
  struct graph_span *centers = &body->centers;
  centers->left = body->x - half - ox;
  centers->right = body->x + half - 1 - ox;
  centers->top = body->z - half - oz;
  centers->bottom = body->z + half - 1 - oz;
  if (centers->left < 0) centers->left = 0;
  if (centers->top < 0) centers->top = 0;
  centers->left /= step;
  centers->right /= step;
  centers->top /= step;
  centers->bottom /= step;
  graph_clip(centers, width, height);

  /* Integer positions strictly inside the collision box are the inclusive
   * interval [center-half+1, center+half-1]. For East edges, the left endpoint
   * can lie one step before that interval; South is the symmetric case. */
  s64 cx = ox + step / 2, cz = oz + step / 2;
  s64 left = body->x - half + 1, right = body->x + half - 1;
  s64 top = body->z - half + 1, bottom = body->z + half - 1;
  body->east = (struct graph_span) {
    graph_ceil(left - step - cx, step), graph_floor(right - cx, step),
    graph_ceil(top - cz, step), graph_floor(bottom - cz, step)
  };
  graph_clip(&body->east, width - 1, height);
  body->south = (struct graph_span) {
    graph_ceil(left - cx, step), graph_floor(right - cx, step),
    graph_ceil(top - step - cz, step), graph_floor(bottom - cz, step)
  };
  graph_clip(&body->south, width, height - 1);
  return true;
}

static void graph_mark(char *bytes, s64 width,
                        const struct graph_span *span)
{
  if (!graph_area(span)) return;
  for (s64 row = span->top; row <= span->bottom; ++row)
    memset(bytes + row * width + span->left, '#',
           (size_t) (span->right - span->left + 1));
}

/* Build three owned ASCII planes: centers, East edges, South edges. KC3
 * supplies the filtered bodies, expansion, excluded ID and terrain/clearance
 * mask; retries, search policy and budgets remain outside this primitive.
 * East/South slots beyond the map boundary remain '.', never traversed.
 *
 * Complete shape/range/work preflight precedes the single output allocation.
 * Opaque IDs use KC3 equality. Excluded bodies' unused geometry is not read.
 * No Facts traversal (which could omit clipped/tiny bodies), mutation, cache or
 * borrowed result. Unsupported input => Void; allocation failure => NULL.
 */
s_tag *kc3rts_grid_graph(const s_tag *layout, const s_tag *mask,
                        const s_tag *bodies, const s_tag *inflate_tag,
                        const s_tag *excluded_id, s_tag *result)
{
  s64 width, height, ox, oz, step, inflate;
  if (layout->type != TAG_PTUPLE || !layout->data.td_ptuple ||
      layout->data.td_ptuple->count != 5 || mask->type != TAG_STR ||
      bodies->type != TAG_PLIST)
    return tag_init(result);
  const s_tag *grid = layout->data.td_ptuple->tag;
  if (!grid_scalar(grid, &width) || !grid_scalar(grid + 1, &height) ||
      !grid_scalar(grid + 2, &ox) || !grid_scalar(grid + 3, &oz) ||
      !grid_scalar(grid + 4, &step) || !grid_scalar(inflate_tag, &inflate) ||
      width < 1 || width > 65535 || height < 1 || height > 65535 ||
      step < 1 || inflate < 1 || width * height > 1048576 ||
      mask->data.td_str.size != (uw) (width * height))
    return tag_init(result);
  uw cells = (uw) (width * height);
  for (uw i = 0; i < cells; ++i)
    if (mask->data.td_str.ptr.p_pchar[i] != '.' &&
        mask->data.td_str.ptr.p_pchar[i] != '#')
      return tag_init(result);

  uw count = 0, work = 0;
  for (s_list *item = bodies->data.td_plist; item; item = list_next(item)) {
    if (item->next.type != TAG_PLIST || ++count > 4096 ||
        item->tag.type != TAG_PTUPLE || !item->tag.data.td_ptuple ||
        item->tag.data.td_ptuple->count != 4)
      return tag_init(result);
    const s_tag *parts = item->tag.data.td_ptuple->tag;
    if (!compare_tag(parts, excluded_id)) continue;
    struct graph_body body;
    if (!graph_body_init(&body, parts, inflate, width, height, ox, oz, step))
      return tag_init(result);
    uw area = graph_area(&body.centers) + graph_area(&body.east) +
      graph_area(&body.south);
    if (area > 4194304 - work) return tag_init(result);
    work += area;
  }

  s_tag output = {0};
  if (!tag_init_str_alloc(&output, 3 * cells)) return NULL;
  char *bytes = output.data.td_str.free.p_pchar;
  memcpy(bytes, mask->data.td_str.ptr.p_pchar, cells);
  memset(bytes + cells, '.', 2 * cells);
  for (s_list *item = bodies->data.td_plist; item; item = list_next(item)) {
    const s_tag *parts = item->tag.data.td_ptuple->tag;
    if (!compare_tag(parts, excluded_id)) continue;
    struct graph_body body;
    if (!graph_body_init(&body, parts, inflate, width, height, ox, oz, step)) {
      tag_clean(&output);
      return tag_init(result);
    }
    if (graph_area(&body.centers))
      for (s64 row = body.centers.top; row <= body.centers.bottom; ++row)
        for (s64 col = body.centers.left; col <= body.centers.right; ++col) {
          s64 dx = ox + col * step + step / 2 - body.x;
          s64 dz = oz + row * step + step / 2 - body.z;
          if (dx * 2 < body.clearance && dx * 2 > -body.clearance &&
              dz * 2 < body.clearance && dz * 2 > -body.clearance)
            bytes[row * width + col] = '#';
        }
    graph_mark(bytes + cells, width, &body.east);
    graph_mark(bytes + 2 * cells, width, &body.south);
  }
  *result = output;
  return result;
}

/* Union of inclusive integer rectangles sampled at grid centers.
 * Rectangle construction and every game clearance decision remain in KC3.
 * Read-only, owned output; unsupported inputs decline before allocation. */
struct rect_span { s64 left, top, right, bottom; };

static bool rect_span_init(struct rect_span *span, const s_tag *rectangle,
                           s64 width, s64 height, s64 cx, s64 cz, s64 step)
{
  if (rectangle->type != TAG_PTUPLE || !rectangle->data.td_ptuple ||
      rectangle->data.td_ptuple->count != 4)
    return false;
  const s_tag *parts = rectangle->data.td_ptuple->tag;
  s64 left, top, right, bottom;
  if (!grid_scalar(parts, &left) || !grid_scalar(parts + 1, &top) ||
      !grid_scalar(parts + 2, &right) || !grid_scalar(parts + 3, &bottom))
    return false;
  if (left > right || top > bottom) {
    *span = (struct rect_span) {1, 1, 0, 0};
    return true;
  }
  *span = (struct rect_span) {
    graph_ceil(left - cx, step), graph_ceil(top - cz, step),
    graph_floor(right - cx, step), graph_floor(bottom - cz, step)
  };
  if (span->left < 0) span->left = 0;
  if (span->top < 0) span->top = 0;
  if (span->right >= width) span->right = width - 1;
  if (span->bottom >= height) span->bottom = height - 1;
  return true;
}

static uw rect_area(const struct rect_span *span)
{
  if (span->left > span->right || span->top > span->bottom) return 0;
  return (uw) ((span->right - span->left + 1) *
               (span->bottom - span->top + 1));
}

s_tag *kc3rts_grid_rectangles_mask(const s_tag *layout, const s_tag *rectangles,
                                  s_tag *result)
{
  if (layout->type != TAG_PTUPLE || !layout->data.td_ptuple ||
      layout->data.td_ptuple->count != 5 || rectangles->type != TAG_PLIST)
    return tag_init(result);
  const s_tag *grid = layout->data.td_ptuple->tag;
  s64 width, height, ox, oz, step;
  if (!grid_scalar(grid, &width) || !grid_scalar(grid + 1, &height) ||
      !grid_scalar(grid + 2, &ox) || !grid_scalar(grid + 3, &oz) ||
      !grid_scalar(grid + 4, &step) || width < 1 || width > 65535 ||
      height < 1 || height > 65535 || step < 1 ||
      width * height > 1048576)
    return tag_init(result);
  s64 cx = ox + step / 2, cz = oz + step / 2;
  uw cells = (uw) (width * height), count = 0, work = 0;
  /* Validate EVERY rectangle before allocation, even after full coverage.
   * Bound duplicate write work as well as input count and allocation size. */
  for (s_list *item = rectangles->data.td_plist; item; item = list_next(item)) {
    struct rect_span span;
    if (item->next.type != TAG_PLIST || ++count > 4096 ||
        !rect_span_init(&span, &item->tag, width, height, cx, cz, step))
      return tag_init(result);
    uw area = rect_area(&span);
    if (area > 4194304 - work) return tag_init(result);
    work += area;
  }
  s_tag output = {0};
  if (!tag_init_str_alloc(&output, cells)) return NULL;
  char *bytes = output.data.td_str.free.p_pchar;
  memset(bytes, '.', cells);
  for (s_list *item = rectangles->data.td_plist; item; item = list_next(item)) {
    struct rect_span span;
    if (!rect_span_init(&span, &item->tag, width, height, cx, cz, step)) {
      tag_clean(&output);
      return tag_init(result);
    }
    if (rect_area(&span))
      for (s64 row = span.top; row <= span.bottom; ++row)
        memset(bytes + row * width + span.left, '#',
               (size_t) (span.right - span.left + 1));
  }
  *result = output;
  return result;
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

/* The same caller-selected corridor, with explicit center/East/South planes.
 * Keep the legacy API unchanged: it cannot infer N from a 3N mask. Borrow only
 * the center prefix while constructing the legacy owned path, then reject any
 * blocked edge. No alternate route, graph mutation or borrowed output. */
s_tag *kc3rts_grid_graph_corridor(const s_tag *width_tag,
                                 const s_tag *count_tag,
                                 const s_tag *mask, s_tag *start_tag,
                                 const s_tag *goal_tag,
                                 const s_tag *horizontal, s_tag *result)
{
  s64 width, count, start, goal;
  if (!grid_scalar(width_tag, &width) || width < 1 || width > 65535 ||
      !grid_scalar(count_tag, &count) || count < 1 || count > 1048576 ||
      count % width || mask->type != TAG_STR ||
      mask->data.td_str.size != 3 * (uw) count ||
      !grid_scalar(start_tag, &start) || !grid_scalar(goal_tag, &goal) ||
      start < 0 || goal < 0 || start >= count || goal >= count ||
      horizontal->type != TAG_BOOL)
    return tag_init(result);
  s_tag centers = {0}, path = {0};
  tag_init_str(&centers, NULL, (uw) count, mask->data.td_str.ptr.p_pchar);
  if (!kc3rts_grid_corridor(width_tag, &centers, start_tag, goal_tag,
                            horizontal, &path))
    return NULL;
  if (path.type == TAG_VOID) return tag_init(result);
  for (s_list *item = path.data.td_plist; item; item = list_next(item)) {
    s_list *next = list_next(item);
    if (!next) break;
    s64 from, to;
    if (!grid_scalar(&item->tag, &from) || !grid_scalar(&next->tag, &to)) {
      tag_clean(&path);
      return tag_init(result);
    }
    /* Comparing rows also handles width=1, where +/-1 is vertical. */
    s64 edge = (from / width == to / width ? count : 2 * count) +
      (from < to ? from : to);
    if (mask->data.td_str.ptr.p_pchar[edge] == '#') {
      tag_clean(&path);
      return tag_init_plist(result, NULL);
    }
  }
  *result = path;
  return result;
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
