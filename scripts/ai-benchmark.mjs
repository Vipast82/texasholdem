#!/usr/bin/env node
/**
 * CPU strength benchmark: 6-handed tables with two CPUs of each difficulty.
 * Stacks are reset every hand (a cash game), seats rotate, and we report each
 * difficulty's result in big blinds won per 100 hands. A correctly tuned AI
 * shows hard > normal > easy.
 *
 *   node scripts/ai-benchmark.mjs [hands=3000]
 */
import { GameTable } from '../shared/src/gameEngine.js';
import { decideAction } from '../shared/src/ai/aiEngine.js';
import { recordHand } from '../shared/src/ai/opponentModel.js';

const HANDS = Number(process.argv[2]) || 3000;
const BB = 20;
const STACK = 2000;
const LINEUP = ['easy', 'easy', 'normal', 'normal', 'hard', 'hard'];
const NAMES = ['Kate', 'Dave', 'Nina', 'Oscar', 'Jack', 'Vera'];

const net = { easy: 0, normal: 0, hard: 0 };
const stats = { easy: { vpip: 0, hands: 0 }, normal: { vpip: 0, hands: 0 }, hard: { vpip: 0, hands: 0 } };
let errors = 0;
const reads = {}; // opponent model, as the server keeps it
let showdowns = 0;
const started = Date.now();

const table = new GameTable({
  tableId: 'bench',
  smallBlind: BB / 2,
  bigBlind: BB,
  startingStack: STACK,
  tutorialSeed: 'bench'
});
LINEUP.forEach((diff, seat) =>
  table.addPlayer({ id: `p${seat}`, name: NAMES[seat], seat, isBot: true, bot: { difficulty: diff } })
);

for (let h = 0; h < HANDS; h += 1) {
  // Rotate who sits where every 6 hands so nobody keeps a positional edge.
  const shift = Math.floor(h / 6) % 6;
  table.players.forEach((p, i) => {
    p.chips = STACK;
    p.bot.difficulty = LINEUP[(i + shift) % 6];
  });
  table.startHand();
  const voluntary = new Set();
  let guard = 0;
  while (table.inHand && guard < 300) {
    guard += 1;
    const id = table.nextActorId();
    if (!id) {
      errors += 1;
      break;
    }
    const p = table.playerById(id);
    const d = decideAction(table, id, {
      difficulty: p.bot.difficulty,
      persona: p.name,
      seed: `b${h}:${guard}`,
      reads
    });
    if (table.street === 'preflop' && ['call', 'raise', 'bet', 'allin'].includes(d.action)) voluntary.add(id);
    try {
      table.applyAction(id, d.action, d.amount || 0);
    } catch (err) {
      errors += 1;
      table.applyAction(id, table.currentBet > p.contributions[table.street] ? 'fold' : 'check');
    }
  }
  recordHand(reads, table);
  if (table.lastShowdown) showdowns += 1;
  for (const p of table.players) {
    const diff = p.bot.difficulty;
    net[diff] += p.chips - STACK;
    stats[diff].hands += 1;
    if (voluntary.has(p.id)) stats[diff].vpip += 1;
  }
}

const secs = ((Date.now() - started) / 1000).toFixed(1);
console.log(
  `${HANDS} hands in ${secs}s, ${errors} illegal/stuck actions, ${Math.round((showdowns / HANDS) * 100)}% showdowns`
);
for (const diff of ['easy', 'normal', 'hard']) {
  const per100 = (net[diff] / BB / (stats[diff].hands / 100)).toFixed(1);
  const vpip = Math.round((stats[diff].vpip / stats[diff].hands) * 100);
  console.log(`${diff.padEnd(6)}  ${per100.padStart(7)} bb/100   plays ${vpip}% of hands`);
}
if (errors > 0) process.exitCode = 1;
