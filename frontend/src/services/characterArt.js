import { Rng } from '@saloon/shared';

/**
 * Western character portraits. Every feature comes from a short list of
 * options; a player can pick each one in the character creator (a "look"),
 * and anything not picked is chosen from a seed (the player's name), so a
 * character always looks the same. Pure: returns an inline SVG data URI.
 */

export const LOOK_OPTIONS = {
  backdrop: ['#6b4a2b', '#3d5a4a', '#5e3a35', '#3f4a63', '#6b5a2b', '#4b3b5a', '#2f2a26', '#7a5a3a'],
  skin: ['#f6d2b4', '#f1c9a5', '#e0ac7e', '#c68b59', '#a0663f', '#7a4a2a', '#5a3620'],
  hat: ['cowboy', 'gambler', 'wide', 'bowler', 'none'],
  hatColor: ['#2a1d14', '#c7a46b', '#6d4526', '#efe6d2', '#4a4f57', '#8a2e22', '#3a4a2e'],
  hair: ['short', 'long', 'bald', 'curly'],
  hairColor: ['#2b1d12', '#5a3a1c', '#8a5a2b', '#c9a15a', '#a8452a', '#9a9a96', '#e9e4d8'],
  facial: ['none', 'mustache', 'handlebar', 'beard', 'stubble'],
  shirt: ['#7a2618', '#2c4562', '#3e5a2e', '#5a4632', '#d9cfb9', '#2a2522'],
  bandana: ['none', '#b8432f', '#2c4562', '#d2a54c', '#2f7a4b', '#1d1a16'],
  eyes: ['plain', 'squint', 'patch', 'spectacles']
};

const HAT_BAND = ['#b8432f', '#5a3a24', '#d2a54c', '#3d5a4a', '#c2b8a3', '#2a1d14', '#d2a54c'];
const KEYS = Object.keys(LOOK_OPTIONS);

/** Resolve a full look (indices) from a seed, overridden by any chosen features. */
export function resolveLook(seed, look = null) {
  const rng = new Rng(`character:${seed}`);
  const out = {};
  for (const k of KEYS) {
    const n = LOOK_OPTIONS[k].length;
    const rolled = rng.nextInt(n); // always roll, so picks never shift other features
    const chosen = look && Number.isInteger(look[k]) ? look[k] : null;
    out[k] = chosen !== null && chosen >= 0 && chosen < n ? chosen : rolled;
  }
  return out;
}

/** A random look (for the creator's "Surprise me" button). */
export function randomLook(seed) {
  return resolveLook(`${seed}:${Math.random()}`);
}

function hatSvg(style, color, band) {
  switch (style) {
    case 'gambler':
      return (
        `<ellipse cx="50" cy="40" rx="27" ry="5" fill="${color}"/>` +
        `<path d="M36 40 L37 22 Q50 19 63 22 L64 40 Z" fill="${color}"/>` +
        `<rect x="36.5" y="33" width="27" height="5" fill="${band}"/>`
      );
    case 'wide':
      return (
        `<ellipse cx="50" cy="42" rx="42" ry="8" fill="${color}"/>` +
        `<path d="M35 42 Q34 16 50 14 Q66 16 65 42 Z" fill="${color}"/>` +
        `<path d="M35.3 35 Q50 38 64.7 35 L65 41 Q50 44 35 41 Z" fill="${band}"/>`
      );
    case 'bowler':
      return (
        `<ellipse cx="50" cy="40" rx="24" ry="4.5" fill="${color}"/>` +
        `<path d="M34 40 Q34 20 50 20 Q66 20 66 40 Z" fill="${color}"/>` +
        `<rect x="34" y="35" width="32" height="4" fill="${band}"/>`
      );
    case 'none':
      return '';
    default:
      return (
        `<ellipse cx="50" cy="42" rx="34" ry="7" fill="${color}"/>` +
        `<path d="M34 42 Q33 22 42 19 Q50 24 58 19 Q67 22 66 42 Z" fill="${color}"/>` +
        `<path d="M34.5 36 Q50 39 65.5 36 L66 41 Q50 44 34 41 Z" fill="${band}"/>` +
        `<ellipse cx="50" cy="42" rx="34" ry="7" fill="none" stroke="#00000030" stroke-width="1"/>`
      );
  }
}

function hairSvg(style, color, hatless) {
  const top = hatless
    ? `<path d="M33 52 Q31 33 50 32 Q69 33 67 52 Q62 41 50 41 Q38 41 33 52 Z" fill="${color}"/>`
    : `<path d="M33 50 Q33 40 50 40 Q67 40 67 50 Q60 45 50 45 Q40 45 33 50 Z" fill="${color}"/>`;
  switch (style) {
    case 'long':
      return `<path d="M32 46 Q28 66 34 78 L38 76 Q35 62 36 48 Z M68 46 Q72 66 66 78 L62 76 Q65 62 64 48 Z" fill="${color}"/>${top}`;
    case 'bald':
      return hatless ? '' : top;
    case 'curly':
      return (
        top +
        `<circle cx="33" cy="49" r="4" fill="${color}"/><circle cx="67" cy="49" r="4" fill="${color}"/>` +
        `<circle cx="32" cy="56" r="3.5" fill="${color}"/><circle cx="68" cy="56" r="3.5" fill="${color}"/>`
      );
    default:
      return top;
  }
}

function eyesSvg(style, tough) {
  const brows = tough
    ? '<path d="M38 50 L46 52 M62 50 L54 52" stroke="#2b1d12" stroke-width="2.2" stroke-linecap="round"/>'
    : '<path d="M38 51 Q42 49 46 51 M54 51 Q58 49 62 51" stroke="#2b1d12" stroke-width="1.8" fill="none" stroke-linecap="round"/>';
  switch (style) {
    case 'squint':
      return (
        brows + '<path d="M39 56 h6 M55 56 h6" stroke="#1d1a16" stroke-width="2.2" stroke-linecap="round"/>'
      );
    case 'patch':
      return (
        brows +
        '<circle cx="42" cy="56" r="2.2" fill="#1d1a16"/>' +
        '<path d="M53 52.5 h9.5 v7 h-9.5 Z" fill="#1d1a16"/><path d="M53 54 L33 46 M62.5 54 L70 51" stroke="#1d1a16" stroke-width="1.4"/>'
      );
    case 'spectacles':
      return (
        brows +
        '<circle cx="42" cy="56" r="2" fill="#1d1a16"/><circle cx="58" cy="56" r="2" fill="#1d1a16"/>' +
        '<circle cx="42" cy="56" r="5" fill="none" stroke="#c9a15a" stroke-width="1.4"/>' +
        '<circle cx="58" cy="56" r="5" fill="none" stroke="#c9a15a" stroke-width="1.4"/>' +
        '<path d="M47 56 h6" stroke="#c9a15a" stroke-width="1.4"/>'
      );
    default:
      return (
        brows +
        '<circle cx="42" cy="56" r="2.2" fill="#1d1a16"/><circle cx="58" cy="56" r="2.2" fill="#1d1a16"/>'
      );
  }
}

function facialSvg(style, color) {
  switch (style) {
    case 'mustache':
      return `<path d="M42 63 Q50 60 58 63 Q50 66 42 63 Z" fill="${color}"/>`;
    case 'handlebar':
      return `<path d="M40 66 Q42 61 50 62 Q58 61 60 66 Q57 63 50 64.5 Q43 63 40 66 Z" fill="${color}"/>`;
    case 'beard':
      return `<path d="M34 58 Q35 78 50 80 Q65 78 66 58 Q62 70 50 70 Q38 70 34 58 Z" fill="${color}"/>`;
    case 'stubble':
      return `<path d="M36 62 Q37 75 50 77 Q63 75 64 62 Q60 71 50 71 Q40 71 36 62 Z" fill="${color}" opacity=".35"/>`;
    default:
      return '';
  }
}

/** The portrait for `seed` (usually the player's name), with optional chosen features. */
export function characterSvg(seed, difficulty = 'normal', look = null) {
  const L = resolveLook(seed, look);
  const O = LOOK_OPTIONS;
  const skin = O.skin[L.skin];
  const hatStyle = O.hat[L.hat];
  const hairColor = O.hairColor[L.hairColor];
  const bandana = O.bandana[L.bandana];
  const tough = difficulty === 'hard';
  const friendly = difficulty === 'easy';

  const mouth = friendly
    ? '<path d="M44 66 Q50 71 56 66" stroke="#3a2214" stroke-width="2" fill="none" stroke-linecap="round"/>'
    : tough
      ? '<path d="M44 67 L56 66" stroke="#3a2214" stroke-width="2" stroke-linecap="round"/>'
      : '<path d="M45 67 Q50 69 55 67" stroke="#3a2214" stroke-width="2" fill="none" stroke-linecap="round"/>';

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">` +
    `<defs><radialGradient id="g" cx="50%" cy="35%" r="70%"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset="1" stop-color="#000" stop-opacity=".25"/></radialGradient></defs>` +
    `<rect width="100" height="100" fill="${O.backdrop[L.backdrop]}"/><rect width="100" height="100" fill="url(#g)"/>` +
    // shoulders, vest and neck
    `<path d="M14 100 Q16 80 36 76 L64 76 Q84 80 86 100 Z" fill="${O.shirt[L.shirt]}"/>` +
    `<path d="M14 100 Q16 82 34 77 L42 100 Z M86 100 Q84 82 66 77 L58 100 Z" fill="#2a1d14" opacity=".75"/>` +
    `<rect x="44" y="66" width="12" height="13" fill="${skin}"/>` +
    (bandana !== 'none' ? `<path d="M36 76 L64 76 L50 90 Z" fill="${bandana}"/>` : '') +
    // head
    `<circle cx="32" cy="57" r="4" fill="${skin}"/><circle cx="68" cy="57" r="4" fill="${skin}"/>` +
    `<ellipse cx="50" cy="58" rx="17" ry="20" fill="${skin}"/>` +
    hairSvg(O.hair[L.hair], hairColor, hatStyle === 'none') +
    eyesSvg(O.eyes[L.eyes], tough) +
    `<path d="M50 57 L48 63 L52 63" stroke="#00000040" stroke-width="1.4" fill="none" stroke-linejoin="round"/>` +
    facialSvg(O.facial[L.facial], hairColor) +
    mouth +
    hatSvg(hatStyle, O.hatColor[L.hatColor], HAT_BAND[L.hatColor]) +
    `</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** Portrait to preview for a (human) player before they sit down. */
export function avatarPreviewSrc(name, look) {
  return characterSvg(name || 'stranger', 'normal', look);
}
