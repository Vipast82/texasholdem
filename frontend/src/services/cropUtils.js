/**
 * Crop math for the avatar cropper (Sprint 5). Pure functions, no DOM — the
 * React component calls these to know WHICH square region of the source image
 * to blit onto the output canvas. Keeping the math out of the component makes
 * it unit-testable under Node.
 *
 * The crop window is always a square (it becomes the circular avatar) and is
 * ALWAYS fully in-bounds. `zoom` is a magnification factor (like a camera
 * zoom): 1 = "fit the whole image" (the crop square equals the smaller image
 * dimension); larger values zoom IN toward the center, shrinking the visible
 * square down to 1px. `cx`/`cy` are the requested center, clamped so the
 * square never leaves the image.
 */

export function clamp(value, lo, hi) {
  if (Number.isNaN(value)) return lo;
  return Math.max(lo, Math.min(hi, value));
}

/**
 * Compute the square crop rect (in source-image pixels).
 * @param {object} p
 * @param {number} p.imageW  source width (px), > 0
 * @param {number} p.imageH  source height (px), > 0
 * @param {number} [p.zoom]  magnification: 1 = fit (square = smallest dim);
 *                           higher = zoom in (smaller, tighter square). >= 1.
 * @param {number|null} [p.cx] requested center x (defaults to image center)
 * @param {number|null} [p.cy] requested center y
 * @returns {{ x: number, y: number, size: number, w: number, h: number }}
 */
export function computeSquareCrop({ imageW, imageH, zoom = 1, cx = null, cy = null } = {}) {
  const w = Math.max(1, imageW);
  const h = Math.max(1, imageH);
  const minDim = Math.min(w, h);
  const maxZoom = Math.max(1, minDim); // zoom of `minDim` reduces to a 1px window

  const z = clamp(zoom || 1, 1, maxZoom);
  // Magnification: the visible square shrinks as you zoom in.
  const size = clamp(minDim / z, 1, minDim);

  // Center defaults to the image center.
  const centerX = cx == null ? w / 2 : cx;
  const centerY = cy == null ? h / 2 : cy;

  // Clamp the center so the square stays fully inside the image.
  const clampedCx = clamp(centerX, size / 2, w - size / 2);
  const clampedCy = clamp(centerY, size / 2, h - size / 2);

  return {
    x: clampedCx - size / 2,
    y: clampedCy - size / 2,
    size,
    w: size,
    h: size
  };
}
