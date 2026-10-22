import { describe, it, expect } from 'vitest';
import { stadiumPoint, project, stadiumPath, seatSpots } from '../src/tableGeometry.js';

const W = 1000;
const H = 480;

describe('tableGeometry', () => {
  it('starts at the bottom centre and goes left first', () => {
    const start = stadiumPoint(0, W, H);
    expect(start.x).toBeCloseTo(500);
    expect(start.y).toBeCloseTo(480);
    expect(stadiumPoint(0.05, W, H).x).toBeLessThan(500);
  });

  it('keeps every point inside the box (landscape and portrait)', () => {
    for (const [w, h] of [
      [W, H],
      [360, 520]
    ]) {
      for (let i = 0; i < 100; i += 1) {
        const p = stadiumPoint(i / 100, w, h, 10);
        expect(p.x).toBeGreaterThanOrEqual(9.99);
        expect(p.x).toBeLessThanOrEqual(w - 9.99);
        expect(p.y).toBeGreaterThanOrEqual(9.99);
        expect(p.y).toBeLessThanOrEqual(h - 9.99);
      }
    }
  });

  it('half way round is the top centre', () => {
    const top = stadiumPoint(0.5, W, H);
    expect(top.x).toBeCloseTo(500);
    expect(top.y).toBeCloseTo(0);
  });

  it('tilt narrows the far edge but leaves the near edge alone', () => {
    expect(project({ x: 0, y: H }, W, H).x).toBeCloseTo(0);
    expect(project({ x: 0, y: 0 }, W, H).x).toBeGreaterThan(50);
  });

  it('draws a closed SVG path', () => {
    const d = stadiumPath(W, H, 8);
    expect(d.startsWith('M')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
  });

  it('puts me at the bottom and everyone else around the rail', () => {
    const spots = seatSpots(6, W, H, 2);
    expect(spots[2].isBottom).toBe(true);
    expect(spots[2].x).toBeCloseTo(500);
    expect(spots[2].y).toBeCloseTo(H);
    // Bets sit between each seat and the middle.
    for (const s of spots) {
      expect(Math.abs(s.betX - 500)).toBeLessThanOrEqual(Math.abs(s.x - 500) + 0.01);
      expect(Math.abs(s.betY - 240)).toBeLessThanOrEqual(Math.abs(s.y - 240) + 0.01);
    }
  });
});
