// Card representation. A card is a string: rank + suit, e.g. "As" = Ace of spades.
// Suits: s=spades, h=hearts, d=diamonds, c=clubs. Ranks: 2-9, T(10), J, Q, K, A.

export const SUITS = ['s', 'h', 'd', 'c'];
export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];

export const SUIT_NAMES = {
  s: 'spades',
  h: 'hearts',
  d: 'diamonds',
  c: 'clubs'
};

export const SUIT_SYMBOLS = {
  s: '♠',
  h: '♥',
  d: '♦',
  c: '♣'
};

export const DECK = RANKS.flatMap((rank) => SUITS.map((suit) => rank + suit));

const VALUE_BY_RANK = Object.fromEntries(RANKS.map((rank, i) => [rank, i + 2]));

export function parseCard(card) {
  if (typeof card !== 'string' || card.length < 2) {
    throw new Error(`Invalid card: ${card}`);
  }
  const suit = card.slice(-1);
  const rank = card.slice(0, -1);
  const value = VALUE_BY_RANK[rank];
  if (!value || !SUIT_NAMES[suit]) {
    throw new Error(`Invalid card: ${card}`);
  }
  return { rank, suit, value };
}

export function rankValue(card) {
  return parseCard(card).value;
}

export const SUIT_NAMES_ES = {
  s: 'picas',
  h: 'corazones',
  d: 'diamantes',
  c: 'tréboles'
};

/** Human-readable: "As" -> "Ace of spades". */
export function cardName(card, lang = 'en') {
  const { rank, suit } = parseCard(card);
  const rankNames =
    lang === 'es'
      ? { A: 'As', K: 'Rey', Q: 'Reina', J: 'Jota', T: 'Diez' }
      : { A: 'Ace', K: 'King', Q: 'Queen', J: 'Jack', T: 'Ten' };
  const suitNames = lang === 'es' ? SUIT_NAMES_ES : SUIT_NAMES;
  const rankLabel = rankNames[rank] || rank;
  return `${rankLabel} of ${suitNames[suit]}`;
}

export function assertValidCards(cards) {
  const seen = new Set();
  for (const card of cards) {
    parseCard(card);
    if (seen.has(card)) throw new Error(`Duplicate card: ${card}`);
    seen.add(card);
  }
}
