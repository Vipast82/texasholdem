import { Rng } from '@saloon/shared';

/**
 * Western character portraits for players without an uploaded picture.
 * Seeded by the player's name, so a character always looks the same and two
 * players at a table rarely match. Pure: returns an inline SVG data URI.
 */

const BACKDROPS = ['#6b4a2b', '#3d5a4a', '#5e3a35', '#3f4a63', '#6b5a2b', '#4b3b5a'];
const SKINS = ['#f1c9a5', '#e0ac7e', '#c68b59', '#a0663f', '#7a4a2a'];
const HATS = [
  { crown: '#2a1d14', band: '#b8432f' },
  { crown: '#c7a46b', band: '#5a3a24' },
  { crown: '#6d4526', band: '#d2a54c' },
  { crown: '#efe6d2', band: '#3d5a4a' },
  { crown: '#4a4f57', band: '#c2b8a3' },
  { crown: '#8a2e22', band: '#2a1d14' }
];
const HAIR = ['#2b1d12', '#5a3a1c', '#8a5a2b', '#c9a15a', '#9a9a96', '#e9e4d8'];
const SHIRTS = ['#7a2618', '#2c4562', '#3e5a2e', '#5a4632', '#d9cfb9'];
const BANDANAS = ['#b8432f', '#2c4562', '#d2a54c', '#2f7a4b', '#1d1a16'];

function pick(rng, list) {
  return list[rng.nextInt(list.length)];
}

export function characterSvg(seed, difficulty = 'normal') {
  const rng = new Rng(`character:${seed}`);
  const bg = pick(rng, BACKDROPS);
  const skin = pick(rng, SKINS);
  const hat = pick(rng, HATS);
  const hair = pick(rng, HAIR);
  const shirt = pick(rng, SHIRTS);
  const bandana = pick(rng, BANDANAS);
  const facial = rng.nextInt(4); // 0 none, 1 mustache, 2 handlebar, 3 beard
  const wearsBandana = rng.next() < 0.6;
  const tough = difficulty === 'hard';
  const friendly = difficulty === 'easy';

  const mouth = friendly
    ? '<path d="M44 66 Q50 71 56 66" stroke="#3a2214" stroke-width="2" fill="none" stroke-linecap="round"/>'
    : tough
      ? '<path d="M44 67 L56 66" stroke="#3a2214" stroke-width="2" stroke-linecap="round"/>'
      : '<path d="M45 67 Q50 69 55 67" stroke="#3a2214" stroke-width="2" fill="none" stroke-linecap="round"/>';
  const brows = tough
    ? '<path d="M38 50 L46 52 M62 50 L54 52" stroke="#2b1d12" stroke-width="2.2" stroke-linecap="round"/>'
    : '<path d="M38 51 Q42 49 46 51 M54 51 Q58 49 62 51" stroke="#2b1d12" stroke-width="1.8" fill="none" stroke-linecap="round"/>';
  const eyes =
    tough && rng.next() < 0.5
      ? '<circle cx="42" cy="56" r="2.2" fill="#1d1a16"/><path d="M53 53 h9 v6 h-9 Z M53 54 L34 47 M62 54 L70 52" fill="#1d1a16" stroke="#1d1a16" stroke-width="1.4"/>'
      : '<circle cx="42" cy="56" r="2.2" fill="#1d1a16"/><circle cx="58" cy="56" r="2.2" fill="#1d1a16"/>';
  const facialHair = [
    '',
    `<path d="M42 63 Q50 60 58 63 Q50 66 42 63 Z" fill="${hair}"/>`,
    `<path d="M40 66 Q42 61 50 62 Q58 61 60 66 Q57 63 50 64.5 Q43 63 40 66 Z" fill="${hair}"/>`,
    `<path d="M34 58 Q35 78 50 80 Q65 78 66 58 Q62 70 50 70 Q38 70 34 58 Z" fill="${hair}"/>`
  ][facial];

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">` +
    `<defs><radialGradient id="g" cx="50%" cy="35%" r="70%"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset="1" stop-color="#000" stop-opacity=".25"/></radialGradient></defs>` +
    `<rect width="100" height="100" fill="${bg}"/><rect width="100" height="100" fill="url(#g)"/>` +
    // shoulders, vest and neck
    `<path d="M14 100 Q16 80 36 76 L64 76 Q84 80 86 100 Z" fill="${shirt}"/>` +
    `<path d="M14 100 Q16 82 34 77 L42 100 Z M86 100 Q84 82 66 77 L58 100 Z" fill="#2a1d14" opacity=".75"/>` +
    `<rect x="44" y="66" width="12" height="13" fill="${skin}"/>` +
    (wearsBandana ? `<path d="M36 76 L64 76 L50 90 Z" fill="${bandana}"/>` : '') +
    // head
    `<circle cx="32" cy="57" r="4" fill="${skin}"/><circle cx="68" cy="57" r="4" fill="${skin}"/>` +
    `<ellipse cx="50" cy="58" rx="17" ry="20" fill="${skin}"/>` +
    `<path d="M33 50 Q33 40 50 40 Q67 40 67 50 Q60 45 50 45 Q40 45 33 50 Z" fill="${hair}"/>` +
    brows +
    eyes +
    `<path d="M50 57 L48 63 L52 63" stroke="#00000040" stroke-width="1.4" fill="none" stroke-linejoin="round"/>` +
    facialHair +
    mouth +
    // hat
    `<ellipse cx="50" cy="42" rx="34" ry="7" fill="${hat.crown}"/>` +
    `<path d="M34 42 Q33 22 42 19 Q50 24 58 19 Q67 22 66 42 Z" fill="${hat.crown}"/>` +
    `<path d="M34.5 36 Q50 39 65.5 36 L66 41 Q50 44 34 41 Z" fill="${hat.band}"/>` +
    `<ellipse cx="50" cy="42" rx="34" ry="7" fill="none" stroke="#00000030" stroke-width="1"/>` +
    `</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
