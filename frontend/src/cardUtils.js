import { SUIT_SYMBOLS } from '@saloon/shared/cards';

const RANK_DISPLAY = {
  T: '10',
  J: 'J',
  Q: 'Q',
  K: 'K',
  A: 'A',
  '2': '2',
  '3': '3',
  '4': '4',
  '5': '5',
  '6': '6',
  '7': '7',
  '8': '8',
  '9': '9'
};

/** "As" -> { rank: "A", suit: "♠", isRed: false } */
export function parseDisplayCard(card) {
  const rank = card.slice(0, -1);
  const suit = card.slice(-1);
  return {
    rank: RANK_DISPLAY[rank] || rank,
    suit: SUIT_SYMBOLS[suit] || suit,
    isRed: suit === 'h' || suit === 'd'
  };
}

export function shortName(playerId) {
  if (!playerId) return '?';
  return playerId.slice(0, 4);
}
