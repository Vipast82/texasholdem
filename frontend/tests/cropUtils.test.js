/**
 * cropUtils.js (Sprint 5) — pure square-crop math for the AvatarCropper.
 * Verifies the crop window stays in-bounds, square, and zoomable across
 * portrait / landscape / square source images.
 */
import { describe, it, expect } from 'vitest';
import { clamp, computeSquareCrop } from '../src/services/cropUtils.js';

describe('clamp', () => {
  it('clamps within bounds', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });

  it('coerces NaN to the lower bound', () => {
    expect(clamp(NaN, 3, 10)).toBe(3);
  });
});

describe('computeSquareCrop', () => {
  it('defaults to a centered square = smallest dimension on a landscape image', () => {
    const r = computeSquareCrop({ imageW: 100, imageH: 60 });
    expect(r.size).toBe(60);
    expect(r.w).toBe(r.h);
    expect(r.x).toBe(20); // (100 - 60) / 2
    expect(r.y).toBe(0);
  });

  it('defaults to a centered square = smallest dimension on a portrait image', () => {
    const r = computeSquareCrop({ imageW: 40, imageH: 100 });
    expect(r.size).toBe(40);
    expect(r.y).toBe(30);
    expect(r.x).toBe(0);
  });

  it('zooms in (magnification) so the window shrinks but stays fully in-bounds', () => {
    const base = computeSquareCrop({ imageW: 100, imageH: 60 });
    const zoomed = computeSquareCrop({ imageW: 100, imageH: 60, zoom: 2 });
    // Zooming in makes the visible square SMALLER (tighter crop)...
    expect(zoomed.size).toBeLessThan(base.size);
    // ...but it must never exceed the smaller dimension (it would clip out of
    // bounds on the short axis), and it must stay fully inside the image.
    expect(zoomed.size).toBeLessThanOrEqual(60);
    expect(zoomed.x).toBeGreaterThanOrEqual(0);
    expect(zoomed.y).toBeGreaterThanOrEqual(0);
    expect(zoomed.x + zoomed.w).toBeLessThanOrEqual(100);
    expect(zoomed.y + zoomed.h).toBeLessThanOrEqual(60);
  });

  it('keeps the crop square and in-bounds when the center is pushed to a corner', () => {
    const r = computeSquareCrop({ imageW: 200, imageH: 100, cx: 500, cy: 500 });
    expect(r.size).toBe(100);
    expect(r.x + r.w).toBeLessThanOrEqual(200);
    expect(r.y + r.h).toBeLessThanOrEqual(100);
  });

  it('clamps zoom into the valid magnification range', () => {
    // zoom < 1 is treated as "fit" (the largest in-bounds square = smaller dim).
    const r2 = computeSquareCrop({ imageW: 100, imageH: 50, zoom: 0.2 });
    expect(r2.size).toBe(50);
    // Over-zooming clamps to a 1px window (max magnification = smaller dim).
    const r = computeSquareCrop({ imageW: 100, imageH: 50, zoom: 999 });
    expect(r.size).toBe(1);
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.x + r.w).toBeLessThanOrEqual(100);
    expect(r.y + r.h).toBeLessThanOrEqual(50);
  });

  it('handles a 1px image without throwing', () => {
    const r = computeSquareCrop({ imageW: 1, imageH: 1 });
    expect(r.size).toBe(1);
    expect(r.x).toBe(0);
  });
});
