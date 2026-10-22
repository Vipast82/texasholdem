import { evaluateBest, categoryName } from '@saloon/shared';

/**
 * Name of the best hand you hold right now ("Two pair", "Flush"…), for the
 * HUD readout. Before the flop it can only be a pair or a high card.
 * @returns {string|null}
 */
export function describeHand(holeCards, community = [], locale = 'en') {
  if (!Array.isArray(holeCards) || holeCards.length !== 2) return null;
  const cards = [...holeCards, ...(community || [])];
  try {
    if (cards.length >= 5) return categoryName(evaluateBest(cards).category, locale);
    const pair = holeCards[0].slice(0, -1) === holeCards[1].slice(0, -1);
    return categoryName(pair ? 1 : 0, locale);
  } catch (err) {
    return null;
  }
}
