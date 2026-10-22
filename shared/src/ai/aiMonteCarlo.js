import { DECK, parseCard } from '../cards.js';
import { rankCards, compareFast } from '../fastEval.js';
import { Rng } from '../rng.js';

/**
 * Deterministic Monte-Carlo win/tie/lose estimator.
 *
 * Given our two hole cards and any revealed community cards, this deals the
 * remaining board cards and a number of random opponent hands, then scores our
 * best 5-card combo against each opponent. The result is used both by the
 * HARD AI (equity) and by the later HUD odds (Sprint 3) — so it must stay
 * deterministic: same inputs + seed => same output, always.
 *
 * All randomness flows through createShuffledDeck, which is seeded. Each
 * iteration gets a *derived* seed so the whole estimate is reproducible
 * without depending on a single shared deck state.
 *
 * @param {string[]} hole two of our cards, e.g. ['As','Kd']
 * @param {string[]} community 0-5 revealed board cards
 * @param {string|number} seed any seed (string or number)
 * @param {number} [iterations] number of simulations (default 300)
 * @param {number} [opponents] random opponents to deal against (default 3)
 * @returns {{win:number,tie:number,lose:number,confidence:number}}
 */
export function estimateWinTieLose(hole, community, seed, iterations = 300, opponents = 3) {
  if (!hole || hole.length !== 2) throw new Error('estimateWinTieLose needs exactly 2 hole cards');
  const board = Array.isArray(community) ? community.slice() : [];
  if (board.length > 5) throw new Error('estimateWinTieLose board must be 5 or fewer');
  if (iterations <= 0) throw new Error('estimateWinTieLose needs iterations > 0');
  if (opponents <= 0) opponents = 1;

  const used = new Set([...hole, ...board]);
  for (const c of used) parseCard(c); // validate early

  const needBoard = Math.max(0, 5 - board.length);
  // A single seeded generator drives the whole estimate, so the full run is
  // reproducible given (hole, board, seed).
  const master = new Rng(`${seed}:${hole.join('')}:${board.join('')}`);
  const unknown = DECK.filter((c) => !used.has(c));
  const need = needBoard + opponents * 2;
  if (unknown.length < need) return { win: 0, tie: 0, lose: 0, confidence: 0 };
  let wins = 0;
  let ties = 0;
  let losses = 0;
  let played = 0;
  const dealtBoard = board.slice();
  const mine = hole.concat(board);

  for (let i = 0; i < iterations; i += 1) {
    // Partial Fisher-Yates: only shuffle the cards this deal actually needs.
    for (let k = 0; k < need; k += 1) {
      const j = k + master.nextInt(unknown.length - k);
      const tmp = unknown[k];
      unknown[k] = unknown[j];
      unknown[j] = tmp;
    }
    dealtBoard.length = board.length;
    mine.length = 2 + board.length;
    for (let k = 0; k < needBoard; k += 1) {
      dealtBoard.push(unknown[k]);
      mine.push(unknown[k]);
    }
    const myBest = rankCards(mine);

    let lost = false;
    let tied = false;
    for (let o = 0; o < opponents && !lost; o += 1) {
      const at = needBoard + o * 2;
      const oppBest = rankCards([unknown[at], unknown[at + 1], ...dealtBoard]);
      const cmp = compareFast(myBest, oppBest);
      if (cmp < 0) lost = true;
      else if (cmp === 0) tied = true;
    }
    if (lost) losses += 1;
    else if (tied) ties += 1;
    else wins += 1;
    played += 1;
  }

  if (played === 0) {
    return { win: 0, tie: 0, lose: 0, confidence: 0 };
  }
  const win = wins / played;
  const tie = ties / played;
  const lose = losses / played;
  // Confidence: how decisive the equity is (1 = near-certain win or lose).
  const confidence = Math.max(win, lose);
  return { win, tie, lose, confidence };
}
