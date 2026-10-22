/**
 * Opponent modelling: the CPUs remember how each player has been playing at
 * this table (how often they play a hand, raise, and go all in) and use it to
 * judge how strong a bet from that player really is. A maniac who shoves
 * every hand gets called much wider than a rock who only shoves aces.
 *
 * Pure data in, pure data out; the server keeps one stats map per table.
 */

const AGGRESSIVE = new Set(['bet', 'raise', 'allin']);

export function emptyStats() {
  return { hands: 0, vpip: 0, pfr: 0, aggr: 0, passive: 0, allins: 0 };
}

/**
 * Fold a finished hand into the stats map (mutates and returns `statsById`).
 * @param {object} statsById playerId -> stats
 * @param {object} game a GameTable right after the hand ended
 */
export function recordHand(statsById, game) {
  const dealt = Array.isArray(game.activePlayers) ? game.activePlayers : [];
  const seen = new Map();
  for (const a of game.actionLog || []) {
    const s = seen.get(a.playerId) || { vpip: false, pfr: false, aggr: 0, passive: 0, allin: false };
    if (a.street === 'preflop' && a.action !== 'fold' && a.action !== 'check') s.vpip = true;
    if (a.street === 'preflop' && AGGRESSIVE.has(a.action)) s.pfr = true;
    if (AGGRESSIVE.has(a.action)) s.aggr += 1;
    if (a.action === 'call') s.passive += 1;
    if (a.action === 'allin') s.allin = true;
    seen.set(a.playerId, s);
  }
  for (const id of dealt) {
    const st = statsById[id] || (statsById[id] = emptyStats());
    const s = seen.get(id);
    st.hands += 1;
    if (!s) continue;
    if (s.vpip) st.vpip += 1;
    if (s.pfr) st.pfr += 1;
    if (s.allin) st.allins += 1;
    st.aggr += s.aggr;
    st.passive += s.passive;
  }
  return statsById;
}

/**
 * How wide and how aggressive a player has looked, as 0..1 rates. Small
 * samples are pulled towards a typical player so one wild hand does not
 * convince the CPU that someone is a maniac.
 */
export function readOf(stats) {
  const s = stats || emptyStats();
  const prior = 6; // hands' worth of "typical player" assumption
  const vpip = (s.vpip + prior * 0.25) / (s.hands + prior);
  const pfr = (s.pfr + prior * 0.15) / (s.hands + prior);
  const allinRate = (s.allins + prior * 0.03) / (s.hands + prior);
  const af = (s.aggr + 2) / (s.passive + 3);
  // One number for "how loose are this player's bets": 0 = only the nuts, 1 = anything.
  const betWidth = Math.min(1, Math.max(pfr * 1.8, allinRate * 3, Math.min(1, af / 4) * vpip * 1.5));
  return { vpip, pfr, allinRate, af, betWidth, sample: s.hands };
}
