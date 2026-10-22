/**
 * Who says what, and when. Pure decisions over the game table; the server
 * turns each decision into a concrete line, rate-limits it and broadcasts it
 * so every seat hears the same thing.
 *
 * A decision is { speaker: 'cpu' | 'announcer', playerId?, category, sfx? }.
 * `random` is injected so tests can pin the dice.
 */
import { evaluateBest, chenScore, handLineCategory } from '@saloon/shared';

const AGGRESSIVE = new Set(['bet', 'raise', 'allin']);

const pick = (list, random) => list[Math.floor(random() * list.length)];

/** Did this player make the last bet/raise of the hand? */
function lastAggressor(table) {
  const log = table.actionLog || [];
  for (let i = log.length - 1; i >= 0; i -= 1) if (AGGRESSIVE.has(log[i].action)) return log[i].playerId;
  return null;
}

/** Was this hand weak enough that winning it was a bluff? */
function wasBluffing(player, community) {
  if (!Array.isArray(player.holeCards) || player.holeCards.length !== 2) return false;
  try {
    if (community.length >= 3) return evaluateBest([...player.holeCards, ...community]).category === 0;
    return chenScore(player.holeCards) < 7;
  } catch (err) {
    return false;
  }
}

/** Talk when a hand ends: busts, brags, bad beats, and the announcer for your big hands. */
export function handEndTalk(table, random = Math.random) {
  const out = [];
  const players = table.players || [];
  const byId = new Map(players.map((p) => [p.id, p]));
  const dealt = new Set(table.activePlayers || []);
  const payouts = table.payouts || {};
  const winners = Object.keys(payouts).filter((id) => payouts[id] > 0);
  const potBB = (table.lastPot || 0) / table.bigBlind;
  const showdown = table.lastShowdown;
  const bots = players.filter((p) => p.isBot);
  const cpuSpoke = () => out.some((o) => o.speaker === 'cpu');

  // Someone just went broke.
  const bustedBot = bots.find((p) => p.chips === 0 && dealt.has(p.id));
  const bustedHuman = players.find((p) => !p.isBot && p.chips === 0 && dealt.has(p.id));
  if (bustedBot && random() < 0.7) {
    out.push({ speaker: 'cpu', playerId: bustedBot.id, category: 'busted' });
  } else if (bustedHuman) {
    const taunters = bots.filter((p) => p.chips > 0);
    if (taunters.length && random() < 0.6) {
      out.push({ speaker: 'cpu', playerId: pick(taunters, random).id, category: 'humanBusted' });
    }
  }

  const humanWinner = winners.find((id) => byId.get(id) && !byId.get(id).isBot);
  const botWinner = winners.find((id) => byId.get(id) && byId.get(id).isBot);

  if (humanWinner) {
    if (showdown) {
      const special = handLineCategory(showdown.ranked && showdown.ranked.category);
      if (special) out.push({ speaker: 'announcer', category: special });
      else if (potBB >= 20 && random() < 0.6) out.push({ speaker: 'announcer', category: 'humanWin' });
      // A CPU that lost the showdown tips its hat (through gritted teeth).
      const losers = Object.keys(showdown.all || {}).filter(
        (id) => !winners.includes(id) && byId.get(id) && byId.get(id).isBot
      );
      if (!cpuSpoke() && losers.length && potBB >= 10 && random() < 0.45) {
        out.push({ speaker: 'cpu', playerId: pick(losers, random), category: 'niceHand' });
      }
    } else if (potBB >= 25 && random() < 0.35) {
      out.push({ speaker: 'announcer', category: 'humanWin' });
    }
  } else if (botWinner && !cpuSpoke()) {
    const bot = byId.get(botWinner);
    if (showdown) {
      const losers = Object.keys(showdown.all || {}).filter(
        (id) => !winners.includes(id) && byId.get(id) && byId.get(id).isBot
      );
      if (potBB >= 12 && random() < 0.55) out.push({ speaker: 'cpu', playerId: bot.id, category: 'winBig' });
      else if (losers.length && potBB >= 30 && random() < 0.5) {
        out.push({ speaker: 'cpu', playerId: pick(losers, random), category: 'badBeat', sfx: 'badBeat' });
      } else if (random() < 0.4) out.push({ speaker: 'cpu', playerId: bot.id, category: 'winSmall' });
    } else if (lastAggressor(table) === bot.id && wasBluffing(bot, table.community || []) && random() < 0.4) {
      out.push({ speaker: 'cpu', playerId: bot.id, category: 'winBluff' });
    } else if (random() < 0.3) {
      out.push({ speaker: 'cpu', playerId: bot.id, category: 'winSmall' });
    }
  }
  return out;
}

/** Talk in reaction to one action (the engine's actionTaken payload). */
export function actionTalk(table, action, random = Math.random) {
  const actor = (table.players || []).find((p) => p.id === action.playerId);
  if (!actor) return null;
  const liveBots = (table.players || []).filter(
    (p) => p.isBot && p.id !== actor.id && p.status === 'in-hand' && !p.hasFolded
  );

  if (action.action === 'allin') {
    if (actor.isBot)
      return random() < 0.45 ? { speaker: 'cpu', playerId: actor.id, category: 'allInBot' } : null;
    if (liveBots.length && random() < 0.5) {
      return { speaker: 'cpu', playerId: pick(liveBots, random).id, category: 'reactAllIn' };
    }
    return null;
  }

  // A human folds to a CPU's bet: the CPU lets them hear about it.
  if (action.action === 'fold' && !actor.isBot) {
    const log = table.actionLog || [];
    for (let i = log.length - 1; i >= 0; i -= 1) {
      const a = log[i];
      if (a.street !== action.street) break;
      if (a.playerId === actor.id) continue;
      if (AGGRESSIVE.has(a.action)) {
        const bettor = (table.players || []).find((p) => p.id === a.playerId);
        if (bettor && bettor.isBot && random() < 0.3) {
          return { speaker: 'cpu', playerId: bettor.id, category: 'heckleFold', sfx: 'spittoon' };
        }
        break;
      }
    }
  }
  return null;
}

/** A CPU (other than the slowpoke) who is still in the hand, to nag them. */
export function slowHeckler(table, slowId, random = Math.random) {
  const bots = (table.players || []).filter(
    (p) => p.isBot && p.id !== slowId && p.status === 'in-hand' && !p.hasFolded
  );
  return bots.length ? { speaker: 'cpu', playerId: pick(bots, random).id, category: 'heckleSlow' } : null;
}
