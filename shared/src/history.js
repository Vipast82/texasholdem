/**
 * Hand-history records (Sprint 4).
 *
 * `buildHandRecord` is a PURE serializer: given a GameTable (or anything with
 * the same public fields) right after `handEnded`, it returns a plain,
 * JSON-serializable object describing the completed hand — players, blinds,
 * per-street actions, board, winner(s), pots and the deck seed.
 *
 * Determinism is a hard requirement: no Date.now(), no Math.random(). The
 * only non-deterministic field is `ts`, which the caller supplies (defaults
 * to null so the pure form stays fully reproducible).
 */

/** Per-street breakdown of a player's committed chips + final chip count. */
function playerSummary(p) {
  const c = p.contributions || {};
  return {
    id: p.id,
    name: p.name,
    seat: p.seat,
    isBot: !!p.isBot,
    difficulty: p.bot && p.bot.difficulty ? p.bot.difficulty : null,
    folded: !!p.hasFolded,
    allIn: !!p.isAllIn,
    contributed: {
      preflop: c.preflop || 0,
      flop: c.flop || 0,
      turn: c.turn || 0,
      river: c.river || 0,
      total: (c.preflop || 0) + (c.flop || 0) + (c.turn || 0) + (c.river || 0)
    },
    chipsAfter: p.chips,
    holeCards: Array.isArray(p.holeCards) ? p.holeCards.slice() : null,
    // Best 5-card hand at showdown, if this player reached it.
    bestHand: null
  };
}

/**
 * Build a serializable record of the just-finished hand.
 *
 * @param {object} game GameTable (or duck-typed object) after handEnded
 * @param {object} [opts]
 * @param {number|null} [opts.ts] epoch-ms supplied by the caller (determinism: null by default)
 * @returns {object} JSON-safe hand record
 */
export function buildHandRecord(game, opts = {}) {
  if (!game) throw new Error('buildHandRecord requires a game table');

  const showdown = game.lastShowdown || null;
  // Showdown hands list every tied winner; a hand won uncontested (everyone
  // else folded or left) has its single winner on lastEnd.
  const foldWinner = game.lastEnd && game.lastEnd.winnerId;
  const winners = showdown ? showdown.winnerIds.slice() : foldWinner ? [foldWinner] : [];
  const ranked = showdown && showdown.ranked ? showdown.ranked : null;

  // Per-player best hand at showdown (only for players who actually reached it).
  const bestBySeat = {};
  if (showdown && showdown.all && Array.isArray(game.community)) {
    for (const id of Object.keys(showdown.all)) {
      bestBySeat[id] = summarizeRanked(showdown.all[id]);
    }
  }

  const players = (game.players || []).map((p) => {
    const s = playerSummary(p);
    s.bestHand = bestBySeat[p.id] || null;
    return s;
  });

  return {
    schema: 'saloon.hand-record/v1',
    tableId: game.tableId || null,
    handNumber: game.handNumber || 0,
    gameType: game.gameType || 'no-limit',
    smallBlind: game.smallBlind,
    bigBlind: game.bigBlind,
    startingStack: game.startingStack,
    seed: game.lastSeed || game.tutorialSeed || null,
    dealerSeat: game.dealerSeat,
    board: Array.isArray(game.community) ? game.community.slice() : [],
    reason: (game.lastEnd && game.lastEnd.reason) || (showdown ? 'showdown' : 'fold'),
    winnerIds: winners,
    rankedHand: ranked ? summarizeRanked(ranked) : null,
    payouts: showdown && showdown.payouts ? Object.assign({}, showdown.payouts) : game.payouts || {},
    potAtEnd: game.lastPot != null ? game.lastPot : game.pot || 0,
    actions: (game.actionLog || []).map((a) => ({
      playerId: a.playerId,
      action: a.action,
      amount: a.amount,
      street: a.street,
      pot: a.pot
    })),
    players,
    ts: opts.ts != null ? opts.ts : null
  };
}

/** Compact, JSON-safe form of a ranked hand (category, name, tiebreakers, cards). */
function summarizeRanked(ranked) {
  if (!ranked) return null;
  return {
    category: ranked.category,
    tiebreakers: (ranked.tiebreakers || []).slice(),
    cards: (ranked.cards || []).slice()
  };
}

/**
 * Serialize a record (or array of records) to a pretty-printed JSON string.
 * Output is deterministic for identical records (Object key order is stable).
 * @param {object|object[]} record(s)
 * @param {string} [indent] 2 spaces by default
 */
export function serializeHandRecord(record, indent = 2) {
  const payload = Array.isArray(record) ? { hands: record } : record;
  return JSON.stringify(payload, null, indent);
}
