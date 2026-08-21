/**
 * avatarView.js (Sprint 5) — the per-seat "what to render" decision + the
 * privacy invariant (you only ever see a binary YOU have stored; bots get the
 * generated cowboy; everyone else falls back to the neutral default).
 */
import { describe, it, expect } from 'vitest';
import { resolveAvatarView, avatarCss, cropCss, AVATAR_KINDS } from '../src/services/avatarView.js';

describe('resolveAvatarView', () => {
  const botSrc = (d) => `cowboy:${d}`;
  const avatarById = {
    'user-me': { url: 'blob:me', crop: { x: 4, y: 6, size: 80 } }
  };

  it('renders the generated cowboy for a bot by difficulty', () => {
    const v = resolveAvatarView(
      { id: 'b', isBot: true, bot: { difficulty: 'hard' } },
      { avatarById, botSrc, defaultSrc: 'def' }
    );
    expect(v.kind).toBe('cowboy');
    expect(v.src).toBe('cowboy:hard');
    expect(v.crop).toBeNull();
  });

  it('falls back to normal when a bot has no difficulty', () => {
    const v = resolveAvatarView({ id: 'b', isBot: true }, { botSrc, defaultSrc: 'def' });
    expect(v.src).toBe('cowboy:normal');
  });

  it('renders your OWN uploaded avatar (you have the blob) with its crop', () => {
    const v = resolveAvatarView(
      { id: 'me', isBot: false, avatarMeta: { avatarId: 'user-me', crop: { x: 4, y: 6, size: 80 } } },
      { avatarById, botSrc, defaultSrc: 'def' }
    );
    expect(v.kind).toBe('upload');
    expect(v.src).toBe('blob:me');
    expect(v.crop).toEqual({ x: 4, y: 6, size: 80 });
    expect(v.avatarId).toBe('user-me');
  });

  it('PRIVACY: another player whose avatar id you do NOT have falls back to default', () => {
    const v = resolveAvatarView(
      { id: 'them', isBot: false, avatarMeta: { avatarId: 'user-them' } },
      { avatarById, botSrc, defaultSrc: 'def' }
    );
    expect(v.kind).toBe('default');
    expect(v.src).toBe('def');
  });

  it('a human with no avatar meta renders the default', () => {
    const v = resolveAvatarView({ id: 'x', isBot: false }, { avatarById, botSrc, defaultSrc: 'def' });
    expect(v.kind).toBe('default');
    expect(v.src).toBe('def');
  });

  it('tolerates a null player', () => {
    const v = resolveAvatarView(null, { defaultSrc: 'def' });
    expect(v.kind).toBe('default');
    expect(v.src).toBe('def');
  });

  it('exposes the canonical kinds', () => {
    expect(AVATAR_KINDS).toEqual(['cowboy', 'upload', 'default']);
  });
});

describe('avatarCss', () => {
  it('returns null when there is no image', () => {
    expect(avatarCss(null)).toBeNull();
    expect(avatarCss({})).toBeNull();
  });

  it('produces a cover background for an un-cropped avatar', () => {
    const css = avatarCss({ src: 'data:image/svg+xml,x' });
    expect(css.backgroundImage).toContain('data:image/svg+xml');
    expect(css.backgroundSize).toBe('cover');
    expect(css.backgroundPosition).toBe('center');
    expect(css.backgroundRepeat).toBe('no-repeat');
  });
});

describe('cropCss', () => {
  it('frames the crop window with the correct background-size/position', () => {
    // Source 200x100, crop is an 80x80 square starting at (40, 10).
    const css = cropCss({ x: 40, y: 10, size: 80 }, 200, 100);
    // Whole source scaled so the 80px window = 100% -> 250% x 125%.
    expect(css.backgroundSize).toBe('250% 125%');
    // x / (w - size) = 40 / 120 = 33.333%; y / (h - size) = 10 / 20 = 50%.
    expect(css.backgroundPosition).toBe('33.333333333333336% 50%');
    expect(css.backgroundRepeat).toBe('no-repeat');
  });

  it('clamps to 0 offset on an axis the crop spans fully', () => {
    // Source 200x80, crop height = full height -> vertical offset forced to 0.
    const css = cropCss({ x: 0, y: 0, size: 80 }, 200, 80);
    expect(css.backgroundSize).toBe('250% 100%');
    expect(css.backgroundPosition).toBe('0% 0%');
  });

  it('falls back to the smallest dimension when no size is given', () => {
    const css = cropCss(null, 200, 80);
    // size defaults to min(200,80)=80; x,y default 0.
    expect(css.backgroundSize).toBe('250% 100%');
    expect(css.backgroundPosition).toBe('0% 0%');
  });
});
