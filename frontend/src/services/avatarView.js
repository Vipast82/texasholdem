/**
 * avatarView (Sprint 5) — PURE decision logic for "what image do I render for
 * this seat?". Split out of the React component so it is unit-testable under
 * Node with no DOM / IndexedDB / audio involved.
 *
 * PRIVACY MODEL (the important part): the avatar BINARY only ever exists in the
 * OWNER's IndexedDB. What travels over the socket is just `avatarMeta`
 * (avatarId + crop + kind). So when you look at the table:
 *   - Bots     → an inline-SVG cowboy (generated, no binary needed).
 *   - YOU      → your own uploaded avatar (you are the only one who has the
 *                blob, resolved locally from IndexedDB).
 *   - Other humans → you do NOT have their blob, so we render the neutral
 *     default stick-figure. We never try to fetch/serve someone else's binary.
 *
 * This makes "avatars are personal, the wire only carries ids" a hard, testable
 * invariant rather than a hope.
 */

export const AVATAR_KINDS = ['cowboy', 'upload', 'default'];

/**
 * Resolve the view for one player seat.
 * @param {object} player a player from the snapshot ({ id, isBot, bot, avatarMeta, ... })
 * @param {object} [resolved]
 * @param {object} [resolved.avatarById] avatarId -> { url, crop? } for avatars
 *        THIS client has stored locally (only the owner will have their own).
 * @param {Function} [resolved.botSrc] (difficulty) -> string (inline cowboy SVG data URI)
 * @param {string} [resolved.defaultSrc] fallback avatar (neutral stick-figure)
 * @returns {{ kind: string, src: string, crop: (object|null), avatarId: (string|null) }}
 */
export function resolveAvatarView(player, { avatarById = null, botSrc = null, defaultSrc = null } = {}) {
  if (!player) {
    return { kind: 'default', src: defaultSrc || null, crop: null, avatarId: null };
  }

  // 1) Bots always render the generated cowboy for their difficulty.
  if (player.isBot) {
    const difficulty = (player.bot && player.bot.difficulty) || 'normal';
    return {
      kind: 'cowboy',
      src: typeof botSrc === 'function' ? botSrc(difficulty) : null,
      crop: null,
      avatarId: player.bot && player.bot.avatarId ? player.bot.avatarId : null
    };
  }

  // 2) The seat's own uploaded avatar, IF this client has the blob for it.
  const meta = player.avatarMeta;
  const avatarId = meta && typeof meta.avatarId === 'string' ? meta.avatarId : null;
  if (avatarId && avatarById && avatarById[avatarId]) {
    const local = avatarById[avatarId];
    return {
      kind: 'upload',
      src: local.url,
      crop: local.crop || (meta && meta.crop) || null,
      avatarId
    };
  }

  // 3) Fallback: neutral default (covers other players + your-not-yet-uploaded).
  return { kind: 'default', src: defaultSrc || null, crop: null, avatarId };
}

/**
 * Simple, always-valid CSS for an avatar image (used for cowsboys + the
 * default + un-cropped uploads). Circular masking is done in CSS (see styles.css);
 * the component only needs this background descriptor.
 * @param {{ src?: string }} view
 * @returns {object|null} an inline-style fragment for a <div>, or null
 */
export function avatarCss(view) {
  if (!view || !view.src) return null;
  return {
    backgroundImage: `url("${view.src}")`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat'
  };
}

/**
 * CSS that frames a square crop window (in source pixels) inside a source image
 * of known dimensions. Uses background-size/position so no <img> scaling is
 * needed and the crop is pixel-accurate. Pure string building.
 *
 * @param {object} crop  { x, y, size } in source pixels
 * @param {number} srcW  source image width (px)
 * @param {number} srcH  source image height (px)
 * @returns {object} inline-style fragment
 */
export function cropCss(crop, srcW, srcH) {
  const w = Math.max(1, Number(srcW) || 1);
  const h = Math.max(1, Number(srcH) || 1);
  const size = Math.max(1, (crop && crop.size) || Math.min(w, h));
  const x = Math.max(0, (crop && crop.x) || 0);
  const y = Math.max(0, (crop && crop.y) || 0);
  // Scale the whole source so the crop window (`size` px) fills the element
  // exactly, then position so the crop's top-left sits at the element's corner.
  const bgSize = `${(w * 100) / size}% ${(h * 100) / size}%`;
  // background-position % is relative to (element - rendered image); the
  // correct framing offset is x / (w - size) (0 when the crop spans the axis).
  const posX = w > size ? (x * 100) / (w - size) : 0;
  const posY = h > size ? (y * 100) / (h - size) : 0;
  return {
    backgroundSize: bgSize,
    backgroundPosition: `${posX}% ${posY}%`,
    backgroundRepeat: 'no-repeat'
  };
}
