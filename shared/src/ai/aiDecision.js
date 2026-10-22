import { minRaise, maxBet } from '../bettingRules.js';
import { parseCard } from '../cards.js';
import { rankCards } from '../fastEval.js';
import { estimateWinTieLose } from './aiMonteCarlo.js';

/**
 * CPU poker decisions. Pure functions: no I/O.
 *
 * The engine (aiEngine.js) turns the table into a compact `state` and calls
 * rankCandidates(), which returns weighted candidate actions (best first).
 *
 * Preflop: Chen-formula hand rating against position-based opening ranges,
 * 3-bets and pot-odds calls versus raises, push/fold when short-stacked.
 * Postflop: Monte-Carlo equity against the live opponents (discounted when
 * someone has bet, since betting ranges are stronger than random hands),
 * compared with pot odds, plus draws for semi-bluffs, continuation bets and
 * value bets sized to the pot.
 *
 * `state` (see aiEngine.normalizeState):
 *   { hole, community, street, pot, toCall, committed, chips, bigBlind,
 *     currentBet, gameType, lastRaiseIncrement, raiseCount, maxRaises,
 *     playersRemaining, position, posScore, wasAggressor, limpers,
 *     boardTexture, equity? }
 */

const HIGH_POINTS = { 14: 10, 13: 8, 12: 7, 11: 6 };

/** Chen formula starting-hand score: about -1 (72o) to 20 (AA). */
export function chenScore(hole) {
  const [a, b] = hole.map((c) => parseCard(c));
  const hi = Math.max(a.value, b.value);
  const lo = Math.min(a.value, b.value);
  let score = HIGH_POINTS[hi] || hi / 2;
  if (hi === lo) return Math.max(5, score * 2);
  if (a.suit === b.suit) score += 2;
  const gap = hi - lo - 1;
  score -= [0, 1, 2, 4][gap] ?? 5;
  if (gap <= 1 && hi < 12) score += 1;
  return Math.ceil(score);
}

/** A 0..1 measure of raw hand strength from the known cards only. */
export function handStrength(state) {
  const { hole, community } = state;
  if (!community || community.length < 3) {
    return Math.min(1, Math.max(0, (chenScore(hole) + 1) / 21));
  }
  const made = rankCards([...hole, ...community]);
  let s = [0.2, 0.42, 0.62, 0.72, 0.8, 0.85, 0.92, 0.97, 0.99, 1][made.category];
  const draws = drawInfo(hole, community);
  if (made.category < 4 && draws.flushDraw) s += 0.1;
  if (made.category < 4 && draws.straightDraw) s += 0.07;
  return Math.min(1, s);
}

/** Pot odds: the share of the final pot we must win to break even on a call. */
export function potOddsRequired(state) {
  const { pot, toCall } = state;
  if (toCall <= 0) return 0;
  return toCall / (pot + toCall);
}

/** Flush / open-ended straight draws that use at least one of our hole cards. */
export function drawInfo(hole, community) {
  const all = [...hole, ...community].map((c) => parseCard(c));
  const holeSuits = new Set(hole.map((c) => c.slice(-1)));
  const suitCount = {};
  for (const c of all) suitCount[c.suit] = (suitCount[c.suit] || 0) + 1;
  const flushDraw =
    community.length < 5 && Object.entries(suitCount).some(([s, n]) => n === 4 && holeSuits.has(s));
  let mask = 0;
  for (const c of all) mask |= 1 << c.value;
  if (mask & (1 << 14)) mask |= 1 << 1;
  const holeMask = hole.reduce((m, c) => m | (1 << parseCard(c).value), 0);
  let straightDraw = false;
  if (community.length < 5) {
    for (let lo = 1; lo <= 10; lo += 1) {
      const window = 0b1111 << lo;
      if ((mask & window) === window && holeMask & window) {
        // open-ended: both ends still live
        const below = lo - 1 >= 1 && !(mask & (1 << (lo - 1)));
        const above = lo + 4 <= 14 && !(mask & (1 << (lo + 4)));
        if (below && above) straightDraw = true;
      }
    }
  }
  return { flushDraw, straightDraw };
}

/** Round a bet to a tidy number of chips (multiples of half a big blind). */
function tidy(amount, bigBlind) {
  const unit = Math.max(1, Math.round(bigBlind / 2));
  return Math.max(unit, Math.round(amount / unit) * unit);
}

/**
 * Weighted candidate actions for the given state + profile, best first.
 * `rng` drives every random choice (bluffs, mixing), so decisions are
 * reproducible for a given seed.
 */
export function rankCandidates(state, profile, rng) {
  const roll = () => (rng ? rng.next() : 0.5);
  const noise = (profile.noise || 0) * (roll() * 2 - 1);
  const p = { ...defaults, ...profile };

  const { pot, toCall, chips, bigBlind, currentBet, lastRaiseIncrement, raiseCount, maxRaises } = state;
  const minTarget = currentBet === 0 ? bigBlind : minRaise(currentBet, bigBlind, lastRaiseIncrement);
  const cap = maxBet(state.gameType, pot, state.street, bigBlind, currentBet);
  const maxTarget = cap === null ? state.committed + chips : Math.min(cap, state.committed + chips);
  const canAggress = raiseCount < maxRaises && state.committed + chips > minTarget && maxTarget >= minTarget;
  const aggressive = currentBet === 0 ? 'bet' : 'raise';

  const out = [];
  const add = (action, weight, amount = 0, why = '') => out.push({ action, weight, amount, why });
  // Bet or raise to `target` (a total for this street); shove if it is most of our stack.
  const aggress = (target, weight, why) => {
    if (!canAggress) return false;
    const total = Math.max(minTarget, Math.min(maxTarget, tidy(target, bigBlind)));
    if (total >= (state.committed + chips) * 0.7 || total >= maxTarget) add('allin', weight, 0, why);
    else add(aggressive, weight, total, why);
    return true;
  };

  const opponents = Math.max(1, state.playersRemaining - 1);
  const stackBB = (chips + state.committed) / bigBlind;
  const odds = potOddsRequired(state);

  if (state.street === 'preflop') {
    const chen = chenScore(state.hole) + noise * 10;
    const posScore = state.posScore ?? 0.5;
    // Opening threshold: tighter out of position and at full tables, looser
    // on the button and for loose personalities.
    const openThr = 8.5 - posScore * 3.5 - (p.looseness - 0.4) * 6 + Math.max(0, opponents - 4) * 0.4;

    if (typeof state.equity === 'number' && toCall > 0) {
      // A big bet or shove: compare our equity against the bettor's likely
      // range (wide for maniacs, narrow for rocks) with the price we are offered.
      const width = state.bettorWidth ?? 0.3;
      const eq = state.equity - p.rangeRespectPre * (1 - width) * Math.max(0, state.equity - 0.3);
      if (eq >= 0.6 && canAggress && roll() < p.aggression)
        add('allin', 1, 0, `well ahead (~${pct(eq)}): all in`);
      else if (eq + noise >= odds + p.callMargin)
        add('call', 1, 0, `~${pct(eq)} against their range vs ${pct(odds)} pot odds: call`);
    } else if (stackBB <= 12 && (toCall > 0 || canAggress)) {
      // Short stack: push or fold.
      const shoveThr = openThr - 2 - (12 - stackBB) * 0.25;
      if (chen >= shoveThr) add('allin', 1, 0, 'short stack, good hand: all in');
    } else if (raiseCount === 0) {
      // Unopened (or only limped) pot.
      if (chen >= openThr) {
        const open = bigBlind * (2.5 + p.aggression * 0.6) + state.limpers * bigBlind;
        aggress(currentBet + open - bigBlind, 1, 'good starting hand: raise');
      } else if (toCall === 0) {
        add('check', 1, 0, 'free look at the flop');
      } else if (chen >= openThr - 2.5 * p.looseness - 0.5 && roll() < p.looseness) {
        add('call', 0.9, 0, 'playable hand: limp in');
      }
    } else {
      // Facing a raise (or more).
      const pressure = raiseCount - 1;
      const threeBetThr = 12.5 - p.aggression * 2 + pressure * 2.5;
      const callThr = openThr + 1.5 + pressure * 2 - (odds < 0.25 ? 1.5 : 0) - p.callDown * 6;
      const bluff3 =
        canAggress && p.bluffFreq > 0 && roll() < p.bluffFreq * 0.5 && chen >= 6 && posScore > 0.6;
      if (chen >= threeBetThr || bluff3) {
        aggress(
          currentBet * (2.6 + p.aggression * 0.6),
          1,
          bluff3 ? 'representing strength' : 'premium hand: re-raise'
        );
        if (!out.length) add('call', 1, 0, 'premium hand: call');
      } else if (chen >= callThr && toCall <= chips * (0.25 + p.looseness * 0.5)) {
        add('call', 1, 0, 'good hand at a fair price: call');
      }
    }
  } else {
    // ---------------------------------------------------------------- postflop
    const raw = typeof state.equity === 'number' ? state.equity : handStrength(state);
    // A bet narrows the bettor's range: discount our equity accordingly —
    // less against players who have been betting everything.
    const betRatio = toCall > 0 ? toCall / Math.max(1, pot - toCall) : 0;
    const respect = (p.rangeRespect * (1 - (state.bettorWidth ?? 0.3))) / 0.7;
    const equity = Math.min(1, Math.max(0, raw * (1 - respect * Math.min(1, betRatio)) + noise));
    const draws = drawInfo(state.hole, state.community);
    const drawing = draws.flushDraw || draws.straightDraw;
    const strongThr = 0.5 + 0.15 / opponents + (1 - p.aggression) * 0.08;

    if (toCall === 0) {
      if (equity >= strongThr + 0.18 && roll() < p.slowplay) {
        add('check', 1, 0, 'monster hand: slow-play');
      } else if (equity >= strongThr) {
        aggress(pot * (0.55 + p.aggression * 0.25), 1, `strong hand (${pct(equity)}): bet for value`);
      } else if (state.wasAggressor && roll() < p.cbet * (opponents === 1 ? 1 : 0.6)) {
        aggress(pot * (0.33 + p.aggression * 0.15), 1, 'keep the pressure on: continuation bet');
      } else if (drawing && roll() < p.aggression * 0.55) {
        aggress(pot * 0.5, 1, 'semi-bluff with a draw');
      } else if (roll() < p.bluffFreq * (opponents === 1 ? 1 : 0.4)) {
        aggress(pot * 0.5, 1, 'bluff');
      }
      if (!out.length) add('check', 1, 0, equity >= 0.35 ? 'pot control: check' : 'nothing yet: check');
    } else {
      const drawBonus = drawing && state.street !== 'river' ? (draws.flushDraw ? 0.12 : 0.08) : 0;
      const margin = p.callMargin - p.callDown;
      if (equity >= strongThr + 0.12 && canAggress) {
        aggress(
          currentBet * (2.4 + p.aggression * 0.8) + pot * 0.2,
          1,
          `very strong (${pct(equity)}): raise`
        );
      } else if (equity + drawBonus >= odds + margin) {
        add('call', 1, 0, `${pct(equity)} to win vs ${pct(odds)} pot odds: call`);
      } else if (drawing && canAggress && roll() < p.bluffFreq) {
        aggress(currentBet * 2.5, 1, 'semi-bluff raise');
      } else if (roll() < p.callDown * 0.5) {
        add('call', 0.8, 0, 'curious call');
      }
    }
  }

  // Always offer the passive alternatives (lower weight) so callers can see
  // the full menu and the list never comes back empty.
  const decided = out.length > 0;
  if (toCall === 0) add('check', decided ? 0.2 : 1, 0, 'check');
  else {
    add('call', decided ? 0.15 : 0.3, 0, 'call');
    add('fold', decided ? 0.1 : 1, 0, `not worth ${toCall}: fold`);
  }

  // Keep the first entry for each action, best weight first.
  const seen = new Set();
  return out
    .filter((c) => (seen.has(c.action) ? false : seen.add(c.action)))
    .sort((a, b) => b.weight - a.weight);
}

const defaults = {
  looseness: 0.45,
  aggression: 0.5,
  bluffFreq: 0.1,
  cbet: 0.55,
  callDown: 0.05,
  callMargin: 0.02,
  rangeRespect: 0.15,
  rangeRespectPre: 0.6,
  slowplay: 0.1,
  noise: 0.05
};

const pct = (x) => `${Math.round(x * 100)}%`;

/**
 * Monte-Carlo equity for the AI: win + half of ties, against the opponents
 * still in the hand (capped at 4 for speed).
 */
export function monteCarloEquity(state, profile, seed) {
  const opponents = Math.max(1, Math.min(4, (state.playersRemaining || 2) - 1));
  return estimateWinTieLose(state.hole, state.community, seed, profile.mcIterations || 200, opponents);
}
