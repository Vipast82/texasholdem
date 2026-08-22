import { parseDisplayCard } from '../cardUtils.js';

/**
 * CardTile (Sprint 7) — a single playing-card graphic (rank + suit, correctly
 * colored) used in the Hand History panel to show the board and the winner's
 * five best cards as real card faces instead of a raw string like "Ks Qh".
 *
 * Reuses the shared `parseDisplayCard` (rank + suit + red/black) and the same
 * `.card` CSS the table uses, scaled down via the `.cardtile` class. Pure and
 * presentational: it renders one card or a neutral placeholder.
 */
export default function CardTile({ card, title }) {
  if (!card || typeof card !== 'string' || card.length < 2) {
    return <span className="cardtile cardtile--empty" aria-hidden="true" />;
  }
  let parsed;
  try {
    parsed = parseDisplayCard(card);
  } catch (err) {
    return <span className="cardtile cardtile--empty" aria-hidden="true" />;
  }
  return (
    <span
      className={`cardtile ${parsed.isRed ? 'cardtile--red' : 'cardtile--black'}`}
      role="img"
      aria-label={title || `${parsed.rank} ${parsed.suit}`}
    >
      <span className="cardtile__rank">{parsed.rank}</span>
      <span className="cardtile__suit">{parsed.suit}</span>
    </span>
  );
}

/** A small row of CardTiles from an array of card strings (null-safe). */
export function CardRow({ cards, titlePrefix = '' }) {
  const list = Array.isArray(cards) ? cards.filter((c) => c && c.length >= 2) : [];
  if (list.length === 0) return null;
  return (
    <span className="cardrow" role="group" aria-label={titlePrefix ? `${titlePrefix} ${list.join(' ')}` : list.join(' ')}>
      {list.map((c, i) => (
        <CardTile key={`${c}-${i}`} card={c} title={`${titlePrefix} ${c}`} />
      ))}
    </span>
  );
}