/**
 * Table geometry — pure math for drawing the poker table and placing seats.
 *
 * The table is a "stadium" (a rectangle with round ends) that fits a W×H box.
 * Landscape boxes get a horizontal stadium, portrait boxes a vertical one.
 * A light perspective tilt makes the far (top) edge narrower than the near
 * edge, so the table reads as lying flat in front of you.
 *
 * Everything is in pixels of the box, so the SVG felt, the seats, the bets and
 * the board all line up exactly.
 */

/** Far-edge narrowing: 0 = flat, 0.16 = top edge is 84% as wide as the bottom. */
export const TILT = 0.16;

/**
 * Point at fraction `t` (0..1) along the stadium inset `inset` px inside the
 * box, starting at the bottom centre and going clockwise on screen (towards
 * the left first, like the action around a real table).
 */
export function stadiumPoint(t, W, H, inset = 0) {
  const w = Math.max(1, W - 2 * inset);
  const h = Math.max(1, H - 2 * inset);
  const cx = W / 2;
  const cy = H / 2;
  const horizontal = w >= h;
  const r = (horizontal ? h : w) / 2;
  const s = Math.abs(w - h); // length of each straight side
  const perimeter = 2 * s + 2 * Math.PI * r;
  let d = (((t % 1) + 1) % 1) * perimeter;

  if (horizontal) {
    // bottom edge, left half
    if (d <= s / 2) return { x: cx - d, y: cy + r };
    d -= s / 2;
    // left round end, bottom -> top
    if (d <= Math.PI * r) {
      const a = Math.PI / 2 + d / r;
      return { x: cx - s / 2 + r * Math.cos(a), y: cy + r * Math.sin(a) };
    }
    d -= Math.PI * r;
    // top edge, left -> right
    if (d <= s) return { x: cx - s / 2 + d, y: cy - r };
    d -= s;
    // right round end, top -> bottom
    if (d <= Math.PI * r) {
      const a = -Math.PI / 2 + d / r;
      return { x: cx + s / 2 + r * Math.cos(a), y: cy + r * Math.sin(a) };
    }
    d -= Math.PI * r;
    return { x: cx + s / 2 - d, y: cy + r };
  }

  // Vertical stadium: round ends at top and bottom.
  // bottom round end, centre -> left
  if (d <= (Math.PI * r) / 2) {
    const a = Math.PI / 2 + d / r;
    return { x: cx + r * Math.cos(a), y: cy + s / 2 + r * Math.sin(a) };
  }
  d -= (Math.PI * r) / 2;
  // left edge, bottom -> top
  if (d <= s) return { x: cx - r, y: cy + s / 2 - d };
  d -= s;
  // top round end, left -> right
  if (d <= Math.PI * r) {
    const a = Math.PI + d / r;
    return { x: cx + r * Math.cos(a), y: cy - s / 2 + r * Math.sin(a) };
  }
  d -= Math.PI * r;
  // right edge, top -> bottom
  if (d <= s) return { x: cx + r, y: cy - s / 2 + d };
  d -= s;
  // bottom round end, right -> centre
  const a = d / r;
  return { x: cx + r * Math.cos(a), y: cy + s / 2 + r * Math.sin(a) };
}

/** Apply the perspective tilt: the higher a point sits, the closer to centre. */
export function project(p, W, H, tilt = TILT) {
  const depth = 1 - Math.min(1, Math.max(0, p.y / H)); // 1 at the far edge
  return { x: W / 2 + (p.x - W / 2) * (1 - tilt * depth), y: p.y };
}

/** SVG path of the tilted stadium, inset `inset` px. */
export function stadiumPath(W, H, inset = 0, tilt = TILT, steps = 160) {
  let path = '';
  for (let i = 0; i <= steps; i += 1) {
    const p = project(stadiumPoint(i / steps, W, H, inset), W, H, tilt);
    path += `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`;
  }
  return `${path}Z`;
}

/**
 * Seat spots for `n` players spread evenly around the rail, with player
 * `meIndex` at the bottom centre. Each spot also carries where that player's
 * bet sits (between the seat and the middle) and which side their cards fan to.
 */
export function seatSpots(
  n,
  W,
  H,
  meIndex = 0,
  { inset = 0, betPull = 0.42, betPullY = 0.64, tilt = TILT } = {}
) {
  const cx = W / 2;
  const cy = H / 2;
  const spots = [];
  for (let i = 0; i < n; i += 1) {
    const step = (i - meIndex + n) % n;
    const flat = stadiumPoint(step / n, W, H, inset);
    const seat = project(flat, W, H, tilt);
    const bet = project({ x: cx + (flat.x - cx) * betPull, y: cy + (flat.y - cy) * betPullY }, W, H, tilt);
    spots.push({
      x: seat.x,
      y: seat.y,
      betX: bet.x,
      betY: bet.y,
      side: seat.x < cx - W * 0.05 ? 'left' : 'right',
      isBottom: step === 0
    });
  }
  return spots;
}
